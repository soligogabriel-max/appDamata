// Edge Function: orcamento-publico
// Renderiza o orçamento como página HTML pública acessível pelo cliente.
// GET ?id=UUID → página com os dados do orçamento

const SB_URL = Deno.env.get("SUPABASE_URL")!;
const SB_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "apikey, authorization, content-type",
};

function fmt(v: number) {
  return "R$ " + Number(v).toLocaleString("pt-BR", { minimumFractionDigits: 2 });
}
function fmtDate(d: string) {
  if (!d) return "";
  const [y, m, dd] = d.split("-");
  return `${dd}/${m}/${y}`;
}

function page(body: string, title = "Orçamento – Fazenda Damata") {
  return new Response(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${title}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,Arial,sans-serif;background:#f5f0eb;min-height:100vh;padding:24px 16px;color:#222}
.card{background:#fff;border-radius:16px;padding:32px 28px;max-width:640px;margin:0 auto;box-shadow:0 4px 24px rgba(0,0,0,.08)}
.logo{font-size:36px;margin-bottom:4px;text-align:center}
.brand{color:#8b5a2b;font-size:13px;font-weight:700;letter-spacing:.8px;text-align:center;margin-bottom:24px}
h1{color:#8b5a2b;font-size:20px;margin-bottom:4px}
.sub{color:#888;font-size:12px;margin-bottom:20px}
.info-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;margin-bottom:20px}
.info-item span{color:#888;font-size:11px;display:block;margin-bottom:2px}
.info-item strong{font-size:13px}
table{width:100%;border-collapse:collapse;margin-bottom:20px}
th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;padding:6px 0;border-bottom:2px solid #eee}
td{padding:8px 0;border-bottom:1px solid #f0f0f0;font-size:13px}
.total-row td{font-size:17px;font-weight:700;color:#8b5a2b;border-top:2px solid #ddd;border-bottom:none;padding-top:12px}
.disc{color:#2a7a2a;font-weight:600}
.sub-row{color:#888}
.sim-box{background:#eef4ff;border:1.5px solid #b8d0ff;border-radius:8px;padding:14px;margin-bottom:12px}
.sim-box h3{font-size:13px;font-weight:700;color:#2a4a7a;margin-bottom:10px}
.sim-table{width:100%;font-size:12px;border-collapse:collapse}
.sim-table th{background:#dde8ff;color:#2a4a7a;padding:5px 8px;text-align:left}
.sim-table td{padding:5px 8px;border-bottom:1px solid #c8deff}
.avista{background:#effff5;border:1.5px solid #a8e6c0;border-radius:8px;padding:12px}
.avista strong{color:#2a6644;font-size:13px}
.avista small{color:#2a6644;font-size:11px;display:block;margin-top:2px}
.footer{margin-top:20px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:12px;line-height:1.6}
.tag-validade{display:inline-block;background:#fef3c7;color:#92400e;font-size:11px;font-weight:600;padding:3px 8px;border-radius:6px;margin-bottom:20px}
</style>
</head>
<body>
<div class="card">
<div class="logo">🌿</div>
<div class="brand">FAZENDA DAMATA</div>
${body}
</div>
</body>
</html>`, { headers: { "Content-Type": "text/html; charset=utf-8", ...CORS } });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const id = url.searchParams.get("id") ?? "";

  if (!id) return page(`<h1>Link inválido</h1><p style="color:#888;margin-top:8px">Este link é inválido ou expirou.</p>`);

  const res = await fetch(`${SB_URL}/rest/v1/orcamentos?id=eq.${id}&select=*`, {
    headers: { apikey: SB_KEY, Authorization: `Bearer ${SB_KEY}` }
  });
  const rows = await res.json();
  const o = rows?.[0];

  if (!o) return page(`<h1>Orçamento não encontrado</h1><p style="color:#888;margin-top:8px">Entre em contato: (19) 99783-0437</p>`);

  const validade = o.validade ? fmtDate(o.validade) : "";
  const emitido = o.created_at ? fmtDate(o.created_at.slice(0, 10)) : "";
  const nomes = [o.nome_noiva, o.nome_noivo].filter(Boolean).join(" e ") || "";
  const itens: Array<{ descricao: string; qty: number; subtotal: number; valor_unitario?: number }> = Array.isArray(o.itens) ? o.itens : [];

  let subtotal = 0;
  const itemRows = itens.map((i) => {
    subtotal += i.subtotal || 0;
    return `<tr>
      <td>${i.descricao || ""}${i.qty > 1 ? " × " + i.qty : ""}</td>
      <td style="text-align:right;white-space:nowrap;padding-left:16px">${fmt(i.subtotal || 0)}</td>
    </tr>`;
  }).join("");

  const total = o.valor_total || subtotal;
  const discount = subtotal - total;
  const subtotalRow = discount > 0 ? `<tr class="sub-row"><td>Subtotal</td><td style="text-align:right">${fmt(subtotal)}</td></tr>` : "";
  const discRow = discount > 0 ? `<tr class="disc"><td>Desconto</td><td style="text-align:right">− ${fmt(discount)}</td></tr>` : "";

  // Simulação de parcelamento
  let simHTML = "";
  if (o.data_evento && total > 0) {
    const hoje = new Date();
    const evento = new Date(o.data_evento + "T12:00:00");
    const mesesAteEvento = Math.max(1, Math.round((evento.getTime() - hoje.getTime()) / (1000 * 60 * 60 * 24 * 30)));
    const n = Math.min(mesesAteEvento, 12);
    if (n >= 2) {
      const parcela = total / n;
      const valorAVista = total * 0.95;
      const rows = Array.from({ length: n }, (_, k) => {
        const d = new Date(hoje);
        d.setMonth(d.getMonth() + k + 1);
        return `<tr><td>${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}</td><td style="text-align:right;font-weight:600">${fmt(parcela)}</td></tr>`;
      }).join("");
      simHTML = `
      <div style="margin-top:20px;border-top:2px solid #eee;padding-top:16px">
        <div style="font-size:14px;font-weight:700;color:#333;margin-bottom:12px">Condições de Pagamento</div>
        <div class="sim-box">
          <h3>Parcelamento em ${n}× de ${fmt(parcela)} (sem juros)</h3>
          <table class="sim-table"><thead><tr><th>Mês</th><th style="text-align:right">Valor</th></tr></thead><tbody>${rows}</tbody></table>
        </div>
        <div class="avista">
          <strong>À vista: ${fmt(valorAVista)}</strong>
          <small>5% de desconto — economia de ${fmt(total - valorAVista)}</small>
        </div>
      </div>`;
    }
  }

  const body = `
    <h1>Orçamento – Fazenda Damata</h1>
    <div class="sub">Emitido em ${emitido}</div>
    ${validade ? `<div class="tag-validade">⏳ Válido até ${validade}</div>` : ""}
    <div class="info-grid">
      <div class="info-item"><span>Contratante</span><strong>${o.nome_contratante || "—"}</strong></div>
      <div class="info-item"><span>WhatsApp</span><strong>${o.whatsapp || "—"}</strong></div>
      <div class="info-item"><span>Evento</span><strong>${o.tipo_evento || "—"}</strong></div>
      <div class="info-item"><span>Data</span><strong>${o.data_evento ? fmtDate(o.data_evento) : "—"}</strong></div>
      ${o.salao ? `<div class="info-item"><span>Salão</span><strong>${o.salao}</strong></div>` : ""}
      ${o.num_convidados ? `<div class="info-item"><span>Convidados</span><strong>${o.num_convidados}</strong></div>` : ""}
      ${nomes ? `<div class="info-item"><span>Nome(s)</span><strong>${nomes}</strong></div>` : ""}
    </div>
    <table>
      <thead><tr><th>Item</th><th style="text-align:right">Valor</th></tr></thead>
      <tbody>
        ${itemRows}
        ${subtotalRow}
        ${discRow}
        <tr class="total-row"><td>Total</td><td style="text-align:right">${fmt(total)}</td></tr>
      </tbody>
    </table>
    ${simHTML}
    <div class="footer">
      Fazenda Damata · fazendadamata.com · (19) 99638-3386<br>
      Este orçamento é válido por 7 dias a partir da data de emissão.
    </div>`;

  return page(body);
});
