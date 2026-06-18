// Supabase Edge Function: autentique-webhook
// Recebe notificações do Autentique quando o documento é assinado/finalizado
// e atualiza o evento (agenda): assinatura_status, assinatura_pdf_url, contrato_ok.
//
// Configure a URL desta função no painel do Autentique (Webhooks).
// Supabase injeta automaticamente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
//
// OBS: o formato exato do payload do Autentique deve ser confirmado no 1º teste
// (os caminhos abaixo são tolerantes e podem precisar de pequeno ajuste).

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  let body: any = {};
  try {
    body = await req.json();
  } catch {
    /* alguns webhooks mandam form-encoded; tratamos abaixo */
  }

  // Tenta extrair o id do documento e o evento de vários formatos possíveis
  const docId =
    body?.document?.id || body?.id || body?.data?.document?.id || body?.partner?.document?.id || null;
  const event = (body?.event || body?.type || body?.action || "").toString().toLowerCase();
  const pdfUrl =
    body?.document?.files?.signed ||
    body?.document?.signed_file ||
    body?.signed_file ||
    body?.files?.signed ||
    null;

  // Considera assinado quando o evento indica conclusão/assinatura
  const assinado = /sign|assinad|finaliz|complete/.test(event) || !!pdfUrl;

  if (docId) {
    try {
      const SB_URL = Deno.env.get("SUPABASE_URL");
      const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      const patch: Record<string, unknown> = {
        assinatura_status: assinado ? "assinado" : event || "evento",
      };
      if (pdfUrl) patch.assinatura_pdf_url = pdfUrl;
      if (assinado) patch.contrato_ok = true;

      await fetch(`${SB_URL}/rest/v1/agenda?assinatura_doc_id=eq.${encodeURIComponent(docId)}`, {
        method: "PATCH",
        headers: {
          apikey: SB_SR!,
          Authorization: "Bearer " + SB_SR,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify(patch),
      });
    } catch (_) {
      /* ignora */
    }
  }

  return new Response(JSON.stringify({ ok: true }), {
    headers: { ...CORS, "Content-Type": "application/json" },
  });
});
