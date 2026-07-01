// Edge Function: set-user-role
// Atualiza app_metadata.role e/ou senha de um usuário no Supabase Auth.
// Chamada pelo admin ao aprovar ou editar usuários.
// Requer JWT de admin no header Authorization.

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  // Verificar que quem chama é admin
  const authHeader = req.headers.get("Authorization") || "";
  const callerToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!callerToken || callerToken === Deno.env.get("SUPABASE_ANON_KEY")) {
    return json({ error: "Não autorizado." }, 401);
  }

  try {
    const [, payload] = callerToken.split(".");
    const claims = JSON.parse(atob(payload));
    const callerRole = claims?.app_metadata?.role || claims?.user_metadata?.role;
    if (callerRole !== "admin") return json({ error: "Apenas admins podem alterar papéis ou senhas." }, 403);
  } catch {
    return json({ error: "Token inválido." }, 401);
  }

  let body: any;
  try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  const { user_email, role, password } = body || {};
  if (!user_email || (!role && !password)) {
    return json({ error: "Campos obrigatórios: user_email e ao menos role ou password." }, 400);
  }

  // Buscar usuário pelo email
  const listRes = await fetch(`${SB_URL}/auth/v1/admin/users?email=${encodeURIComponent(user_email)}`, {
    headers: { apikey: SB_SR, Authorization: "Bearer " + SB_SR },
  });
  const listData = await listRes.json();
  const users: any[] = listData?.users || [];
  if (!users.length) return json({ error: "Usuário não encontrado no auth." }, 404);

  const userId = users[0].id;

  // Montar payload de atualização
  const updatePayload: Record<string, unknown> = {};
  if (role) updatePayload.app_metadata = { role };
  if (password) updatePayload.password = password;

  const patchRes = await fetch(`${SB_URL}/auth/v1/admin/users/${userId}`, {
    method: "PUT",
    headers: {
      apikey: SB_SR,
      Authorization: "Bearer " + SB_SR,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(updatePayload),
  });

  if (!patchRes.ok) {
    const err = await patchRes.text();
    return json({ error: "Falha ao atualizar usuário.", detail: err }, 502);
  }

  return json({ ok: true, user_email, ...(role ? { role } : {}), ...(password ? { password_updated: true } : {}) });
});
