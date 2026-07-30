// Edge Function: notificar-cancelamento-visita
// Notifica a equipe Damata via WhatsApp quando uma visita é cancelada pelo admin.
// Payload POST: { nome: string, data_hora: string }

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const TEAM_PHONE = "5519996784361";
const TEMPLATE   = "cancelamento_visita_equipe";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: CORS });

  const token   = Deno.env.get("META_WPP_TOKEN");
  const phoneId = Deno.env.get("META_WPP_PHONE_ID");
  if (!token || !phoneId) return new Response("Secrets não configurados", { status: 500, headers: CORS });

  let payload: { nome?: string; data_hora?: string } = {};
  try { payload = await req.json(); } catch { /* ignore */ }

  const nome     = payload.nome     || "Visitante";
  const dataHora = payload.data_hora || "—";

  const res = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: TEAM_PHONE,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: "pt_BR" },
        components: [{ type: "body", parameters: [
          { type: "text", text: nome },
          { type: "text", text: dataHora },
        ]}],
      },
    }),
  });

  const data = await res.json();
  return new Response(JSON.stringify(data), { headers: { ...CORS, "Content-Type": "application/json" } });
});
