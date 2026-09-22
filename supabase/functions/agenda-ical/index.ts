// Supabase Edge Function: agenda-ical
// Publica a ocupação da agenda como feed iCalendar para o Airbnb importar.
//
// O anúncio do Airbnb vende uso exclusivo do espaço, então qualquer evento da
// agenda — de qualquer natureza — bloqueia as datas no anúncio.
//
// Por que gravar no Storage em vez de responder o .ics aqui:
// o gateway de functions/v1 força content-type text/plain em tudo que sai, e o
// Airbnb exige URL terminada em .ics servindo text/calendar. O bucket público
// entrega as duas coisas. Esta função só regenera o arquivo.
//
// Chamada pelo pg_cron (segredo do Vault) e pelo admin a cada gravação na agenda.
//
// URL do feed (é o que se cola no Airbnb):
//   https://wwnndsprpofmgbklqdgg.supabase.co/storage/v1/object/public/ical/damata.ics

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const BUCKET = "ical";
const OBJETO = "damata.ics";
// Dias de passado mantidos no feed. Airbnb só liga para o futuro; a margem
// evita sumir com um bloqueio no meio de uma estadia que começou ontem.
const DIAS_TRAS = 7;

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

function getJwtRole(authHeader: string): string | null {
  const t = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split(".")[1]));
    return p?.app_metadata?.role || p?.user_metadata?.role || null;
  } catch { return null; }
}

function diaMais(dateStr: string, dias: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const semTraco = (d: string) => d.replace(/-/g, "");

type Evento = { cod: string; data_evento: string; data_fim: string | null };

// RFC 5545: linhas terminam em CRLF e o texto escapa \ ; , e quebra de linha.
function montarIcs(eventos: Evento[], agora: Date): string {
  const stamp = agora.toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const linhas = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Fazenda Damata//Agenda//PT-BR",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:Fazenda Damata — Ocupação",
  ];

  for (const ev of eventos) {
    const inicio = ev.data_evento;
    const fimReal = ev.data_fim && ev.data_fim >= inicio ? ev.data_fim : inicio;
    linhas.push(
      "BEGIN:VEVENT",
      `UID:agenda-${ev.cod}@fazendadamata.com`,
      `DTSTAMP:${stamp}`,
      // VALUE=DATE (dia inteiro): desde abr/2025 o Airbnb recusa entrada com
      // horário no feed importado. DTEND é exclusivo, por isso o +1 dia.
      `DTSTART;VALUE=DATE:${semTraco(inicio)}`,
      `DTEND;VALUE=DATE:${semTraco(diaMais(fimReal, 1))}`,
      // O feed fica numa URL pública: nada de nome de cliente ou tipo de
      // evento aqui. O Airbnb só precisa saber que a data está ocupada.
      "SUMMARY:Ocupado",
      "TRANSP:OPAQUE",
      "END:VEVENT",
    );
  }

  linhas.push("END:VCALENDAR");
  return linhas.join("\r\n") + "\r\n";
}

// O cron manda um segredo que vive só no Vault e a function confere por RPC —
// mesmo desenho do sync-meta-ads, para o job não carregar chave no texto.
async function segredoDoCronConfere(sbUrl: string, sbKey: string, token: string) {
  const res = await fetch(`${sbUrl}/rest/v1/rpc/agenda_ical_auth`, {
    method: "POST",
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  if (!SB_URL || !SB_SVC) return json({ error: "Function sem SUPABASE_URL/SERVICE_ROLE_KEY." }, 500);

  // Três chamadores: o admin logado (a cada gravação na agenda), o cron (com o
  // segredo do Vault) e chamadas internas com a service role.
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  const role = getJwtRole(req.headers.get("Authorization") || "");
  const autorizado = ["admin", "equipe"].includes(role ?? "") || (auth.length > 20 && (
    auth === SB_SVC ||
    (auth.startsWith("sb_secret_") && SECRET_KEYS.includes(auth)) ||
    await segredoDoCronConfere(SB_URL, SB_SVC, auth)
  ));
  if (!autorizado) return json({ error: "Não autorizado." }, 401);

  const sb = createClient(SB_URL, SB_SVC);
  const desde = diaMais(new Date().toISOString().slice(0, 10), -DIAS_TRAS);

  // Soft-delete: evento apagado não pode continuar bloqueando o anúncio.
  const { data: eventos, error } = await sb
    .from("agenda")
    .select("cod,data_evento,data_fim")
    .is("deleted_at", null)
    .not("data_evento", "is", null)
    .gte("data_evento", desde)
    .order("data_evento", { ascending: true });

  if (error) return json({ error: "Falha ao ler a agenda.", detail: error.message }, 502);

  const ics = montarIcs((eventos ?? []) as Evento[], new Date());

  const { error: upErr } = await sb.storage.from(BUCKET).upload(OBJETO, new TextEncoder().encode(ics), {
    // Sem "; charset=utf-8": o bucket restringe o mime e o Storage compara a
    // string inteira. iCalendar já é UTF-8 por padrão (RFC 5545).
    contentType: "text/calendar",
    cacheControl: "600",
    upsert: true,
  });
  if (upErr) return json({ error: "Falha ao gravar o feed.", detail: upErr.message }, 502);

  return json({
    ok: true,
    eventos: eventos?.length ?? 0,
    bytes: ics.length,
    url: `${SB_URL}/storage/v1/object/public/${BUCKET}/${OBJETO}`,
  });
});
