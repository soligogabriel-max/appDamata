// Edge Function: whatsapp-webhook
// Recebe mensagens do WhatsApp via Meta Cloud API (webhook GET=verificação, POST=mensagens)
//
// Secrets necessários:
//   META_VERIFY_TOKEN  = token de verificação (definido aqui e no painel Meta)
//   META_WPP_TOKEN     = Bearer token do Meta Cloud API (para enviar respostas)
//   META_WPP_PHONE_ID  = Phone Number ID

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") ?? "";
const WPP_TOKEN   = Deno.env.get("META_WPP_TOKEN") ?? "";
const PHONE_ID    = Deno.env.get("META_WPP_PHONE_ID") ?? "";
const SB_URL      = Deno.env.get("SUPABASE_URL") ?? "";
const SB_KEY      = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

// ── Enviar mensagem de texto simples ─────────────────────────────────────────
async function sendText(to: string, text: string) {
  await fetch(`https://graph.facebook.com/v19.0/${PHONE_ID}/messages`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${WPP_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "text",
      text: { body: text },
    }),
  });
}

// ── Processar mensagem recebida ───────────────────────────────────────────────
async function handleMessage(from: string, msgText: string) {
  const t = msgText.trim().toLowerCase();

  // Menu principal
  if (["oi", "olá", "ola", "bom dia", "boa tarde", "boa noite", "menu", "1"].includes(t)) {
    await sendText(from,
      "Olá! Bem-vindo à *Fazenda Damata* 🌿\n\n" +
      "Como posso te ajudar?\n\n" +
      "1️⃣ Informações sobre eventos\n" +
      "2️⃣ Fazer um orçamento\n" +
      "3️⃣ Marcar uma visita\n" +
      "4️⃣ Falar com atendente\n\n" +
      "Responda com o número da opção."
    );
    return;
  }

  if (t === "2" || t.includes("orçamento") || t.includes("orcamento")) {
    await sendText(from,
      "Para fazer seu orçamento, acesse:\n" +
      "👉 https://fazendadamata.com\n\n" +
      "Preencha os dados do evento e em poucos minutos você recebe o orçamento completo. " +
      "Ao final já é possível agendar uma visita presencial! 🏡"
    );
    return;
  }

  if (t === "3" || t.includes("visita")) {
    await sendText(from,
      "Para agendar uma visita à Fazenda Damata:\n" +
      "👉 https://fazendadamata.com/#visita\n\n" +
      "Escolha o horário disponível e confirme. " +
      "Você receberá um lembrete no WhatsApp antes da visita! 📅"
    );
    return;
  }

  if (t === "4" || t.includes("atendente") || t.includes("humano")) {
    await sendText(from,
      "Um momento! Vou te conectar com nossa equipe. 😊\n\n" +
      "Horário de atendimento: *seg–sex, 8h–18h*.\n" +
      "Se estiver fora do horário, retornaremos em breve."
    );
    return;
  }

  if (t === "1" || t.includes("informaç") || t.includes("evento") || t.includes("espaço") || t.includes("espaco")) {
    await sendText(from,
      "*Fazenda Damata* — espaço para eventos em meio à natureza 🌿\n\n" +
      "✅ Casamentos e festas de debutante\n" +
      "✅ Eventos corporativos\n" +
      "✅ Hospedagem\n\n" +
      "Capacidade: até 500 convidados\n" +
      "Localização: Zona rural, Minas Gerais\n\n" +
      "Quer fazer um orçamento? Responda *2*."
    );
    return;
  }

  // Fallback
  await sendText(from,
    "Não entendi muito bem 😅\n\n" +
    "Digite *menu* para ver as opções disponíveis, " +
    "ou *4* para falar com um atendente."
  );
}

// ── Handler principal ─────────────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: CORS });
  }

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

    if (msg && msg.type === "text") {
      const from = msg.from;
      const text = msg.text?.body ?? "";
      await handleMessage(from, text);
    }

    return new Response("ok", { status: 200 });
  }

  return new Response("Method Not Allowed", { status: 405 });
});
