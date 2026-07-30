// Edge Function: notificar-visita-nova
// Chamada logo após o agendamento de uma visita comercial.
// Envia:
//   1. Confirmação via WhatsApp para o visitante (se tiver celular)
//   2. Aviso via WhatsApp para a equipe Damata
//
// Payload POST: { visita_id: string }
//
// Secrets: META_WPP_TOKEN, META_WPP_PHONE_ID, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAM_PHONE = "5519996784361";
const TEMPLATE_VISITANTE = "confirmacao_visita_damata";
const TEMPLATE_EQUIPE    = "nova_visita_equipe";

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

function fmtDataHora(data: string, hora: string): string {
  const dt = new Date(data + "T12:00:00");
  const dateFmt = dt.toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
  return `${dateFmt} às ${hora.slice(0, 5)}`;
}

async function sendTemplate(
  metaUrl: string, token: string,
  phone: string, templateName: string,
  params: string[],
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
        components: [{
          type: "body",
          parameters: params.map((text) => ({ type: "text", text })),
        }],
      },
    }),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const token   = Deno.env.get("META_WPP_TOKEN");
  const phoneId = Deno.env.get("META_WPP_PHONE_ID");
  if (!token || !phoneId) return json({ error: "Secrets Meta não configurados." }, 500);

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH    = { apikey: SB_SR, Authorization: "Bearer " + SB_SR, "Content-Type": "application/json" };
  const META_URL = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  let payload: { visita_id?: string } = {};
  try { payload = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }
  if (!payload.visita_id) return json({ error: "visita_id obrigatório." }, 400);

  // Busca dados da visita com slot
  const res = await fetch(
    `${SB_URL}/rest/v1/visitas_comerciais?id=eq.${payload.visita_id}&select=id,nome,whatsapp,slot_id,slots_visita(data,hora)&limit=1`,
    { headers: sbH },
  );
  const [visita] = await res.json();
  if (!visita) return json({ error: "Visita não encontrada." }, 404);

  const slot = visita.slots_visita;
  if (!slot) return json({ error: "Slot não encontrado." }, 404);

  const primeiroNome = (visita.nome || "Visitante").split(" ")[0];
  const dataHora     = fmtDataHora(slot.data, slot.hora);
  const results: Record<string, unknown> = {};

  // 1. Confirmação para o visitante
  if (visita.whatsapp) {
    const phone = normalizePhone(visita.whatsapp);
    if (phone && phone.length >= 13) {
      const dateFmt = new Date(slot.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
      const hora    = slot.hora.slice(0, 5);
      try {
        const r = await sendTemplate(META_URL, token, phone, TEMPLATE_VISITANTE, [primeiroNome, dateFmt, hora]);
        results.visitante = r.error ? { erro: r.error.message } : { enviado: true, wamid: r.messages?.[0]?.id };
        if (!r.error) {
          await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
            method: "POST",
            headers: { ...sbH, Prefer: "return=minimal" },
            body: JSON.stringify({
              telefone: phone, nome: visita.nome || null,
              mensagem: `[Confirmação de visita] ${dateFmt} às ${hora}`,
              direcao: "enviada", tipo: "template", wamid: r.messages?.[0]?.id || null,
            }),
          });
        }
      } catch (e) {
        results.visitante = { erro: String(e) };
      }
    }
  } else {
    results.visitante = { skip: "sem WhatsApp" };
  }

  // 2. Aviso para a equipe
  try {
    const wppDisplay = visita.whatsapp || "não informado";
    const r = await sendTemplate(META_URL, token, TEAM_PHONE, TEMPLATE_EQUIPE, [visita.nome || "?", wppDisplay, dataHora]);
    results.equipe = r.error ? { erro: r.error.message } : { enviado: true, wamid: r.messages?.[0]?.id };
    if (!r.error) {
      await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
        method: "POST",
        headers: { ...sbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          telefone: TEAM_PHONE, nome: "Equipe Damata",
          mensagem: `[Nova visita] ${visita.nome} | ${wppDisplay} | ${dataHora}`,
          direcao: "enviada", tipo: "template", wamid: r.messages?.[0]?.id || null,
        }),
      });
    }
  } catch (e) {
    results.equipe = { erro: String(e) };
  }

  return json({ ok: true, visita_id: payload.visita_id, results });
});
