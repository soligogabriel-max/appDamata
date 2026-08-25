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
//         tipo_evento?, local_evento?, status?, spaces_json?, google_cal_id? }
//   — exige JWT de admin/equipe, ou a service role key (chamada entre funções).
//
// Body alternativo: { action?, visita_id } — para os fluxos sem login. A função
// lê a visita comercial no banco, monta o evento a partir dela e grava o
// gcal_event_id de volta. Nada do body do cliente entra no calendário.
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

const SPACES_LABELS: Record<string, string> = {
  spTumb:    "Salão Tumbérgia",
  spPeroba:  "Peroba Rosa",
  spBrom:    "Salão Bromélias",
  acLoft:    "Loft Flamboyant",
  acCasa:    "Casa Flamboyant",
  acSuiteAss:"Suíte Assessoria",
  acSf1:     "Suíte SF1",
  acSf2:     "Suíte SF2",
  acSf3:     "Suíte SF3",
  acSf4:     "Suíte SF4",
  acSf5:     "Suíte SF5",
  acSb1:     "Suíte SB1",
  acSb2:     "Suíte SB2",
  acSb3:     "Suíte SB3",
  fuBal:     "Balneário",
};

function buildDescription(tipo_evento?: string, status?: string, spaces_json?: string, assessoria_nome?: string): string {
  const parts: string[] = [];

  if (tipo_evento) parts.push(tipo_evento);
  if (status) parts.push(`Status: ${status}`);
  if (assessoria_nome) parts.push(`Assessoria: ${assessoria_nome}`);

  if (spaces_json) {
    try {
      const sp = JSON.parse(spaces_json);
      const items: string[] = [];
      for (const [key, label] of Object.entries(SPACES_LABELS)) {
        if (sp[key]) items.push(label);
      }
      if (sp.mesas) items.push(`${sp.mesas} mesas`);
      if (sp.cad)   items.push(`${sp.cad} cadeiras`);
      if (sp.ban)   items.push(`${sp.ban} banquetas`);
      if (items.length) parts.push("Incluso: " + items.join(", "));
    } catch { /* spaces_json inválido, ignora */ }
  }

  return parts.join("\n") || "";
}

function getJwtRole(authHeader: string): string | null {
  const t = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split(".")[1]));
    return p?.app_metadata?.role || p?.user_metadata?.role || null;
  } catch { return null; }
}

// ── Modo visita comercial ────────────────────────────────────────────────
// A página pública (index.html) e a confirmar-visita chamam sem JWT de
// admin/equipe — a chave publishable nem é JWT. Em vez de confiar no que o
// navegador manda, aceitamos só o visita_id e lemos o resto do banco com a
// service role. Assim nada do body do cliente vira evento no calendário.
const SB_URL   = Deno.env.get("SUPABASE_URL") ?? "";
const SB_SVC   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
const svcHeaders = {
  apikey: SB_SVC,
  Authorization: "Bearer " + SB_SVC,
  "Content-Type": "application/json",
};

type Visita = {
  id: string;
  nome: string | null;
  whatsapp: string | null;
  status: string | null;
  gcal_event_id: string | null;
  slots_visita: { data: string; hora: string } | null;
};

async function fetchVisita(id: string): Promise<Visita | null> {
  const res = await fetch(
    `${SB_URL}/rest/v1/visitas_comerciais?id=eq.${encodeURIComponent(id)}` +
      `&select=id,nome,whatsapp,status,gcal_event_id,slots_visita(data,hora)`,
    { headers: svcHeaders },
  );
  if (!res.ok) return null;
  const rows = await res.json().catch(() => []);
  return Array.isArray(rows) ? (rows[0] ?? null) : null;
}

async function saveGcalId(id: string, gcalId: string | null) {
  await fetch(`${SB_URL}/rest/v1/visitas_comerciais?id=eq.${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { ...svcHeaders, Prefer: "return=minimal" },
    body: JSON.stringify({ gcal_event_id: gcalId }),
  });
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
    hora_inicio?: string;  // HH:MM — se presente, cria evento com horário (não dia inteiro)
    hora_fim?: string;     // HH:MM — padrão: hora_inicio + 30min
    tipo_evento?: string;
    local_evento?: string;
    status?: string;
    spaces_json?: string;
    google_cal_id?: string;
    assessoria_nome?: string;
    notes?: string;  // texto livre adicionado ao final da descrição
    visita_id?: string;  // visita comercial: função monta o evento a partir do banco
  } = {};

  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  let { action = "upsert", cod, nome_evento, data_evento, data_fim, hora_inicio, hora_fim, tipo_evento, local_evento, status, spaces_json, google_cal_id, assessoria_nome, notes } = body;

  // Quem pode mandar um evento arbitrário: admin/equipe logados, ou uma outra
  // Edge Function usando a service role. Os demais só podem pedir a sincronia
  // de uma visita comercial pelo id — os dados vêm do banco, não do body.
  const authHeader = req.headers.get("Authorization") || "";
  const role  = getJwtRole(authHeader);
  const token = authHeader.replace(/^Bearer\s+/i, "").trim();
  const isStaff = ["admin", "equipe"].includes(role ?? "") || (!!SB_SVC && token === SB_SVC);

  let visita: Visita | null = null;
  if (body.visita_id) {
    if (!SB_URL || !SB_SVC) return json({ error: "Function sem SUPABASE_URL/SERVICE_ROLE_KEY." }, 500);
    visita = await fetchVisita(body.visita_id);
    if (!visita) return json({ error: "Visita não encontrada." }, 404);
  } else if (!isStaff) {
    return json({ error: "Não autorizado." }, 401);
  }

  // Visita comercial: o evento é derivado da linha do banco.
  if (visita) {
    const slot = visita.slots_visita;
    if (action !== "delete" && visita.status !== "agendada") {
      // cancelada / já visitada não tem evento a criar; se sobrou algum, remove.
      if (!visita.gcal_event_id) return json({ ok: true, msg: "Visita não está agendada." });
      action = "delete";
    }
    if (action === "delete") {
      google_cal_id = visita.gcal_event_id ?? undefined;
    } else {
      if (!slot) return json({ error: "Visita sem horário definido." }, 400);
      const wpp   = visita.whatsapp || "";
      nome_evento = "Visita — " + (visita.nome || "") + (wpp ? " | 📱 " + wpp : "");
      cod         = undefined;
      data_evento = slot.data;
      hora_inicio = slot.hora.slice(0, 5);
      hora_fim    = undefined;
      data_fim    = undefined;
      tipo_evento = "Visita Comercial";
      local_evento = "Fazenda Damata, Mogi Mirim - SP";
      status      = undefined;
      spaces_json = undefined;
      assessoria_nome = undefined;
      notes         = wpp ? "📱 WhatsApp: " + wpp : undefined;
      google_cal_id = visita.gcal_event_id ?? undefined;
    }
  }

  if (action !== "delete" && !data_evento) return json({ error: "data_evento obrigatório." }, 400);

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
    const delRes = await fetch(`${BASE}/${google_cal_id}`, { method: "DELETE", headers: authH });
    // 410/404 = evento já não existe (apagado na mão, por exemplo): fim igual.
    if (!delRes.ok && delRes.status !== 404 && delRes.status !== 410) {
      const detail = await delRes.text().catch(() => "");
      return json({ error: `Google recusou a exclusão (HTTP ${delRes.status}).`, detail }, 502);
    }
    if (visita) await saveGcalId(visita.id, null);
    return json({ ok: true, deleted: true });
  }

  // ── UPSERT (create ou update) ──
  const title = nome_evento && cod
    ? `${nome_evento} [${cod}]`
    : (nome_evento || cod || "Evento Fazenda Damata");

  // Evento com horário (visita comercial) vs dia inteiro (agenda)
  let startField: object, endField: object;
  if (hora_inicio) {
    const TZ = "America/Sao_Paulo";
    const startDT = `${data_evento}T${hora_inicio.length === 5 ? hora_inicio + ":00" : hora_inicio}`;
    let endDT: string;
    if (hora_fim) {
      endDT = `${data_evento}T${hora_fim.length === 5 ? hora_fim + ":00" : hora_fim}`;
    } else {
      // +30min
      const [hh, mm] = hora_inicio.split(":").map(Number);
      const total = hh * 60 + mm + 30;
      endDT = `${data_evento}T${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}:00`;
    }
    startField = { dateTime: startDT, timeZone: TZ };
    endField   = { dateTime: endDT,   timeZone: TZ };
  } else {
    startField = { date: data_evento };
    endField   = { date: addOneDay((data_fim && data_fim >= data_evento) ? data_fim : data_evento) };
  }

  const descBase = buildDescription(tipo_evento, status, spaces_json, assessoria_nome);
  const description = [descBase, notes].filter(Boolean).join("\n") || undefined;

  const event = {
    summary: title,
    description,
    location: local_evento || "Fazenda Damata, Mogi Mirim - SP",
    start: startField,
    end: endField,
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
  if (calData.error || !calData.id) {
    return json({ error: "Google Calendar retornou erro.", detail: calData.error }, 502);
  }

  // Visita comercial: grava o id aqui, com a service role. Antes isso era feito
  // pelo navegador com a chave anon e falhava calado, deixando evento órfão.
  if (visita && calData.id !== visita.gcal_event_id) await saveGcalId(visita.id, calData.id);

  return json({ ok: true, google_cal_id: calData.id });
});
