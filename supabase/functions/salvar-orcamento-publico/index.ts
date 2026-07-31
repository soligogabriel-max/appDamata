// Edge Function: salvar-orcamento-publico
// Cria e atualiza o orçamento do wizard público (fazendadamata.com/?orcamento).
//
// Por que existe: o wizard roda sem login, então fala com o PostgREST como
// anon. A tabela orcamentos tem política de INSERT para anon, mas nenhuma de
// SELECT — e o PostgREST manda Prefer: return=representation, que vira
// INSERT ... RETURNING. RETURNING exige política de SELECT, então todo save
// público falhava com 42501. Como orcamentos.js engolia o erro num catch
// vazio, o lead sumia em silêncio: sem registro e sem WhatsApp.
//
// Aqui a gravação usa service role e devolve só o id. O UPDATE é escopado por
// visitor_id — sem isso qualquer um sobrescreveria orçamento alheio, já que o
// id é um bigint sequencial e trivial de adivinhar.
//
// Payload POST: { id?: number, visitor_id?: string, ...campos do orçamento }
// Resposta:     { id }
//
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (injetados pelo Supabase)

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

// Só estes campos vêm do cliente. Qualquer outro é descartado — o wizard é
// público, então nada de deixar o payload escolher coluna livremente.
const CAMPOS_TEXTO = [
  "nome_noiva", "nome_noivo", "nome_contratante", "tipo_evento",
  "salao", "whatsapp", "email", "pacote_cod",
];
const CAMPOS_DATA = ["data_evento", "validade"];

// convertido é transição de negócio, feita no admin — o público não escolhe.
const STATUS_PERMITIDOS = new Set(["lead", "orcado", "pendente"]);

const MAX_TEXTO = 300;
const MAX_ITENS = 200;

function texto(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  if (!s) return null;
  return s.slice(0, MAX_TEXTO);
}

function data(v: unknown): string | null {
  const s = texto(v);
  if (!s) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function numero(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function montarBody(p: Record<string, unknown>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const c of CAMPOS_TEXTO) if (c in p) body[c] = texto(p[c]);
  for (const c of CAMPOS_DATA) if (c in p) body[c] = data(p[c]);
  if ("num_convidados" in p) body.num_convidados = numero(p.num_convidados);
  if ("valor_total" in p) body.valor_total = numero(p.valor_total);
  if ("itens" in p) {
    body.itens = Array.isArray(p.itens) ? p.itens.slice(0, MAX_ITENS) : [];
  }
  if ("status" in p) {
    const s = texto(p.status) || "lead";
    body.status = STATUS_PERMITIDOS.has(s) ? s : "lead";
  }
  return body;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH = {
    apikey: SB_SR,
    Authorization: "Bearer " + SB_SR,
    "Content-Type": "application/json",
  };

  let p: Record<string, unknown>;
  try {
    p = await req.json();
  } catch {
    return json({ error: "JSON inválido." }, 400);
  }

  const visitorId = texto(p.visitor_id);
  const body = montarBody(p);
  if (!Object.keys(body).length) return json({ error: "Nada para salvar." }, 400);

  // ── UPDATE ──────────────────────────────────────────────────────────
  const id = p.id === null || p.id === undefined ? null : Number(p.id);
  if (id !== null) {
    if (!Number.isInteger(id) || id <= 0) return json({ error: "id inválido." }, 400);
    // Sem visitor_id não há como provar que o orçamento é de quem pediu.
    if (!visitorId) return json({ error: "visitor_id obrigatório para atualizar." }, 400);

    const res = await fetch(
      `${SB_URL}/rest/v1/orcamentos?id=eq.${id}&visitor_id=eq.${encodeURIComponent(visitorId)}&select=id`,
      {
        method: "PATCH",
        headers: { ...sbH, Prefer: "return=representation" },
        body: JSON.stringify(body),
      },
    );
    if (!res.ok) return json({ error: "Falha ao atualizar.", detail: await res.text() }, 502);

    const rows = await res.json();
    // Zero linhas = id não existe ou pertence a outro visitante. Mesma
    // resposta nos dois casos, para não virar sonda de ids válidos.
    if (!Array.isArray(rows) || !rows.length) return json({ error: "Orçamento não encontrado." }, 404);
    return json({ id: rows[0].id });
  }

  // ── INSERT ──────────────────────────────────────────────────────────
  body.visitor_id = visitorId;

  const res = await fetch(`${SB_URL}/rest/v1/orcamentos?select=id`, {
    method: "POST",
    headers: { ...sbH, Prefer: "return=representation" },
    body: JSON.stringify(body),
  });
  if (!res.ok) return json({ error: "Falha ao salvar.", detail: await res.text() }, 502);

  const rows = await res.json();
  const novo = Array.isArray(rows) ? rows[0] : rows;
  if (!novo?.id) return json({ error: "Insert não retornou id." }, 502);

  return json({ id: novo.id });
});
