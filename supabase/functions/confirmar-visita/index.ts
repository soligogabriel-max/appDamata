// Edge Function: confirmar-visita
// Página pública para o visitante confirmar ou cancelar visita agendada
// GET ?id=UUID&token=HMAC         → página com botões Confirmar / Cancelar
// GET ?id=UUID&acao=confirmar&token=HMAC → processa confirmação
// GET ?id=UUID&acao=cancelar&token=HMAC  → processa cancelamento

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SECRET = Deno.env.get("LEMBRETE_SECRET") ?? "damata2026";

async function makeToken(id: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(SECRET),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(id));
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function page(body: string) {
  return new Response(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Visita Fazenda Damata</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,sans-serif;background:#f0f4f0;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:20px}
.card{background:#fff;border-radius:20px;padding:36px 28px;max-width:420px;width:100%;text-align:center;box-shadow:0 8px 32px rgba(0,0,0,.10)}
.logo{font-size:40px;margin-bottom:8px}
.brand{color:#4a7c59;font-size:14px;font-weight:600;letter-spacing:.5px;margin-bottom:24px}
h2{color:#1a2e1a;font-size:20px;margin-bottom:8px}
.info{color:#555;font-size:15px;line-height:1.6;margin-bottom:28px}
.info strong{color:#1a2e1a}
.btn{display:block;width:100%;padding:14px;border-radius:12px;font-size:16px;font-weight:600;cursor:pointer;border:none;text-decoration:none;margin-bottom:12px}
.btn-confirm{background:#16a34a;color:#fff}
.btn-cancel{background:#fff;color:#dc2626;border:2px solid #fca5a5}
.btn-ics{background:#fff;color:#2E3C44;border:2px solid #E8A52A}
.btn-remarcar{background:#fff;color:#4a7c59;border:2px solid #9fc3ab}
.slot{display:block;width:100%;padding:12px;margin-bottom:8px;border-radius:12px;border:1.5px solid #dbe5dd;background:#fff;color:#1a2e1a;font-size:15px;font-weight:600;text-decoration:none;text-align:center}
.slot small{display:block;font-weight:400;color:#6b7d70;font-size:12px;margin-top:2px}
.slots{max-height:46vh;overflow-y:auto;margin-bottom:14px;text-align:left}
.msg{font-size:32px;margin-bottom:16px}
.msg-title{color:#1a2e1a;font-size:22px;font-weight:700;margin-bottom:10px}
.msg-text{color:#555;font-size:15px;line-height:1.6}
a.link{color:#4a7c59;text-decoration:none;font-weight:600}
</style>
</head>
<body><div class="card">
<div class="logo">🌿</div>
<div class="brand">FAZENDA DAMATA</div>
${body}
</div></body></html>`, {
    // Quem busca este HTML e' o visita.html, de outra origem
    // (fazendadamata.com): sem liberar CORS o navegador bloqueia o fetch e o
    // cliente ve "Nao foi possivel abrir sua visita".
    headers: { "Content-Type": "text/html; charset=utf-8", ...CORS }
  });
}

const svc = { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" };

// Onde o cliente abre isto: uma página estática no domínio da Damata, que
// busca este HTML e renderiza. A função não pode entregar a página direto — o
// gateway degrada o que sai de functions/v1 e o cliente vê código-fonte. Mesma
// solução do orçamento (ver orcamento.html / visita.html).
//
// Os botões apontam para cá, e não para a função, senão o primeiro clique
// jogaria o cliente de volta na tela de código.
const PUBLIC_PAGE = "https://fazendadamata.com/visita.html";

function getJwtRole(authHeader: string): string | null {
  const t = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!t) return null;
  try {
    const p = JSON.parse(atob(t.split(".")[1]));
    return p?.app_metadata?.role || p?.user_metadata?.role || null;
  } catch { return null; }
}

const hojeLocal = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 10);  // BRT = UTC-3
const agoraLocal = () => new Date(Date.now() - 3 * 3600 * 1000).toISOString().slice(0, 16).replace("T", " ");
const fmtDia = (d: string) =>
  new Date(d + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" });

// Horários ainda livres, do mais próximo para o mais distante. Exclui o atual
// do próprio cliente: remarcar para o mesmo horário não é remarcar.
async function slotsLivres(slotAtual: string | null) {
  const [rs, rv] = await Promise.all([
    fetch(`${SB_URL}/rest/v1/slots_visita?data=gte.${hojeLocal()}&select=id,data,hora&order=data.asc,hora.asc&limit=200`, { headers: svc }),
    fetch(`${SB_URL}/rest/v1/visitas_comerciais?status=neq.cancelada&select=slot_id`, { headers: svc }),
  ]);
  const slots = rs.ok ? await rs.json().catch(() => []) : [];
  const ocup  = new Set(((rv.ok ? await rv.json().catch(() => []) : []) as { slot_id: string }[]).map((x) => x.slot_id));
  const agora = agoraLocal();
  return (slots as { id: string; data: string; hora: string }[])
    .filter((s) => s.id !== slotAtual && !ocup.has(s.id) && `${s.data} ${s.hora.slice(0, 5)}` > agora);
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id    = url.searchParams.get("id") ?? "";
  const acao  = url.searchParams.get("acao") ?? "";
  const token = url.searchParams.get("token") ?? "";

  // ── Link assinado para a equipe mandar ao cliente ──────────────────
  // O lembrete automático com o link só sai às 9h da véspera. Quem pede para
  // remarcar antes disso não tem link nenhum, e a equipe não consegue montar
  // um: ele é assinado. Aqui a própria função devolve o link pronto, só para
  // admin/equipe logados — sem isso seria um gerador aberto de tokens.
  if (acao === "link") {
    if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
    const papel = getJwtRole(req.headers.get("Authorization") || "");
    if (!["admin", "equipe"].includes(papel ?? "")) {
      return new Response(JSON.stringify({ error: "Não autorizado." }),
        { status: 401, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    if (!id) {
      return new Response(JSON.stringify({ error: "id obrigatório." }),
        { status: 400, headers: { ...CORS, "Content-Type": "application/json" } });
    }
    const assinado = `${PUBLIC_PAGE}?id=${id}&token=${await makeToken(id)}`;
    return new Response(JSON.stringify({ ok: true, url: assinado }),
      { headers: { ...CORS, "Content-Type": "application/json" } });
  }

  if (!url.searchParams.has("raw")) {
    const destino = new URL(PUBLIC_PAGE);
    url.searchParams.forEach((v, k) => destino.searchParams.set(k, v));
    return new Response(null, { status: 302, headers: { Location: destino.toString() } });
  }

  if (!id || !token) return page(`<div class="msg">❌</div><div class="msg-title">Link inválido</div><div class="msg-text">Este link é inválido ou expirou.</div>`);

  const expected = await makeToken(id);
  if (token !== expected) return page(`<div class="msg">❌</div><div class="msg-title">Link inválido</div><div class="msg-text">Este link é inválido ou expirou.</div>`);

  // Busca visita
  const res = await fetch(`${SB_URL}/rest/v1/visitas_comerciais?id=eq.${id}&select=*,slots_visita(data,hora)`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  const visits = await res.json();
  const v = visits?.[0];

  if (!v) return page(`<div class="msg">❌</div><div class="msg-title">Visita não encontrada</div><div class="msg-text">Entre em contato: (19) 99783-0437</div>`);

  const slot = v.slots_visita;
  const dataFmt = slot ? new Date(slot.data + "T12:00:00").toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long" }) : "";
  const hora = slot?.hora?.slice(0, 5) ?? "";
  const base = PUBLIC_PAGE;
  const confirmUrl = `${base}?id=${id}&acao=confirmar&token=${token}`;
  const cancelUrl  = `${base}?id=${id}&acao=cancelar&token=${token}`;
  const remarcarUrl = `${base}?id=${id}&acao=remarcar&token=${token}`;

  // Página principal — mostrar opções
  if (!acao) {
    if (v.status === "cancelada") {
      return page(`<div class="msg">😔</div><div class="msg-title">Visita cancelada</div><div class="msg-text">Esta visita já foi cancelada.<br><br>Para reagendar: <a class="link" href="https://fazendadamata.com/#visita">fazendadamata.com</a></div>`);
    }
    // Convite para a agenda do cliente. Só oferece se o arquivo existe mesmo —
    // visita antiga, de antes desta função, não tem convite gerado.
    const icsUrl = `${SB_URL}/storage/v1/object/public/ical/visita-${id}.ics`;
    let btnIcs = "";
    try {
      const head = await fetch(icsUrl, { method: "HEAD" });
      if (head.ok) btnIcs = `<a class="btn btn-ics" href="${icsUrl}">📅 Adicionar à minha agenda</a>`;
    } catch { /* sem convite, segue sem o botão */ }

    return page(`
      <h2>Sua visita está agendada</h2>
      <div class="info"><strong>${dataFmt}</strong><br>às <strong>${hora}</strong></div>
      <a class="btn btn-confirm" href="${confirmUrl}">✅ Confirmar presença</a>
      <a class="btn btn-remarcar" href="${remarcarUrl}">🔄 Remarcar para outro horário</a>
      ${btnIcs}
      <a class="btn btn-cancel" href="${cancelUrl}">❌ Cancelar visita</a>
    `);
  }

  // Confirmar
  if (acao === "confirmar") {
    return page(`<div class="msg">✅</div><div class="msg-title">Presença confirmada!</div><div class="msg-text">Sua visita está confirmada para<br><strong>${dataFmt} às ${hora}</strong>.<br><br>Aguardamos você! 🌿</div>`);
  }

  // Cancelar
  if (acao === "cancelar") {
    if (v.status !== "cancelada") {
      await fetch(`${SB_URL}/rest/v1/visitas_comerciais?id=eq.${id}`, {
        method: "PATCH",
        headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json", Prefer: "return=minimal" },
        body: JSON.stringify({ status: "cancelada" })
      });
      // Tira o evento do Google Calendar. Sem isto a visita cancelada pelo
      // cliente continuava ocupando o horário na agenda da equipe.
      try {
        await fetch(`${SB_URL}/functions/v1/sync-google-calendar`, {
          method: "POST",
          headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ action: "delete", visita_id: id })
        });
      } catch (e) {
        console.error("cancelar: falha ao remover evento do Google Calendar", id, e);
      }
    }
    return page(`<div class="msg">😔</div><div class="msg-title">Visita cancelada</div><div class="msg-text">Sua visita de <strong>${dataFmt} às ${hora}</strong> foi cancelada.<br><br>Quando quiser reagendar:<br><a class="link" href="https://fazendadamata.com/#visita">fazendadamata.com</a></div>`);
  }

  // ── Remarcar ───────────────────────────────────────────────────────
  // Sem prazo mínimo de propósito: o lembrete com este link só sai às 9h da
  // véspera, então qualquer corte de 24h deixaria o botão inútil na prática.
  // Vale até a hora da visita; depois disso não há o que remarcar.
  if (acao === "remarcar") {
    const base2 = `${base}?id=${id}&token=${token}`;
    if (v.status === "cancelada") {
      return page(`<div class="msg">😔</div><div class="msg-title">Visita cancelada</div><div class="msg-text">Esta visita já foi cancelada.<br><br>Para marcar outra: <a class="link" href="https://fazendadamata.com/#visita">fazendadamata.com</a></div>`);
    }
    if (slot && `${slot.data} ${String(slot.hora).slice(0, 5)}` <= agoraLocal()) {
      return page(`<div class="msg">⏰</div><div class="msg-title">Horário já passou</div><div class="msg-text">Esta visita era <strong>${dataFmt} às ${hora}</strong>.<br><br>Para marcar outra: <a class="link" href="https://fazendadamata.com/#visita">fazendadamata.com</a><br>ou chame no WhatsApp: (19) 99783-0437</div>`);
    }

    const escolhido = url.searchParams.get("slot") ?? "";
    const livres = await slotsLivres(v.slot_id ?? null);

    // Sem escolha ainda: mostra a lista.
    if (!escolhido) {
      if (!livres.length) {
        return page(`<div class="msg">😕</div><div class="msg-title">Sem outros horários</div><div class="msg-text">No momento não há outro horário livre.<br><br>Chame a gente no WhatsApp que a gente dá um jeito:<br><a class="link" href="https://wa.me/5519997830437">(19) 99783-0437</a></div>`);
      }
      return page(`
        <h2>Escolha o novo horário</h2>
        <div class="info">Hoje sua visita é<br><strong>${dataFmt}</strong> às <strong>${hora}</strong></div>
        <div class="slots">${livres.map((s) =>
          `<a class="slot" href="${base2}&acao=remarcar&slot=${s.id}">${fmtDia(s.data)}<small>às ${String(s.hora).slice(0, 5)}</small></a>`).join("")}</div>
        <a class="btn btn-cancel" href="${base2}">Voltar</a>
      `);
    }

    // Escolheu: o horário pode ter sido tomado entre carregar a lista e clicar.
    const novo = livres.find((s) => s.id === escolhido);
    if (!novo) {
      return page(`<div class="msg">😕</div><div class="msg-title">Horário indisponível</div><div class="msg-text">Alguém marcou esse horário antes. Escolha outro:<br><br><a class="btn btn-remarcar" href="${base2}&acao=remarcar">🔄 Ver horários</a></div>`);
    }

    const upd = await fetch(`${SB_URL}/rest/v1/visitas_comerciais?id=eq.${id}`, {
      method: "PATCH",
      headers: { ...svc, Prefer: "return=minimal" },
      body: JSON.stringify({ slot_id: novo.id }),
    });
    if (!upd.ok) {
      return page(`<div class="msg">⚠️</div><div class="msg-title">Não consegui remarcar</div><div class="msg-text">Tente de novo em instantes ou chame no WhatsApp:<br><a class="link" href="https://wa.me/5519997830437">(19) 99783-0437</a></div>`);
    }

    // Move o evento na agenda da equipe e reescreve o convite do cliente. A
    // function lê a visita do banco, então já pega o horário novo; o convite
    // mantém o mesmo identificador e o celular dele trata como atualização.
    try {
      await fetch(`${SB_URL}/functions/v1/sync-google-calendar`, {
        method: "POST", headers: svc,
        body: JSON.stringify({ action: "upsert", visita_id: id }),
      });
    } catch (e) {
      console.error("remarcar: falha ao mover evento no Google Calendar", id, e);
    }

    const icsUrl2 = `${SB_URL}/storage/v1/object/public/ical/visita-${id}.ics`;
    let btnIcs2 = "";
    try {
      const head = await fetch(icsUrl2, { method: "HEAD" });
      if (head.ok) btnIcs2 = `<a class="btn btn-ics" href="${icsUrl2}">📅 Atualizar na minha agenda</a>`;
    } catch { /* segue sem o botão */ }

    return page(`
      <div class="msg">🔄</div>
      <div class="msg-title">Visita remarcada!</div>
      <div class="msg-text">Seu novo horário é<br><strong>${fmtDia(novo.data)} às ${String(novo.hora).slice(0, 5)}</strong>.<br><br>Aguardamos você! 🌿</div>
      ${btnIcs2}
    `);
  }

  return page(`<div class="msg">❌</div><div class="msg-title">Ação inválida</div>`);
});
