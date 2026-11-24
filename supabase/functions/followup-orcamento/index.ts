// Supabase Edge Function: followup-orcamento
// Um dia depois do orçamento, convida a pessoa para visitar a fazenda, por
// WhatsApp, com botão que abre o agendamento já ligado ao orçamento dela.
// Chamada diariamente pelo pg_cron às 14h30 UTC (11h30 Brasília).
//
// Quem recebe é decidido no banco (followup_orcamento_candidatos): janela de
// 24 a 72 horas, sem visita marcada, sem contrato, sem conversa recente com a
// equipe, uma mensagem por telefone, nunca duas vezes. Ver a migração
// supabase/migrations/followup_orcamento.sql para a lista inteira.
//
// Secrets necessários:
//   META_WPP_TOKEN                  = Bearer permanente do Meta Cloud API
//   META_WPP_PHONE_ID               = Phone Number ID do WhatsApp Business
//   META_WPP_WABA_ID                = WhatsApp Business Account ID (só para criar o template)
//   META_WPP_TEMPLATE_FOLLOWUP_ORC  = nome do template (padrão: convite_visita_fd)
//
// Template convite_visita_fd (pt_BR, MARKETING):
//   Body: {{1}} = primeiro nome
//   Botão URL dinâmico: fazendadamata.com/admin.html?visita&t={{1}} — {{1}} é o
//   token do orçamento, para a visita nascer com nome, WhatsApp e orc_id.
//
// Payload POST (todos opcionais):
//   {}                          → envia para os candidatos de hoje
//   { "dry": true }             → só lista quem receberia, não manda nada
//   { "acao": "criar_template" }  → cadastra o template na WABA (uma vez)
//   { "acao": "status_template" } → consulta se a Meta já aprovou
//
// Protegida no Authorization por uma de três credenciais: service role, chave
// sb_secret_, ou o segredo do cron (Vault 'followup_orcamento', conferido por
// RPC). verify_jwt:false — sem isso qualquer um dispararia envios.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH = "https://graph.facebook.com/v21.0";
const LINK_VISITA = "https://fazendadamata.com/admin.html?visita&t=";
const LIMITE_PADRAO = 40;

type Candidato = {
  id: number; token: string; primeiro_nome: string; telefone: string;
  criado_em: string; tipo_evento: string | null; valor_total: number | null; origem: string | null;
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });
}

// O cron manda um segredo que vive só no Vault e a função confere por RPC —
// ela nunca precisa saber o valor.
async function segredoDoCronConfere(sbUrl: string, sbKey: string, token: string) {
  const res = await fetch(`${sbUrl}/rest/v1/rpc/followup_orcamento_auth`, {
    method: "POST",
    headers: { apikey: sbKey, Authorization: `Bearer ${sbKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ p_token: token }),
  });
  if (!res.ok) return false;
  return (await res.json()) === true;
}

// Definição do template, no formato da API de message_templates. Fica aqui,
// e não só no painel da Meta, para o texto estar versionado junto do código
// que o dispara.
function definicaoTemplate(nome: string) {
  return {
    name: nome,
    language: "pt_BR",
    category: "MARKETING",
    components: [
      {
        type: "BODY",
        text: "Oi {{1}}, aqui é da Fazenda Damata 🌿\n\n" +
          "Vi que você montou um orçamento para o seu evento com a gente. Que tal conhecer a fazenda pessoalmente? " +
          "A visita é guiada e sem compromisso — é só escolher o dia e o horário no botão abaixo.\n\n" +
          "Se preferir, responde esta mensagem que a gente combina por aqui.",
        example: { body_text: [["Ana"]] },
      },
      { type: "FOOTER", text: "Não quer mais receber mensagens? Responda SAIR." },
      {
        type: "BUTTONS",
        buttons: [{
          type: "URL",
          text: "Agendar visita",
          url: LINK_VISITA + "{{1}}",
          example: [LINK_VISITA + "3f2c1b0a-5d6e-4f70-8a9b-0c1d2e3f4a5b"],
        }],
      },
    ],
  };
}

async function criarTemplate(waba: string, token: string, nome: string) {
  const res = await fetch(`${GRAPH}/${waba}/message_templates`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(definicaoTemplate(nome)),
  });
  return res.json();
}

async function statusTemplate(waba: string, token: string, nome: string) {
  const res = await fetch(
    `${GRAPH}/${waba}/message_templates?name=${encodeURIComponent(nome)}&fields=name,status,category,language,rejected_reason`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  const d = await res.json();
  if (d.error) return { error: d.error.message };
  // name= na Graph API é prefixo, então filtra o nome exato
  const t = (d.data || []).find((x: { name: string }) => x.name === nome);
  return t || { status: "NAO_CADASTRADO" };
}

async function enviarTemplate(phoneId: string, token: string, nome: string, c: Candidato) {
  const res = await fetch(`${GRAPH}/${phoneId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: c.telefone,
      type: "template",
      template: {
        name: nome,
        language: { code: "pt_BR" },
        components: [
          { type: "body", parameters: [{ type: "text", text: c.primeiro_nome || "tudo bem" }] },
          { type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: c.token }] },
        ],
      },
    }),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const TOKEN    = Deno.env.get("META_WPP_TOKEN") || "";
  const PHONE_ID = Deno.env.get("META_WPP_PHONE_ID") || "";
  const WABA_ID  = Deno.env.get("META_WPP_WABA_ID") || "";
  const TEMPLATE = Deno.env.get("META_WPP_TEMPLATE_FOLLOWUP_ORC") || "convite_visita_fd";
  const SB_URL   = Deno.env.get("SUPABASE_URL") || "";
  const SB_KEY   = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

  if (!TOKEN || !PHONE_ID) return json({ error: "META_WPP_TOKEN ou META_WPP_PHONE_ID ausente." }, 500);
  if (!SB_URL || !SB_KEY) return json({ error: "Credenciais do Supabase ausentes." }, 500);

  const auth = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const SECRET_KEYS = Deno.env.get("SUPABASE_SECRET_KEYS") || "";
  const autorizado = auth.length > 20 && (
    auth === SB_KEY ||
    (auth.startsWith("sb_secret_") && SECRET_KEYS.includes(auth)) ||
    await segredoDoCronConfere(SB_URL, SB_KEY, auth)
  );
  if (!autorizado) return json({ error: "Não autorizado." }, 401);

  let body: { dry?: boolean; acao?: string; limite?: number } = {};
  try { body = await req.json(); } catch (_) { /* corpo vazio: envio normal */ }

  if (body.acao === "criar_template" || body.acao === "status_template") {
    if (!WABA_ID) return json({ error: "META_WPP_WABA_ID ausente." }, 500);
    const r = body.acao === "criar_template"
      ? await criarTemplate(WABA_ID, TOKEN, TEMPLATE)
      : await statusTemplate(WABA_ID, TOKEN, TEMPLATE);
    return json({ ok: !r.error, template: TEMPLATE, resultado: r });
  }

  const sbH = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };
  const limite = Math.max(1, Math.min(Number(body.limite) || LIMITE_PADRAO, 200));

  const resC = await fetch(`${SB_URL}/rest/v1/rpc/followup_orcamento_candidatos`, {
    method: "POST", headers: sbH,
    body: JSON.stringify({ p_min_h: 24, p_max_h: 72, p_limite: limite }),
  });
  if (!resC.ok) return json({ error: `candidatos: PostgREST ${resC.status}: ${await resC.text()}` }, 500);
  const candidatos: Candidato[] = await resC.json();

  // Nunca devolver telefone inteiro: a resposta vai parar em log do cron.
  const mascara = (t: string) => t.slice(0, 6) + "…" + t.slice(-2);
  const resumo = (c: Candidato) => ({
    id: c.id, nome: c.primeiro_nome, telefone: mascara(c.telefone),
    criado_em: c.criado_em, origem: c.origem, tipo: c.tipo_evento,
  });

  if (body.dry) {
    return json({ ok: true, dry: true, template: TEMPLATE, candidatos: candidatos.map(resumo) });
  }
  if (!candidatos.length) return json({ ok: true, enviados: 0, msg: "Ninguém para convidar hoje." });

  const enviados: unknown[] = [];
  const erros: unknown[] = [];

  for (const c of candidatos) {
    try {
      const d = await enviarTemplate(PHONE_ID, TOKEN, TEMPLATE, c);
      if (d.error) {
        erros.push({ ...resumo(c), erro: d.error.message, code: d.error.code });
        // Template inexistente ou não aprovado: vai falhar igual para todos.
        // Para aqui em vez de bater 40 vezes na Meta com o mesmo erro.
        if ([132001, 132012, 132015, 132016].includes(Number(d.error.code))) break;
        continue;
      }
      const link = LINK_VISITA + c.token;
      // O prefixo "[Follow-up orçamento]" é o que impede o reenvio: a seleção
      // no banco exclui telefone que já tem mensagem começando assim.
      await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
        method: "POST",
        headers: { ...sbH, Prefer: "return=minimal" },
        body: JSON.stringify({
          telefone: c.telefone,
          mensagem: `[Follow-up orçamento] ${c.primeiro_nome} — ${TEMPLATE} — link: ${link}`,
          direcao: "enviada",
          nome: c.primeiro_nome || null,
          tipo: "template",
          wamid: d.messages?.[0]?.id || null,
        }),
      });
      enviados.push(resumo(c));
    } catch (e) {
      erros.push({ ...resumo(c), erro: String(e instanceof Error ? e.message : e) });
    }
  }

  return json({ ok: true, template: TEMPLATE, enviados: enviados.length, erros, lista: enviados, candidatos: candidatos.length });
});
