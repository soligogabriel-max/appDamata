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
    headers: { "Content-Type": "text/html; charset=utf-8" }
  });
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  const id    = url.searchParams.get("id") ?? "";
  const acao  = url.searchParams.get("acao") ?? "";
  const token = url.searchParams.get("token") ?? "";

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
  const base = url.origin + url.pathname;
  const confirmUrl = `${base}?id=${id}&acao=confirmar&token=${token}`;
  const cancelUrl  = `${base}?id=${id}&acao=cancelar&token=${token}`;

  // Página principal — mostrar opções
  if (!acao) {
    if (v.status === "cancelada") {
      return page(`<div class="msg">😔</div><div class="msg-title">Visita cancelada</div><div class="msg-text">Esta visita já foi cancelada.<br><br>Para reagendar: <a class="link" href="https://fazendadamata.com/#visita">fazendadamata.com</a></div>`);
    }
    return page(`
      <h2>Sua visita está agendada</h2>
      <div class="info"><strong>${dataFmt}</strong><br>às <strong>${hora}</strong></div>
      <a class="btn btn-confirm" href="${confirmUrl}">✅ Confirmar presença</a>
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
    }
    return page(`<div class="msg">😔</div><div class="msg-title">Visita cancelada</div><div class="msg-text">Sua visita de <strong>${dataFmt} às ${hora}</strong> foi cancelada.<br><br>Quando quiser reagendar:<br><a class="link" href="https://fazendadamata.com/#visita">fazendadamata.com</a></div>`);
  }

  return page(`<div class="msg">❌</div><div class="msg-title">Ação inválida</div>`);
});
