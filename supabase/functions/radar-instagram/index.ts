// Supabase Edge Function: radar-instagram
// Lê os últimos posts dos perfis cadastrados em radar_perfis, detecta o que
// saiu da curva e avisa a equipe no WhatsApp com o link. Não reposta: o
// repost é pelo app, com o sticker do post, que dá crédito e leva ao
// original. Chamada diariamente pelo pg_cron às 9h15 de Brasília.
//
// Regra: engajamento = curtidas + 3 × comentários. Mediana sobre os últimos
// 25 posts do perfil. Post da última semana com engajamento >= 3 × mediana e
// >= 200 é viral. Avisa uma vez por post.
//
// Leitura por business discovery: só funciona para conta profissional
// (Business ou Creator); perfil pessoal fica com erro em radar_perfis.
//
// Secrets: META_IG_TOKEN (o mesmo de publicar-story), META_IG_USER_ID (opc.),
//          META_WPP_TOKEN, META_WPP_PHONE_ID, META_WPP_WABA_ID, WPP_EQUIPE (opc.)
//
// Payload POST:
//   { "acao": "varrer" }          → lê, grava, avisa (cron)
//   { "acao": "dry" }             → lê e mostra o que avisaria, sem gravar nem avisar
//   { "acao": "criar_template" }  → cadastra o template do aviso na WABA
//   { "acao": "status_template" } → consulta a aprovação
// Autorização: service role, sb_secret_, segredo do cron (Vault) ou JWT de admin.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const GRAPH = "https://graph.facebook.com/v21.0";
const TEMPLATE = "radar_viral_fd";
const TEAM_PHONE_PADRAO = "5519996784361";   // o mesmo de notificar-visita-nova
const POSTS_POR_PERFIL = 25;
const DIAS_RECENTE = 7;
const FATOR_VIRAL = 3;
const MINIMO_VIRAL = 200;

type Media = { id: string; media_type: string; media_url?: string; thumbnail_url?: string; permalink?: string;
  timestamp: string; like_count?: number; comments_count?: number; caption?: string };

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });
}
async function graph(path: string, token: string, init?: { method?: string; body?: unknown }) {
  const url = new URL(`${GRAPH}/${path}`);
  url.searchParams.set("access_token", token);
  const res = await fetch(url.toString(), {
    method: init?.method || "GET",
    headers: init?.body ? { "Content-Type": "application/json" } : {},
    body: init?.body ? JSON.stringify(init.body) : undefined,
  });
  const d = await res.json();
  if (d.error) throw new Error(`${d.error.message} (code ${d.error.code})`);
  return d;
}
async function rpc(sbUrl: string, key: string, bearer: string, fn: string, body: unknown) {
  const res = await fetch(`${sbUrl}/rest/v1/rpc/${fn}`, {
    method: "POST", headers: { apikey: key, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return res.ok ? res.json() : null;
}
async function autorizado(req: Request, sbUrl: string, sbKey: string, anonKey: string) {
  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (auth.length <= 20) return false;
  if (auth === sbKey) return true;
  const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  if (auth.startsWith("sb_secret_") && SECRET_KEYS.includes(auth)) return true;
  if ((await rpc(sbUrl, sbKey, sbKey, "radar_instagram_auth", { p_token: auth })) === true) return true;
  if (auth.split(".").length === 3 && anonKey && (await rpc(sbUrl, anonKey, auth, "get_my_role", {})) === "admin") return true;
  return false;
}
function sb(sbUrl: string, key: string) {
  const h = { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
  return {
    get: async (path: string) => { const r = await fetch(`${sbUrl}/rest/v1/${path}`, { headers: h }); return r.ok ? r.json() : []; },
    upsert: async (path: string, body: unknown) => {
      const r = await fetch(`${sbUrl}/rest/v1/${path}`, { method: "POST", headers: { ...h, Prefer: "resolution=merge-duplicates,return=minimal" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`PostgREST ${r.status}: ${await r.text()}`);
    },
    patch: async (path: string, body: unknown) => {
      const r = await fetch(`${sbUrl}/rest/v1/${path}`, { method: "PATCH", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`PostgREST ${r.status}: ${await r.text()}`);
    },
    post: async (path: string, body: unknown) => {
      const r = await fetch(`${sbUrl}/rest/v1/${path}`, { method: "POST", headers: { ...h, Prefer: "return=minimal" }, body: JSON.stringify(body) });
      if (!r.ok) throw new Error(`PostgREST ${r.status}: ${await r.text()}`);
    },
  };
}

async function igUserId(token: string, fixo: string) {
  if (fixo) return fixo;
  const pags = await graph(`me/accounts?fields=instagram_business_account{id}`, token);
  const p = (pags.data || []).find((x: { instagram_business_account?: { id: string } }) => x.instagram_business_account);
  if (!p) throw new Error("Nenhuma Página com conta do Instagram ligada neste token.");
  return p.instagram_business_account.id as string;
}

// Business discovery: posts públicos de outra conta profissional, pelo username.
async function lerPerfil(ig: string, token: string, username: string) {
  const campos = `username,followers_count,media_count,media.limit(${POSTS_POR_PERFIL}){id,media_type,media_url,thumbnail_url,permalink,timestamp,like_count,comments_count,caption}`;
  const d = await graph(`${ig}?fields=business_discovery.username(${encodeURIComponent(username)}){${campos}}`, token);
  const bd = d.business_discovery;
  return { seguidores: bd.followers_count as number, posts: (bd.media?.data || []) as Media[] };
}

const eng = (m: Media) => (m.like_count || 0) + 3 * (m.comments_count || 0);
function mediana(vals: number[]) {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : Math.round((s[s.length / 2 - 1] + s[s.length / 2]) / 2);
}

function definicaoTemplate() {
  return {
    name: TEMPLATE, language: "pt_BR", category: "UTILITY",
    components: [
      { type: "BODY",
        text: "📡 Radar: post de @{{1}} saiu da curva — {{2}} curtidas, {{3}}× a mediana do perfil.\n\nSe fizer sentido para a fazenda, abra e compartilhe nos stories pelo app, com o crédito.",
        example: { body_text: [["lapisdenoiva", "2.709", "4,1"]] } },
      { type: "BUTTONS", buttons: [{ type: "URL", text: "Abrir post", url: "https://www.instagram.com/{{1}}", example: ["https://www.instagram.com/p/DPOYZBSgC5t/"] }] },
    ],
  };
}

async function avisarEquipe(phoneId: string, token: string, para: string, p: { username: string; curtidas: number; razao: number; permalink: string }) {
  const sufixo = (p.permalink || "").replace(/^https?:\/\/(www\.)?instagram\.com\//, "");
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp", to: para, type: "template",
      template: { name: TEMPLATE, language: { code: "pt_BR" }, components: [
        { type: "body", parameters: [
          { type: "text", text: p.username },
          { type: "text", text: p.curtidas.toLocaleString("pt-BR") },
          { type: "text", text: p.razao.toFixed(1).replace(".", ",") } ] },
        { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: sufixo }] },
      ] },
    }),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const TOKEN    = Deno.env.get("META_IG_TOKEN") || "";
  const IG_FIX   = Deno.env.get("META_IG_USER_ID") || "";
  const WPP_TOK  = Deno.env.get("META_WPP_TOKEN") || "";
  const PHONE_ID = Deno.env.get("META_WPP_PHONE_ID") || "";
  const WABA_ID  = Deno.env.get("META_WPP_WABA_ID") || "";
  const EQUIPE   = Deno.env.get("WPP_EQUIPE") || TEAM_PHONE_PADRAO;
  const SB_URL   = Deno.env.get("SUPABASE_URL") || "";
  const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const ANON     = Deno.env.get("SUPABASE_ANON_KEY") || "";
  if (!SB_URL || !SB_KEY) return json({ error: "Credenciais do Supabase ausentes." }, 500);
  if (!(await autorizado(req, SB_URL, SB_KEY, ANON))) return json({ error: "Não autorizado." }, 401);

  let body: { acao?: string } = {};
  try { body = await req.json(); } catch (_) { /* vazio */ }
  const acao = body.acao || "varrer";
  const db = sb(SB_URL, SB_KEY);

  try {
    if (acao === "criar_template" || acao === "status_template") {
      if (!WABA_ID || !WPP_TOK) return json({ error: "META_WPP_WABA_ID ou META_WPP_TOKEN ausente." }, 500);
      if (acao === "criar_template") {
        const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates`, { method: "POST", headers: { Authorization: `Bearer ${WPP_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(definicaoTemplate()) }).then((r) => r.json());
        return json({ ok: !r.error, template: TEMPLATE, resultado: r });
      }
      const r = await fetch(`${GRAPH}/${WABA_ID}/message_templates?name=${TEMPLATE}&fields=name,status,category,rejected_reason`, { headers: { Authorization: `Bearer ${WPP_TOK}` } }).then((r) => r.json());
      const t = (r.data || []).find((x: { name: string }) => x.name === TEMPLATE);
      return json({ ok: !r.error, template: TEMPLATE, resultado: t || r.error || { status: "NAO_CADASTRADO" } });
    }

    if (!TOKEN) return json(acao === "varrer" ? { ok: true, pulado: "META_IG_TOKEN ausente" } : { error: "META_IG_TOKEN ausente" }, acao === "varrer" ? 200 : 500);
    const dry = acao === "dry";
    const ig = await igUserId(TOKEN, IG_FIX);
    const perfis: Array<{ username: string; tipo: string }> = await db.get(`radar_perfis?ativo=eq.true&select=username,tipo&order=username`);
    const limiteRecente = new Date(); limiteRecente.setDate(limiteRecente.getDate() - DIAS_RECENTE);
    const agora = new Date().toISOString();
    const resumo: unknown[] = [];
    const virais: Array<{ username: string; media_id: string; permalink: string; curtidas: number; comentarios: number; razao: number; data: string; ja_avisado: boolean }> = [];

    for (const perfil of perfis) {
      const u = perfil.username;
      try {
        const { seguidores, posts } = await lerPerfil(ig, TOKEN, u);
        const med = mediana(posts.map(eng));
        const jaVistos: Array<{ media_id: string; avisado_em: string | null }> = dry ? await db.get(`radar_posts?username=eq.${u}&select=media_id,avisado_em`) : [];
        const avisados = new Map(jaVistos.map((j) => [j.media_id, j.avisado_em]));
        const linhas = posts.map((m) => {
          const e = eng(m);
          const razao = med ? e / med : 0;
          const recente = new Date(m.timestamp) >= limiteRecente;
          const viral = recente && e >= MINIMO_VIRAL && razao >= FATOR_VIRAL;
          return { media_id: m.id, username: u, permalink: m.permalink || null, media_type: m.media_type, imagem_url: m.media_url || m.thumbnail_url || null,
            legenda: (m.caption || "").slice(0, 200), publicado_em: m.timestamp, curtidas: m.like_count || 0, comentarios: m.comments_count || 0,
            engajamento: e, mediana: med, razao: Number(razao.toFixed(2)), viral, lido_em: agora };
        });
        if (!dry) {
          // upsert não mexe em avisado_em: só o aviso grava essa coluna
          await db.upsert("radar_posts?on_conflict=media_id", linhas);
          await db.patch(`radar_perfis?username=eq.${u}`, { seguidores, ultima_leitura: agora, ultimo_erro: null });
        }
        linhas.filter((l) => l.viral).forEach((l) => virais.push({ username: u, media_id: l.media_id, permalink: l.permalink || "", curtidas: l.curtidas, comentarios: l.comentarios, razao: l.razao, data: l.publicado_em.slice(0, 10), ja_avisado: !!avisados.get(l.media_id) }));
        resumo.push({ perfil: u, seguidores, posts: posts.length, mediana: med, virais: linhas.filter((l) => l.viral).length });
      } catch (e) {
        const msg = String(e instanceof Error ? e.message : e);
        if (!dry) await db.patch(`radar_perfis?username=eq.${u}`, { ultima_leitura: agora, ultimo_erro: msg }).catch(() => {});
        resumo.push({ perfil: u, erro: msg });
      }
    }

    if (dry) return json({ ok: true, dry: true, perfis: resumo, virais });

    // avisa só o que ainda não foi avisado
    const pend: Array<{ media_id: string; username: string; permalink: string; curtidas: number; razao: number }> =
      await db.get(`radar_posts?viral=eq.true&avisado_em=is.null&publicado_em=gte.${limiteRecente.toISOString()}&select=media_id,username,permalink,curtidas,razao&order=razao.desc&limit=5`);
    const avisos: unknown[] = [];
    for (const p of pend) {
      if (!WPP_TOK || !PHONE_ID) { avisos.push({ ...p, erro: "WhatsApp não configurado" }); continue; }
      const r = await avisarEquipe(PHONE_ID, WPP_TOK, EQUIPE, { username: p.username, curtidas: p.curtidas, razao: Number(p.razao), permalink: p.permalink });
      if (r.error) { avisos.push({ ...p, erro: r.error.message }); if ([132001, 132012, 132015, 132016].includes(Number(r.error.code))) break; continue; }
      await db.patch(`radar_posts?media_id=eq.${p.media_id}`, { avisado_em: new Date().toISOString() });
      await db.post("wpp_mensagens", { telefone: EQUIPE, nome: "Equipe Damata", direcao: "enviada", tipo: "template",
        mensagem: `[Radar] @${p.username} — ${p.curtidas} curtidas, ${Number(p.razao).toFixed(1)}× a mediana — ${p.permalink}`, wamid: r.messages?.[0]?.id || null }).catch(() => {});
      avisos.push({ ...p, avisado: true });
    }
    return json({ ok: true, perfis: resumo, virais_novos: avisos.length, avisos });
  } catch (e) {
    console.error("[radar-instagram]", e);
    return json({ error: String(e instanceof Error ? e.message : e) }, 500);
  }
});
