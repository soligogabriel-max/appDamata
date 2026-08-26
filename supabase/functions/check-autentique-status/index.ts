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
  // 1) Role direto no JWT (set via migration ou Supabase dashboard)
  const jwtRole = claims?.app_metadata?.role || claims?.user_metadata?.role;
  if (jwtRole) return String(jwtRole);

  // 2) Busca em app_users por email (email sempre presente no JWT do Supabase)
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

  // 3) Busca em app_users por sub (funciona se app_users.id = auth UUID)
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

    const token = Deno.env.get("Autentique_token");
    if (!token) return json({ error: "Token do Autentique não configurado." }, 500);

    let body: { cod?: string; aditivoId?: number | string } = {};
    try { body = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

    // Dois documentos independentes no Autentique: o contrato (agenda) e o
    // termo aditivo (aditivos). Quem chama diz qual, e o PATCH do fim volta
    // para a mesma linha — marcar a agenda por um aditivo assinado daria o
    // contrato como concluido sem ele ter sido.
    const { cod, aditivoId } = body;
    const ehAditivo = aditivoId !== undefined && aditivoId !== null && aditivoId !== "";
    if (!ehAditivo && !cod) return json({ error: "cod ou aditivoId obrigatório." }, 400);

    const alvo = ehAditivo
      ? { rotulo: "Termo aditivo", filtro: `aditivos?id=eq.${encodeURIComponent(String(aditivoId))}` }
      : { rotulo: "Evento",        filtro: `agenda?cod=eq.${encodeURIComponent(String(cod))}` };

    // 1) Busca o assinatura_doc_id do registro
    let evRows: any[] = [];
    try {
      const evRes = await fetch(
        `${SB_URL}/rest/v1/${alvo.filtro}&select=assinatura_doc_id,assinatura_status,contrato_ok`,
        { headers: { apikey: SB_SR, Authorization: "Bearer " + SB_SR } }
      );
      evRows = await evRes.json();
    } catch (e) {
      return json({ error: "Erro ao consultar registro: " + String(e) }, 502);
    }

    if (!evRows.length) return json({ error: alvo.rotulo + " não encontrado." }, 404);

    const ev = evRows[0];
    if (!ev.assinatura_doc_id) return json({ error: alvo.rotulo + " não tem documento Autentique vinculado." }, 400);

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

    let auteData: any;
    try {
      const auteRes = await fetch(AUTENTIQUE_URL, {
        method: "POST",
        headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
        body: JSON.stringify({ query, variables: { id: ev.assinatura_doc_id } }),
      });
      if (!auteRes.ok) {
        const txt = await auteRes.text();
        return json({ error: `Autentique retornou HTTP ${auteRes.status}: ${txt.slice(0, 200)}` }, 502);
      }
      auteData = await auteRes.json();
    } catch (e) {
      return json({ error: "Erro ao conectar com Autentique: " + String(e) }, 502);
    }

    if (auteData.errors) return json({ error: "Autentique retornou erro.", detail: auteData.errors }, 502);

    const doc = auteData?.data?.document;
    if (!doc) return json({ error: "Documento não encontrado no Autentique." }, 404);

    const allSignatures: any[] = doc.signatures || [];
    // ignora signatários sem nome (entradas internas do Autentique não exibidas na UI)
    const signatures = allSignatures.filter((s: any) => s.name);
    const total      = signatures.length;
    const assinados  = signatures.filter((s: any) => s.signed?.created_at).length;
    const todosAssinaram = total > 0 && assinados === total;
    const pdfUrl = doc.files?.signed || null;

    // 3) Atualiza o evento se necessário
    if (todosAssinaram && !ev.contrato_ok) {
      const patch: Record<string, unknown> = {
        assinatura_status: "assinado",
        contrato_ok: true,
      };
      if (pdfUrl) patch.assinatura_pdf_url = pdfUrl;

      try {
        await fetch(`${SB_URL}/rest/v1/${alvo.filtro}`, {
          method: "PATCH",
          headers: {
            apikey: SB_SR,
            Authorization: "Bearer " + SB_SR,
            "Content-Type": "application/json",
            Prefer: "return=minimal",
          },
          body: JSON.stringify(patch),
        });
      } catch (e) {
        console.error("Erro ao atualizar evento:", e);
      }
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

  } catch (e) {
    console.error("Erro inesperado:", e);
    return json({ error: "Erro interno: " + String(e) }, 500);
  }
});
