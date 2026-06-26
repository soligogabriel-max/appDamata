// Supabase Edge Function: emitir-nfse
// Integração direta com SigISS de Mogi Mirim — ABRASF 2.04
// Secrets obrigatórios: NFSE_CERT_PFX_B64, NFSE_CERT_PASSWORD

import forge from "npm:node-forge@1";
import { SignedXml } from "npm:xml-crypto@3";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Endpoints Mogi Mirim (Betha/SigISS)
const ENDPOINT_PROD  = "https://mogimirim.meumunicipio.online/abrasf/ws/nfs";
const ENDPOINT_HOMOL = "https://testemogimirim.meumunicipio.online/abrasf/ws/nfs";
const ABRASF_NS      = "http://www.abrasf.org.br/nfse.xsd";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

function esc(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ── Certificado ──────────────────────────────────────────────
function loadCert(pfxB64: string, password: string) {
  const der   = forge.util.decode64(pfxB64);
  const asn1  = forge.asn1.fromDer(der);
  const pfx   = forge.pkcs12.pkcs12FromAsn1(asn1, password);

  const certs = pfx.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] ?? [];
  const keys  = pfx.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag })[forge.pki.oids.pkcs8ShroudedKeyBag] ?? [];

  // Pega o certificado do emissor (não CA intermediária)
  const certBag = certs.find(b => {
    const c = b.cert!;
    return c.subject.getField("CN") !== null && !c.getExtension("basicConstraints");
  }) ?? certs[0];

  if (!certBag?.cert || !keys[0]?.key) {
    throw new Error("Certificado ou chave privada não encontrados no PFX.");
  }

  const certPem    = forge.pki.certificateToPem(certBag.cert);
  const privKeyPem = forge.pki.privateKeyToPem(keys[0].key!);
  const certDer    = forge.util.encode64(forge.asn1.toDer(forge.pki.certificateToAsn1(certBag.cert)).getBytes());

  return { certPem, privKeyPem, certDer };
}

// ── Assinatura XML (xmldsig enveloped, C14N, RSA-SHA1) ────────
function signXml(xml: string, privKeyPem: string, certDer: string, refId: string): string {
  const sig = new SignedXml({
    privateKey: privKeyPem,
    signatureAlgorithm: "http://www.w3.org/2000/09/xmldsig#rsa-sha1",
    canonicalizationAlgorithm: "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
  });

  sig.addReference({
    uri: `#${refId}`,
    transforms: [
      "http://www.w3.org/2000/09/xmldsig#enveloped-signature",
      "http://www.w3.org/TR/2001/REC-xml-c14n-20010315",
    ],
    digestAlgorithm: "http://www.w3.org/2000/09/xmldsig#sha1",
    isEmptyUri: false,
  });

  sig.keyInfoProvider = {
    getKeyInfo: () => `<X509Data><X509Certificate>${certDer}</X509Certificate></X509Data>`,
    getKey: () => Buffer.from(privKeyPem),
  };

  sig.computeSignature(xml, {
    location: { reference: `//*[@Id='${refId}']`, action: "append" },
  });

  return sig.getSignedXml();
}

// ── XML ABRASF 2.04 ───────────────────────────────────────────
function rpsNum(): string {
  // Número único crescente — usa últimos 9 dígitos do timestamp ms
  return String(Date.now()).slice(-9);
}

function buildGerarNfseEnvio(p: Record<string, unknown>, rpsN: string): string {
  const prestador  = p.prestador  as Record<string, string>;
  const tomador    = p.tomador    as Record<string, unknown>;
  const servico    = p.servico    as Record<string, unknown>;
  const dataEmissao = p.data_emissao as string;
  const end        = (tomador.endereco ?? {}) as Record<string, string>;

  const issRetido  = servico.iss_retido === "true" ? "1" : "2";
  const aliq       = ((parseFloat(String(servico.aliquota)) || 3) / 100).toFixed(4);
  const valorServ  = parseFloat(String(servico.base_calculo || 0)).toFixed(2);
  const valorIss   = parseFloat(String(servico.valor_iss   || 0)).toFixed(2);
  const valorLiq   = parseFloat(String(servico.valor_liquido_nfse || valorServ)).toFixed(2);

  const docTag = (tomador as Record<string, string>).cpf
    ? `<Cpf>${esc((tomador as Record<string,string>).cpf)}</Cpf>`
    : `<Cnpj>${esc((tomador as Record<string,string>).cnpj ?? "")}</Cnpj>`;

  const endXml = end.logradouro ? `
        <Endereco>
          <Endereco>${esc(end.logradouro)}</Endereco>
          <Numero>${esc(end.numero || "S/N")}</Numero>
          ${end.complemento ? `<Complemento>${esc(end.complemento)}</Complemento>` : ""}
          <Bairro>${esc(end.bairro || "Não informado")}</Bairro>
          <CodigoMunicipio>${esc(end.codigo_municipio || "3531308")}</CodigoMunicipio>
          <Uf>${esc(end.uf || "SP")}</Uf>
          <CodigoPais>1058</CodigoPais>
          <Cep>${(end.cep || "").replace(/\D/g,"").padEnd(8,"0").slice(0,8)}</Cep>
        </Endereco>` : "";

  const contatoXml = (tomador as Record<string,string>).email || (tomador as Record<string,string>).telefone ? `
        <Contato>
          ${(tomador as Record<string,string>).telefone ? `<Telefone>${((tomador as Record<string,string>).telefone).replace(/\D/g,"").slice(0,11)}</Telefone>` : ""}
          ${(tomador as Record<string,string>).email    ? `<Email>${esc((tomador as Record<string,string>).email)}</Email>` : ""}
        </Contato>` : "";

  // InfDeclaracaoPrestacaoServico é o elemento assinado
  return `<InfDeclaracaoPrestacaoServico Id="rps${rpsN}" versao="2.04">
      <Rps>
        <IdentificacaoRps>
          <Numero>${rpsN}</Numero>
          <Serie>A</Serie>
          <Tipo>1</Tipo>
        </IdentificacaoRps>
        <DataEmissao>${dataEmissao}</DataEmissao>
        <Status>1</Status>
      </Rps>
      <Competencia>${dataEmissao}</Competencia>
      <Servico>
        <Valores>
          <ValorServicos>${valorServ}</ValorServicos>
          <ValorDeducoes>0.00</ValorDeducoes>
          <ValorPis>0.00</ValorPis>
          <ValorCofins>0.00</ValorCofins>
          <ValorInss>0.00</ValorInss>
          <ValorIr>0.00</ValorIr>
          <ValorCsll>0.00</ValorCsll>
          <IssRetido>${issRetido}</IssRetido>
          <ValorIss>${valorIss}</ValorIss>
          <ValorIssRetido>0.00</ValorIssRetido>
          <OutrasRetencoes>0.00</OutrasRetencoes>
          <BaseCalculo>${valorServ}</BaseCalculo>
          <Aliquota>${aliq}</Aliquota>
          <ValorLiquidoNfse>${valorLiq}</ValorLiquidoNfse>
          <DescontoCondicionado>0.00</DescontoCondicionado>
          <DescontoIncondicionado>0.00</DescontoIncondicionado>
        </Valores>
        <IssRetido>${issRetido}</IssRetido>
        <ResponsavelRetencao>2</ResponsavelRetencao>
        <ItemListaServico>${esc(String(servico.item_lista_servico))}</ItemListaServico>
        <CodigoTributacaoMunicipio>${esc(String(servico.item_lista_servico))}</CodigoTributacaoMunicipio>
        <Discriminacao>${esc(String(servico.discriminacao))}</Discriminacao>
        <CodigoMunicipio>${esc(prestador.codigo_municipio)}</CodigoMunicipio>
        <CodigoPais>1058</CodigoPais>
        <ExigibilidadeISS>1</ExigibilidadeISS>
        <MunicipioIncidencia>${esc(prestador.codigo_municipio)}</MunicipioIncidencia>
      </Servico>
      <Prestador>
        <CpfCnpj><Cnpj>${esc(prestador.cnpj)}</Cnpj></CpfCnpj>
        <InscricaoMunicipal>${esc(prestador.inscricao_municipal)}</InscricaoMunicipal>
      </Prestador>
      <Tomador>
        <IdentificacaoTomador>
          <CpfCnpj>${docTag}</CpfCnpj>
        </IdentificacaoTomador>
        <RazaoSocial>${esc(String((tomador as Record<string,string>).razao_social))}</RazaoSocial>
        ${endXml}
        ${contatoXml}
      </Tomador>
      <OptanteSimplesNacional>2</OptanteSimplesNacional>
      <IncentivoFiscal>2</IncentivoFiscal>
    </InfDeclaracaoPrestacaoServico>`;
}

function buildSoap(dadosMsg: string): string {
  // O SOAP do SigISS Betha recebe o XML de dados como texto escapado
  const dadosEsc = dadosMsg
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  const cabecalho = `<?xml version="1.0" encoding="UTF-8"?><cabecalho versao="2.04" xmlns="${ABRASF_NS}"><versaoDados>2.04</versaoDados></cabecalho>`;
  const cabEsc = cabecalho
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  return `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">
  <soapenv:Header/>
  <soapenv:Body>
    <GerarNfse xmlns="${ABRASF_NS}">
      <nfseCabecMsg>${cabEsc}</nfseCabecMsg>
      <nfseDadosMsg>${dadosEsc}</nfseDadosMsg>
    </GerarNfse>
  </soapenv:Body>
</soapenv:Envelope>`;
}

// ── Servidor ──────────────────────────────────────────────────
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const pfxB64  = Deno.env.get("NFSE_CERT_PFX_B64");
  const pfxPass = Deno.env.get("NFSE_CERT_PASSWORD") ?? "";

  if (!pfxB64) {
    return json({
      error: "Certificado não configurado.",
      hint: "Adicione NFSE_CERT_PFX_B64 (base64 do .pfx) e NFSE_CERT_PASSWORD nos Secrets da Edge Function no Supabase.",
    }, 500);
  }

  let body: Record<string, unknown>;
  try { body = await req.json(); }
  catch { return json({ error: "Body JSON inválido." }, 400); }

  const { payload, sandbox = true } = body as { payload: Record<string, unknown>; sandbox?: boolean };
  if (!payload) return json({ error: "Campo 'payload' obrigatório." }, 400);

  // 1. Carrega certificado
  let certPem: string, privKeyPem: string, certDer: string;
  try {
    ({ certPem, privKeyPem, certDer } = loadCert(pfxB64, pfxPass));
  } catch (e) {
    return json({ error: "Erro ao carregar certificado.", detail: String(e) }, 500);
  }

  // 2. Gera XML do RPS
  const rpsN = rpsNum();
  const infXml = buildGerarNfseEnvio(payload, rpsN);

  // 3. Assina o elemento InfDeclaracaoPrestacaoServico
  const xmlParaAssinar = `<Rps xmlns="${ABRASF_NS}">${infXml}</Rps>`;
  let signedRpsXml: string;
  try {
    signedRpsXml = signXml(xmlParaAssinar, privKeyPem, certDer, `rps${rpsN}`);
  } catch (e) {
    return json({ error: "Erro ao assinar XML.", detail: String(e) }, 500);
  }

  // 4. Monta GerarNfseEnvio
  const gerarEnvio = `<?xml version="1.0" encoding="UTF-8"?><GerarNfseEnvio xmlns="${ABRASF_NS}">${signedRpsXml}</GerarNfseEnvio>`;

  // 5. Monta SOAP e envia
  const soapBody = buildSoap(gerarEnvio);
  const endpoint = sandbox ? ENDPOINT_HOMOL : ENDPOINT_PROD;

  let soapRes: Response;
  try {
    soapRes = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml;charset=UTF-8",
        "SOAPAction": `"${ABRASF_NS}/GerarNfse"`,
      },
      body: soapBody,
    });
  } catch (e) {
    return json({ error: "Falha ao conectar com SigISS de Mogi Mirim.", detail: String(e) }, 502);
  }

  const respText = await soapRes.text();

  // 6. Extrai número da NFS-e da resposta
  const numero    = respText.match(/<Numero>(\d+)<\/Numero>/)?.[1] ?? null;
  const verif     = respText.match(/<CodigoVerificacao>([^<]+)<\/CodigoVerificacao>/)?.[1] ?? null;
  const linkNfse  = respText.match(/<LinkNfse>([^<]+)<\/LinkNfse>/)?.[1] ?? null;
  const mensErro  = respText.match(/<Mensagem>([^<]+)<\/Mensagem>/)?.[1] ?? null;
  const codErro   = respText.match(/<Codigo>([^<]+)<\/Codigo>/)?.[1] ?? null;

  if (!soapRes.ok || mensErro || !numero) {
    return json({
      error: mensErro ?? `Resposta inesperada do SigISS (HTTP ${soapRes.status}).`,
      codigo: codErro ?? null,
      raw: respText.slice(0, 3000),
    }, 502);
  }

  return json({
    ok: true,
    numero,
    protocolo: verif,
    url_pdf: linkNfse,
    rps_numero: rpsN,
  });
});
