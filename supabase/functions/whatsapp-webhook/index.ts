// Edge Function: whatsapp-webhook
// Recebe mensagens do WhatsApp via Meta Cloud API
// Salva todas mensagens em wpp_mensagens e envia resposta automática de atendimento

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const SB_URL       = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY       = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const WPP_TOKEN    = Deno.env.get("META_WPP_TOKEN") ?? "";
const PHONE_ID     = Deno.env.get("META_WPP_PHONE_ID") ?? "";

const ATENDIMENTO = "(19) 99678-4361";

const RESPOSTA_AUTO = `Olá! 🌿 Obrigado por entrar em contato com a Fazenda Damata.

Esta é uma caixa de saída automática. Para atendimento personalizado, fale diretamente com nossa equipe pelo WhatsApp: ${ATENDIMENTO}

Aguardamos você!`;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const sbH = {
  apikey: SB_KEY,
  Authorization: `Bearer ${SB_KEY}`,
  "Content-Type": "application/json",
  Prefer: "return=minimal",
};

async function salvarMensagem(
  telefone: string, mensagem: string,
  direcao: "recebida" | "enviada",
  nome?: string, wamid?: string, tipo?: string
) {
  await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
    method: "POST",
    headers: sbH,
    body: JSON.stringify({ telefone, mensagem, direcao, nome: nome || null, wamid: wamid || null, tipo: tipo || "text" }),
  }).catch(() => {});
}

async function enviarResposta(para: string): Promise<string | null> {
  if (!WPP_TOKEN || !PHONE_ID) return null;
  const res = await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${WPP_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: para,
      type: "text",
      text: { body: RESPOSTA_AUTO, preview_url: false },
    }),
  });
  const data = await res.json();
  return data.messages?.[0]?.id ?? null;
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

  // POST — mensagens recebidas
  if (req.method === "POST") {
    const body = await req.json().catch(() => ({}));
    const entry   = body?.entry?.[0];
    const changes = entry?.changes?.[0];
    const value   = changes?.value;
    const msg     = value?.messages?.[0];
    const contact = value?.contacts?.[0];

    if (msg) {
      const from = msg.from as string;
      const nome = contact?.profile?.name as string | undefined;

      // Salva mensagem recebida (texto ou outros tipos)
      const texto = msg.type === "text"
        ? (msg.text?.body ?? "")
        : `[${msg.type}]`;
      await salvarMensagem(from, texto, "recebida", nome, msg.id);

      // Envia resposta automática e salva no histórico
      const wamid = await enviarResposta(from);
      if (wamid) {
        await salvarMensagem(from, RESPOSTA_AUTO, "enviada", nome, wamid);
      }
    }

    return new Response("ok", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
