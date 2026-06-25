// Supabase Edge Function: sync-google-calendar
// Cria, atualiza ou deleta eventos no Google Calendar via OAuth2 (refresh token).
//
// Secrets necessários (Project Settings -> Edge Functions -> Secrets):
//   GOOGLE_OAUTH_CLIENT_ID     = Client ID do OAuth2 (Google Cloud Console)
//   GOOGLE_OAUTH_CLIENT_SECRET = Client Secret do OAuth2
//   GOOGLE_OAUTH_REFRESH_TOKEN = Refresh token da conta atendimentoespacodamata@gmail.com
//   GOOGLE_CALENDAR_ID         = atendimentoespacodamata@gmail.com
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

async function getAccessToken(clientId: string, clientSecret: string, refreshToken: string): Promise<string> {
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!data.access_token) throw new Error("Falha ao obter access token: " + JSON.stringify(data));
  return data.access_token;
}

function addOneDay(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const clientId     = Deno.env.get("GOOGLE_OAUTH_CLIENT_ID");
  const clientSecret = Deno.env.get("GOOGLE_OAUTH_CLIENT_SECRET");
  const refreshToken = Deno.env.get("GOOGLE_OAUTH_REFRESH_TOKEN");
  const calendarId   = Deno.env.get("GOOGLE_CALENDAR_ID");

  if (!clientId || !clientSecret || !refreshToken || !calendarId) {
    return json({ error: "Configure GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN e GOOGLE_CALENDAR_ID." }, 500);
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
    accessToken = await getAccessToken(clientId, clientSecret, refreshToken);
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
    end: { date: addOneDay((data_fim && data_fim >= data_evento) ? data_fim : data_evento) },
  };

  let gcalId = google_cal_id;
  let calRes: Response;

  if (gcalId) {
    calRes = await fetch(`${BASE}/${gcalId}`, {
      method: "PUT",
      headers: authH,
      body: JSON.stringify(event),
    });
    if (calRes.status === 404 || calRes.status === 410) gcalId = undefined;
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
