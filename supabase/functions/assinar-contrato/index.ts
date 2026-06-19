// Supabase Edge Function: assinar-contrato
// Recebe o PDF do contrato (base64) + dados do signatário e envia ao Autentique
// para assinatura por WhatsApp. Atualiza o status no evento (agenda).
//
// Secret necessário (Project Settings -> Edge Functions -> Secrets):
//   Autentique_token = <token da API do Autentique>
//
// Supabase injeta automaticamente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/^data:[^;]+;base64,/, "");
  const bin = atob(clean);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Normaliza telefone para o formato internacional E.164 (+55...)
function normalizePhone(raw: string): string {
  let d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55")) return "+" + d;
  return "+55" + d;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const token = Deno.env.get("Autentique_token");
  if (!token) return json({ error: "Token do Autentique não configurado." }, 500);

  let payload: any;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const { cod, signerName, signerPhone, signerEmail, witnessName, witnessPhone, witnessEmail, pdfBase64, filename, docName } = payload || {};
  if (!pdfBase64 || !signerName || !signerPhone) {
    return json({ error: "Campos obrigatórios: pdfBase64, signerName, signerPhone." }, 400);
  }

  // 1) Monta a requisição GraphQL multipart do Autentique
  const query = `
    mutation CreateDocument($document: DocumentInput!, $signers: [SignerInput!]!, $file: Upload!) {
      createDocument(document: $document, signers: $signers, file: $file) {
        id
        name
        signatures { public_id name created_at action { name } link { short_link } }
      }
    }`;

  // Signatários fixos da fazenda (assinam todo contrato, por WhatsApp)
  const FAZENDA_SIGNERS = [
    { name: "Vitoria Bedutti Rodrigues", phone: "+5519994086658", action: "SIGN", delivery_method: "DELIVERY_METHOD_WHATSAPP" },
    { name: "Gabriel Jose Soligo", phone: "+5519991677827", action: "SIGN", delivery_method: "DELIVERY_METHOD_WHATSAPP" },
  ];

  const variables = {
    document: { name: docName || ("Contrato " + (cod || "")) },
    signers: [
      {
        name: signerName,
        phone: normalizePhone(signerPhone),
        action: "SIGN",
        delivery_method: "DELIVERY_METHOD_WHATSAPP",
      },
      ...(witnessName && witnessPhone
        ? [{
            name: witnessName,
            phone: normalizePhone(witnessPhone),
            action: "SIGN",
            delivery_method: "DELIVERY_METHOD_WHATSAPP",
          }]
        : []),
      ...FAZENDA_SIGNERS,
    ],
    file: null,
  };

  const form = new FormData();
  form.append("operations", JSON.stringify({ query, variables }));
  form.append("map", JSON.stringify({ "0": ["variables.file"] }));
  form.append(
    "0",
    new Blob([base64ToBytes(pdfBase64)], { type: "application/pdf" }),
    filename || "contrato.pdf",
  );

  let auteData: any;
  try {
    const res = await fetch(AUTENTIQUE_URL, {
      method: "POST",
      headers: { Authorization: "Bearer " + token },
      body: form,
    });
    auteData = await res.json();
  } catch (e) {
    return json({ error: "Falha ao chamar o Autentique.", detail: String(e) }, 502);
  }

  if (auteData.errors) {
    return json({ error: "Autentique retornou erro.", detail: auteData.errors }, 502);
  }

  const doc = auteData?.data?.createDocument;
  const docId = doc?.id || null;
  const link = doc?.signatures?.[0]?.link?.short_link || null;

  // 2) Atualiza o evento (agenda) com o status e o id do documento
  if (cod) {
    try {
      const SB_URL = Deno.env.get("SUPABASE_URL");
      const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      await fetch(`${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(cod)}`, {
        method: "PATCH",
        headers: {
          apikey: SB_SR!,
          Authorization: "Bearer " + SB_SR,
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          assinatura_status: "enviado",
          assinatura_doc_id: docId,
        }),
      });
    } catch (_) {
      // não bloqueia: o documento já foi criado no Autentique
    }
  }

  return json({ ok: true, docId, link });
});
