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

// Noites de verdade, para cobranca. data_fim aqui e a ultima noite (inclusiva),
// entao 05 -> 08 sao 4 noites. O noites() acima mede o vao entre as datas e
// serve so de teto de seguranca; usar ele para faturar cobra uma noite a menos.
const noitesDe = (ini: string, fim: string) =>
  Math.round((Date.parse(fim + "T12:00:00Z") - Date.parse(ini + "T12:00:00Z")) / 86400000) + 1;

// Marcas em obs_interna. Reserva cancelada ou remarcada nunca mexe no
// financeiro sozinha: pode ja ter recebimento conciliado.
const MARCA_FORA = "[Airbnb] reserva saiu do feed";
const MARCA_MUDOU = "[Airbnb] datas mudaram no feed";

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

  // Diaria do a receber. Em app_config para mudar sem deploy.
  let diaria = 4000;
  try {
    const r = await fetch(`${SB_URL}/rest/v1/app_config?chave=eq.airbnb_diaria&select=valor&limit=1`, { headers: svc });
    const [row] = await r.json();
    const n = Number(row?.valor);
    if (Number.isFinite(n) && n > 0) diaria = n;
  } catch (_) { /* fica no padrao */ }

  const aGravar: Entrada[] = [];
  const criados: Array<Record<string, unknown>> = [];
  const avisos: Array<Record<string, unknown>> = [];
  const hoje = new Date().toISOString().slice(0, 10);

  for (const r of reservas) {
    const nome = `Airbnb ${r.data_ini.slice(8, 10)}${r.data_ini.slice(5, 7)}${r.data_ini.slice(0, 4)}`;
    const noitesCobradas = noitesDe(r.data_ini, r.data_fim);
    const checkout = isoMais(r.data_fim, 1);   // agenda.data_fim e a saida, nao a ultima noite
    const venc = isoMais(r.data_ini, 1);       // segundo dia da estadia
    const total = Number((diaria * noitesCobradas).toFixed(2));

    // Evento que este import ja criou. Nao recriar — e nao deixar a regra de
    // "ja existe evento na agenda" (abaixo) derrubar o bloqueio: a
    // disponibilidade do site sai so da bloqueios_airbnb, evento da agenda
    // nao esconde horario de visita.
    const meuRes = await fetch(
      `${SB_URL}/rest/v1/agenda?airbnb_uid=eq.${encodeURIComponent(r.uid)}` +
      `&select=cod,data_evento,data_fim,obs_interna&limit=1`, { headers: svc });
    const meu = meuRes.ok ? await meuRes.json().catch(() => []) : [];
    if (Array.isArray(meu) && meu.length) {
      const ev = meu[0];
      // Remarcacao mantem o UID e troca as datas. Sinaliza, nao reescreve: a
      // parcela pode ja estar recebida e conciliada no extrato.
      const mudou = ev.data_evento !== r.data_ini || ev.data_fim !== checkout;
      if (mudou && !seco && !(ev.obs_interna || "").includes(MARCA_MUDOU)) {
        await fetch(`${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(ev.cod)}`, {
          method: "PATCH", headers: { ...svc, Prefer: "return=minimal" },
          body: JSON.stringify({
            obs_interna: `${ev.obs_interna || ""}\n${MARCA_MUDOU} (${hoje}): feed diz ${r.data_ini} a ${checkout}`.trim(),
          }),
        });
      }
      if (mudou) avisos.push({ cod: ev.cod, aviso: "datas mudaram", agenda: `${ev.data_evento} a ${ev.data_fim}`, feed: `${r.data_ini} a ${checkout}` });
      r.motivo = mudou
        ? `reserva (evento ${ev.cod} existe, datas divergem — sinalizado)`
        : `reserva (evento ${ev.cod} ja criado)`;
      aGravar.push(r);
      continue;
    }

    // Evento de outra origem nas mesmas datas: eco do nosso proprio feed ou
    // cadastro manual. Nao cria nem grava bloqueio em cima.
    const url = `${SB_URL}/rest/v1/agenda?select=cod&deleted_at=is.null&airbnb_uid=is.null` +
      `&data_evento=lte.${r.data_fim}` +
      `&or=(data_fim.gte.${r.data_ini},and(data_fim.is.null,data_evento.gte.${r.data_ini}))&limit=1`;
    const res = await fetch(url, { headers: svc });
    const linhas = res.ok ? await res.json().catch(() => []) : [];
    if (Array.isArray(linhas) && linhas.length) {
      r.motivo = `ignorado: já existe evento na agenda (${linhas[0].cod}) nessas datas`;
      continue;
    }

    if (seco) {
      r.motivo = `reserva (criaria "${nome}", ${noitesCobradas} noite(s), ${total} vencendo ${venc})`;
      criados.push({ cod: "(dry)", nome, noites: noitesCobradas, valor: total, vencimento: venc, estadia: `${r.data_ini} a ${checkout}` });
      aGravar.push(r);
      continue;
    }

    // Codigo sem p_ano: a sequencia e a de criacao do evento, como no gerador.
    const codRes = await fetch(`${SB_URL}/rest/v1/rpc/proximo_cod_contrato`, {
      method: "POST", headers: svc, body: JSON.stringify({}),
    });
    const cod = codRes.ok ? await codRes.json().catch(() => null) : null;
    if (typeof cod !== "string" || !cod) {
      // Bloqueio entra de todo jeito: sem evento, ele e a unica coisa que
      // segura a data contra agendamento de visita.
      r.motivo = "erro: nao obtive o proximo codigo de contrato";
      avisos.push({ uid: r.uid, aviso: "sem codigo, evento nao criado" });
      aGravar.push(r);
      continue;
    }

    // payments_json coerente com a parcela: sincronizarParcelasReceber() do
    // admin reconcilia por numero de parcela, entao abrir e salvar o evento
    // ajusta a linha em vez de duplicar.
    const agRes = await fetch(`${SB_URL}/rest/v1/agenda`, {
      method: "POST", headers: { ...svc, Prefer: "return=minimal" },
      body: JSON.stringify({
        cod, airbnb_uid: r.uid,
        data_evento: r.data_ini, data_fim: checkout,
        tipo_evento: "Hospedagem", nome_evento: nome, obs: nome,
        valor_locacao: total, cin: "14:00", cout: "12:00",
        spaces_json: "[]",
        payments_json: JSON.stringify([{ desc: "Airbnb", date: venc, value: total.toFixed(2) }]),
        obs_interna: `Criado automaticamente do feed do Airbnb (${hoje}) · ${r.uid}`,
      }),
    });
    if (!agRes.ok) {
      r.motivo = `erro ao criar evento: HTTP ${agRes.status}`;
      avisos.push({ uid: r.uid, aviso: `agenda HTTP ${agRes.status}` });
      aGravar.push(r);
      continue;
    }

    const crRes = await fetch(`${SB_URL}/rest/v1/contas_a_receber`, {
      method: "POST", headers: { ...svc, Prefer: "return=minimal" },
      body: JSON.stringify({
        cod_evento: cod, parcela: "1", num_parcela: "1",
        valor: total, vencimento: venc,
        mes_ano: venc.slice(0, 7).replace("-", ""),
        obs: "Airbnb", status: "NP", aditivo_id: null,
      }),
    });
    if (!crRes.ok) avisos.push({ cod, aviso: `a receber HTTP ${crRes.status} — evento criado sem parcela` });

    r.motivo = `reserva (evento ${cod} criado, ${noitesCobradas} noite(s), vencimento ${venc})`;
    criados.push({ cod, nome, noites: noitesCobradas, valor: total, vencimento: venc, estadia: `${r.data_ini} a ${checkout}` });
    aGravar.push(r);
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

    // Evento criado daqui cuja reserva nao esta mais no feed: sinaliza, nunca
    // apaga. Estadia passada sai do feed naturalmente, por isso so o futuro.
    const uidsNoFeed = reservas.map((r) => r.uid);
    const orfaosRes = await fetch(
      `${SB_URL}/rest/v1/agenda?select=cod,airbnb_uid,obs_interna&airbnb_uid=not.is.null` +
      `&deleted_at=is.null&data_evento=gt.${hoje}`, { headers: svc });
    const orfaos = orfaosRes.ok ? await orfaosRes.json().catch(() => []) : [];
    for (const ev of (Array.isArray(orfaos) ? orfaos : [])) {
      if (uidsNoFeed.includes(ev.airbnb_uid)) continue;
      if ((ev.obs_interna || "").includes(MARCA_FORA)) continue;
      await fetch(`${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(ev.cod)}`, {
        method: "PATCH", headers: { ...svc, Prefer: "return=minimal" },
        body: JSON.stringify({ obs_interna: `${ev.obs_interna || ""}\n${MARCA_FORA} (${hoje})`.trim() }),
      });
      avisos.push({ cod: ev.cod, aviso: "reserva saiu do feed — sinalizado, nada apagado" });
    }
  }

  return json({
    ok: true,
    seco,
    no_feed: entradas.length,
    importados: aGravar.length,
    diaria,
    criados,
    avisos,
    detalhe: entradas.map((e) => ({
      de: e.data_ini, ate: e.data_fim, titulo: e.titulo, motivo: e.motivo,
    })),
  });
});
