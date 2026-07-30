// Edge Function: lembrete-visita-3d
// Busca visitas agendadas para daqui a 3 dias e envia WhatsApp pedindo confirmação.
// Chamada pelo pg_cron diariamente às 12h UTC (9h BRT).
//
// Secrets: META_WPP_TOKEN, META_WPP_PHONE_ID, LEMBRETE_SECRET
// Template: confirme_visita_damata (UTILITY, pt_BR)
//   Body: {{1}}=nome {{2}}=data {{3}}=hora
//   Botão URL dinâmico: sufixo {{1}} = BASE64URL(id|token)

const SB_URL    = Deno.env.get("SUPABASE_URL")!;
const SB_KEY    = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WPP_TOKEN = Deno.env.get("META_WPP_TOKEN")!;
const PHONE_ID  = Deno.env.get("META_WPP_PHONE_ID")!;
const SECRET    = Deno.env.get("LEMBRETE_SECRET") ?? "damata2026";
const TEMPLATE  = "confirme_visita_damata";
const FUNC_BASE = `${Deno.env.get("SUPABASE_URL")?.replace("supabase.co", "supabase.co/functions/v1") ?? ""}/confirmar-visita?v=`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function makeToken(id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function encodeV(id: string, token: string): string {
  return btoa(id + "|" + token).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

function normalizePhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d.startsWith("55") ? d : "55" + d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    const agora = new Date();
    agora.setUTCHours(agora.getUTCHours() + 3);
    const em3d = new Date(agora);
    em3d.setDate(em3d.getDate() + 3);
    const data3d = em3d.toISOString().slice(0, 10);

    // Busca visitas agendadas (não confirmadas ainda) para daqui a 3 dias
    const res = await fetch(
      `${SB_URL}/rest/v1/visitas_comerciais?status=eq.agendada&select=id,nome,whatsapp,slot_id,slots_visita(data,hora)&slots_visita.data=eq.${data3d}`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const visitas = await res.json();
    const alvos = visitas.filter((v: any) => v.slots_visita?.data === data3d);

    const results = [];
    for (const v of alvos) {
      if (!v.whatsapp) { results.push({ id: v.id, skip: "sem whatsapp" }); continue; }

      const token    = await makeToken(v.id);
      const vEncoded = encodeV(v.id, token);
      const slot     = v.slots_visita;
      const dataFmt  = new Date(slot.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });
      const hora     = slot.hora.slice(0, 5);
      const phone    = normalizePhone(v.whatsapp);
      const nome     = (v.nome || "").split(" ")[0];

      const r = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
        method: "POST",
        headers: { Authorization: `Bearer ${WPP_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          messaging_product: "whatsapp",
          to: phone,
          type: "template",
          template: {
            name: TEMPLATE,
            language: { code: "pt_BR" },
            components: [
              { type: "body", parameters: [
                { type: "text", text: nome },
                { type: "text", text: dataFmt },
                { type: "text", text: hora },
              ]},
              { type: "button", sub_type: "url", index: "0",
                parameters: [{ type: "text", text: vEncoded }] },
            ],
          },
        }),
      }).then(r => r.json());

      if (r.messages) {
        await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
          method: "POST",
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
          body: JSON.stringify({ telefone: phone, mensagem: `[Confirme sua visita D-3] ${dataFmt} às ${hora}`, direcao: "enviada", nome: v.nome || null, tipo: "template", wamid: r.messages[0]?.id || null }),
        });
      }
      results.push({ id: v.id, phone, status: r.messages ? "enviado" : "erro", detail: r });
    }

    return new Response(JSON.stringify({ data: data3d, total: alvos.length, results }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
