// Supabase Edge Function: followup-visita-comercial
// Envia follow-up automático via WhatsApp para visitantes com interesse pendente.
// Chamada diariamente pelo pg_cron às 13h UTC (10h Brasília).
//
// Secrets necessários:
//   META_WPP_TOKEN             = Bearer token permanente do Meta Cloud API
//   META_WPP_PHONE_ID          = Phone Number ID do WhatsApp Business
//   META_WPP_TEMPLATE_FOLLOWUP = Template aprovado (padrão: followup_visita_fd)
//
// Template followup_visita_fd:
//   Body: {{1}} = primeiro nome do visitante
//   Botão URL dinâmico: sufixo {{1}} = ID da visita (fazendadamata.com/?feedback={{1}})

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function normalizePhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return "+" + d;
  return "+55" + d;
}

async function sendTemplate(
  metaUrl: string, token: string,
  phone: string, templateName: string,
  bodyParams: string[],
  buttonParam: string,
) {
  const res = await fetch(metaUrl, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: bodyParams.map((text) => ({ type: "text", text })),
          },
          {
            type: "button",
            sub_type: "url",
            index: "0",
            parameters: [{ type: "text", text: buttonParam }],
          },
        ],
      },
    }),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const token = Deno.env.get("META_WPP_TOKEN");
  const phoneId = Deno.env.get("META_WPP_PHONE_ID");
  const templateName = Deno.env.get("META_WPP_TEMPLATE_FOLLOWUP") || "followup_visita_fd";

  if (!token || !phoneId) {
    return json({ error: "Configure META_WPP_TOKEN e META_WPP_PHONE_ID nos secrets." }, 500);
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH = { apikey: SB_SR, Authorization: "Bearer " + SB_SR, "Content-Type": "application/json" };
  const META_URL = `https://graph.facebook.com/v21.0/${phoneId}/messages`;
  const hoje = new Date().toISOString().slice(0, 10);

  // Busca visitas com follow-up ativo, sem feedback ainda, e proximo_followup <= hoje
  const res = await fetch(
    `${SB_URL}/rest/v1/visitas_comerciais` +
    `?followup_ativo=eq.true&feedback=is.null&proximo_followup=lte.${hoje}` +
    `&select=id,nome,whatsapp,followup_count&limit=100`,
    { headers: sbH },
  );

  const visitas: Array<{ id: string; nome: string; whatsapp: string; followup_count: number }> =
    await res.json();

  if (!Array.isArray(visitas) || !visitas.length) {
    return json({ ok: true, enviados: 0, msg: "Nenhum follow-up pendente.", data: hoje });
  }

  const enviados: string[] = [];
  const erros: Array<{ id: string; nome: string; erro: string }> = [];

  for (const v of visitas) {
    if (!v.whatsapp) {
      erros.push({ id: v.id, nome: v.nome || "?", erro: "Sem WhatsApp cadastrado" });
      continue;
    }
    const phone = normalizePhone(v.whatsapp);
    if (!phone || phone.length < 13) {
      erros.push({ id: v.id, nome: v.nome || "?", erro: `Telefone inválido: ${v.whatsapp}` });
      continue;
    }

    const primeiroNome = (v.nome || "").split(" ")[0] || "Cliente";

    try {
      const data = await sendTemplate(META_URL, token, phone, templateName, [primeiroNome], v.id);

      if (data.error) {
        erros.push({ id: v.id, nome: v.nome || "?", erro: data.error.message });
        continue;
      }

      // Avança proximo_followup em +7 dias e incrementa followup_count
      const proximo = new Date();
      proximo.setDate(proximo.getDate() + 7);

      await fetch(`${SB_URL}/rest/v1/visitas_comerciais?id=eq.${v.id}`, {
        method: "PATCH",
        headers: { ...sbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          proximo_followup: proximo.toISOString().slice(0, 10),
          followup_count: (v.followup_count || 0) + 1,
        }),
      });

      // Registra no log de mensagens
      await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
        method: "POST",
        headers: { ...sbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          telefone: phone,
          mensagem: `[Follow-up automático] ${primeiroNome} — ${templateName} — link: fazendadamata.com/?feedback=${v.id}`,
          direcao: "enviada",
          nome: v.nome || null,
          tipo: "template",
          wamid: data.messages?.[0]?.id || null,
        }),
      });

      enviados.push(`${v.nome || v.id} → ${phone}`);
    } catch (e) {
      erros.push({ id: v.id, nome: v.nome || "?", erro: String(e) });
    }
  }

  return json({ ok: true, enviados: enviados.length, erros, lista: enviados, data: hoje, total: visitas.length });
});
