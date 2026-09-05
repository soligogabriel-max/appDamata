// Supabase Edge Function: assinar-contrato
// Recebe o PDF do contrato (base64) + dados do signatário e envia ao Autentique
// para assinatura por WhatsApp. Atualiza o status no evento (agenda).
//
// Secret necessário (Project Settings -> Edge Functions -> Secrets):
//   Autentique_token = <token da API do Autentique>
//
// Supabase injeta automaticamente: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const AUTENTIQUE_URL = "https://api.autentique.com.br/v2/graphql";

// Teto do PDF aceito para assinatura. O documento vai como upload multipart
// para o Autentique; acima disto ele recusa e a recusa chegava aqui sem
// explicacao nenhuma.
const MAX_PDF_BYTES = 9 * 1024 * 1024;

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

  const { cod, aditivoId, signerName, signerPhone, signerEmail, witnessName, witnessPhone, witnessEmail, pdfBase64, filename, docName } = payload || {};
  if (!pdfBase64 || !signerName || !signerPhone) {
    return json({ error: "Campos obrigatórios: pdfBase64, signerName, signerPhone." }, 400);
  }

  // O PDF sai do navegador do cliente como base64 (~33% maior que o binario).
  // Registrar o tamanho e recusar cedo o que o Autentique nao aceitaria: sem
  // isto, um contrato grande demais voltava como "Autentique retornou erro",
  // sem dizer o que era.
  const pdfBytes = Math.floor((pdfBase64.length * 3) / 4);
  const pdfMB = (pdfBytes / 1048576).toFixed(2);
  console.log(`[assinar-contrato] ${cod || "aditivo:" + aditivoId} pdf=${pdfMB}MB`);
  if (pdfBytes > MAX_PDF_BYTES) {
    console.error(`[assinar-contrato] PDF acima do limite: ${pdfMB}MB`);
    return json({
      error: `O contrato gerado ficou grande demais para a assinatura (${pdfMB} MB, limite ${(MAX_PDF_BYTES / 1048576).toFixed(0)} MB).`,
      detail: { pdfMB, limiteMB: (MAX_PDF_BYTES / 1048576).toFixed(0) },
    }, 413);
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

  // Signatários fixos da fazenda — configurar via Supabase Edge Functions Secrets:
  // FAZENDA_SIGNER1_NAME, FAZENDA_SIGNER1_PHONE, FAZENDA_SIGNER2_NAME, FAZENDA_SIGNER2_PHONE
  const s1n = Deno.env.get("FAZENDA_SIGNER1_NAME") || "";
  const s1p = Deno.env.get("FAZENDA_SIGNER1_PHONE") || "";
  const s2n = Deno.env.get("FAZENDA_SIGNER2_NAME") || "";
  const s2p = Deno.env.get("FAZENDA_SIGNER2_PHONE") || "";
  const FAZENDA_SIGNERS = [
    s1p ? { name: s1n, phone: s1p, action: "SIGN", delivery_method: "DELIVERY_METHOD_WHATSAPP" } : null,
    s2p ? { name: s2n, phone: s2p, action: "SIGN", delivery_method: "DELIVERY_METHOD_WHATSAPP" } : null,
  ].filter(Boolean);

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
    console.error("[assinar-contrato] falha na chamada ao Autentique:", String(e));
    return json({ error: "Falha ao chamar o Autentique: " + String(e), detail: String(e) }, 502);
  }

  if (auteData.errors) {
    // Antes so voltava "Autentique retornou erro." e o motivo morria no detail,
    // que a pagina do cliente nao mostra — ninguem conseguia diagnosticar.
    console.error("[assinar-contrato] Autentique recusou:", JSON.stringify(auteData.errors));
    const msg = (Array.isArray(auteData.errors) ? auteData.errors : [auteData.errors])
      .map((e: any) => e?.message || e?.debugMessage || (typeof e === "string" ? e : ""))
      .filter(Boolean).join(" · ");
    return json({
      error: msg ? "Autentique recusou o documento: " + msg : "Autentique retornou erro.",
      detail: auteData.errors,
    }, 502);
  }

  const doc = auteData?.data?.createDocument;
  const docId = doc?.id || null;
  const link = doc?.signatures?.[0]?.link?.short_link || null;

  // 2) Atualiza o registro de origem com o status e o id do documento.
  //
  // Aditivo tem linha propria em aditivos e nao pode encostar na agenda: o
  // contrato original ja foi assinado, e sobrescrever assinatura_doc_id ali
  // deixaria o documento dele inalcancavel pelo check-autentique-status.
  if (aditivoId) {
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const sbH = {
      apikey: SB_SR!,
      Authorization: "Bearer " + SB_SR,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };
    try {
      await fetch(`${SB_URL}/rest/v1/aditivos?id=eq.${encodeURIComponent(String(aditivoId))}`, {
        method: "PATCH",
        headers: sbH,
        body: JSON.stringify({
          assinatura_status: "enviado",
          assinatura_doc_id: docId,
          updated_at: new Date().toISOString(),
        }),
      });
    } catch (_) {
      // nao bloqueia: o documento ja foi criado no Autentique
    }
    try {
      await fetch(`${SB_URL}/rest/v1/aditivos?id=eq.${encodeURIComponent(String(aditivoId))}&cliente_json=is.null`, {
        method: "PATCH",
        headers: sbH,
        body: JSON.stringify({ cliente_json: {
          origem: "assinatura",
          nome: signerName || null,
          whatsapp: signerPhone || null,
          email: signerEmail || null,
          testemunhaNome: witnessName || null,
          testemunhaWhatsapp: witnessPhone || null,
          testemunhaEmail: witnessEmail || null,
        } }),
      });
    } catch (_) { /* nao bloqueia */ }

    return json({ ok: true, docId, link });
  }

  if (cod) {
    const SB_URL = Deno.env.get("SUPABASE_URL");
    const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const sbH = {
      apikey: SB_SR!,
      Authorization: "Bearer " + SB_SR,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    };

    try {
      await fetch(`${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(cod)}`, {
        method: "PATCH",
        headers: sbH,
        body: JSON.stringify({
          assinatura_status: "enviado",
          assinatura_doc_id: docId,
        }),
      });
    } catch (_) {
      // não bloqueia: o documento já foi criado no Autentique
    }

    // 3) Guarda o que sabemos do signatário.
    //
    // Estes campos sempre chegaram aqui no payload e eram descartados — por
    // isso cliente_json ficou nulo em todos os contratos anteriores ao link,
    // e o e-mail digitado pelo cliente se perdia duas vezes (nem vai ao
    // Autentique, que só recebe nome e telefone, nem ficava na base).
    //
    // Vale para os arquivos .html antigos ainda em circulação: se um deles for
    // assinado, o contrato deixa de nascer sem nenhum dado do cliente.
    //
    // É parcial de propósito — CPF, RG, endereço, profissão e nacionalidade
    // não chegam nesta função, ficam só no corpo do PDF.
    const dados: Record<string, string | null> = {
      origem: "assinatura",   // veio do envio, não do formulário do link
      nome: signerName || null,
      whatsapp: signerPhone || null,
      email: signerEmail || null,
      testemunhaNome: witnessName || null,
      testemunhaWhatsapp: witnessPhone || null,
      testemunhaEmail: witnessEmail || null,
    };

    try {
      // cliente_json=is.null no filtro: nunca sobrescreve o que o cliente
      // preencheu pelo link, que tem muito mais campos que isto.
      await fetch(
        `${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(cod)}&cliente_json=is.null`,
        { method: "PATCH", headers: sbH, body: JSON.stringify({ cliente_json: dados }) },
      );
    } catch (_) { /* não bloqueia */ }

    try {
      await fetch(`${SB_URL}/rest/v1/ficha_do_evento?on_conflict=cod`, {
        method: "POST",
        headers: { ...sbH, Prefer: "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify({
          cod,
          nome_contratante: dados.nome,
          celular: dados.whatsapp,
          email: dados.email,
          nome_testemunha: dados.testemunhaNome,
          email_testemunha: dados.testemunhaEmail,
        }),
      });
    } catch (_) { /* não bloqueia */ }
  }

  return json({ ok: true, docId, link });
});
