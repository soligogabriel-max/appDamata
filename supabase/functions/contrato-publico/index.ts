// Edge Function: contrato-publico
// Devolve, em JSON, os dados do contrato de um evento a partir de um link.
//
// GET ?token=<uuid> → { contractType: "evento"|"hospedagem", preset: {...} }
//
// Quem monta a página é fazendadamata.com/contrato.html, que pega este JSON e
// injeta no template. A página NÃO pode ser servida daqui: o gateway do
// Supabase força content-type: text/plain e CSP sandbox em tudo que sai de
// *.supabase.co/functions/v1/ — proteção anti-phishing do domínio
// compartilhado. HTML servido daqui chega ao cliente como código-fonte.
//
// O preset é um port de downloadContract() (admin.html), que já o montava a
// partir do banco: mesma leitura (agenda + app_users.personal + inventario),
// mesmos campos.
//
// O endereço é contrato_token (uuid), não cod: cod é sequencial de 6 dígitos
// e qualquer um enumeraria os contratos de todos os eventos.
//
// O link expira sozinho: assinar-contrato grava assinatura_status='enviado'
// quando o Autentique aceita, e daí em diante esta função recusa.
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados pelo Supabase)

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Status em que o contrato ainda aceita preenchimento. Fora disso o link morre.
const STATUS_ABERTOS = new Set([null, "", "gerado", "dados_preenchidos"]);

// Mesmo mapa de downloadContract() — códigos do inventário das acomodações.
const AC_COD_MAP: Record<string, string> = {
  acLoft: "000019", acCasa: "000006", acSuiteAss: "000022",
  acSf1: "000011", acSf2: "000012", acSf3: "000029",
  acSf4: "000030", acSf5: "000031",
  acSb1: "000013", acSb2: "000014", acSb3: "000015",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// A página do cliente mostra titulo/texto tal como vierem daqui.
function erro(titulo: string, texto: string, status: number) {
  return json({ erro: { titulo, texto } }, status);
}

// Parse tolerante: as colunas são text, mas podem vir já como objeto.
function parseJson(v: unknown, fallback: unknown) {
  if (v === null || v === undefined || v === "") return fallback;
  if (typeof v === "object") return v;
  try { return JSON.parse(String(v)); } catch { return fallback; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "GET") return erro("Método não permitido", "Use o link que você recebeu.", 405);

  const token = new URL(req.url).searchParams.get("token") || "";
  if (!UUID_RE.test(token)) {
    return erro("Link inválido", "Confira o link que você recebeu ou peça um novo à nossa equipe.", 400);
  }

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH = { apikey: SB_SR, Authorization: "Bearer " + SB_SR };

  // ── Evento ────────────────────────────────────────────────────────────
  const evRes = await fetch(
    `${SB_URL}/rest/v1/agenda?contrato_token=eq.${token}&select=*&limit=1`,
    { headers: sbH },
  );
  if (!evRes.ok) return erro("Erro ao carregar", "Tente novamente em instantes.", 502);
  const [ev] = await evRes.json();
  if (!ev) {
    return erro("Contrato não encontrado", "Confira o link que você recebeu ou peça um novo à nossa equipe.", 404);
  }

  const st = ev.assinatura_status ?? null;
  if (!STATUS_ABERTOS.has(st)) {
    return erro(
      st === "assinado" ? "Contrato já assinado" : "Contrato já enviado para assinatura",
      st === "assinado"
        ? "Este contrato já foi assinado. Qualquer dúvida, fale com a nossa equipe."
        : "Este contrato já foi enviado para assinatura — procure a mensagem do Autentique no seu WhatsApp.",
      410,
    );
  }

  // ── Dados pessoais já conhecidos (mesma busca de downloadContract) ────
  let personal: Record<string, unknown> = {};
  try {
    const uRes = await fetch(
      `${SB_URL}/rest/v1/app_users?event_ids=cs.{${encodeURIComponent(ev.cod)}}&select=role,personal`,
      { headers: sbH },
    );
    const users = await uRes.json();
    const cliente = Array.isArray(users) ? users.find((u: Record<string, unknown>) => u.role === "cliente") : null;
    if (cliente?.personal) personal = cliente.personal;
  } catch (_) { /* segue com formulário vazio */ }

  // cliente_json vence sobre personal: é o que o próprio cliente já digitou.
  const cj = (ev.cliente_json || {}) as Record<string, string>;

  const pmts = parseJson(ev.payments_json, []) as Array<Record<string, unknown>>;
  const extras = parseJson(ev.spaces_json, {}) as Record<string, unknown>;
  const tipo = String(ev.tipo_evento || "").toLowerCase();
  const isHosp = tipo === "hospedagem";

  const preset: Record<string, unknown> = {
    code: ev.cod || "",
    obs: ev.nome_evento || "",
    date1: ev.data_evento || "",
    date2: ev.data_fim || ev.data_evento || "",
    cin: ev.cin || "18:00",
    cout: ev.cout || "14:00",
    total: ev.valor_locacao ?? "",
    payments: (Array.isArray(pmts) ? pmts : []).map((p) => ({ desc: p.desc, date: p.date, value: p.value })),
    clientName: cj.nome || personal.name || "",
    clientNat: personal.nat || "brasileira",
    clientProf: personal.prof || "",
    clientRg: cj.rg || personal.rg || "",
    clientCpf: cj.cpf || personal.cpf || "",
    clientAddr: cj.endereco || personal.addr || "",
    clientPhone: cj.whatsapp || personal.phone || "",
    clientEmail: cj.email || personal.email || "",
    w2Name: personal.w2name || "",
    w2Cpf: personal.w2cpf || "",
    w2Email: personal.w2email || "",
    isCorporativo: tipo === "corporativo",
  };

  if (isHosp) {
    preset.contractType = "hospedagem";
    preset.nomeLocatario = extras.nomeLocatario || personal.name ||
      String(ev.nome_evento || "").replace(/\s*-\s*\S+$/, "").trim() || "";
    preset.tipoEvento = "Hospedagem";
    preset.acomodacoes = {
      loftFlamboyant: extras.acLoft || false, casaFlamboyant: extras.acCasa || false,
      suiteAssessoria: extras.acSuiteAss || false,
      sf1: extras.acSf1 || false, sf2: extras.acSf2 || false, sf3: extras.acSf3 || false,
      sf4: extras.acSf4 || false, sf5: extras.acSf5 || false,
      sb1: extras.acSb1 || false, sb2: extras.acSb2 || false, sb3: extras.acSb3 || false,
    };
  } else {
    Object.assign(preset, {
      spTumb: extras.spTumb || false, spPeroba: extras.spPeroba || false,
      spBrom: extras.spBrom || false, dayQty: extras.dayQty || 0,
      acLoft: extras.acLoft || false, acCasa: extras.acCasa || false,
      acSuiteAss: extras.acSuiteAss || false,
      acSf1: extras.acSf1 || false, acSf2: extras.acSf2 || false, acSf3: extras.acSf3 || false,
      acSf4: extras.acSf4 || false, acSf5: extras.acSf5 || false,
      acSb1: extras.acSb1 || false, acSb2: extras.acSb2 || false, acSb3: extras.acSb3 || false,
      fuBal: extras.fuBal || false, fuMesas: extras.mesas || 0, fuCad: extras.cad || 0,
      fuBan: extras.ban || 0, exHoras: extras.horas || 0, exMont: extras.mont || 0,
      exDesm: extras.desm || 0,
    });
  }

  // Nomes/descrições das acomodações vêm do inventário — os dois ramos usam.
  try {
    const cods = Object.values(AC_COD_MAP).join(",");
    const invRes = await fetch(
      `${SB_URL}/rest/v1/inventario?cod=in.(${cods})&select=cod,descricao,descricao_orc&limit=50`,
      { headers: sbH },
    );
    const inv = await invRes.json();
    const invMap: Record<string, Record<string, string>> = {};
    (Array.isArray(inv) ? inv : []).forEach((i: Record<string, string>) => { invMap[i.cod] = i; });
    const info: Record<string, unknown> = {};
    for (const [key, cod] of Object.entries(AC_COD_MAP)) {
      const it = invMap[cod] || {};
      info[key] = { nome: it.descricao || key, desc: it.descricao_orc || "" };
    }
    preset.acomodacoesInfo = info;
  } catch (_) { /* template cai no nome padrão */ }

  return json({ contractType: isHosp ? "hospedagem" : "evento", preset });
});
