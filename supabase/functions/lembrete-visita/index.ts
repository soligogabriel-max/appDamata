// Edge Function: lembrete-visita
// Busca visitas agendadas para amanhã e envia lembrete via WhatsApp
// Chamada pelo pg_cron diariamente às 9h BRT (12h UTC)
//
// Secrets: META_WPP_TOKEN, META_WPP_PHONE_ID, LEMBRETE_SECRET
// Template: lembrete_visita_damata (UTILITY, pt_BR)

const SB_URL   = Deno.env.get("SUPABASE_URL")!;
const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const WPP_TOKEN = Deno.env.get("META_WPP_TOKEN")!;
const PHONE_ID  = Deno.env.get("META_WPP_PHONE_ID")!;
const SECRET    = Deno.env.get("LEMBRETE_SECRET") ?? "damata2026";
const TEMPLATE  = "lembrete_visita_damata";
const FUNC_URL  = `${Deno.env.get("SUPABASE_URL")?.replace("supabase.co","supabase.co/functions/v1") ?? ""}/confirmar-visita`;

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

function normalizePhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  return d.startsWith("55") ? d : "55" + d;
}

async function sendTemplate(to: string, nome: string, data: string, hora: string, link: string) {
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: TEMPLATE,
        language: { code: "pt_BR" },
        components: [{
          type: "body",
          parameters: [
            { type: "text", text: nome },
            { type: "text", text: data },
            { type: "text", text: hora },
            { type: "text", text: link },
          ]
        }]
      }
    })
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  try {
    // Amanhã no fuso de Brasília (UTC-3)
    const agora = new Date();
    agora.setUTCHours(agora.getUTCHours() + 3); // ajusta para BRT
    const amanha = new Date(agora);
    amanha.setDate(amanha.getDate() + 1);
    const dataAmanha = amanha.toISOString().slice(0, 10); // YYYY-MM-DD

    // Busca visitas de amanhã com status agendada
    const res = await fetch(
      `${SB_URL}/rest/v1/visitas_comerciais?status=eq.agendada&select=id,nome,whatsapp,slot_id,slots_visita(data,hora)&slots_visita.data=eq.${dataAmanha}`,
      { headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` } }
    );
    const visitas = await res.json();

    // Filtra apenas as que têm slot com data amanhã
    const alvos = visitas.filter((v: any) => v.slots_visita?.data === dataAmanha);

    const results = [];
    for (const v of alvos) {
      if (!v.whatsapp) { results.push({ id: v.id, skip: "sem whatsapp" }); continue; }

      const token = await makeToken(v.id);
      const link  = `${FUNC_URL}?id=${v.id}&token=${token}`;
      const slot  = v.slots_visita;
      const dataFmt = new Date(slot.data + "T12:00:00").toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
      const hora  = slot.hora.slice(0, 5);
      const phone = normalizePhone(v.whatsapp);
      const nome  = (v.nome || "").split(" ")[0];

      const r = await sendTemplate(phone, nome, dataFmt, hora, link);
      results.push({ id: v.id, phone, status: r.messages ? "enviado" : "erro", detail: r });
    }

    return new Response(JSON.stringify({ data: dataAmanha, total: alvos.length, results }), {
      headers: { ...CORS, "Content-Type": "application/json" }
    });

  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500, headers: { ...CORS, "Content-Type": "application/json" }
    });
  }
});
