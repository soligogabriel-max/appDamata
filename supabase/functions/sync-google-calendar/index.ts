// Supabase Edge Function: sync-google-calendar
// Cria, atualiza ou deleta eventos no Google Calendar via Service Account.
//
// Secrets necessários (Project Settings -> Edge Functions -> Secrets):
//   GOOGLE_SA_EMAIL      = email da service account (ex: damata@projeto.iam.gserviceaccount.com)
//   GOOGLE_SA_PRIVATE_KEY = chave privada PEM da service account (campo "private_key" do JSON)
//   GOOGLE_CALENDAR_ID   = ID do calendário (ex: atendimentoespacodamata@gmail.com)
//
// Body: { action: "upsert"|"delete", cod, nome_evento, data_evento, data_fim?,
//         tipo_evento?, local_evento?, status?, google_cal_id? }
//
// Resposta: { ok: true, google_cal_id: "..." }

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

function b64urlFromBytes(bytes: Uint8Array): string {
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function b64urlEncode(str: string): string {
  return b64urlFromBytes(new TextEncoder().encode(str));
}

async function getAccessToken(saEmail: string, privateKeyPem: string): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const header = b64urlEncode(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64urlEncode(JSON.stringify({
    iss: saEmail,
    scope: "https://www.googleapis.com/auth/calendar",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  const sigInput = `${header}.${payload}`;

  const keyPem = privateKeyPem
    .replace(/-----BEGIN PRIVATE KEY-----/g, "")
    .replace(/-----END PRIVATE KEY-----/g, "")
    .replace(/\\n/g, "\n")
    .replace(/\s+/g, "");
  const keyBytes = Uint8Array.from(atob(keyPem), (c) => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8",
    keyBytes,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );

  const sigBytes = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    cryptoKey,
    new TextEncoder().encode(sigInput),
  );
  const sig = b64urlFromBytes(new Uint8Array(sigBytes));
  const jwt = `${sigInput}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Token Google inválido: " + JSON.stringify(data));
  return data.access_token;
}

// Adiciona 1 dia a uma string "YYYY-MM-DD" (end date exclusivo no Google Calendar)
function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const saEmail = Deno.env.get("GOOGLE_SA_EMAIL");
  const privateKey = Deno.env.get("GOOGLE_SA_PRIVATE_KEY");
  const calendarId = Deno.env.get("GOOGLE_CALENDAR_ID");

  if (!saEmail || !privateKey || !calendarId) {
    return json({ error: "Configure GOOGLE_SA_EMAIL, GOOGLE_SA_PRIVATE_KEY e GOOGLE_CALENDAR_ID." }, 500);
  }

  let body: {
    action?: string;
    cod?: string;
    nome_evento?: string;
    data_evento?: string;
    data_fim?: string;
    tipo_evento?: string;
    local_evento?: string;
    status?: string;
    google_cal_id?: string;
  } = {};

  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const { action = "upsert", cod, nome_evento, data_evento, data_fim, tipo_evento, local_evento, status, google_cal_id } = body;

  if (!data_evento) return json({ error: "data_evento obrigatório." }, 400);

  let accessToken: string;
  try {
    accessToken = await getAccessToken(saEmail, privateKey);
  } catch (e) {
    return json({ error: "Falha ao autenticar com Google: " + String(e) }, 502);
  }

  const BASE = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`;
  const authH = { Authorization: "Bearer " + accessToken, "Content-Type": "application/json" };

  // ── DELETE ──
  if (action === "delete") {
    if (!google_cal_id) return json({ ok: true, msg: "Sem google_cal_id, nada a deletar." });
    await fetch(`${BASE}/${google_cal_id}`, { method: "DELETE", headers: authH });
    return json({ ok: true });
  }

  // ── UPSERT (create ou update) ──
  const descParts = [tipo_evento, status ? `Status: ${status}` : null].filter(Boolean);
  const event = {
    summary: nome_evento || cod || "Evento Fazenda Damata",
    description: descParts.join(" · ") || undefined,
    location: local_evento || "Fazenda Damata, Campinas - SP",
    start: { date: data_evento },
    end: { date: addOneDay(data_fim || data_evento) },
  };

  let gcalId = google_cal_id;
  let calRes: Response;

  if (gcalId) {
    // Tenta atualizar — se não existir mais, cria novo
    calRes = await fetch(`${BASE}/${gcalId}`, {
      method: "PUT",
      headers: authH,
      body: JSON.stringify(event),
    });
    if (calRes.status === 404 || calRes.status === 410) {
      gcalId = undefined;
    }
  }

  if (!gcalId) {
    calRes = await fetch(BASE, {
      method: "POST",
      headers: authH,
      body: JSON.stringify(event),
    });
  }

  const calData = await calRes!.json();
  if (calData.error) {
    return json({ error: "Google Calendar retornou erro.", detail: calData.error }, 502);
  }

  return json({ ok: true, google_cal_id: calData.id });
});
