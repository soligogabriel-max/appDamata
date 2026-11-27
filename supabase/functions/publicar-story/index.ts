// Supabase Edge Function: publicar-story
// Todo dia republica um post do próprio feed como story, pela API de
// publicação do Instagram, e no dia seguinte colhe as métricas do story.
// A grade é o feed: não há planilha nem arte nova.
//
// Regra de escolha: posts dos últimos 5 anos, melhor desempenho primeiro
// (curtidas + 3 × comentários), sem repetir o mesmo post em 60 dias. Se a
// equipe já publicou story à mão no dia, não publica — o dia é dela.
// Carrossel vai pela primeira foto; vídeo e Reels, pela capa (a API de
// stories só aceita vídeo de até 60 s, e Reels costuma passar).
//
// O que a API NÃO faz: sticker do post, link, enquete, menção, música. Vai a
// imagem, e só. Por isso não há UTM — o que se mede é alcance, respostas e
// navegação, em stories_auto.metricas.
//
// Secrets:
//   META_IG_TOKEN     = token de usuário do sistema com instagram_basic,
//                       instagram_content_publish, instagram_manage_insights,
//                       pages_show_list, pages_read_engagement
//   META_IG_USER_ID   = (opcional) id da conta do Instagram; sem ele a função
//                       descobre pela Página ligada ao token
//
// Payload POST:
//   { "acao": "diagnostico" } → permissões do token, Página e conta encontradas
//   { "acao": "dry" }         → qual post sairia hoje, sem publicar
//   { "acao": "publicar" }    → publica (cron das 10h de Brasília)
//   { "acao": "metricas" }    → colhe insights dos stories dos últimos 2 dias
//
// Autorização: service role, chave sb_secret_, segredo do cron (Vault
// 'stories_auto', conferido por RPC) ou JWT de um usuário admin do app — este
// último é o que permite os botões da tela de admin chamarem daqui.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GRAPH = "https://graph.facebook.com/v21.0";
const MESES_JANELA = 60;      // posts elegíveis: o feed tem 216 posts e só 1 nos últimos 12 meses — o repertório é de 2022 a 2024
const DIAS_SEM_REPETIR = 60;
const FUSO_MS = -3 * 3600 * 1000;   // Brasília, sem horário de verão

type Post = {
  id: string; caption?: string; media_type: string; media_url?: string; thumbnail_url?: string;
  permalink?: string; timestamp: string; like_count?: number; comments_count?: number;
  children?: { data: Array<{ media_type: string; media_url?: string }> };
  username?: string;          // dono do post, quando veio da lista de marcados
  marcado?: boolean;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
const hojeBR = () => new Date(Date.now() + FUSO_MS).toISOString().slice(0, 10);
const diaBR = (iso: string) => new Date(new Date(iso).getTime() + FUSO_MS).toISOString().slice(0, 10);

async function graph(path: string, token: string, init?: RequestInit & { form?: Record<string, string> }) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  let body: string | undefined;
  const headers: Record<string, string> = {};
  if (init?.form) {
    body = new URLSearchParams(init.form).toString();
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }
  const res = await fetch(url.toString(), { method: init?.method || "GET", headers, body });
  const d = await res.json();
  if (d.error) throw new Error(`Graph ${path}: ${d.error.message} (code ${d.error.code})`);
  return d;
}

// ── Autorização ──
async function rpc(sbUrl: string, key: string, bearer: string, fn: string, body: unknown) {
  const res = await fetch(`${sbUrl}/rest/v1/rpc/${fn}`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return null;
  return res.json();
}
async function autorizado(req: Request, sbUrl: string, sbKey: string, anonKey: string) {
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (auth.length <= 20) return false;
  if (auth === sbKey) return true;
  const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  if (auth.startsWith("sb_secret_") && SECRET_KEYS.includes(auth)) return true;
  if ((await rpc(sbUrl, sbKey, sbKey, "stories_auto_auth", { p_token: auth })) === true) return true;
  // JWT de usuário do app: só admin. get_my_role lê o e-mail do próprio JWT.
  if (auth.split(".").length === 3 && anonKey) {
    const papel = await rpc(sbUrl, anonKey, auth, "get_my_role", {});
    if (papel === "admin") return true;
  }
  return false;
}

// ── Conta do Instagram ligada ao token ──
async function descobrirConta(token: string, fixo: string) {
  if (fixo) {
    const d = await graph(`${fixo}?fields=id,username`, token);
    return { ig_user_id: d.id, username: d.username, pagina: null };
  }
  const pags = await graph(`me/accounts?fields=name,instagram_business_account{id,username}`, token);
  const p = (pags.data || []).find((x: { instagram_business_account?: { id: string } }) => x.instagram_business_account);
  if (!p) throw new Error("Nenhuma Página com conta do Instagram ligada neste token. Confira os ativos do usuário do sistema.");
  return { ig_user_id: p.instagram_business_account.id, username: p.instagram_business_account.username, pagina: p.name };
}

// ── Feed: posts próprios + posts em que a conta foi marcada ──
// A lista de mídia só traz o que a conta publicou. Post em colaboração, ou
// do fotógrafo marcando a fazenda, aparece no perfil mas vem só pela lista
// de marcados (/tags) — e é a maior parte da grade.
// `ordenado`: a lista de mídia vem do mais novo para o mais velho e dá para
// parar na primeira fora da janela; a de marcados não garante ordem, então
// lê tudo e filtra.
async function lerLista(path: string, token: string, limite: Date, extra: Partial<Post>, ordenado = true, maxPag = 12): Promise<Post[]> {
  const posts: Post[] = [];
  for (let pag = 0; pag < maxPag && path; pag++) {
    const d = await graph(path, token);
    for (const p of (d.data || []) as Post[]) {
      if (new Date(p.timestamp) < limite) { if (ordenado) return posts; continue; }
      posts.push({ ...p, ...extra });
    }
    // `next` vem com a URL inteira, e numa versão da API que não é a fixada
    // aqui (v25 quando pedimos v21): tira qualquer prefixo de versão.
    const next = d.paging?.next as string | undefined;
    path = next ? next.replace(/^https:\/\/graph\.facebook\.com\/v\d+\.\d+\//, "").replace(/([?&])access_token=[^&]*&?/, "$1") : "";
  }
  return posts;
}
let _erroMarcados = "";   // último erro da lista de marcados, para o diagnóstico mostrar
let _filtroAutores = { permitidos: new Set<string>(), bloqueados: new Set<string>(), soProprios: false };
function autorOk(p: Post) {
  if (!p.marcado) return true;
  if (_filtroAutores.soProprios) return false;
  const u = (p.username || "").toLowerCase();
  if (_filtroAutores.bloqueados.has(u)) return false;
  return _filtroAutores.permitidos.size === 0 || _filtroAutores.permitidos.has(u);
}
let _tempos = { proprios_ms: 0, marcados_ms: 0 };
async function lerFeed(ig: string, token: string): Promise<Post[]> {
  _erroMarcados = "";
  const t0 = Date.now();
  const limite = new Date(); limite.setMonth(limite.getMonth() - MESES_JANELA);
  const campos = "id,caption,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count";
  const proprios = await lerLista(`${ig}/media?fields=${campos},children{media_type,media_url}&limit=50`, token, limite, { marcado: false });
  const t1 = Date.now();
  let marcados: Post[] = [];
  try {
    // a lista de marcados é lenta na Meta: páginas de 100 e no máximo 6 (600 posts)
    marcados = await lerLista(`${ig}/tags?fields=${campos},username,children{media_type,media_url}&limit=100`, token, limite, { marcado: true }, false, 6);
  } catch (e) { console.warn("[publicar-story] lista de marcados falhou:", e); _erroMarcados = String(e instanceof Error ? e.message : e); }
  _tempos = { proprios_ms: t1 - t0, marcados_ms: Date.now() - t1 };
  const vistos = new Set(proprios.map((p) => p.id));
  return proprios.concat(marcados.filter((p) => !vistos.has(p.id)));
}

function imagemDoPost(p: Post): string | null {
  if (p.media_type === "IMAGE") return p.media_url || null;
  if (p.media_type === "CAROUSEL_ALBUM") {
    const f = (p.children?.data || []).find((c) => c.media_type === "IMAGE" && c.media_url);
    return f?.media_url || p.media_url || null;
  }
  if (p.media_type === "VIDEO") return p.thumbnail_url || null;   // Reels e vídeo: a capa
  return null;
}
const score = (p: Post) => (p.like_count || 0) + 3 * (p.comments_count || 0);

// ── Supabase (service role) ──
function sb(sbUrl: string, key: string) {
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    get: async (path: string) => { const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers: h }); return r.ok ? r.json() : []; },
    post: async (path: string, body: unknown) => {
      const r = await fetch(`${sbUrl}/rest/v1/${path}`, { method: "POST", headers: { ...h, Prefer: "return=representation" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`PostgREST ${r.status}: ${await r.text()}`);
      return r.json();
    },
    patch: async (path: string, body: unknown) => {
      const r = await fetch(`${sbUrl}/rest/v1/${path}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`PostgREST ${r.status}: ${await r.text()}`);
    },
  };
}

// ── Escolha do post do dia ──
async function escolher(ig: string, token: string, db: ReturnType<typeof sb>) {
  const feed = await lerFeed(ig, token);
  const comImagem = feed.filter((p) => imagemDoPost(p) && autorOk(p));
  // último dia em que cada post saiu como story, em todo o histórico
  const hist: Array<{ media_id: string; dia: string }> = await db.get(`stories_auto?status=eq.publicado&select=media_id,dia&order=dia.desc&limit=2000`);
  const ultimoUso = new Map<string, string>();
  hist.forEach((h) => { if (!ultimoUso.has(h.media_id)) ultimoUso.set(h.media_id, h.dia); });
  const desde = new Date(); desde.setDate(desde.getDate() - DIAS_SEM_REPETIR);
  const corte = desde.toISOString().slice(0, 10);
  const elegiveis = comImagem.filter((p) => !(ultimoUso.get(p.id) && ultimoUso.get(p.id)! >= corte));
  elegiveis.sort((a, b) => score(b) - score(a) || b.timestamp.localeCompare(a.timestamp));
  if (elegiveis[0]) return { feed: feed.length, elegiveis: elegiveis.length, rodizio: false, escolhido: elegiveis[0], proximos: elegiveis.slice(1, 6) };
  // Todos saíram nos últimos 60 dias: o feed é menor que a janela (21 posts
  // em 5 anos). Em vez de calar, volta o que saiu há mais tempo — rodízio.
  const fila = [...comImagem].sort((a, b) => (ultimoUso.get(a.id) || "").localeCompare(ultimoUso.get(b.id) || "") || score(b) - score(a));
  return { feed: feed.length, elegiveis: 0, rodizio: true, escolhido: fila[0] || null, proximos: fila.slice(1, 6) };
}

// Story à mão hoje? A API lista os stories no ar; se algum é de hoje e não é
// nosso, a equipe já cuidou do dia.
async function equipeJaPostouHoje(ig: string, token: string, db: ReturnType<typeof sb>) {
  const d = await graph(`${ig}/stories?fields=id,timestamp`, token);
  const nossos: Array<{ story_id: string }> = await db.get(`stories_auto?status=eq.publicado&select=story_id&order=dia.desc&limit=5`);
  const ids = new Set(nossos.map((n) => n.story_id));
  const hoje = hojeBR();
  return (d.data || []).some((s: { id: string; timestamp: string }) => diaBR(s.timestamp) === hoje && !ids.has(s.id));
}

async function publicarStory(ig: string, token: string, imagemUrl: string) {
  const c = await graph(`${ig}/media`, token, { method: "POST", form: { media_type: "STORIES", image_url: imagemUrl } });
  // imagem fica pronta em segundos; vídeo levaria mais, mas não mandamos vídeo
  for (let i = 0; i < 10; i++) {
    const st = await graph(`${c.id}?fields=status_code,status`, token);
    if (st.status_code === "FINISHED") break;
    if (st.status_code === "ERROR") throw new Error(`Container com erro: ${st.status || "?"}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  const pub = await graph(`${ig}/media_publish`, token, { method: "POST", form: { creation_id: c.id } });
  return pub.id as string;
}

const resumoPost = (p: Post) => ({
  media_id: p.id, tipo: p.media_type, permalink: p.permalink, data: p.timestamp.slice(0, 10),
  autor: p.marcado ? p.username || "(marcado)" : "próprio",
  curtidas: p.like_count || 0, comentarios: p.comments_count || 0, score: score(p),
  legenda: (p.caption || "").slice(0, 80), imagem: imagemDoPost(p),
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const TOKEN  = Deno.env.get("META_IG_TOKEN") || "";
  const IG_FIX = Deno.env.get("META_IG_USER_ID") || "";
  const SB_URL = Deno.env.get("SUPABASE_URL") || "";
  const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON   = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!SB_URL || !SB_KEY) return json({ error: "Credenciais do Supabase ausentes." }, 500);
  if (!(await autorizado(req, SB_URL, SB_KEY, ANON))) return json({ error: "Não autorizado." }, 401);

  let body: { acao?: string } = {};
  try { body = await req.json(); } catch (_) { /* vazio */ }
  const acao = body.acao || "publicar";
  const db = sb(SB_URL, SB_KEY);

  // Sem token o cron não deve virar erro diário: publicar/metricas só pulam.
  // Diagnóstico e dry reclamam, porque aí alguém está olhando.
  if (!TOKEN) {
    const msg = "META_IG_TOKEN ausente: gere o token do usuário do sistema e salve nos secrets.";
    return (acao === "publicar" || acao === "metricas") ? json({ ok: true, pulado: msg }) : json({ error: msg }, 500);
  }

  try {
    if (acao === "diagnostico") {
      const perms = await graph(`me/permissions`, TOKEN).catch((e) => ({ error: String(e.message) }));
      const conta = await descobrirConta(TOKEN, IG_FIX).catch((e) => ({ erro: String(e.message) }));
      const concedidas = (perms.data || []).filter((p: { status: string }) => p.status === "granted").map((p: { permission: string }) => p.permission);
      const precisa = ["instagram_basic", "instagram_content_publish", "instagram_manage_insights"];
      // amostra do feed: quantos posts a conta tem e os 12 mais recentes que a
      // API entrega — para ver se o que ela devolve bate com o que está no perfil
      let feed: unknown = null;
      if ((conta as { ig_user_id?: string }).ig_user_id) {
        const ig = (conta as { ig_user_id: string }).ig_user_id;
        try {
          const u = await graph(`${ig}?fields=media_count,followers_count`, TOKEN);
          const m = await graph(`${ig}/media?fields=id,media_type,media_product_type,timestamp,like_count,comments_count&limit=12`, TOKEN);
          const tudo = await lerFeed(ig, TOKEN);
          feed = { media_count: u.media_count, seguidores: u.followers_count,
            tempos: _tempos,
            na_janela: { proprios: tudo.filter((p) => !p.marcado).length, marcados: tudo.filter((p) => p.marcado).length, erro_marcados: _erroMarcados || undefined,
              por_autor: Object.entries(tudo.filter((p) => p.marcado).reduce((m: Record<string, number>, p) => { m[p.username || "?"] = (m[p.username || "?"] || 0) + 1; return m; }, {})).sort((a, b) => b[1] - a[1]).slice(0, 8) },
            recentes: (m.data || []).map((x: Post & { media_product_type?: string }) => ({ data: x.timestamp.slice(0, 10), tipo: x.media_type, produto: x.media_product_type, curtidas: x.like_count, comentarios: x.comments_count })),
            tem_mais: !!m.paging?.next };
        } catch (e) { feed = { erro: String(e instanceof Error ? e.message : e) }; }
      }
      return json({ ok: true, conta, permissoes: concedidas, faltam: precisa.filter((p) => !concedidas.includes(p)), feed, permissoes_raw: perms.error || undefined });
    }

    const cfg: Array<{ valor: { ativo?: boolean; autores_permitidos?: string[]; autores_bloqueados?: string[]; so_proprios?: boolean } }> =
      await db.get(`app_config?chave=eq.stories_auto&select=valor`);
    const ativo = cfg[0]?.valor?.ativo !== false;
    // Quem entra no repertório além dos posts próprios. Lista vazia = todo
    // mundo que marcou a fazenda; com nomes, só eles; bloqueados saem sempre.
    const norm = (a?: string[]) => new Set((a || []).map((x) => String(x).replace(/^@/, "").trim().toLowerCase()).filter(Boolean));
    _filtroAutores = { permitidos: norm(cfg[0]?.valor?.autores_permitidos), bloqueados: norm(cfg[0]?.valor?.autores_bloqueados), soProprios: cfg[0]?.valor?.so_proprios === true };
    const conta = await descobrirConta(TOKEN, IG_FIX);
    const ig = conta.ig_user_id;

    if (acao === "dry") {
      const sel = await escolher(ig, TOKEN, db);
      const manual = await equipeJaPostouHoje(ig, TOKEN, db).catch(() => null);
      return json({ ok: true, dry: true, conta, ativo, equipe_ja_postou_hoje: manual, feed: sel.feed, elegiveis: sel.elegiveis, rodizio: sel.rodizio,
        filtro: { so_proprios: _filtroAutores.soProprios, permitidos: [..._filtroAutores.permitidos], bloqueados: [..._filtroAutores.bloqueados] },
        escolhido: sel.escolhido ? resumoPost(sel.escolhido) : null, proximos: sel.proximos.map(resumoPost) });
    }

    if (acao === "publicar") {
      const hoje = hojeBR();
      if (!ativo) return json({ ok: true, pulado: "pausado em app_config" });
      const jaHoje: unknown[] = await db.get(`stories_auto?dia=eq.${hoje}&status=in.(publicado,pulado)&select=id`);
      if (jaHoje.length) return json({ ok: true, pulado: "já há registro de hoje" });
      if (await equipeJaPostouHoje(ig, TOKEN, db)) {
        await db.post("stories_auto", { dia: hoje, media_id: "-", status: "pulado", erro: "equipe já publicou story hoje" });
        return json({ ok: true, pulado: "equipe já publicou story hoje" });
      }
      const sel = await escolher(ig, TOKEN, db);
      const p = sel.escolhido;
      if (!p) return json({ ok: true, pulado: "nenhum post elegível", feed: sel.feed });
      const imagem = imagemDoPost(p)!;
      const base = { dia: hoje, media_id: p.id, permalink: p.permalink || null, legenda: (p.caption || "").slice(0, 200),
        imagem_url: imagem, tipo_post: p.media_type, score: score(p), autor: p.marcado ? (p.username || null) : null };
      try {
        const storyId = await publicarStory(ig, TOKEN, imagem);
        await db.post("stories_auto", { ...base, story_id: storyId, status: "publicado" });
        return json({ ok: true, publicado: { ...resumoPost(p), story_id: storyId }, conta: conta.username });
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        await db.post("stories_auto", { ...base, status: "erro", erro: msg }).catch(() => {});
        return json({ ok: false, erro: msg, post: resumoPost(p) }, 500);
      }
    }

    if (acao === "metricas") {
      const desde = new Date(); desde.setDate(desde.getDate() - 2);
      const pend: Array<{ id: number; story_id: string; dia: string }> =
        await db.get(`stories_auto?status=eq.publicado&metricas=is.null&dia=gte.${desde.toISOString().slice(0, 10)}&select=id,story_id,dia`);
      const feitos: unknown[] = [];
      for (const s of pend) {
        // Lista de métricas de story muda com a versão da API: tenta a completa
        // e cai para a mínima, em vez de perder o dia por uma métrica renomeada.
        const conjuntos = ["reach,replies,navigation,shares,profile_visits,total_interactions", "reach,replies", "reach"];
        let m: Record<string, number> | null = null, erro = "";
        for (const met of conjuntos) {
          try {
            const d = await graph(`${s.story_id}/insights?metric=${met}`, TOKEN);
            m = Object.fromEntries((d.data || []).map((x: { name: string; values?: Array<{ value: number }> }) => [x.name, x.values?.[0]?.value ?? 0]));
            break;
          } catch (e) { erro = String(e instanceof Error ? e.message : e); }
        }
        if (m) { await db.patch(`stories_auto?id=eq.${s.id}`, { metricas: m, metricas_em: new Date().toISOString() }); feitos.push({ dia: s.dia, ...m }); }
        else feitos.push({ dia: s.dia, erro });
      }
      return json({ ok: true, coletados: feitos.length, lista: feitos });
    }

    return json({ error: `ação desconhecida: ${acao}` }, 400);
  } catch (e) {
    console.error("[publicar-story]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
