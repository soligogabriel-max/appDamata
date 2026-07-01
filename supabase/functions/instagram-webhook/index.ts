// Supabase Edge Function: instagram-webhook
// Recebe eventos de comentários do Instagram via Meta Webhooks.
// Para cada comentário novo, gera uma resposta com GPT e publica via Graph API.
//
// Secrets necessários (Supabase Dashboard → Edge Functions → Secrets):
//   META_VERIFY_TOKEN   = string definida ao configurar o webhook no Meta
//   META_APP_SECRET     = App Secret do Meta App (para verificar assinatura HMAC)
//   META_ACCESS_TOKEN   = Page/User Access Token com instagram_manage_comments
//   OPENAI_API_KEY      = chave da API da OpenAI (platform.openai.com)
//
// URL desta função (configurar no Meta App → Webhooks):
//   https://wwnndsprpofmgbklqdgg.supabase.co/functions/v1/instagram-webhook

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-hub-signature-256",
};

function resp(body: string, status = 200, extraHeaders: Record<string, string> = {}) {
  return new Response(body, { status, headers: { ...CORS, ...extraHeaders } });
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

async function verifySignature(body: string, signature: string, secret: string): Promise<boolean> {
  try {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"]
    );
    const expected = signature.replace("sha256=", "");
    const bodyBytes = new TextEncoder().encode(body);
    const sigBytes = new Uint8Array(expected.match(/.{2}/g)!.map(b => parseInt(b, 16)));
    return await crypto.subtle.verify("HMAC", key, sigBytes, bodyBytes);
  } catch {
    return false;
  }
}

async function generateReply(comment: string, authorName: string, apiKey: string): Promise<string> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      max_tokens: 200,
      messages: [
        {
          role: "system",
          content: `Você é a assistente virtual da Fazenda Damata, um espaço de eventos para casamentos, festas e hospedagem em meio à natureza em Minas Gerais. Responda comentários do Instagram de forma calorosa, genuína e profissional. Use um tom acolhedor e próximo, como uma equipe apaixonada pelo que faz. Seja breve (1-3 frases). Não use emojis em excesso. Se a pessoa demonstra interesse em reservar ou pedir informações, convide a entrar em contato pelo WhatsApp ou DM. Não invente preços ou datas. Escreva em português brasileiro.`,
        },
        {
          role: "user",
          content: `${authorName} comentou: "${comment}"\n\nEscreva uma resposta para este comentário.`,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error("OpenAI API error: " + err);
  }

  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function postReply(commentId: string, message: string, accessToken: string): Promise<void> {
  const res = await fetch(
    `https://graph.facebook.com/v21.0/${commentId}/replies`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ message, access_token: accessToken }),
    }
  );
  if (!res.ok) {
    const err = await res.text();
    throw new Error("Graph API reply error: " + err);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return resp("ok");

  const META_VERIFY_TOKEN = Deno.env.get("META_VERIFY_TOKEN") || "";
  const META_APP_SECRET   = Deno.env.get("META_APP_SECRET") || "";
  const META_ACCESS_TOKEN = Deno.env.get("META_ACCESS_TOKEN") || "";
  const OPENAI_KEY        = Deno.env.get("OPENAI_API_KEY") || "";

  // ── GET: verificação do webhook pelo Meta ─────────────────────────────────
  if (req.method === "GET") {
    const url       = new URL(req.url);
    const mode      = url.searchParams.get("hub.mode");
    const token     = url.searchParams.get("hub.verify_token");
    const challenge = url.searchParams.get("hub.challenge");

    if (mode === "subscribe" && token === META_VERIFY_TOKEN && challenge) {
      console.log("Webhook verificado com sucesso.");
      return resp(challenge, 200, { "Content-Type": "text/plain" });
    }
    return resp("Verificação inválida.", 403);
  }

  // ── POST: eventos de comentários ──────────────────────────────────────────
  if (req.method !== "POST") return json({ error: "Método não permitido." }, 405);

  const rawBody = await req.text();

  if (META_APP_SECRET) {
    const sig   = req.headers.get("x-hub-signature-256") || "";
    const valid = await verifySignature(rawBody, sig, META_APP_SECRET);
    if (!valid) {
      console.error("Assinatura inválida.");
      return json({ error: "Assinatura inválida." }, 401);
    }
  }

  let payload: any;
  try { payload = JSON.parse(rawBody); } catch { return json({ error: "JSON inválido." }, 400); }

  if (!OPENAI_KEY || !META_ACCESS_TOKEN) {
    console.error("Secrets OPENAI_API_KEY ou META_ACCESS_TOKEN não configurados.");
    return json({ ok: true });
  }

  const entries: any[] = payload.entry || [];
  const tasks = entries.flatMap((entry: any) =>
    (entry.changes || []).map(async (change: any) => {
      if (change.field !== "comments") return;

      const value      = change.value || {};
      const commentId  = value.id;
      const commentText = value.text || "";
      const authorName = value.from?.name || "visitante";

      if (value.from?.id === value.item?.id) return;
      if (!commentId || !commentText.trim()) return;

      console.log(`Comentário de ${authorName}: "${commentText}"`);

      try {
        const reply = await generateReply(commentText, authorName, OPENAI_KEY);
        if (reply) {
          await postReply(commentId, reply, META_ACCESS_TOKEN);
          console.log(`Resposta publicada: "${reply}"`);
        }
      } catch (e) {
        console.error("Erro ao processar comentário:", e);
      }
    })
  );

  await Promise.race([
    Promise.allSettled(tasks),
    new Promise(r => setTimeout(r, 20000)),
  ]);

  return json({ ok: true });
});
