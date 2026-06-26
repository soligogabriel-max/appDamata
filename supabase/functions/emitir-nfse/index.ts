// Supabase Edge Function: emitir-nfse
// Proxy para Focus NFe API (NFS-e).
// Protege o token do Focus NFe no servidor.
// Body esperado: { payload: <objeto NFS-e Focus NFe>, sandbox: boolean }

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

  const FOCUS_TOKEN = Deno.env.get("FOCUS_NFE_TOKEN");
  if (!FOCUS_TOKEN) {
    return json({ error: "Token Focus NFe não configurado no servidor." }, 500);
  }

  let body: { payload: Record<string, unknown>; sandbox?: boolean };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Body JSON inválido." }, 400);
  }

  const { payload, sandbox = true } = body;
  if (!payload) return json({ error: "Campo 'payload' obrigatório." }, 400);

  const baseUrl = sandbox
    ? "https://homologacao.focusnfe.com.br/v2/nfse"
    : "https://api.focusnfe.com.br/v2/nfse";

  // Gera referência única para a NFS-e
  const ref = `DM${Date.now()}`;
  const url = `${baseUrl}?ref=${ref}`;

  let focusRes: Response;
  try {
    focusRes = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": "Basic " + btoa(FOCUS_TOKEN + ":"),
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    return json({ error: "Falha ao conectar com Focus NFe.", detail: String(e) }, 502);
  }

  const focusData = await focusRes.json().catch(() => ({}));

  if (!focusRes.ok) {
    return json({
      error: "Erro na API Focus NFe.",
      detail: focusData?.mensagem || focusData?.erros || focusData,
      status: focusRes.status,
    }, 502);
  }

  // Focus NFe retorna status "processando" ou "autorizado"
  const numero    = focusData.numero_nfse   || focusData.numero   || null;
  const protocolo = focusData.codigo_verificacao || focusData.protocolo || ref;
  const url_pdf   = focusData.caminho_nfse  || focusData.url_nfse || null;

  return json({ ok: true, numero, protocolo, url_pdf, ref, raw: focusData });
});
