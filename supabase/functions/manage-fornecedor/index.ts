// Supabase Edge Function: manage-fornecedor
// Cria fornecedores usando service role (bypassa RLS).

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

function decodeJwt(authHeader: string): Record<string, any> | null {
  const t = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  const parts = t.split(".");
  if (parts.length !== 3) return null;
  try {
    return JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
  } catch { return null; }
}

async function resolveRole(claims: Record<string, any>, sbUrl: string, sbSr: string): Promise<string | null> {
  const jwtRole = claims?.app_metadata?.role || claims?.user_metadata?.role;
  if (jwtRole) return String(jwtRole);

  const email = claims?.email;
  if (email) {
    try {
      const r = await fetch(
        `${sbUrl}/rest/v1/app_users?email=eq.${encodeURIComponent(email)}&select=role&limit=1`,
        { headers: { apikey: sbSr, Authorization: "Bearer " + sbSr } }
      );
      if (r.ok) {
        const rows: any[] = await r.json();
        if (Array.isArray(rows) && rows[0]?.role) return rows[0].role;
      }
    } catch { /* continua */ }
  }

  const sub = claims?.sub;
  if (sub) {
    try {
      const r = await fetch(
        `${sbUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(sub)}&select=role&limit=1`,
        { headers: { apikey: sbSr, Authorization: "Bearer " + sbSr } }
      );
      if (r.ok) {
        const rows: any[] = await r.json();
        if (Array.isArray(rows) && rows[0]?.role) return rows[0].role;
      }
    } catch { /* continua */ }
  }

  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

    const SB_URL = Deno.env.get("SUPABASE_URL")!;
    const SB_SR  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization") || "";
    const claims = decodeJwt(authHeader);
    if (!claims) return json({ error: "Não autorizado." }, 401);

    const userRole = await resolveRole(claims, SB_URL, SB_SR);
    if (!["admin", "equipe"].includes(userRole ?? "")) return json({ error: "Não autorizado." }, 401);

    let body: { nome?: string; tipo_servico?: string } = {};
    try { body = await req.json(); } catch { return json({ error: "JSON invalido." }, 400); }

    const { nome, tipo_servico } = body;
    if (!nome || !nome.trim()) return json({ error: "nome obrigatorio." }, 400);

    const codsRes = await fetch(SB_URL + "/rest/v1/fornecedores?select=codigo", {
      headers: { apikey: SB_SR, Authorization: "Bearer " + SB_SR },
    });
    const cods: any[] = codsRes.ok ? await codsRes.json() : [];
    let maxNum = 0;
    for (const r of cods) {
      const n = parseInt(r.codigo, 10);
      if (!isNaN(n) && n > maxNum) maxNum = n;
    }
    const novoCod = String(maxNum + 1).padStart(8, "0");

    const insertRes = await fetch(SB_URL + "/rest/v1/fornecedores", {
      method: "POST",
      headers: {
        apikey: SB_SR,
        Authorization: "Bearer " + SB_SR,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      },
      body: JSON.stringify({ codigo: novoCod, nome: nome.trim(), tipo_servico: tipo_servico || null }),
    });

    if (!insertRes.ok) {
      const err = await insertRes.text();
      return json({ error: "Erro ao criar fornecedor.", detail: err }, 502);
    }

    const rows: any[] = await insertRes.json();
    return json({ ok: true, fornecedor: rows[0] });

  } catch (e) {
    console.error("Erro inesperado:", e);
    return json({ error: "Erro interno: " + String(e) }, 500);
  }
});
