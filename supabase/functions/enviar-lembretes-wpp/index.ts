// Supabase Edge Function: enviar-lembretes-wpp
// Envia lembretes de vencimento/atraso de parcelas via WhatsApp (Meta Cloud API).
//
// Secrets necessários:
//   META_WPP_TOKEN          = Bearer token permanente do Meta Cloud API
//   META_WPP_PHONE_ID       = Phone Number ID do WhatsApp Business
//   META_WPP_TEMPLATE       = Template para parcelas (padrão: parcela_vencimento_damata)
//   META_WPP_TEMPLATE_ATRASO = Template para modo atrasados em lote (padrão: cobranca_atraso_damata)
//
// Payload POST:
//   { parcela_id, celular_override? }             → modo individual (botão inline)
//   { vencimento_de, vencimento_ate }             → modo vencimento em lote
//   { vencimento_de, vencimento_ate, modo: "atrasados" } → modo atraso em lote

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

function normalizePhone(raw: string): string {
  const d = (raw || "").replace(/\D/g, "");
  if (!d) return "";
  if (d.startsWith("55") && d.length >= 12) return "+" + d;
  return "+55" + d;
}

function fmtDate(dateStr: string): string {
  if (!dateStr) return "";
  const [y, m, d] = dateStr.split("-");
  return `${d}/${m}/${y}`;
}

function fmtVal(val: number): string {
  return "R$ " + Number(val).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}

async function sendTemplate(
  metaUrl: string, token: string,
  phone: string, templateName: string,
  params: string[]
) {
  const res = await fetch(metaUrl, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: phone,
      type: "template",
      template: {
        name: templateName,
        language: { code: "pt_BR" },
        components: [{
          type: "body",
          parameters: params.map((text) => ({ type: "text", text })),
        }],
      },
    }),
  });
  return res.json();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Método não permitido" }, 405);

  const token = Deno.env.get("META_WPP_TOKEN");
  const phoneId = Deno.env.get("META_WPP_PHONE_ID");
  const templateVencimento = Deno.env.get("META_WPP_TEMPLATE") || "parcela_vencimento_damata";
  const templateAtraso = Deno.env.get("META_WPP_TEMPLATE_ATRASO") || "cobranca_atraso_damata";

  if (!token || !phoneId) {
    return json({ error: "Configure META_WPP_TOKEN e META_WPP_PHONE_ID nos secrets." }, 500);
  }

  let payload: {
    dias?: number; vencimento_de?: string; vencimento_ate?: string; modo?: string;
    parcela_id?: string; celular_override?: string;
  } = {};
  try { payload = await req.json(); } catch { return json({ error: "JSON inválido." }, 400); }

  const SB_URL = Deno.env.get("SUPABASE_URL")!;
  const SB_SR = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const sbH = { apikey: SB_SR, Authorization: "Bearer " + SB_SR, "Content-Type": "application/json" };
  const META_URL = `https://graph.facebook.com/v21.0/${phoneId}/messages`;

  // ── Modo individual: botão inline por título ──
  if (payload.parcela_id) {
    const pRes = await fetch(
      `${SB_URL}/rest/v1/contas_a_receber?id=eq.${payload.parcela_id}&select=id,cod_evento,parcela,num_parcela,valor,vencimento&limit=1`,
      { headers: sbH },
    );
    const [p] = await pRes.json();
    if (!p) return json({ error: "Parcela não encontrada." }, 404);

    const cod = p.cod_evento;

    // Salva celular_override na ficha, se fornecido
    if (payload.celular_override) {
      await fetch(`${SB_URL}/rest/v1/ficha_do_evento?cod=eq.${encodeURIComponent(cod)}`, {
        method: "PATCH",
        headers: { ...sbH, Prefer: "return=minimal" },
        body: JSON.stringify({ celular: payload.celular_override }),
      });
    }

    const [fichaR, agR] = await Promise.all([
      fetch(`${SB_URL}/rest/v1/ficha_do_evento?cod=eq.${encodeURIComponent(cod)}&select=nome_contratante,celular&limit=1`, { headers: sbH }),
      fetch(`${SB_URL}/rest/v1/agenda?cod=eq.${encodeURIComponent(cod)}&select=nome_evento&limit=1`, { headers: sbH }),
    ]);
    const [ficha] = await fichaR.json();
    const [evento] = await agR.json();

    const celular = payload.celular_override || ficha?.celular;
    if (!celular) return json({ ok: false, enviados: 0, msg: "Sem telefone cadastrado." });

    const phone = normalizePhone(celular);
    if (!phone || phone.length < 13) return json({ ok: false, enviados: 0, erro: `Telefone inválido: ${celular}` });

    const nome = (ficha?.nome_contratante || "Cliente").split(" ")[0];

    // Usa template de vencimento individual (parcela_vencimento_damata)
    const data = await sendTemplate(META_URL, token, phone, templateVencimento, [
      nome,
      `${p.parcela ?? "?"}/${p.num_parcela ?? "?"}`,
      fmtVal(p.valor ?? 0),
      fmtDate(p.vencimento),
    ]);

    if (data.error) return json({ ok: false, enviados: 0, erro: data.error.message, template: templateVencimento });

    const nomeEvento = evento?.nome_evento || cod;
    await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
      method: "POST",
      headers: { ...sbH, Prefer: "return=minimal" },
      body: JSON.stringify({
        telefone: phone,
        mensagem: `[Fazenda Damata] Ctr. ${cod} — ${nomeEvento} — Parcela ${p.parcela}/${p.num_parcela} — ${fmtVal(p.valor)} — venceu ${fmtDate(p.vencimento)}`,
        direcao: "enviada",
        nome: ficha?.nome_contratante || null,
        tipo: "template",
        wamid: data.messages?.[0]?.id || null,
      }),
    });

    return json({ ok: true, enviados: 1, phone, lista: [`${cod} parc.${p.parcela}/${p.num_parcela} → ${phone}`] });
  }

  // ── Modos em lote (vencimento / atrasados) ──
  const hoje = new Date();
  const inicio = payload.vencimento_de ?? hoje.toISOString().slice(0, 10);
  const fimDate = new Date(hoje);
  fimDate.setDate(fimDate.getDate() + (payload.dias ?? 3));
  const fim = payload.vencimento_ate ?? fimDate.toISOString().slice(0, 10);
  const modoAtraso = payload.modo === "atrasados";

  // 1. Busca parcelas pendentes no período
  const recRes = await fetch(
    `${SB_URL}/rest/v1/contas_a_receber?status=eq.NP&vencimento=gte.${inicio}&vencimento=lte.${fim}&deleted_at=is.null` +
    `&select=id,cod_evento,parcela,num_parcela,valor,vencimento&order=cod_evento.asc,vencimento.asc&limit=500`,
    { headers: sbH },
  );
  const parcelas: Array<{ id: string; cod_evento: string; parcela: string; num_parcela: string; valor: number; vencimento: string }> =
    await recRes.json();

  if (!Array.isArray(parcelas) || !parcelas.length) {
    return json({ ok: true, enviados: 0, msg: "Nenhuma parcela pendente no período.", periodo: { de: inicio, ate: fim } });
  }

  // 2. Busca dados do evento e ficha do cliente
  const codEventos = [...new Set(parcelas.map((p) => p.cod_evento).filter(Boolean))];

  const [fichaRes, agendaRes] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/ficha_do_evento?cod=in.(${codEventos.map(encodeURIComponent).join(",")})&select=cod,nome_contratante,celular&limit=500`, { headers: sbH }),
    fetch(`${SB_URL}/rest/v1/agenda?cod=in.(${codEventos.map(encodeURIComponent).join(",")})&select=cod,nome_evento&limit=500`, { headers: sbH }),
  ]);
  const fichas: Array<{ cod: string; nome_contratante: string; celular: string }> = await fichaRes.json();
  const eventos: Array<{ cod: string; nome_evento: string }> = await agendaRes.json();

  const fichaMap: Record<string, { nome_contratante: string; celular: string }> = {};
  fichas.forEach((f) => { fichaMap[f.cod] = f; });
  const eventoMap: Record<string, string> = {};
  eventos.forEach((e) => { eventoMap[e.cod] = e.nome_evento; });

  const enviados: string[] = [];
  const erros: Array<{ cod_evento: string; parcela: string; erro: string }> = [];

  if (modoAtraso) {
    // ── Modo atrasados: uma mensagem por evento com lista completa ──
    const porEvento: Record<string, typeof parcelas> = {};
    for (const p of parcelas) {
      if (!porEvento[p.cod_evento]) porEvento[p.cod_evento] = [];
      porEvento[p.cod_evento].push(p);
    }

    for (const [cod, itens] of Object.entries(porEvento)) {
      const ficha = fichaMap[cod];
      if (!ficha?.celular) {
        erros.push({ cod_evento: cod, parcela: "—", erro: "Sem telefone em ficha_do_evento" });
        continue;
      }
      const phone = normalizePhone(ficha.celular);
      if (!phone || phone.length < 13) {
        erros.push({ cod_evento: cod, parcela: "—", erro: `Telefone inválido: ${ficha.celular}` });
        continue;
      }

      const nome = (ficha.nome_contratante || "Cliente").split(" ")[0];
      const nomeEvento = eventoMap[cod] || cod;

      const lista = itens
        .map((p) => `Parcela ${p.parcela ?? "?"}/${p.num_parcela ?? "?"} - venceu ${fmtDate(p.vencimento)} - ${fmtVal(p.valor ?? 0)}`)
        .join("\n");

      try {
        const data = await sendTemplate(META_URL, token, phone, templateAtraso, [nome, nomeEvento, lista]);
        if (data.error) {
          erros.push({ cod_evento: cod, parcela: "—", erro: data.error.message });
        } else {
          enviados.push(`${cod} (${itens.length} parcela(s)) → ${phone}`);
          await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
            method: "POST",
            headers: { ...sbH, Prefer: "return=minimal" },
            body: JSON.stringify({
              telefone: phone,
              mensagem: `[Fazenda Damata] Ctr. ${cod} — ${nomeEvento} — ${itens.length} parcela(s) em atraso:\n${lista}`,
              direcao: "enviada",
              nome: ficha.nome_contratante || null,
              tipo: "template",
              wamid: data.messages?.[0]?.id || null,
            }),
          });
        }
      } catch (e) {
        erros.push({ cod_evento: cod, parcela: "—", erro: String(e) });
      }
    }
  } else {
    // ── Modo vencimento: uma mensagem por parcela ──
    for (const p of parcelas) {
      const ficha = fichaMap[p.cod_evento];
      if (!ficha?.celular) {
        erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: "Sem telefone em ficha_do_evento" });
        continue;
      }
      const phone = normalizePhone(ficha.celular);
      if (!phone || phone.length < 13) {
        erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: `Telefone inválido: ${ficha.celular}` });
        continue;
      }

      const nome = (ficha.nome_contratante || "Cliente").split(" ")[0];

      try {
        const data = await sendTemplate(META_URL, token, phone, templateVencimento, [
          nome,
          `${p.parcela ?? "?"}/${p.num_parcela ?? "?"}`,
          fmtVal(p.valor ?? 0),
          fmtDate(p.vencimento),
        ]);
        if (data.error) {
          erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: data.error.message });
        } else {
          enviados.push(`${p.cod_evento} parc.${p.parcela ?? "?"}/${p.num_parcela ?? "?"} → ${phone}`);
          await fetch(`${SB_URL}/rest/v1/wpp_mensagens`, {
            method: "POST",
            headers: { ...sbH, Prefer: "return=minimal" },
            body: JSON.stringify({
              telefone: phone,
              mensagem: `[Fazenda Damata] Ctr. ${p.cod_evento} — Parcela ${p.parcela ?? "?"}/${p.num_parcela ?? "?"} — ${fmtVal(p.valor ?? 0)} — vence ${fmtDate(p.vencimento)}`,
              direcao: "enviada",
              nome: ficha.nome_contratante || null,
              tipo: "template",
              wamid: data.messages?.[0]?.id || null,
            }),
          });
        }
      } catch (e) {
        erros.push({ cod_evento: p.cod_evento, parcela: p.parcela ?? "?", erro: String(e) });
      }
    }
  }

  return json({ ok: true, enviados: enviados.length, erros, lista: enviados, periodo: { de: inicio, ate: fim }, total_parcelas: parcelas.length });
});
