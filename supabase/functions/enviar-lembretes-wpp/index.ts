// Supabase Edge Function: enviar-lembretes-wpp
// Envia lembretes de vencimento de parcelas via WhatsApp (Meta Cloud API).
//
// Secrets necessários (Project Settings -> Edge Functions -> Secrets):
//   META_WPP_TOKEN    = Bearer token permanente do Meta Cloud API
//   META_WPP_PHONE_ID = Phone Number ID do WhatsApp Business
//   META_WPP_TEMPLATE = Nome do template aprovado (padrão: lembrete_vencimento)
//
// Template sugerido para criar no Meta Business Manager (categoria UTILITY, pt_BR):
//   Corpo: "Olá {{1}}! Passando para lembrar que a parcela {{2}}/{{3}} no valor
//   de R$ {{4}} referente ao seu evento na Fazenda Damata vence em {{5}}.
//   Qualquer dúvida estamos à disposição. 🌿"
//
// Supabase injeta automaticamente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

function fmtDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function fmtVal(val: number): string {
  return Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const token = Deno.env.get("META_WPP_TOKEN");
  const phoneId = Deno.env.get("META_WPP_PHONE_ID");
  const templateName = Deno.env.get("META_WPP_TEMPLATE") || "lembrete_vencimento";

  if (!token || !phoneId) {
    return json({ error: "Configure META_WPP_TOKEN e META_WPP_PHONE_ID nos secrets da Edge Function." }, 500);
  }

  let payload: { dias?: number; vencimento_de?: string; vencimento_ate?: string } = {};
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  // Período padrão: hoje até hoje + N dias
  const dias = payload.dias ?? 3;
  const hoje = new Date();
  const inicio = payload.vencimento_de ?? hoje.toISOString().slice(0, 10);
  const fimDate = new Date(hoje);
  fimDate.setDate(fimDate.getDate() + dias);
  const fim = payload.vencimento_ate ?? fimDate.toISOString().slice(0, 10);

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH = {
    apikey: SB_SR,
    Authorization: "Bearer " + SB_SR,
    "Content-Type": "application/json",
  };

  // 1. Busca parcelas pendentes no período
  const recRes = await fetch(
    `${SB_URL}/rest/v1/contas_a_receber?status=eq.NP&vencimento=gte.${inicio}&vencimento=lte.${fim}&deleted_at=is.null` +
    `&select=id,cod_evento,parcela,num_parcela,valor,vencimento&order=vencimento.asc&limit=500`,
    { headers: sbH },
  );
  const parcelas: Array<{ id: string; cod_evento: string; parcela: string; num_parcela: string; valor: number; vencimento: string }> =
    await recRes.json();

  if (!Array.isArray(parcelas) || !parcelas.length) {
    return json({ ok: true, enviados: 0, msg: "Nenhuma parcela pendente no período.", periodo: { de: inicio, ate: fim } });
  }

  // 2. Busca telefone do cliente via ficha_do_evento
  const codEventos = [...new Set(parcelas.map((p) => p.cod_evento).filter(Boolean))];
  const fichaRes = await fetch(
    `${SB_URL}/rest/v1/ficha_do_evento?cod=in.(${codEventos.map(encodeURIComponent).join(",")})` +
    `&select=cod,nome_contratante,celular&limit=500`,
    { headers: sbH },
  );
  const fichas: Array<{ cod: string; nome_contratante: string; celular: string }> = await fichaRes.json();
  const fichaMap: Record<string, { nome_contratante: string; celular: string }> = {};
  fichas.forEach((f) => { fichaMap[f.cod] = f; });

  // 3. Envia mensagens via Meta Cloud API
  const enviados: string[] = [];
  const erros: Array<{ cod_evento: string; parcela: string; erro: string }> = [];
  const META_URL = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  for (const p of parcelas) {
    const ficha = fichaMap[p.cod_evento];
    if (!ficha?.celular) {
      erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: "Sem telefone cadastrado em ficha_do_evento" });
      continue;
    }

    const phone = normalizePhone(ficha.celular);
    if (!phone || phone.length < 13) {
      erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: `Telefone inválido: ${ficha.celular}` });
      continue;
    }

    const primeiroNome = (ficha.nome_contratante || "Cliente").split(" ")[0];

    const body = {
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [
          {
            type: "body",
            parameters: [
              { type: "text", text: primeiroNome },
              { type: "text", text: String(p.parcela ?? "?") },
              { type: "text", text: String(p.num_parcela ?? "?") },
              { type: "text", text: fmtVal(p.valor ?? 0) },
              { type: "text", text: fmtDate(p.vencimento) },
            ],
          },
        ],
      },
    };

    try {
      const res = await fetch(META_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.error) {
        erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: data.error.message });
      } else {
        enviados.push(`${p.cod_evento} parc.${p.parcela ?? "?"}/${p.num_parcela ?? "?"} → ${phone}`);
      }
    } catch (e) {
      erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: String(e) });
    }
  }

  return json({
    ok: true,
    enviados: enviados.length,
    erros,
    lista: enviados,
    periodo: { de: inicio, ate: fim },
    total_parcelas: parcelas.length,
  });
});
