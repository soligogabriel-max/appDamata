// Edge Function: enviar-orcamento-wpp
// Envia orçamento via WhatsApp com link para página pública.
// POST { id: "UUID" }  → busca orçamento, envia template, salva em wpp_mensagens

const SB_URL    = Deno.env.get("SUPABASE_URL")!;
const SB_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WPP_TOKEN = Deno.env.get("META_WPP_TOKEN")!;
const PHONE_ID  = Deno.env.get("META_WPP_PHONE_ID")!;
const TEMPLATE  = "orcamento_damata";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function normalizePhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return "+" + d;
  return "+55" + d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method Not Allowed", { status: 405, headers: CORS });

  try {
    const { id } = await req.json();
    if (!id) return new Response(JSON.stringify({ error: "id obrigatório" }), { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });

    // Busca orçamento
    const res = await fetch(`${SB_URL}/rest/v1/orcamentos?id=eq.${id}&select=id,nome_contratante,whatsapp,tipo_evento,data_evento,valor_total`, {
      headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
    });
    const rows = await res.json();
    const o = rows?.[0];

    if (!o) return new Response(JSON.stringify({ error: "Orçamento não encontrado" }), { status: 404, headers: { ...CORS, "Content-Type": "application/json" } });
    if (!o.whatsapp) return new Response(JSON.stringify({ error: "Orçamento sem WhatsApp cadastrado" }), { status: 422, headers: { ...CORS, "Content-Type": "application/json" } });

    const phone = normalizePhone(o.whatsapp);
    if (!phone || phone.length < 13) return new Response(JSON.stringify({ error: `Telefone inválido: ${o.whatsapp}` }), { status: 422, headers: { ...CORS, "Content-Type": "application/json" } });

    const nome = (o.nome_contratante || "Cliente").split(" ")[0];
    // O link aponta para o site da Damata, não direto para a função: o gateway
    // do Supabase força content-type: text/plain e CSP sandbox no domínio
    // compartilhado, então o cliente que abria a função via código-fonte.
    // orcamento.html busca o HTML da função e renderiza.
    const link = `https://fazendadamata.com/orcamento.html?id=${id}`;

    // Envia template WhatsApp
    const wppRes = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${WPP_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to: phone,
        type: "template",
        template: {
          name: TEMPLATE,
          language: { code: "pt_BR" },
          components: [{
            type: "body",
            parameters: [
              { type: "text", text: nome },
              { type: "text", text: link },
            ]
          }]
        }
      })
    });
    const wppData = await wppRes.json();

    if (wppData.error) {
      return new Response(JSON.stringify({ ok: false, error: wppData.error.message }), { headers: { ...CORS, "Content-Type": "application/json" } });
    }

    // Salva no histórico
    const sbH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
    await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
      method: "POST",
      headers: { ...sbH, Prefer: "return=minimal" },
      body: JSON.stringify({
        telefone: phone,
        mensagem: `[Orçamento] ${o.tipo_evento || ""} — link: ${link}`,
        direcao: "enviada",
        nome: o.nome_contratante || null,
        tipo: "template",
        wamid: wppData.messages?.[0]?.id || null,
      }),
    });

    return new Response(JSON.stringify({ ok: true, phone, wamid: wppData.messages?.[0]?.id }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json" } });
  }
});
