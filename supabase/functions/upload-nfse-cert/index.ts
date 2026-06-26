// Edge Function: upload-nfse-cert
// Recebe .pfx + senha, valida, salva no bucket privado "nfse-certs"
// e grava metadados + senha em app_config (protegido por service role).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import forge from "npm:node-forge@1";

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

  let form: FormData;
  try { form = await req.formData(); }
  catch { return json({ error: "Esperado multipart/form-data." }, 400); }

  const certFile = form.get("cert");
  const password = (form.get("password") as string | null) ?? "";

  if (!(certFile instanceof File)) return json({ error: "Campo 'cert' (.pfx) obrigatório." }, 400);

  // 1. Lê bytes do PFX
  const pfxBytes  = new Uint8Array(await certFile.arrayBuffer());
  const pfxBase64 = forge.util.encode64(
    Array.from(pfxBytes).map(b => String.fromCharCode(b)).join("")
  );

  // 2. Valida PFX e extrai informações do certificado
  let certInfo: Record<string, string>;
  try {
    const der  = forge.util.decode64(pfxBase64);
    const asn1 = forge.asn1.fromDer(der);
    const pfx  = forge.pkcs12.pkcs12FromAsn1(asn1, password);

    const certs = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
    const keys  = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

    // Encontra certificado do titular (não CA)
    const certBag = certs.find(b => !b.cert!.getExtension("basicConstraints")) ?? certs[0];
    const cert = certBag?.cert;

    if (!cert)         throw new Error("Certificado não encontrado no PFX.");
    if (!keys[0]?.key) throw new Error("Chave privada não encontrada no PFX.");

    certInfo = {
      cn:          cert.subject.getField("CN")?.value  ?? "Desconhecido",
      cnpj:        cert.subject.getField("CN")?.value?.match(/\d{14}/)?.[0] ?? "",
      validade:    cert.validity.notAfter.toISOString(),
      inicio:      cert.validity.notBefore.toISOString(),
      serial:      cert.serialNumber,
      arquivo:     certFile.name,
      carregado_em: new Date().toISOString(),
    };
  } catch (e) {
    return json({ error: "Certificado inválido ou senha incorreta.", detail: String(e) }, 400);
  }

  // 3. Salva PFX no bucket privado "nfse-certs"
  const sb = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Cria bucket se não existir
  await sb.storage.createBucket("nfse-certs", { public: false }).catch(() => {});

  const { error: upErr } = await sb.storage
    .from("nfse-certs")
    .upload("cert.pfx", pfxBytes, {
      contentType: "application/x-pkcs12",
      upsert: true,
    });

  if (upErr) return json({ error: "Erro ao salvar PFX no Storage.", detail: upErr.message }, 502);

  // 4. Salva senha e metadados em app_config (via service role — sem RLS)
  const upsert = async (chave: string, valor: unknown) => {
    const existing = await sb.from("app_config").select("chave").eq("chave", chave).maybeSingle();
    if (existing.data) {
      await sb.from("app_config").update({ valor }).eq("chave", chave);
    } else {
      await sb.from("app_config").insert({ chave, valor });
    }
  };

  await upsert("nfse_cert_info",     certInfo);
  await upsert("nfse_cert_password", password);

  return json({ ok: true, cert: certInfo });
});
