// Supabase Edge Function: sync-meta-ads
// Puxa as métricas diárias por anúncio da Marketing API e grava em ads_insights.
// Chamada diariamente pelo pg_cron às 11h UTC (8h Brasília) — depois que a Meta
// já fechou o dia anterior.
//
// Secrets necessários:
//   META_ADS_TOKEN       = token de usuário do sistema, escopo ads_read
//   META_AD_ACCOUNT_ID   = act_1063130737536076
//
// Reprocessa uma janela em vez de só ontem: a Meta revisa gasto e cliques por
// alguns dias depois do fato, então gravar uma vez só deixaria número velho.
// Aceita ?preset= para carga histórica (last_90d no primeiro disparo).
//
// Protegida por chave secreta do projeto no Authorization (service role legada ou
// sb_secret_ nova) — a função é verify_jwt:false e sem isso qualquer um dispararia
// uma ressincronização, queimando cota da Meta.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const PRESETS_OK = new Set([
  "today", "yesterday", "last_3d", "last_7d", "last_14d",
  "last_28d", "last_30d", "last_90d", "this_month", "last_month",
]);

const CAMPOS = [
  "ad_id", "ad_name", "adset_id", "adset_name",
  "campaign_id", "campaign_name",
  "spend", "impressions", "reach", "clicks", "inline_link_clicks",
].join(",");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

const num = (v: unknown) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Percorre a paginação da Graph API. Limite de páginas para não girar sem fim
// se a Meta devolver um cursor circular.
async function buscarInsights(conta: string, token: string, preset: string) {
  const base = `https://graph.facebook.com/v21.0/${conta}/insights`;
  let url =
    `${base}?level=ad&time_increment=1&date_preset=${preset}` +
    `&fields=${CAMPOS}&limit=200&access_token=${encodeURIComponent(token)}`;

  const linhas: any[] = [];
  for (let pagina = 0; pagina < 25 && url; pagina++) {
    const res = await fetch(url);
    const d = await res.json();
    if (d.error) throw new Error(`Graph API: ${d.error.message}`);
    linhas.push(...(d.data || []));
    url = d.paging?.next || "";
  }
  return linhas;
}

async function gravar(sbUrl: string, sbKey: string, conta: string, linhas: any[]) {
  if (!linhas.length) return 0;

  const registros = linhas.map((r) => ({
    dia: r.date_start,
    ad_id: r.ad_id,
    account_id: conta,
    campaign_id: r.campaign_id ?? null,
    campaign_nome: r.campaign_name ?? null,
    adset_id: r.adset_id ?? null,
    adset_nome: r.adset_name ?? null,
    ad_nome: r.ad_name ?? null,
    gasto: num(r.spend),
    impressoes: num(r.impressions),
    alcance: num(r.reach),
    cliques: num(r.clicks),
    cliques_link: num(r.inline_link_clicks),
    sincronizado_em: new Date().toISOString(),
  }));

  // Em lotes: uma carga de 90 dias passa de mil linhas e o PostgREST engasga
  // com payload grande demais.
  let gravadas = 0;
  for (let i = 0; i < registros.length; i += 500) {
    const lote = registros.slice(i, i + 500);
    const res = await fetch(
      `${sbUrl}/rest/v1/ads_insights?on_conflict=dia,ad_id`,
      {
        method: "POST",
        headers: {
          apikey: sbKey,
          Authorization: `Bearer ${sbKey}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(lote),
      },
    );
    if (!res.ok) throw new Error(`PostgREST ${res.status}: ${await res.text()}`);
    gravadas += lote.length;
  }
  return gravadas;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });

  const TOKEN   = Deno.env.get("META_ADS_TOKEN") || "";
  const CONTA   = Deno.env.get("META_AD_ACCOUNT_ID") || "";
  const SB_URL  = Deno.env.get("SUPABASE_URL") || "";
  const SB_KEY  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!TOKEN || !CONTA) return json({ error: "META_ADS_TOKEN ou META_AD_ACCOUNT_ID ausente." }, 500);
  if (!SB_URL || !SB_KEY) return json({ error: "Credenciais do Supabase ausentes." }, 500);

  // Aceita a service role legada (JWT) ou uma secret key nova (sb_secret_...):
  // o dashboard mostra as duas e não é óbvio qual copiar. A publishable/anon
  // continua recusada — é pública, está no HTML do site.
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  const autorizado = auth.length > 20 && (
    auth === SB_KEY ||
    (auth.startsWith("sb_secret_") && SECRET_KEYS.includes(auth))
  );
  if (!autorizado) return json({ error: "Não autorizado." }, 401);

  const preset = new URL(req.url).searchParams.get("preset") || "last_7d";
  if (!PRESETS_OK.has(preset)) {
    return json({ error: `preset inválido: ${preset}` }, 400);
  }

  try {
    const linhas = await buscarInsights(CONTA, TOKEN, preset);
    const gravadas = await gravar(SB_URL, SB_KEY, CONTA, linhas);
    const gasto = linhas.reduce((s, r) => s + num(r.spend), 0);
    return json({
      ok: true,
      preset,
      conta: CONTA,
      linhas: linhas.length,
      gravadas,
      gasto_total: Number(gasto.toFixed(2)),
    });
  } catch (e) {
    console.error("[sync-meta-ads]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
