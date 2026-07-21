// Edge Function: whatsapp-webhook
// Recebe mensagens do WhatsApp via Meta Cloud API
// Salva todas mensagens em wpp_mensagens para visualização no admin
// NÃO responde automaticamente (bot desativado — uso outbound only)

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const SB_URL = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

async function salvarMensagem(telefone: string, mensagem: string, direcao: "recebida" | "enviada", nome?: string, wamid?: string) {
  await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
    method: "POST",
    headers: {
      apikey: SB_KEY,
      Authorization: `Bearer ${SB_KEY}`,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({ telefone, mensagem, direcao, nome: nome || null, wamid: wamid || null }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  // GET — verificação do webhook pelo Meta
  if (req.method === "GET") {
    const url = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");
    if (mode === "subscribe" && token === VERIFY_TOKEN) {
      return new Response(challenge, { status: 200 });
    }
    return new Response("Forbidden", { status: 403 });
  }

  // POST — mensagens e status recebidos
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const entry   = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const msg     = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (msg && msg.type === "text") {
      const from  = msg.from;
      const texto = msg.text?.body ?? "";
      const nome  = contact?.profile?.name ?? undefined;
      await salvarMensagem(from, texto, "recebida", nome, msg.id);
    }

    return new Response("ok", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
