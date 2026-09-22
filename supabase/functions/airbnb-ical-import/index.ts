// Supabase Edge Function: airbnb-ical-import
// Importa do feed de exportação do Airbnb as datas realmente reservadas.
// Sentido inverso do agenda-ical: lá a agenda do Damata bloqueia o anúncio.
//
// ── Só reserva entra, bloqueio não ───────────────────────────────────
// O feed do Airbnb mistura coisas de natureza diferente sob o mesmo VEVENT:
//
//   SUMMARY:Reserved              + DESCRIPTION com a URL da reserva  → hóspede
//   SUMMARY:Airbnb (Not available) sem DESCRIPTION                    → bloqueio
//
// E "bloqueio" ali quase nunca significa espaço ocupado. Os do anúncio do
// Damata hoje são:
//   - as próximas 3 noites, porque o anúncio exige 3 dias de antecedência.
//     Esse bloco anda junto com o dia de hoje: importar por data bloquearia
//     os próximos 3 dias para sempre;
//   - tudo além de ~9 meses, porque o calendário só abre essa janela.
//     Importar isso travaria praticamente toda a agenda futura;
//   - as datas dos eventos que já estão na agenda, bloqueadas à mão ou vindas
//     do nosso próprio feed — eco, não informação nova.
//
// Por isso a regra é pelo tipo da entrada, não pelo período. Bloqueio manual
// que você fizer no Airbnb por motivo pessoal também não entra: para o Damata
// ele é indistinguível de uma regra de disponibilidade.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Reserva mais longa que isto é quase certamente artefato de configuração, não
// hóspede. Rede de segurança para o caso de a Airbnb mudar os rótulos do feed.
const MAX_NOITES = 60;

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

async function segredoDoCronConfere(sbUrl: string, sbKey: string, token: string) {
  const res = await fetch(`${sbUrl}/rest/v1/rpc/agenda_ical_auth`, {
    method: "POST",
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

function isoMais(dateStr: string, dias: number): string {
  const d = new Date(dateStr + "T12:00:00Z");
  d.setUTCDate(d.getUTCDate() + dias);
  return d.toISOString().slice(0, 10);
}

const comTraco = (d: string) => `${d.slice(0, 4)}-${d.slice(4, 6)}-${d.slice(6, 8)}`;
const noites = (ini: string, fim: string) =>
  Math.round((Date.parse(fim + "T12:00:00Z") - Date.parse(ini + "T12:00:00Z")) / 86400000);

export type Entrada = {
  uid: string;
  data_ini: string;   // inclusivo
  data_fim: string;   // inclusivo (DTEND do iCal é exclusivo)
  titulo: string;
  reserva: boolean;
  motivo: string;     // por que entrou ou ficou de fora
};

// Desdobra o VCALENDAR. Não vale a pena uma lib: o feed do Airbnb é plano, só
// VEVENT com data, e o que precisamos são quatro campos.
export function parseIcs(ics: string): Entrada[] {
  // RFC 5545 dobra linha longa continuando com espaço ou tab no começo.
  const texto = ics.replace(/\r\n[ \t]/g, "").replace(/\n[ \t]/g, "");
  const saida: Entrada[] = [];

  for (const bruto of texto.split("BEGIN:VEVENT").slice(1)) {
    const bloco = bruto.split("END:VEVENT")[0];
    const campo = (nome: string) => {
      const m = bloco.match(new RegExp(`^${nome}[^:\\r\\n]*:(.*)$`, "im"));
      return m ? m[1].trim() : "";
    };
    const dtstart = campo("DTSTART").replace(/[^0-9]/g, "").slice(0, 8);
    const dtend   = campo("DTEND").replace(/[^0-9]/g, "").slice(0, 8);
    if (dtstart.length !== 8) continue;

    const uid   = campo("UID") || `sem-uid-${dtstart}-${dtend}`;
    const titulo = campo("SUMMARY");
    const desc   = campo("DESCRIPTION");

    const ini = comTraco(dtstart);
    // DTEND é exclusivo; sem DTEND, trata como uma diária só.
    const fim = dtend.length === 8 ? isoMais(comTraco(dtend), -1) : ini;

    const pareceBloqueio = /not available|indispon|unavailable|blocked|bloquead/i.test(titulo);
    const pareceReserva  = /reserv/i.test(titulo) || /reservations\/details|\/hosting\/reservations/i.test(desc);

    let reserva = pareceReserva && !pareceBloqueio;
    let motivo = reserva ? "reserva" : "bloqueio do anúncio (regra de disponibilidade ou bloqueio manual)";

    if (reserva && noites(ini, fim) > MAX_NOITES) {
      reserva = false;
      motivo = `ignorado: ${noites(ini, fim)} noites, acima do teto de ${MAX_NOITES}`;
    }
    if (fim < ini) { reserva = false; motivo = "ignorado: intervalo invertido"; }

    saida.push({ uid, data_ini: ini, data_fim: fim, titulo, reserva, motivo });
  }
  return saida;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SVC = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const FEED   = Deno.env.get("AIRBNB_ICAL_URL") || "";
  if (!SB_URL || !SB_SVC) return json({ error: "Function sem SUPABASE_URL/SERVICE_ROLE_KEY." }, 500);
  if (!FEED) return json({ error: "Configure o secret AIRBNB_ICAL_URL." }, 500);

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  const role = getJwtRole(req.headers.get("Authorization") || "");
  const autorizado = ["admin", "equipe"].includes(role ?? "") || (auth.length > 20 && (
    auth === SB_SVC ||
    (auth.startsWith("sb_secret_") && SECRET_KEYS.includes(auth)) ||
    await segredoDoCronConfere(SB_URL, SB_SVC, auth)
  ));
  if (!autorizado) return json({ error: "Não autorizado." }, 401);

  const seco = req.url.includes("dry=1");  // classifica e devolve sem gravar

  let ics: string;
  try {
    const r = await fetch(FEED, { headers: { "User-Agent": "FazendaDamata/1.0" } });
    if (!r.ok) return json({ error: `Airbnb respondeu HTTP ${r.status}.` }, 502);
    ics = await r.text();
  } catch (e) {
    return json({ error: "Falha ao buscar o feed do Airbnb.", detail: String(e) }, 502);
  }
  if (!ics.includes("BEGIN:VCALENDAR")) return json({ error: "Feed não parece iCalendar." }, 502);

  const entradas = parseIcs(ics);
  const reservas = entradas.filter((e) => e.reserva);

  const svc = { apikey: SB_SVC, Authorization: `Bearer ${SB_SVC}`, "Content-Type": "application/json" };

  // Data que já tem evento na agenda não ganha nada com um bloqueio em cima:
  // ou é eco do nosso próprio feed, ou é bloqueio manual protegendo o evento.
  const aGravar: Entrada[] = [];
  for (const r of reservas) {
    const url = `${SB_URL}/rest/v1/agenda?select=cod&deleted_at=is.null` +
      `&data_evento=lte.${r.data_fim}` +
      `&or=(data_fim.gte.${r.data_ini},and(data_fim.is.null,data_evento.gte.${r.data_ini}))&limit=1`;
    const res = await fetch(url, { headers: svc });
    const linhas = res.ok ? await res.json().catch(() => []) : [];
    if (Array.isArray(linhas) && linhas.length) {
      r.motivo = `ignorado: já existe evento na agenda (${linhas[0].cod}) nessas datas`;
    } else {
      aGravar.push(r);
    }
  }

  if (!seco) {
    if (aGravar.length) {
      await fetch(`${SB_URL}/rest/v1/bloqueios_airbnb?on_conflict=uid`, {
        method: "POST",
        headers: { ...svc, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(aGravar.map((r) => ({
          uid: r.uid, data_ini: r.data_ini, data_fim: r.data_fim,
          titulo: r.titulo, atualizado_em: new Date().toISOString(),
        }))),
      });
    }
    // Reserva cancelada some do feed: tem que sumir daqui também.
    const manter = aGravar.map((r) => `"${r.uid.replace(/"/g, '\\"')}"`).join(",");
    const filtro = manter ? `?uid=not.in.(${encodeURIComponent(manter)})` : "?uid=not.is.null";
    await fetch(`${SB_URL}/rest/v1/bloqueios_airbnb${filtro}`, {
      method: "DELETE", headers: { ...svc, Prefer: "return=minimal" },
    });
  }

  return json({
    ok: true,
    seco,
    no_feed: entradas.length,
    importados: aGravar.length,
    detalhe: entradas.map((e) => ({
      de: e.data_ini, ate: e.data_fim, titulo: e.titulo, motivo: e.motivo,
    })),
  });
});
