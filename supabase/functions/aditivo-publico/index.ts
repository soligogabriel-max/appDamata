// Edge Function: aditivo-publico
// Devolve, em JSON, os dados de um termo aditivo a partir de um link.
//
// GET  ?token=<uuid> → { preset }
// POST ?token=<uuid> → grava os dados do cliente e devolve { ok: true }
//
// Porta de contrato-publico, com a mesma divisao de responsabilidade: quem
// monta a pagina e fazendadamata.com/aditivo.html. HTML NAO pode ser servido
// daqui — o gateway do Supabase forca content-type: text/plain e CSP sandbox
// em tudo que sai de *.supabase.co/functions/v1/, protecao anti-phishing do
// dominio compartilhado, e o HTML chegaria ao cliente como codigo-fonte.
//
// O endereco e o token (uuid) do aditivo, nao o cod do evento: cod e
// sequencial de 6 digitos e qualquer um enumeraria os aditivos de todos os
// eventos.
//
// O link expira sozinho pelo mesmo mecanismo do contrato: assinar-contrato
// grava assinatura_status='enviado' quando o Autentique aceita, e daí em
// diante esta funcao recusa.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados pelo Supabase)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Status em que o aditivo ainda aceita preenchimento. Fora disso o link morre.
const STATUS_ABERTOS = new Set([null, "", "gerado", "dados_preenchidos"]);

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// A pagina do cliente mostra titulo/texto tal como vierem daqui.
function erro(titulo: string, texto: string, status: number) {
  return json({ erro: { titulo, texto } }, status);
}

// Parse tolerante: as colunas sao text, mas podem vir ja como objeto.
function parseJson(v: unknown, fallback: unknown) {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return fallback; }
}

// So estes campos sao aceitos do cliente. O resto do payload e descartado.
const CAMPOS_CLIENTE = [
  "nome", "nacionalidade", "profissao", "rg", "cpf", "endereco", "whatsapp", "email",
  "razaoSocial", "cnpj", "enderecoEmpresa",
  "testemunhaNome", "testemunhaCpf", "testemunhaWhatsapp", "testemunhaEmail",
];
const MAX_TEXTO = 300;

function limpa(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t ? t.slice(0, MAX_TEXTO) : null;
}

async function gravar(
  SB_URL: string, sbH: Record<string, string>,
  id: number, p: Record<string, unknown>,
) {
  const dados: Record<string, string | null> = { origem: "cliente" };
  for (const c of CAMPOS_CLIENTE) dados[c] = limpa(p[c]);
  if (!dados.nome || !dados.whatsapp) {
    return erro("Dados incompletos", "Nome e WhatsApp do contratante são obrigatórios.", 400);
  }

  const up = await fetch(`${SB_URL}/rest/v1/aditivos?id=eq.${id}`, {
    method: "PATCH",
    headers: { ...sbH, "Content-Type": "application/json", Prefer: "return=minimal" },
    body: JSON.stringify({
      cliente_json: dados,
      assinatura_status: "dados_preenchidos",
      updated_at: new Date().toISOString(),
    }),
  });
  if (!up.ok) return erro("Não foi possível salvar", "Tente novamente em instantes.", 502);

  return json({ ok: true });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET" && req.method !== "POST") {
    return erro("Método não permitido", "Use o link que você recebeu.", 405);
  }

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!UUID_RE.test(token)) {
    return erro("Link inválido", "Confira o link que você recebeu ou peça um novo à nossa equipe.", 400);
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH = { apikey: SB_SR, Authorization: "Bearer " + SB_SR };

  // ── Aditivo ───────────────────────────────────────────────────────────
  const adRes = await fetch(
    `${SB_URL}/rest/v1/aditivos?token=eq.${token}&deleted_at=is.null&select=*&limit=1`,
    { headers: sbH },
  );
  if (!adRes.ok) return erro("Erro ao carregar", "Tente novamente em instantes.", 502);
  const [ad] = await adRes.json();
  if (!ad) {
    return erro("Aditivo não encontrado", "Confira o link que você recebeu ou peça um novo à nossa equipe.", 404);
  }

  const st = ad.assinatura_status ?? null;
  if (!STATUS_ABERTOS.has(st)) {
    return erro(
      st === "assinado" ? "Aditivo já assinado" : "Aditivo já enviado para assinatura",
      st === "assinado"
        ? "Este termo aditivo já foi assinado. Qualquer dúvida, fale com a nossa equipe."
        : "Este termo aditivo já foi enviado para assinatura — procure a mensagem do Autentique no seu WhatsApp.",
      410,
    );
  }

  // ── Evento / contrato original ────────────────────────────────────────
  // deleted_at=is.null pelo mesmo motivo de contrato-publico: evento apagado
  // nao serve mais documento nenhum.
  const evRes = await fetch(
    `${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(ad.cod_evento)}&deleted_at=is.null&select=*&limit=1`,
    { headers: sbH },
  );
  const [ev] = evRes.ok ? await evRes.json() : [];
  if (!ev) {
    return erro("Contrato não encontrado", "Fale com a nossa equipe.", 404);
  }

  // ── Dados do cliente ──────────────────────────────────────────────────
  // Ordem de precedencia: o que o cliente ja digitou neste aditivo, depois o
  // que ele digitou no contrato, depois a ficha do evento. Um aditivo nasce
  // de um contrato ja assinado, entao quase sempre ha de onde preencher.
  const cjAd = (ad.cliente_json || {}) as Record<string, string>;
  const cjEv = (ev.cliente_json || {}) as Record<string, string>;
  let ficha: Record<string, string> = {};
  try {
    const fRes = await fetch(
      `${SB_URL}/rest/v1/ficha_do_evento?cod=eq.${encodeURIComponent(ad.cod_evento)}&select=*&limit=1`,
      { headers: sbH },
    );
    const [f] = await fRes.json();
    if (f) ficha = f;
  } catch (_) { /* segue com formulario vazio */ }

  const pick = (...vs: unknown[]) => {
    for (const v of vs) { if (v !== null && v !== undefined && String(v).trim() !== "") return String(v); }
    return "";
  };

  const itens = parseJson(ad.itens_json, []) as Array<Record<string, unknown>>;
  const alteracoes = parseJson(ad.alteracoes_json, []) as Array<Record<string, unknown>>;
  const pmts = parseJson(ad.payments_json, []) as Array<Record<string, unknown>>;

  const valorContrato = Number(ev.valor_locacao ?? 0);
  const valorAditivo = Number(ad.valor ?? 0);

  const preset: Record<string, unknown> = {
    numero: ad.numero,
    code: ev.cod || "",
    nomeEvento: ev.nome_evento || "",
    justificativa: ad.justificativa || "",

    // contrato original, para o "considerando" do termo
    contratoDate1: ev.data_evento || "",
    contratoDate2: ev.data_fim || ev.data_evento || "",
    contratoCin: ev.cin || "",
    contratoCout: ev.cout || "",
    valorContrato,
    valorAditivo,
    valorTotal: valorContrato + valorAditivo,

    itens: (Array.isArray(itens) ? itens : []).map((it) => ({
      descricao: it.descricao ?? "",
      quantidade: Number(it.quantidade ?? 1),
      valor_unitario: Number(it.valor_unitario ?? 0),
    })),
    alteracoes: (Array.isArray(alteracoes) ? alteracoes : []).map((a) => ({
      campo: a.campo ?? "", de: a.de ?? "", para: a.para ?? "",
    })),
    payments: (Array.isArray(pmts) ? pmts : []).map((p) => ({ desc: p.desc, date: p.date, value: p.value })),

    clientName:  pick(cjAd.nome, cjEv.nome, ficha.nome_contratante),
    clientNat:   pick(cjAd.nacionalidade, cjEv.nacionalidade, ficha.nacionalidade, "brasileira"),
    clientProf:  pick(cjAd.profissao, cjEv.profissao, ficha.profissao),
    clientRg:    pick(cjAd.rg, cjEv.rg, ficha.rg),
    clientCpf:   pick(cjAd.cpf, cjEv.cpf, ficha.cpf),
    clientAddr:  pick(cjAd.endereco, cjEv.endereco, ficha.endereco),
    clientPhone: pick(cjAd.whatsapp, cjEv.whatsapp, ficha.celular),
    clientEmail: pick(cjAd.email, cjEv.email, ficha.email),
    w2Name:      pick(cjAd.testemunhaNome, cjEv.testemunhaNome, ficha.nome_testemunha),
    w2Cpf:       pick(cjAd.testemunhaCpf, cjEv.testemunhaCpf, ficha.cpf_testemunha),
    w2Email:     pick(cjAd.testemunhaEmail, cjEv.testemunhaEmail, ficha.email_testemunha),

    aditivoId: ad.id,        // assinar-contrato usa para marcar o aditivo
    aditivoToken: token,     // o template usa para gravar antes de assinar
  };

  if (req.method === "POST") {
    let p: Record<string, unknown>;
    try { p = await req.json(); } catch { return erro("Dados inválidos", "Recarregue a página e tente de novo.", 400); }
    return await gravar(SB_URL, sbH, Number(ad.id), p);
  }

  return json({ preset });
});
