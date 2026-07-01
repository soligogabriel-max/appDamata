// Supabase Edge Function: check-autentique-status
// Consulta o Autentique pelo status real de um documento e atualiza o evento (agenda).
//
// Secret necessário: Autentique_token
// Supabase injeta: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// Body: { cod: "202626" }  (cod do evento na tabela agenda)

const AUTENTIQUE_URL = "https://api.autentique.com.br/v2/graphql";

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

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const role = getJwtRole(req.headers.get("Authorization") || "");
  if (!["admin", "equipe"].includes(role ?? "")) return json({ error: "Não autorizado." }, 401);

  const token = Deno.env.get("Autentique_token");
  if (!token) return json({ error: "Token do Autentique não configurado." }, 500);

  const SB_URL = Deno.env.get("SUPABASE_URL");
  const SB_SR  = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  let body: { cod?: string } = {};
  try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  const { cod } = body;
  if (!cod) return json({ error: "cod obrigatório." }, 400);

  // 1) Busca o assinatura_doc_id do evento
  const evRes = await fetch(
    `${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(cod)}&select=cod,assinatura_doc_id,assinatura_status,contrato_ok`,
    { headers: { apikey: SB_SR!, Authorization: "Bearer " + SB_SR } }
  );
  const evRows: any[] = await evRes.json();
  if (!evRows.length) return json({ error: "Evento não encontrado." }, 404);

  const ev = evRows[0];
  if (!ev.assinatura_doc_id) return json({ error: "Evento não tem documento Autentique vinculado." }, 400);

  // 2) Consulta o Autentique
  const query = `query GetDocument($id: UUID!) {
    document(id: $id) {
      id name
      files { signed }
      signatures {
        public_id name
        signed { created_at }
        action { name }
      }
    }
  }`;

  const auteRes = await fetch(AUTENTIQUE_URL, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables: { id: ev.assinatura_doc_id } }),
  });
  const auteData: any = await auteRes.json();

  if (auteData.errors) return json({ error: "Autentique retornou erro.", detail: auteData.errors }, 502);

  const doc = auteData?.data?.document;
  if (!doc) return json({ error: "Documento não encontrado no Autentique." }, 404);

  const allSignatures: any[] = doc.signatures || [];
  // ignora signatários sem nome (entradas internas do Autentique não exibidas na UI)
  const signatures = allSignatures.filter((s: any) => s.name);
  const total    = signatures.length;
  const assinados = signatures.filter((s: any) => s.signed?.created_at).length;
  const todosAssinaram = total > 0 && assinados === total;
  const pdfUrl = doc.files?.signed || null;

  // 3) Atualiza o evento se necessário
  if (todosAssinaram && !ev.contrato_ok) {
    const patch: Record<string, unknown> = {
      assinatura_status: "assinado",
      contrato_ok: true,
    };
    if (pdfUrl) patch.assinatura_pdf_url = pdfUrl;

    await fetch(`${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(cod)}`, {
      method: "PATCH",
      headers: {
        apikey: SB_SR!,
        Authorization: "Bearer " + SB_SR,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(patch),
    });
  }

  return json({
    ok: true,
    total,
    assinados,
    todosAssinaram,
    pdfUrl,
    signatures: signatures.map((s: any) => ({
      name: s.name,
      signed: !!s.signed?.created_at,
      signed_at: s.signed?.created_at || null,
    })),
  });
});
