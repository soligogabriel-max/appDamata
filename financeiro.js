// ══════════════════════════════════════════
// TOAST
// ══════════════════════════════════════════
// ══════════════════════════════════════════
// LOOKUP CACHES
// ══════════════════════════════════════════
let _fornecMap = null, _agendaMap = null;

async function getFornecMap() {
  if(_fornecMap) return _fornecMap;
  const rows = await dbGet("fornecedores","select=codigo,nome&limit=500");
  _fornecMap = {};
  rows.forEach(r=>{ _fornecMap[r.codigo]=r.nome; });
  return _fornecMap;
}

async function getAgendaMap() {
  if(_agendaMap) return _agendaMap;
  const rows = await dbGet("agenda","select=cod,nome_evento&limit=1000");
  _agendaMap = {};
  rows.forEach(r=>{ _agendaMap[r.cod]=r.nome_evento; });
  return _agendaMap;
}

let _naturezaMap = null;
async function getNaturezaMap() {
  if(_naturezaMap) return _naturezaMap;
  const rows = await dbGet("naturezas","select=cod,descricao&limit=500");
  _naturezaMap = {};
  rows.forEach(r=>{ _naturezaMap[r.cod]=r.descricao; });
  return _naturezaMap;
}

// ══════════════════════════════════════════
// A RECEBER
// ══════════════════════════════════════════
function fmt(v){ return v==null?"—":"R$ "+Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2,maximumFractionDigits:2}); }
function fmtDate(s){ if(!s)return"—"; const[y,m,d]=s.split("-"); return d+"/"+m+"/"+y; }
function validarFmtWpp(val){
  const v=(val||"").trim();
  if(!v||v==="+55"||v==="+55 ")return"Informe o número de WhatsApp.";
  const d=v.replace(/\D/g,"");
  if(d.length<10)return"Número inválido — inclua código do país, DDD e número (ex: +55 11 99999-9999).";
  if(d.length>15)return"Número muito longo.";
  return null;
}
function statusBadge(s){
  const sl=(s||"").toLowerCase();
  if(sl==="pago"||sl==="recebido") return '<span class="stbadge pago">Pago</span>';
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  return '<span class="stbadge pend">Pendente</span>';
}
function statusBadgeVenc(s,venc){
  const sl=(s||"").toLowerCase();
  if(sl==="pago"||sl==="pago") return '<span class="stbadge pago">Pago</span>';
  if(venc){ const d=new Date(venc); d.setHours(0,0,0,0); const h=new Date(); h.setHours(0,0,0,0); if(d<h) return '<span class="stbadge atras">Atrasado</span>'; }
  return '<span class="stbadge pend">Pendente</span>';
}

let _recFiltrado=[], _recAgendaMap={}, _recConcilMap={}, _recConcilTituloMap={};

async function renderReceber(){
  const wr=document.getElementById("rec-list"); wr.innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  const totWr=document.getElementById("rec-totais"); totWr.innerHTML="";
  try {
    const mesEl=document.getElementById("rec-fil-mes");
    const mes=mesEl.value;
    const st=document.getElementById("rec-fil-status").value;
    const busca=(document.getElementById("rec-busca").value||"").toLowerCase().trim();
    let q="order=vencimento.asc.nullslast&limit=2000&select=*";
    if(mes){ const[y,m]=mes.split("-"); const prox=m==="12"?(parseInt(y)+1)+"-01":(y+"-"+String(parseInt(m)+1).padStart(2,"0")); q+="&vencimento=gte."+y+"-"+m+"-01&vencimento=lt."+prox+"-01"; }
    if(st==="Pago") q+="&status=eq.PAGO";
    else if(st==="Pendente"||st==="Atrasado") q+="&status=eq.NP";
    const rows=await dbGetAll("contas_a_receber",q);
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    let filtrado=rows.filter(r=>{
      if(_userEventIds != null && !_userEventIds.includes(r.cod_evento)) return false;
      if(st==="Atrasado") return (r.valor||0)>0&&r.vencimento&&new Date(r.vencimento)<hoje;
      if(st==="Pendente") return !r.vencimento||new Date(r.vencimento)>=hoje;
      return true;
    });
    const agendaMapRec = await getAgendaMap();
    if(busca) filtrado=filtrado.filter(r=>{
      const nomeEv=(agendaMapRec[r.cod_evento]||"").toLowerCase();
      return nomeEv.includes(busca)||(r.cod_evento||"").toLowerCase().includes(busca);
    });
    const total=filtrado.reduce((a,r)=>a+(r.valor||0),0);
    const recebido=filtrado.filter(r=>(r.status||"").toUpperCase()==="PAGO").reduce((a,r)=>a+(r.valor||0),0);
    const pendente=total-recebido;
    totWr.innerHTML=`
      <div class="tot-card"><div class="tot-lbl">Total</div><div class="tot-val blue">${fmt(total)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Recebido</div><div class="tot-val green">${fmt(recebido)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Pendente</div><div class="tot-val red">${fmt(pendente)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Títulos</div><div class="tot-val">${filtrado.length}</div></div>`;
    // Carrega extrato SEM filtro de mês para pegar conciliações de qualquer data
    const agendaMap = agendaMapRec;
    const extratoRows = await dbGet("extrato_bancario","select=id_extrato_c6,titulo_a_receber,entrada,titulo&titulo_a_receber=not.is.null&limit=2000");
    // Deduplica extrato por id_extrato_c6 antes de montar mapa
    const seenExt=new Set();
    const extratoDedup=extratoRows.filter(e=>{ if(seenExt.has(e.id_extrato_c6)){return false;} seenExt.add(e.id_extrato_c6); return true; });
    const concilMap = {}; const concilTituloMap = {};
    extratoDedup.forEach(e=>{
      const k=String(e.titulo_a_receber);
      concilMap[k]=(concilMap[k]||0)+(e.entrada||0);
      if(e.titulo){ concilTituloMap[k]=concilTituloMap[k]?concilTituloMap[k]+", "+e.titulo:e.titulo; }
    });

    _recFiltrado=filtrado; _recAgendaMap=agendaMap; _recConcilMap=concilMap; _recConcilTituloMap=concilTituloMap;
    if(!filtrado.length){ wr.innerHTML='<div class="empty"><div class="eicon">💰</div>Nenhum título encontrado.</div>'; return; }
    wr.innerHTML=`
    <div id="rec-bulk-bar" style="display:none;align-items:center;gap:10px;padding:8px 12px;background:var(--al);border:1.5px solid var(--am);border-radius:10px;margin-bottom:8px;">
      <span id="rec-bulk-count" style="font-size:13px;font-weight:600;color:var(--dk);"></span>
      <button class="btn-delete" style="padding:5px 14px;font-size:12px;" onclick="bulkDeleteReceber()">🗑 Apagar selecionados</button>
      <button class="btn-cancel" style="padding:5px 14px;font-size:12px;" onclick="_recClearSel()">Limpar seleção</button>
    </div>
    <div class="table-wrap"><table class="fin-table">
      <thead><tr><th style="width:32px;"><input type="checkbox" id="rec-chk-all" onchange="_recToggleAll(this)" style="cursor:pointer;"/></th><th>Vencimento</th><th>Cód.</th><th>Evento</th><th>Natureza</th><th>Parcela</th><th>Valor</th><th>Conciliado</th><th>Título Extrato</th><th>Status</th><th></th></tr></thead>
      <tbody>${filtrado.map(r=>{
        const nomeEv=agendaMap[r.cod_evento]||"";
        const concil=concilMap[String(r.id)]||0;
        const isPago=(r.status||"").toUpperCase()==="PAGO";
        const isAtras=!isPago&&(r.valor||0)>0&&r.vencimento&&new Date(r.vencimento)<hoje;
        const badge=isPago?'<span class="stbadge pago">Pago</span>':(isAtras?'<span class="stbadge atras">Atrasado</span>':'<span class="stbadge pend">Pendente</span>');
        const rj=_esc(JSON.stringify(r));
        const tituloExt=(_recConcilTituloMap||{})[String(r.id)]||"";
        return`<tr>
          <td><input type="checkbox" class="rec-chk" data-id="${r.id}" onchange="_recChkChange()" style="cursor:pointer;"/></td>
          <td>${fmtDate(r.vencimento)}</td>
          <td style="color:var(--dl);font-size:11px;">${r.cod_evento||"—"}</td>
          <td style="font-weight:600;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${nomeEv||"—"}</td>
          <td style="color:var(--dm);">${r.natureza||"—"}</td>
          <td style="color:var(--dm);">${r.parcela||r.num_parcela||"—"}</td>
          <td style="font-weight:700;color:#1A4A7C;">${fmt(r.valor)}</td>
          <td style="font-weight:600;color:${concil>0?"#2A6644":"var(--dl)"};">${concil>0?fmt(concil):"—"}</td>
          <td style="font-size:11px;color:var(--dl);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(tituloExt)}">${tituloExt||"—"}</td>
          <td>${badge}</td>
          <td><div class="row-acts"><button class="act-btn" title="Editar" onclick='openCrud("contas_a_receber",JSON.parse(this.dataset.r),renderReceber)' data-r="${rj}">✏️</button>${isAtras?`<button class="act-btn" title="Lembrete WhatsApp" style="color:#25D366;" data-id="${r.id}" data-cod="${r.cod_evento||''}" onclick="_recEnviarLembrete(this)">📱</button>`:''}</div></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro ao carregar: '+e.message+'</div>'; }
}

function exportarReceberPDF(){
  if(!_recFiltrado.length){ alert("Nenhum registro para exportar."); return; }
  const hoje=new Date(); hoje.setHours(0,0,0,0);
  const mes  = document.getElementById("rec-fil-mes").value;
  const st   = document.getElementById("rec-fil-status").value;
  const busca= document.getElementById("rec-busca").value.trim();
  const filtroDesc=[
    mes   ? "Mês: "+mes : "",
    st    ? "Status: "+st : "",
    busca ? "Busca: "+busca : "",
  ].filter(Boolean).join(" · ") || "Todos os registros";
  const total    =_recFiltrado.reduce((a,r)=>a+(r.valor||0),0);
  const recebido =_recFiltrado.filter(r=>(r.status||"").toUpperCase()==="PAGO").reduce((a,r)=>a+(r.valor||0),0);
  const pendente =total-recebido;
  const rows=_recFiltrado.map(r=>{
    const nomeEv=_recAgendaMap[r.cod_evento]||r.cod_evento||"—";
    const concil=_recConcilMap[String(r.id)]||0;
    const isPago=(r.status||"").toUpperCase()==="PAGO";
    const isAtras=!isPago&&(r.valor||0)>0&&r.vencimento&&new Date(r.vencimento)<hoje;
    const status=isPago?"Pago":isAtras?"Atrasado":"Pendente";
    const statusCor=isPago?"#166534":isAtras?"#b91c1c":"#92400e";
    return `<tr>
      <td>${fmtDate(r.vencimento)||"—"}</td>
      <td style="font-size:11px;color:#6b7280">${r.cod_evento||"—"}</td>
      <td>${_esc(nomeEv)}</td>
      <td>${_esc(r.natureza||"—")}</td>
      <td style="text-align:center">${r.parcela||r.num_parcela||"—"}</td>
      <td style="text-align:right;font-weight:700">${fmt(r.valor)}</td>
      <td style="text-align:right;color:${concil>0?"#166534":"#9ca3af"}">${concil>0?fmt(concil):"—"}</td>
      <td style="text-align:center;color:${statusCor};font-weight:700">${status}</td>
    </tr>`;
  }).join("");
  const w=window.open("","_blank","width=900,height=700");
  w.document.write(`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
  <title>Contas a Receber — Fazenda Damata</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0;}
    body{font-family:'Segoe UI',system-ui,sans-serif;font-size:12px;color:#1f2937;padding:24px 32px;}
    h1{font-size:18px;font-weight:800;color:#2E3C44;margin-bottom:2px;}
    .sub{font-size:11px;color:#6b7280;margin-bottom:16px;}
    .totais{display:flex;gap:24px;margin-bottom:16px;padding:12px 16px;background:#f9fafb;border-radius:8px;border:1px solid #e5e7eb;}
    .tot{display:flex;flex-direction:column;gap:2px;}
    .tot-l{font-size:10px;font-weight:700;letter-spacing:.5px;text-transform:uppercase;color:#6b7280;}
    .tot-v{font-size:15px;font-weight:800;}
    .blue{color:#1d4ed8;} .green{color:#166534;} .red{color:#b91c1c;}
    table{width:100%;border-collapse:collapse;}
    th{background:#2E3C44;color:#fff;padding:7px 8px;text-align:left;font-size:11px;font-weight:700;letter-spacing:.3px;}
    td{padding:6px 8px;border-bottom:1px solid #f3f4f6;vertical-align:middle;}
    tr:nth-child(even) td{background:#f9fafb;}
    .footer{margin-top:16px;font-size:10px;color:#9ca3af;text-align:right;}
    @media print{body{padding:0;}@page{margin:16mm 12mm;size:A4 landscape;}}
  </style></head><body>
  <h1>Contas a Receber — Fazenda Damata</h1>
  <div class="sub">Filtro: ${_esc(filtroDesc)} · Gerado em ${new Date().toLocaleString("pt-BR")}</div>
  <div class="totais">
    <div class="tot"><span class="tot-l">Total</span><span class="tot-v blue">${fmt(total)}</span></div>
    <div class="tot"><span class="tot-l">Recebido</span><span class="tot-v green">${fmt(recebido)}</span></div>
    <div class="tot"><span class="tot-l">Pendente</span><span class="tot-v red">${fmt(pendente)}</span></div>
    <div class="tot"><span class="tot-l">Títulos</span><span class="tot-v">${_recFiltrado.length}</span></div>
  </div>
  <table>
    <thead><tr>
      <th>Vencimento</th><th>Cód.</th><th>Evento</th><th>Natureza</th>
      <th style="text-align:center">Parcela</th><th style="text-align:right">Valor</th>
      <th style="text-align:right">Conciliado</th><th style="text-align:center">Status</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>
  <div class="footer">Fazenda Damata · ${_recFiltrado.length} registros</div>
  <script>window.onload=()=>window.print();<\/script>
  </body></html>`);
  w.document.close();
}

// ══════════════════════════════════════════
// A PAGAR
// ══════════════════════════════════════════
let _pagSort = {col:'vencimento_real', dir:'asc'};

async function renderPagar(){
  const wr=document.getElementById("pag-list"); wr.innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  const totWr=document.getElementById("pag-totais"); totWr.innerHTML="";
  try {
    const mesElP=document.getElementById("pag-fil-mes");
    const mes=mesElP.value;
    const st=document.getElementById("pag-fil-status").value;
    const busca=(document.getElementById("pag-busca").value||"").toLowerCase().trim();
    const natFil=document.getElementById("pag-fil-natureza").value;
    let q="order=vencimento_real.asc.nullslast&limit=2000&select=*";
    if(mes){ const[y,m]=mes.split("-"); const prox=m==="12"?(parseInt(y)+1)+"-01":(y+"-"+String(parseInt(m)+1).padStart(2,"0")); q+="&vencimento_real=gte."+y+"-"+m+"-01&vencimento_real=lt."+prox+"-01"; }
    if(st==="Pago") q+="&status=eq.Pago";
    else if(st==="Pendente"||st==="Atrasado") q+="&status=eq.NP";
    if(natFil) q+="&natureza=eq."+encodeURIComponent(natFil);
    const [rows, extConc, fornecMap, naturezaMap] = await Promise.all([
      dbGetAll("contas_a_pagar",q),
      sbFetch("extrato_bancario?select=titulo_a_pagar&titulo_a_pagar=not.is.null&limit=5000"),
      getFornecMap(),
      getNaturezaMap()
    ]);
    const conciliadoSet=new Set((extConc||[]).map(r=>String(r.titulo_a_pagar)));
    const hoje=new Date(); hoje.setHours(0,0,0,0);
    // Popula dropdown de naturezas na primeira carga
    const selNat=document.getElementById("pag-fil-natureza");
    if(selNat.options.length===1){
      const nats=[...new Set(rows.map(r=>r.natureza).filter(Boolean))].sort();
      nats.forEach(n=>{ const o=document.createElement("option"); o.value=n; o.textContent=naturezaMap[n]||n; selNat.appendChild(o); });
    }
    let filtrado=rows.filter(r=>{
      if(st==="Atrasado") return r.vencimento_real&&new Date(r.vencimento_real)<hoje;
      if(st==="Pendente") return !r.vencimento_real||new Date(r.vencimento_real)>=hoje;
      return true;
    });
    if(busca) filtrado=filtrado.filter(r=>{
      const nomeForn=r.fornecedor_cod?(fornecMap[r.fornecedor_cod]||r.fornecedor_cod):(r.devolver_para||"");
      return nomeForn.toLowerCase().includes(busca)||(r.devolver_para||"").toLowerCase().includes(busca);
    });
    // Sort client-side
    const {col,dir}=_pagSort;
    filtrado.sort((a,b)=>{
      let va=a[col]??'', vb=b[col]??'';
      if(col==='valor'){ return dir==='asc'?(Number(va)||0)-(Number(vb)||0):(Number(vb)||0)-(Number(va)||0); }
      if(col==='vencimento_real'){ va=va||'9999-99-99'; vb=vb||'9999-99-99'; }
      if(col==='fornecedor_cod'){ va=fornecMap[va]||va||''; vb=fornecMap[vb]||vb||''; }
      va=String(va).toLowerCase(); vb=String(vb).toLowerCase();
      return dir==='asc'?va.localeCompare(vb,'pt'):vb.localeCompare(va,'pt');
    });
    const total=filtrado.reduce((a,r)=>a+(r.valor||0),0);
    const pago=filtrado.filter(r=>(r.status||"").toLowerCase()==="pago").reduce((a,r)=>a+(r.valor||0),0);
    const pendente=total-pago;
    totWr.innerHTML=`
      <div class="tot-card"><div class="tot-lbl">Total</div><div class="tot-val blue">${fmt(total)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Pago</div><div class="tot-val green">${fmt(pago)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Pendente</div><div class="tot-val red">${fmt(pendente)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Títulos</div><div class="tot-val">${filtrado.length}</div></div>`;
    if(!filtrado.length){ wr.innerHTML='<div class="empty"><div class="eicon">💳</div>Nenhum título encontrado.</div>'; return; }
    function thS(label,c){const a=_pagSort.col===c;const arr=a?(_pagSort.dir==='asc'?' ▲':' ▼'):'';return`<th style="cursor:pointer;user-select:none;white-space:nowrap;" onclick="_pagSetSort('${c}')">${label}${arr}</th>`;}
    wr.innerHTML=`
    <div id="pag-bulk-bar" style="display:none;align-items:center;gap:10px;padding:8px 12px;background:var(--al);border:1.5px solid var(--am);border-radius:10px;margin-bottom:8px;">
      <span id="pag-bulk-count" style="font-size:13px;font-weight:600;color:var(--dk);"></span>
      <button class="btn-delete" style="padding:5px 14px;font-size:12px;" onclick="bulkDeletePagar()">🗑 Apagar selecionados</button>
      <button class="btn-cancel" style="padding:5px 14px;font-size:12px;" onclick="_pagClearSel()">Limpar seleção</button>
    </div>
    <div class="table-wrap"><table class="fin-table">
      <thead><tr>
        <th style="width:32px;"><input type="checkbox" id="pag-chk-all" onchange="_pagToggleAll(this)" style="cursor:pointer;"/></th>
        ${thS('Vencimento','vencimento_real')}
        ${thS('Fornecedor','fornecedor_cod')}
        <th>C.Custo</th>
        ${thS('Natureza','natureza')}
        ${thS('Tipo/Origem','tipo')}
        <th>Obs</th>
        ${thS('Valor','valor')}
        ${thS('Status','status')}
        <th></th>
      </tr></thead>
      <tbody>${filtrado.map(r=>{
        const nomeForn=r.fornecedor_cod?(fornecMap[r.fornecedor_cod]||r.fornecedor_cod):(r.devolver_para||"—");
        const natDescr=r.natureza?(naturezaMap[r.natureza]||r.natureza):"—";
        const isPago=(r.status||"").toLowerCase()==="pago";
        const isAtras=!isPago&&r.vencimento_real&&new Date(r.vencimento_real)<hoje;
        const badge=isPago?'<span class="stbadge pago">Pago</span>':(isAtras?'<span class="stbadge atras">Atrasado</span>':'<span class="stbadge pend">Pendente</span>');
        const rj=_esc(JSON.stringify(r));
        const tipo=r.tipo||"";
        let srcBadge;
        if(tipo==="Extrato C6") srcBadge='<span style="font-size:11px;background:#dbeafe;color:#1d4ed8;padding:1px 6px;border-radius:4px;white-space:nowrap;">🏦 Extrato</span>';
        else if(tipo==="Cartão C6") srcBadge='<span style="font-size:11px;background:#ede9fe;color:#6d28d9;padding:1px 6px;border-radius:4px;white-space:nowrap;">💳 Cartão</span>';
        else if(tipo) srcBadge='<span style="font-size:11px;background:#f3f4f6;color:#374151;padding:1px 6px;border-radius:4px;white-space:nowrap;">'+_esc(tipo)+'</span>';
        else srcBadge='<span style="font-size:11px;background:#f3f4f6;color:#6b7280;padding:1px 6px;border-radius:4px;white-space:nowrap;">✏️ Manual</span>';
        const isConcil=conciliadoSet.has(String(r.id));
        const concilIcon=isConcil?'<span title="Conciliado com Extrato C6" style="margin-left:4px;color:#16a34a;font-size:13px;cursor:default;">🔗</span>':'';
        const obsText=r.obs||"";
        const obsPreview=obsText.length>35?obsText.substring(0,35)+"…":obsText;
        const obsTd=obsText?`<td style="font-size:12px;color:var(--dm);max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:default;" title="${_esc(obsText)}">${_esc(obsPreview)}</td>`:'<td style="color:var(--br);font-size:12px;">—</td>';
        return '<tr>'
          +'<td><input type="checkbox" class="pag-chk" data-id="'+r.id+'" onchange="_pagChkChange()" style="cursor:pointer;"/></td>'
          +'<td>'+fmtDate(r.vencimento_real)+'</td>'
          +'<td style="font-weight:600;">'+_esc(nomeForn)+'</td>'
          +'<td style="color:var(--dm);">'+( r.centro_custo_cod||"—")+'</td>'
          +'<td style="color:var(--dm);">'+natDescr+'</td>'
          +'<td style="white-space:nowrap;">'+srcBadge+concilIcon+'</td>'
          +obsTd
          +'<td style="font-weight:700;color:var(--er);">'+fmt(r.valor)+'</td>'
          +'<td>'+badge+'</td>'
          +'<td><div class="row-acts"><button class="act-btn" title="Editar" onclick=\'openCrud("contas_a_pagar",JSON.parse(this.dataset.r),renderPagar)\' data-r="'+rj+'">✏️</button></div></td>'
          +'</tr>';
      }).join("")}</tbody>
    </table></div>`;
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro ao carregar: '+e.message+'</div>'; }
}

function _pagSetSort(col){
  if(_pagSort.col===col) _pagSort.dir=_pagSort.dir==='asc'?'desc':'asc';
  else { _pagSort.col=col; _pagSort.dir='asc'; }
  renderPagar();
}

// ══════════════════════════════════════════
// FLUXO DE CAIXA
// ══════════════════════════════════════════
async function renderFluxo(){
  const wr=document.getElementById("flx-table"); wr.innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  const resWr=document.getElementById("flx-resumo"); resWr.innerHTML="";
  const hoje=new Date(); hoje.setDate(1); hoje.setHours(0,0,0,0);
  const deEl=document.getElementById("flx-de");
  const ateEl=document.getElementById("flx-ate");
  // Preenche defaults na primeira abertura: -3 meses até +24 meses
  if(!deEl.value){
    const d=new Date(hoje); d.setMonth(d.getMonth()-3);
    deEl.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }
  if(!ateEl.value){
    const d=new Date(hoje); d.setMonth(d.getMonth()+24);
    ateEl.value=d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0");
  }
  const [iniY,iniM]=deEl.value.split("-").map(Number);
  const [fimY,fimM]=ateEl.value.split("-").map(Number);
  const inicio=new Date(iniY,iniM-1,1);
  const fim=new Date(fimY,fimM-1,1);
  if(fim<inicio){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Mês final deve ser igual ou posterior ao inicial.</div>'; return; }
  const iniStr=deEl.value+"-01";
  const lastDay=new Date(fimY,fimM,0).getDate();
  const fimStr=ateEl.value+"-"+String(lastDay).padStart(2,"0");
  const totalMeses=((fimY-iniY)*12+(fimM-iniM))+1;
  try {
    const [recRows, pagRows] = await Promise.all([
      dbGet("contas_a_receber","vencimento=gte."+iniStr+"&vencimento=lte."+fimStr+"&limit=10000"),
      dbGet("contas_a_pagar","vencimento_real=gte."+iniStr+"&vencimento_real=lte."+fimStr+"&limit=10000")
    ]);
    const MESES_ABREV=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const meses=[];
    for(let i=0;i<totalMeses;i++){
      const d=new Date(inicio); d.setMonth(d.getMonth()+i);
      meses.push({ano:d.getFullYear(), mes:d.getMonth()+1, label:MESES_ABREV[d.getMonth()]+" "+d.getFullYear()});
    }
    const hojeStr=hoje.getFullYear()+"-"+String(hoje.getMonth()+1).padStart(2,"0");
    const dados=meses.map(({ano,mes,label})=>{
      const pfx=ano+"-"+String(mes).padStart(2,"0");
      const recTotal=recRows.filter(r=>r.vencimento&&r.vencimento.startsWith(pfx)).reduce((a,r)=>a+(r.valor||0),0);
      const recPago=recRows.filter(r=>r.vencimento&&r.vencimento.startsWith(pfx)&&(r.status||"").toUpperCase()==="PAGO").reduce((a,r)=>a+(r.valor||0),0);
      const pagTotal=pagRows.filter(r=>r.vencimento_real&&r.vencimento_real.startsWith(pfx)).reduce((a,r)=>a+(r.valor||0),0);
      const pagPago=pagRows.filter(r=>r.vencimento_real&&r.vencimento_real.startsWith(pfx)&&(r.status||"").toLowerCase()==="pago").reduce((a,r)=>a+(r.valor||0),0);
      const isAtual=pfx===hojeStr;
      return {label,pfx,recTotal,recPago,pagTotal,pagPago,saldo:recTotal-pagTotal,saldoReal:recPago-pagPago,isAtual};
    });
    const totRec=dados.reduce((a,d)=>a+d.recTotal,0);
    const totPag=dados.reduce((a,d)=>a+d.pagTotal,0);
    const totSaldo=totRec-totPag;
    resWr.innerHTML=`
      <div class="tot-card"><div class="tot-lbl">Total a Receber (${totalMeses} ${totalMeses===1?"mês":"meses"})</div><div class="tot-val green">${fmt(totRec)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Total a Pagar (${totalMeses} ${totalMeses===1?"mês":"meses"})</div><div class="tot-val red">${fmt(totPag)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Resultado Previsto</div><div class="tot-val ${totSaldo>=0?"green":"red"}">${fmt(totSaldo)}</div></div>`;
    wr.innerHTML=`<div class="table-wrap"><table class="fin-table">
      <thead><tr>
        <th>Mês</th>
        <th style="color:#2A6644;">A Receber</th>
        <th style="color:#2A6644;">Recebido</th>
        <th style="color:var(--er);">A Pagar</th>
        <th style="color:var(--er);">Pago</th>
        <th>Saldo Previsto</th>
        <th>Saldo Real</th>
      </tr></thead>
      <tbody>${dados.map(d=>{
        const cor=d.saldo>=0?"#2A6644":"var(--er)";
        const corR=d.saldoReal>=0?"#2A6644":"var(--er)";
        const rowStyle=d.isAtual?"background:var(--al);outline:2px solid var(--a);outline-offset:-2px;":"";
        return`<tr class="flx-row-mes" style="${rowStyle}">
          <td style="font-weight:700;white-space:nowrap;">${d.isAtual?"▶ ":""}${d.label}</td>
          <td style="color:#2A6644;">${d.recTotal?fmt(d.recTotal):"—"}</td>
          <td style="color:#2A6644;">${d.recPago?fmt(d.recPago):"—"}</td>
          <td style="color:var(--er);">${d.pagTotal?fmt(d.pagTotal):"—"}</td>
          <td style="color:var(--er);">${d.pagPago?fmt(d.pagPago):"—"}</td>
          <td style="font-weight:700;color:${cor};">${fmt(d.saldo)}</td>
          <td style="font-weight:700;color:${corR};">${fmt(d.saldoReal)}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro ao carregar: '+e.message+'</div>'; }
}

// ══════════════════════════════════════════
// CONTA SÓCIOS
// ══════════════════════════════════════════
async function renderContaSocios(){
  const pendDiv  = document.getElementById("socios-pendentes");
  const resumoDiv= document.getElementById("socios-resumo");
  const listaDiv = document.getElementById("socios-lista");
  if(!pendDiv) return;
  pendDiv.innerHTML = '<div style="color:var(--dl);padding:20px 0;">Carregando...</div>';
  resumoDiv.innerHTML = listaDiv.innerHTML = '';

  // Inicializa filtros de mês na 1ª abertura
  const inpDe  = document.getElementById("socios-fil-de");
  const inpAte = document.getElementById("socios-fil-ate");
  if(inpDe && !inpDe.value){
    const now = new Date();
    inpDe.value  = `${now.getFullYear()}-01`;
    inpAte.value = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  const de  = inpDe?.value  || '';
  const ate = inpAte?.value || '';
  const dateGte = de  ? `${de}-01`  : '2020-01-01';
  const dateLte = ate ? (()=>{ const [y,m]=ate.split('-').map(Number); return `${ate}-${String(new Date(y,m,0).getDate()).padStart(2,'0')}`; })() : '2099-12-31';
  const periodoLabel = (de||'?').slice(0,7).split('-').reverse().join('/') + ' — ' + (ate||'?').slice(0,7).split('-').reverse().join('/');

  try {
    const [classified, devols] = await Promise.all([
      sbFetch(`extrato_bancario?select=id_extrato_c6,data_lancamento,titulo,descricao,entrada,saida,socio&socio=in.(gabriel,vitoria)&data_lancamento=gte.${dateGte}&data_lancamento=lte.${dateLte}&order=data_lancamento.desc`),
      sbFetch(`extrato_bancario?select=id_extrato_c6,data_lancamento,titulo,descricao,entrada,saida,socio&titulo=ilike.*DEVOL*PIX*&socio=is.null&order=data_lancamento.desc`)
    ]);

    // ── Pendentes de classificação
    if(devols.length){
      let rows='';
      devols.forEach(r=>{
        const val=r.saida>0?r.saida:r.entrada;
        const sinal=r.saida>0?'−':'+';
        const cor=r.saida>0?'#b91c1c':'#166534';
        rows+=`<tr style="border-top:1px solid #fef3c7;">
          <td style="padding:6px 8px;white-space:nowrap;">${fmtDate(r.data_lancamento)}</td>
          <td style="padding:6px 8px;color:var(--dm);">${r.titulo||r.descricao||'—'}</td>
          <td style="padding:6px 8px;text-align:right;font-weight:600;color:${cor};">${sinal} ${fmt(val)}</td>
          <td style="padding:6px 8px;text-align:center;white-space:nowrap;">
            <button class="btn-a" style="padding:3px 10px;font-size:12px;margin:0 2px;" onclick="classificarSocio('${r.id_extrato_c6}','gabriel')">Gabriel</button>
            <button class="btn-a" style="padding:3px 10px;font-size:12px;margin:0 2px;background:#7c3aed;" onclick="classificarSocio('${r.id_extrato_c6}','vitoria')">Vitória</button>
            <button class="btn-cancel" style="padding:3px 10px;font-size:12px;margin:0 2px;" onclick="classificarSocio('${r.id_extrato_c6}','nenhum')">Nenhum</button>
          </td>
        </tr>`;
      });
      pendDiv.innerHTML=`<div style="background:#fffbeb;border:1.5px solid #f59e0b;border-radius:12px;padding:16px;margin-bottom:20px;">
        <div style="font-weight:700;color:#92400e;margin-bottom:12px;">⚠️ ${devols.length} devolução(ões) de Pix pendente(s) de classificação</div>
        <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;font-size:13px;">
          <thead><tr style="color:#92400e;font-size:12px;">
            <th style="text-align:left;padding:4px 8px;">Data</th>
            <th style="text-align:left;padding:4px 8px;">Título</th>
            <th style="text-align:right;padding:4px 8px;">Valor</th>
            <th style="text-align:center;padding:4px 8px;">Associar a</th>
          </tr></thead><tbody>${rows}</tbody>
        </table></div></div>`;
    } else {
      pendDiv.innerHTML='';
    }

    // ── Cards de resumo por sócio
    const tot={gabriel:{e:0,s:0},vitoria:{e:0,s:0}};
    classified.forEach(r=>{
      if(tot[r.socio]){ tot[r.socio].e+=r.entrada||0; tot[r.socio].s+=r.saida||0; }
    });
    function cardSocio(key,label){
      const t=tot[key], saldo=t.e-t.s;
      const cor=saldo>0?'#b45309':saldo<0?'#166534':'#374151';
      const bg=saldo>0?'#fffbeb':saldo<0?'#f0fdf4':'#f3f4f6';
      const nota=saldo>0?'empresa deve ao sócio':saldo<0?'retiradas superam aportes no período':'em dia';
      return `<div style="flex:1;min-width:220px;background:#f9fafb;border:1.5px solid #e5e7eb;border-radius:12px;padding:16px;">
        <div style="font-weight:700;font-size:15px;margin-bottom:12px;">👤 ${label}</div>
        <div style="display:flex;flex-direction:column;gap:6px;font-size:13px;">
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--dl);">Aportes (entradas)</span>
            <span style="color:#166534;font-weight:600;">+ ${fmt(t.e)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;">
            <span style="color:var(--dl);">Retiradas (saídas)</span>
            <span style="color:#b91c1c;font-weight:600;">− ${fmt(t.s)}</span>
          </div>
          <div style="display:flex;justify-content:space-between;border-top:1px solid #e5e7eb;padding-top:8px;margin-top:4px;">
            <span style="font-weight:600;">Saldo do período</span>
            <span style="font-weight:700;color:${cor};background:${bg};padding:2px 10px;border-radius:6px;">${saldo>=0?'+':'−'} ${fmt(Math.abs(saldo))}</span>
          </div>
          <div style="font-size:11px;color:${cor};margin-top:2px;">${nota}</div>
        </div>
      </div>`;
    }
    resumoDiv.innerHTML=`<div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap;">
      ${cardSocio('gabriel','Gabriel José Soligo')}
      ${cardSocio('vitoria','Vitória Bedutti Rodrigues')}
    </div>`;

    // ── Tabela detalhada
    if(!classified.length){
      listaDiv.innerHTML=`<div style="color:var(--dl);text-align:center;padding:30px 0;">Nenhuma transação classificada no período ${periodoLabel}</div>`;
      return;
    }
    const filSocio=window._sociosFil||'todos';
    const filtered=filSocio==='todos'?classified:classified.filter(r=>r.socio===filSocio);
    const tabBtns=['todos','gabriel','vitoria'].map(s=>{
      const labels={todos:'Todos',gabriel:'Gabriel',vitoria:'Vitória'};
      const active=filSocio===s?'background:var(--a);color:#fff;':'background:var(--bg2);color:var(--dk);border:1px solid #e5e7eb;';
      return `<button onclick="window._sociosFil='${s}';renderContaSocios()" style="padding:4px 14px;border-radius:20px;border:none;cursor:pointer;font-size:12px;font-weight:600;${active}">${labels[s]}</button>`;
    }).join('');
    let rows='';
    filtered.forEach(r=>{
      const isE=r.entrada>0;
      const val=isE?r.entrada:r.saida;
      const cor=isE?'#166534':'#b91c1c';
      const sinal=isE?'+':'−';
      const sLabel=r.socio==='gabriel'?'Gabriel':'Vitória';
      const sColor=r.socio==='gabriel'?'#1d4ed8':'#7c3aed';
      rows+=`<tr style="border-top:1px solid #f3f4f6;">
        <td style="padding:7px 8px;white-space:nowrap;font-size:13px;">${fmtDate(r.data_lancamento)}</td>
        <td style="padding:7px 8px;font-size:13px;color:var(--dm);">${r.titulo||r.descricao||'—'}</td>
        <td style="padding:7px 8px;text-align:right;font-weight:600;font-size:13px;color:${cor};">${sinal} ${fmt(val)}</td>
        <td style="padding:7px 8px;text-align:center;">
          <span style="background:${sColor}1a;color:${sColor};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600;">${sLabel}</span>
        </td>
        <td style="padding:7px 8px;text-align:center;">
          <button class="btn-cancel" style="padding:2px 8px;font-size:11px;" title="Remover classificação" onclick="desclassificarSocio('${r.id_extrato_c6}')">✕</button>
        </td>
      </tr>`;
    });
    listaDiv.innerHTML=`<div style="display:flex;gap:6px;margin-bottom:12px;align-items:center;">
        <span style="font-size:12px;color:var(--dl);margin-right:4px;">Sócio:</span>${tabBtns}
      </div>
      <div style="overflow-x:auto;"><table style="width:100%;border-collapse:collapse;">
        <thead><tr style="color:var(--dl);font-size:12px;">
          <th style="text-align:left;padding:4px 8px;">Data</th>
          <th style="text-align:left;padding:4px 8px;">Descrição</th>
          <th style="text-align:right;padding:4px 8px;">Valor</th>
          <th style="text-align:center;padding:4px 8px;">Sócio</th>
          <th style="padding:4px 8px;"></th>
        </tr></thead><tbody>${rows}</tbody>
      </table></div>`;

  } catch(e) {
    pendDiv.innerHTML=`<div style="color:var(--er)">Erro: ${e.message}</div>`;
  }
}

async function classificarSocio(id, socio){
  try {
    await sbFetch('extrato_bancario?id_extrato_c6=eq.'+id, {method:'PATCH', body:{socio: socio==='nenhum'?'nenhum':socio}, prefer:'return=minimal'});
    await renderContaSocios();
  } catch(e) { alert('Erro ao classificar: '+e.message); }
}

async function desclassificarSocio(id){
  if(!confirm('Remover classificação desta transação?')) return;
  try {
    await sbFetch('extrato_bancario?id_extrato_c6=eq.'+id, {method:'PATCH', body:{socio:null}, prefer:'return=minimal'});
    await renderContaSocios();
  } catch(e) { alert('Erro: '+e.message); }
}

// ══════════════════════════════════════════
// FLUXO REAL vs PREVISTO
// ══════════════════════════════════════════
async function renderFluxoReal(){
  const wr=document.getElementById("flxr-table"); wr.innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  const resWr=document.getElementById("flxr-resumo"); resWr.innerHTML="";
  const selAno=document.getElementById("flxr-ano");
  if(!selAno.options.length){
    const anoAtual=new Date().getFullYear();
    for(let a=anoAtual-2;a<=anoAtual+1;a++){ const o=document.createElement("option"); o.value=a; o.textContent=a; if(a===anoAtual)o.selected=true; selAno.appendChild(o); }
  }
  const ano=parseInt(selAno.value);
  try {
    // Carrega extrato do ano (deduplica), receber e pagar em paralelo
    const [rawExt, recRows, pagRows] = await Promise.all([
      dbGet("extrato_bancario","data_lancamento=gte."+ano+"-01-01&data_lancamento=lte."+ano+"-12-31&select=id_extrato_c6,data_lancamento,entrada,saida&limit=5000"),
      dbGet("contas_a_receber","vencimento=gte."+ano+"-01-01&vencimento=lte."+ano+"-12-31&select=vencimento,valor,status&limit=5000"),
      dbGet("contas_a_pagar","vencimento_real=gte."+ano+"-01-01&vencimento_real=lte."+ano+"-12-31&select=vencimento_real,valor,status&limit=5000")
    ]);
    // Deduplica extrato
    const seenE=new Set();
    const extRows=rawExt.filter(r=>{ if(seenE.has(r.id_extrato_c6))return false; seenE.add(r.id_extrato_c6); return true; });

    const MESES=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
    const dados=MESES.map((_,i)=>{
      const m=String(i+1).padStart(2,"0");
      const pfx=ano+"-"+m;
      // Real (extrato)
      const entReal=extRows.filter(r=>r.data_lancamento&&r.data_lancamento.startsWith(pfx)).reduce((a,r)=>a+(r.entrada||0),0);
      const saiReal=extRows.filter(r=>r.data_lancamento&&r.data_lancamento.startsWith(pfx)).reduce((a,r)=>a+(r.saida||0),0);
      // Previsto (tabelas)
      const recPrev=recRows.filter(r=>r.vencimento&&r.vencimento.startsWith(pfx)).reduce((a,r)=>a+(r.valor||0),0);
      const pagPrev=pagRows.filter(r=>r.vencimento_real&&r.vencimento_real.startsWith(pfx)).reduce((a,r)=>a+(r.valor||0),0);
      return {mes:MESES[i], entReal, saiReal, saldoReal:entReal-saiReal, recPrev, pagPrev, saldoPrev:recPrev-pagPrev, difEnt:entReal-recPrev, difSai:saiReal-pagPrev};
    });

    const totEntReal=dados.reduce((a,d)=>a+d.entReal,0);
    const totSaiReal=dados.reduce((a,d)=>a+d.saiReal,0);
    const totRecPrev=dados.reduce((a,d)=>a+d.recPrev,0);
    const totPagPrev=dados.reduce((a,d)=>a+d.pagPrev,0);

    resWr.innerHTML=`
      <div class="tot-card"><div class="tot-lbl">Entradas Reais ${ano}</div><div class="tot-val green">${fmt(totEntReal)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Saídas Reais ${ano}</div><div class="tot-val red">${fmt(totSaiReal)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Saldo Real ${ano}</div><div class="tot-val ${totEntReal-totSaiReal>=0?"green":"red"}">${fmt(totEntReal-totSaiReal)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Previsto Receber</div><div class="tot-val blue">${fmt(totRecPrev)}</div></div>
      <div class="tot-card"><div class="tot-lbl">Previsto Pagar</div><div class="tot-val blue">${fmt(totPagPrev)}</div></div>`;

    wr.innerHTML=`<div class="table-wrap"><table class="fin-table">
      <thead><tr>
        <th>Mês / ${ano}</th>
        <th style="color:#2A6644;">Entrada Real</th>
        <th style="color:var(--er);">Saída Real</th>
        <th>Saldo Real</th>
        <th style="border-left:2px solid var(--br);color:#2A6644;">Prev. Receber</th>
        <th style="color:var(--er);">Prev. Pagar</th>
        <th>Saldo Prev.</th>
        <th style="border-left:2px solid var(--br);">Δ Entradas</th>
        <th>Δ Saídas</th>
      </tr></thead>
      <tbody>${dados.map(d=>{
        const crR=d.saldoReal>=0?"#2A6644":"var(--er)";
        const crP=d.saldoPrev>=0?"#2A6644":"var(--er)";
        const crDE=d.difEnt>=0?"#2A6644":"var(--er)";
        const crDS=d.difSai<=0?"#2A6644":"var(--er)"; // saída menor que previsto = bom
        const vazio=!d.entReal&&!d.saiReal&&!d.recPrev&&!d.pagPrev;
        if(vazio) return`<tr style="opacity:.4"><td style="font-weight:700;">${d.mes}</td><td colspan="8" style="color:var(--dl);font-size:11px;">Sem dados</td></tr>`;
        return`<tr class="flx-row-mes">
          <td style="font-weight:700;">${d.mes}</td>
          <td style="color:#2A6644;">${d.entReal?fmt(d.entReal):"—"}</td>
          <td style="color:var(--er);">${d.saiReal?fmt(d.saiReal):"—"}</td>
          <td style="font-weight:700;color:${crR};">${fmt(d.saldoReal)}</td>
          <td style="border-left:2px solid var(--br);color:#2A6644;">${d.recPrev?fmt(d.recPrev):"—"}</td>
          <td style="color:var(--er);">${d.pagPrev?fmt(d.pagPrev):"—"}</td>
          <td style="font-weight:700;color:${crP};">${fmt(d.saldoPrev)}</td>
          <td style="border-left:2px solid var(--br);font-weight:600;color:${crDE};">${d.entReal||d.recPrev?fmt(d.difEnt):"—"}</td>
          <td style="font-weight:600;color:${crDS};">${d.saiReal||d.pagPrev?fmt(d.difSai):"—"}</td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro: '+e.message+'</div>'; }
}

// ══════════════════════════════════════════
// EXTRATO C6
// ══════════════════════════════════════════
let _extAllRows=[];

function _extMesChange(){
  const de=document.getElementById("ext-fil-de");
  const ate=document.getElementById("ext-fil-ate");
  if(de)de.value="";
  if(ate)ate.value="";
  renderExtrato();
}
function _extRangeChange(){
  const mesEl=document.getElementById("ext-fil-mes");
  if(mesEl)mesEl.value="";
  renderExtrato();
}
function _extApplyDescFilter(){
  const desc=(document.getElementById("ext-fil-desc")||{}).value||"";
  const term=desc.trim().toLowerCase();
  const wr=document.getElementById("ext-list");
  if(!wr)return;
  if(!term){
    _extRenderTable(_extAllRows);
    return;
  }
  const filtered=_extAllRows.filter(r=>(r.titulo||r.descricao||"").toLowerCase().includes(term));
  _extRenderTable(filtered,true);
}
function _extRenderTable(rows,filtered){
  const wr=document.getElementById("ext-list");
  const totWr=document.getElementById("ext-totais");
  if(!rows.length){
    wr.innerHTML='<div class="empty"><div class="eicon">🏦</div>'+(filtered?"Nenhum resultado para esse filtro.":"Nenhum lançamento neste período.")+'</div>';
    return;
  }
  const totalEnt=rows.reduce((a,r)=>a+(r.entrada||0),0);
  const totalSai=rows.reduce((a,r)=>a+(r.saida||0),0);
  const saldoFinal=rows[rows.length-1].saldo_do_dia;
  if(totWr)totWr.innerHTML=`
    <div class="tot-card"><div class="tot-lbl">Entradas</div><div class="tot-val green">${fmt(totalEnt)}</div></div>
    <div class="tot-card"><div class="tot-lbl">Saídas</div><div class="tot-val red">${fmt(totalSai)}</div></div>
    <div class="tot-card"><div class="tot-lbl">Saldo Final</div><div class="tot-val ${saldoFinal>=0?"blue":"red"}">${fmt(saldoFinal)}</div></div>
    <div class="tot-card"><div class="tot-lbl">Lançamentos</div><div class="tot-val">${rows.length}</div></div>`;
  wr.innerHTML=`<div class="table-wrap"><table class="fin-table">
    <thead><tr><th style="width:32px;"><input type="checkbox" id="ext-chk-all" onchange="_extToggleAll(this)" style="cursor:pointer;"/></th><th>Data</th><th>Descrição</th><th style="color:#2A6644;">Entrada</th><th style="color:var(--er);">Saída</th><th>Saldo do Dia</th><th>Título Receber</th><th>Título Pagar</th><th></th></tr></thead>
    <tbody>${rows.map(r=>{const rj=_esc(JSON.stringify(r));return`<tr>
      <td><input type="checkbox" class="ext-chk" data-id="${_esc(r.id_extrato_c6)}" onchange="_extChkChange()" style="cursor:pointer;"/></td>
      <td style="white-space:nowrap;">${fmtDate(r.data_lancamento)}</td>
      <td style="max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(r.titulo||r.descricao||"")}">${r.titulo||r.descricao||"—"}</td>
      <td style="font-weight:${r.entrada>0?700:400};color:${r.entrada>0?"#2A6644":"var(--dl)"};">${r.entrada>0?fmt(r.entrada):"—"}</td>
      <td style="font-weight:${r.saida>0?700:400};color:${r.saida>0?"var(--er)":"var(--dl)"};">${r.saida>0?fmt(r.saida):"—"}</td>
      <td style="color:var(--dm);">${fmt(r.saldo_do_dia)}</td>
      <td style="color:var(--dl);font-size:11px;">${r.titulo_a_receber||"—"}</td>
      <td style="color:var(--dl);font-size:11px;">${r.titulo_a_pagar||"—"}</td>
      <td><div class="row-acts"><button class="act-btn" title="Associar título" onclick='openCrud("extrato_bancario",JSON.parse(this.dataset.r),renderExtrato)' data-r="${rj}">🔗</button></div></td>
    </tr>`}).join("")}</tbody>
  </table></div>`;
}

async function renderExtrato(){
  const wr=document.getElementById("ext-list"); wr.innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  const totWr=document.getElementById("ext-totais"); totWr.innerHTML="";
  const mesEl=document.getElementById("ext-fil-mes");
  const deEl=document.getElementById("ext-fil-de");
  const ateEl=document.getElementById("ext-fil-ate");
  const descEl=document.getElementById("ext-fil-desc");

  let dateFilter="";
  const deVal=deEl?deEl.value:"";
  const ateVal=ateEl?ateEl.value:"";

  if(deVal||ateVal){
    // Período específico
    if(deVal) dateFilter+="&data_lancamento=gte."+deVal;
    if(ateVal) dateFilter+="&data_lancamento=lte."+ateVal;
    if(!deVal&&ateVal&&mesEl) mesEl.value="";
  } else {
    // Mês
    if(!mesEl.value){ const n=new Date(); mesEl.value=n.getFullYear()+"-"+String(n.getMonth()+1).padStart(2,"0"); }
    const mes=mesEl.value;
    const [y,m]=mes.split("-");
    const prox=m==="12"?(parseInt(y)+1)+"-01":(y+"-"+String(parseInt(m)+1).padStart(2,"0"));
    dateFilter="&data_lancamento=gte."+y+"-"+m+"-01&data_lancamento=lt."+prox+"-01";
  }

  try {
    const rawRows=await dbGet("extrato_bancario",
      "order=data_lancamento.asc,id_extrato_c6.asc&limit=5000"+dateFilter
    );
    const seen=new Set();
    _extAllRows=rawRows.filter(r=>{ if(seen.has(r.id_extrato_c6)){return false;} seen.add(r.id_extrato_c6); return true; });

    const desc=(descEl?descEl.value:"").trim().toLowerCase();
    const rows=desc?_extAllRows.filter(r=>(r.titulo||r.descricao||"").toLowerCase().includes(desc)):_extAllRows;
    _extRenderTable(rows,!!desc);
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro: '+e.message+'</div>'; }
}

// ══════════════════════════════════════════
// IMPORTAÇÃO DE EXTRATO C6
// ══════════════════════════════════════════
let _impRows = [], _impEntradas = [], _impSaidas = [], _impStep = 0;
let _impNaturezas = [], _impFornecList = [], _impNatByFornec = {};
const C6_ZIP_PASS = "356027";

function _djb2(s){let h=5381;for(let i=0;i<s.length;i++)h=((h<<5)+h)^s.charCodeAt(i);return(h>>>0).toString(36);}

function _parseC6CSV(text){
  const lines = text.split(/\r?\n/);
  let headerIdx = -1;
  for(let i=0;i<lines.length;i++){
    if(lines[i].replace(/^﻿/,"").startsWith("Data Lan")){headerIdx=i;break;}
  }
  if(headerIdx===-1) throw new Error("Formato inválido — cabeçalho não encontrado.");
  function parseLine(line){
    const r=[];let cur="",inQ=false;
    for(let i=0;i<line.length;i++){
      if(line[i]==='"'){inQ=!inQ;}
      else if(line[i]===','&&!inQ){r.push(cur.trim());cur="";}
      else cur+=line[i];
    }
    r.push(cur.trim());return r;
  }
  function parseBR(s){if(!s)return null;const p=s.split("/");if(p.length!==3)return null;return`${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;}
  function parseN(s){if(!s)return 0;return parseFloat(s)||0;}
  const rows=[];const keyCount={};
  for(let i=headerIdx+1;i<lines.length;i++){
    const line=lines[i].trim();if(!line)continue;
    const c=parseLine(line);if(c.length<5)continue;
    const dataLanc=parseBR(c[0]);if(!dataLanc)continue;
    const dataContabil=parseBR(c[1]);
    const titulo=c[2]||"";const descricao=c[3]||"";
    const entrada=parseN(c[4]);const saida=parseN(c[5]);const saldo=parseN(c[6]);
    const key=`${dataLanc}||${titulo}||${entrada}||${saida}`;
    keyCount[key]=(keyCount[key]||0);
    const idx=keyCount[key]++;
    const id="W_"+_djb2(key+"||"+idx);
    rows.push({id_extrato_c6:id,data_lancamento:dataLanc,data_contabil:dataContabil,titulo,descricao,entrada,saida,saldo_do_dia:saldo,mes_ano:dataLanc.slice(0,7).replace("-","")});
  }
  return rows;
}

async function _dedupExtrato(rows){
  if(!rows.length)return[];
  const existing=new Set();
  const ids=rows.map(r=>r.id_extrato_c6);
  for(let i=0;i<ids.length;i+=200){
    const batch=ids.slice(i,i+200);
    const res=await sbFetch(`extrato_bancario?select=id_extrato_c6&id_extrato_c6=in.(${batch.join(",")})`);
    if(Array.isArray(res))res.forEach(r=>existing.add(r.id_extrato_c6));
  }
  return rows.filter(r=>!existing.has(r.id_extrato_c6));
}

async function _matchEntradas(entradas){
  const receber=await dbGetAll("contas_a_receber","select=id,cod_evento,parcela,num_parcela,valor,vencimento,status&status=eq.NP");
  const agMap=await getAgendaMap();
  return entradas.map(row=>{
    const d=new Date(row.data_lancamento);
    const cands=receber.filter(r=>{
      if(!r.vencimento||!r.valor)return false;
      const diff=Math.abs(new Date(r.vencimento)-d)/86400000;
      return diff<=45 && Math.abs(r.valor-row.entrada)<0.02;
    });
    cands.sort((a,b)=>Math.abs(new Date(a.vencimento)-d)-Math.abs(new Date(b.vencimento)-d));
    const match=cands[0]||null;
    return{...row,_match:match,_matchId:match?match.id:null,
      _matchLabel:match?`${agMap[match.cod_evento]||match.cod_evento||"?"} — Parc. ${match.parcela||"?"}/${match.num_parcela||"?"} (${fmt(match.valor)})`:null,
      _allCands:cands};
  });
}

function _normalize(s){return(s||"").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g,"").replace(/[^a-z0-9 ]/g," ").replace(/\s+/g," ").trim();}

function _suggestFornecedor(titulo,list){
  const t=_normalize(titulo);
  let best=null,bestScore=0;
  for(const f of list){
    const n=_normalize(f.nome);
    const words=n.split(" ").filter(w=>w.length>2);
    if(!words.length)continue;
    const hits=words.filter(w=>t.includes(w)).length;
    const score=hits/words.length;
    if(score>bestScore&&score>=0.5){best=f;bestScore=score;}
  }
  return best;
}

function openImport(){
  _impRows=[];_impEntradas=[];_impSaidas=[];_impStep=0;
  _renderImportStep0();
  document.getElementById("m-import").classList.add("open");
}
function closeImport(){document.getElementById("m-import").classList.remove("open");}

function _setImportStepsBar(active){
  const steps=["1. Upload","2. Entradas","3. Saídas","4. Confirmar"];
  document.getElementById("import-steps-bar").innerHTML=steps.map((s,i)=>`<span class="imp-step ${i<active?"done":i===active?"active":""}">${i<active?"✓ ":""} ${s}</span>`).join('<span style="color:var(--br);padding:0 2px;">›</span>');
}

function _renderImportStep0(){
  _impStep=0;
  _setImportStepsBar(0);
  document.getElementById("import-title").textContent="Importar Extrato C6";
  document.getElementById("import-body").innerHTML=`
    <p style="color:var(--dm);font-size:13px;margin-bottom:16px;">Exporte o extrato no app C6 → Conta → Extrato → Exportar. Arraste o arquivo <strong>.zip</strong> ou <strong>.csv</strong> aqui.</p>
    <label class="imp-drop" id="imp-drop-zone">
      <div style="font-size:40px;margin-bottom:8px;">📂</div>
      <div style="font-weight:600;margin-bottom:4px;">Clique ou arraste o arquivo aqui</div>
      <div style="font-size:12px;color:var(--dm);">Aceita .zip (direto do C6) ou .csv</div>
      <input type="file" id="imp-file-input" accept=".csv,.txt,.zip" style="display:none;" onchange="_onImportFile(this)"/>
    </label>
    <div id="imp-err" style="color:var(--er);font-size:13px;margin-top:10px;display:none;"></div>`;
  document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Cancelar</button>`;
  const dz=document.getElementById("imp-drop-zone");
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("drag");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("drag"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("drag");const f=e.dataTransfer.files[0];if(f)_processImportFile(f);});
}

async function _onImportFile(inp){if(inp.files[0])await _processImportFile(inp.files[0]);}

async function _extractZipCSV(file){
  try{
    const {ZipReader, BlobReader, TextWriter} = zip;
    const reader = new ZipReader(new BlobReader(file), {password: C6_ZIP_PASS});
    const entries = await reader.getEntries();
    const csvEntry = entries.find(e=>e.filename.toLowerCase().endsWith(".csv"));
    if(!csvEntry) throw new Error("Nenhum arquivo .csv encontrado dentro do ZIP.");
    const text = await csvEntry.getData(new TextWriter());
    await reader.close();
    return text;
  }catch(e){
    if(e.message && e.message.includes(".csv")) throw e;
    throw new Error("Não foi possível abrir o ZIP: " + e.message);
  }
}

async function _processImportFile(file){
  const errEl=document.getElementById("imp-err");
  errEl.style.display="none";
  document.getElementById("import-body").innerHTML='<div class="empty"><div class="eicon">⏳</div>Processando arquivo...</div>';
  document.getElementById("import-acts").innerHTML="";
  try{
    let text;
    if(file.name.toLowerCase().endsWith(".zip")){
      text=await _extractZipCSV(file);
    }else{
      text=await file.text();
    }
    const allRows=_parseC6CSV(text);
    if(!allRows.length)throw new Error("Nenhum lançamento encontrado no arquivo.");
    const newRows=await _dedupExtrato(allRows);
    _impRows=newRows;
    _impEntradas=newRows.filter(r=>r.entrada>0);
    _impSaidas=newRows.filter(r=>r.saida>0&&r.entrada===0);
    if(!newRows.length){
      document.getElementById("import-body").innerHTML=`<div class="empty"><div class="eicon">✅</div>Todos os ${allRows.length} lançamentos já estão na base.</div>`;
      document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Fechar</button>`;
      return;
    }
    toast(`${newRows.length} novos lançamentos encontrados`);
    await _renderImportStep1();
  }catch(e){
    document.getElementById("import-body").innerHTML=`<div class="empty"><div class="eicon">⚠️</div>${e.message}</div>`;
    document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Fechar</button><button class="btn-confirm" onclick="_renderImportStep0()">Tentar novamente</button>`;
  }
}

async function _renderImportStep1(){
  _impStep=1;
  _setImportStepsBar(1);
  document.getElementById("import-title").textContent=`Conciliar Entradas (${_impEntradas.length})`;
  document.getElementById("import-body").innerHTML='<div class="empty"><div class="eicon">⏳</div>Buscando sugestões...</div>';
  document.getElementById("import-acts").innerHTML="";
  const withMatch=await _matchEntradas(_impEntradas);
  _impEntradas=withMatch;
  // Load all NP receber for the dropdowns
  const receber=await dbGetAll("contas_a_receber","select=id,cod_evento,parcela,num_parcela,valor,vencimento,status&status=eq.NP");
  const agMap=await getAgendaMap();
  const recOpts=receber.map(r=>`<option value="${r.id}">${(agMap[r.cod_evento]||r.cod_evento||"?")} — Parc.${r.parcela||"?"}/${r.num_parcela||"?"} (${fmt(r.valor)}) ${r.vencimento||""}</option>`).join("");

  if(!_impEntradas.length){
    document.getElementById("import-body").innerHTML='<div class="empty"><div class="eicon">—</div>Nenhuma entrada nova para conciliar.</div>';
    document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Cancelar</button><button class="btn-confirm" onclick="_renderImportStep2()">Avançar → Saídas</button>`;
    return;
  }
  const rows=_impEntradas.map((r,i)=>`<tr id="imp-ent-row-${i}">
    <td style="white-space:nowrap;font-size:12px;">${fmtDate(r.data_lancamento)}</td>
    <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(r.titulo)}">${_esc(r.titulo||r.descricao||"—")}</td>
    <td style="color:#2A6644;font-weight:700;white-space:nowrap;">${fmt(r.entrada)}</td>
    <td>${r._matchLabel?`<span class="imp-badge-match">✓ Sugerido</span>`:`<span class="imp-badge-no">Sem sugestão</span>`}</td>
    <td style="min-width:220px;">
      <select class="imp-sel" id="imp-ent-sel-${i}" onchange="_impEntSelChange(${i})">
        <option value="">— Não conciliar —</option>
        ${r._matchId?`<option value="${r._matchId}" selected>${_esc(r._matchLabel)}</option>`:""}
        ${recOpts}
      </select>
    </td>
  </tr>`).join("");
  document.getElementById("import-body").innerHTML=`
    <p style="font-size:13px;color:var(--dm);margin-bottom:10px;">Confira as sugestões de conciliação. Selecione o título correspondente ou deixe "Não conciliar".</p>
    <div class="table-wrap"><table class="imp-table">
      <thead><tr><th>Data</th><th>Descrição</th><th>Entrada</th><th>Status</th><th>Título a Receber</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Cancelar</button><button class="btn-confirm" onclick="_renderImportStep2()">Avançar → Saídas</button>`;
  // Remove duplicates in selects (match already shown as first option)
  _impEntradas.forEach((_,i)=>{
    const sel=document.getElementById(`imp-ent-sel-${i}`);
    if(!sel)return;
    const vals=new Set();
    Array.from(sel.options).forEach(o=>{if(vals.has(o.value)&&o.value)o.remove();else vals.add(o.value);});
  });
}

function _impEntSelChange(i){
  const sel=document.getElementById(`imp-ent-sel-${i}`);
  if(sel) _impEntradas[i]._selectedRecId=sel.value||null;
}

async function _renderImportStep2(){
  // Capture selections from Step 1
  _impEntradas.forEach((r,i)=>{
    const sel=document.getElementById(`imp-ent-sel-${i}`);
    r._selectedRecId=sel?sel.value||null:r._matchId||null;
  });
  _impStep=2;
  _setImportStepsBar(2);
  document.getElementById("import-title").textContent=`Criar Títulos a Pagar para Saídas (${_impSaidas.length})`;
  document.getElementById("import-body").innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando fornecedores...</div>';
  document.getElementById("import-acts").innerHTML="";

  if(!_impSaidas.length){
    document.getElementById("import-body").innerHTML='<div class="empty"><div class="eicon">—</div>Nenhuma saída nova para classificar.</div>';
    document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Cancelar</button><button class="btn-confirm" onclick="_renderImportStep3()">Avançar → Confirmar</button>`;
    return;
  }

  // Load fornecedores + naturezas
  _allFornecedores=await dbGet("fornecedores","order=nome.asc&limit=500");
  _impFornecList=_allFornecedores||[];
  const natsImp=await dbGet("naturezas","select=cod,descricao&order=cod.asc&limit=500");
  _impNaturezas=natsImp||[];

  // Load history most-recent-first: match by obs (título) → {fornecedor, natureza}
  const pagHistory=await dbGetAll("contas_a_pagar","select=obs,fornecedor_cod,natureza&obs=not.is.null&natureza=not.is.null&fornecedor_cod=not.is.null&order=created_at.desc");
  const histByTitle={};
  _impNatByFornec={};
  pagHistory.forEach(r=>{
    const key=_normalize(r.obs||"");
    if(key&&!histByTitle[key])histByTitle[key]={fornecedor_cod:r.fornecedor_cod,natureza:r.natureza};
    if(r.fornecedor_cod&&!_impNatByFornec[r.fornecedor_cod])_impNatByFornec[r.fornecedor_cod]=r.natureza;
  });

  // Suggest: history match first, text match fallback
  _impSaidas=_impSaidas.map(r=>{
    const key=_normalize(r.titulo||r.descricao||"");
    const hist=key?histByTitle[key]||null:null;
    if(hist){return{...r,_sugSource:"hist",_sugFornecCod:hist.fornecedor_cod,_sugNat:hist.natureza};}
    const sf=_suggestFornecedor(r.titulo,_impFornecList);
    const sugNat=sf?(_impNatByFornec[sf.codigo]||""):"";
    return{...r,_sugSource:sf?"nome":null,_sugFornecCod:sf?sf.codigo:null,_sugNat:sugNat};
  });

  const fornecOpts=`<option value="">— Sem fornecedor —</option>`+_impFornecList.map(f=>`<option value="${_esc(f.codigo)}">${_esc(f.nome)}</option>`).join("");
  const natOpts=`<option value="">— Sem natureza —</option>`+_impNaturezas.map(n=>`<option value="${_esc(n.cod)}">${_esc(n.descricao)}</option>`).join("");

  const rows=_impSaidas.map((r,i)=>{
    const fCod=r._sugFornecCod||"";
    const nat=r._sugNat||"";
    const badge=r._sugSource==="hist"
      ?`<span class="imp-badge-hist">📋 Histórico</span>`
      :r._sugSource==="nome"
      ?`<span class="imp-badge-match">✓ Nome</span>`
      :`<span class="imp-badge-no">Não identificado</span>`;
    return`<tr id="imp-sai-row-${i}" class="">
      <td style="white-space:nowrap;font-size:12px;">${fmtDate(r.data_lancamento)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(r.titulo)}">${_esc(r.titulo||r.descricao||"—")}</td>
      <td style="color:var(--er);font-weight:700;white-space:nowrap;">${fmt(r.saida)}</td>
      <td>${badge}</td>
      <td><select class="imp-sel" id="imp-sai-forn-${i}" onchange="_impSaiFornChange(${i})">${fornecOpts.replace(`value="${_esc(fCod)}"`,`value="${_esc(fCod)}" selected`)}</select></td>
      <td><select class="imp-sel" id="imp-sai-nat-${i}">${natOpts.replace(`value="${_esc(nat)}"`,`value="${_esc(nat)}" selected`)}</select></td>
      <td style="text-align:center;"><input type="checkbox" class="imp-chk" id="imp-sai-chk-${i}" checked title="Criar A Pagar" onchange="_impSaiChkChange(${i})"/></td>
    </tr>`;
  }).join("");

  document.getElementById("import-body").innerHTML=`
    <p style="font-size:13px;color:var(--dm);margin-bottom:10px;">Para cada saída, escolha o fornecedor e a natureza. Desmarque as que não devem gerar título a pagar.</p>
    <div class="table-wrap"><table class="imp-table">
      <thead><tr><th>Data</th><th>Descrição</th><th>Saída</th><th>Sugestão</th><th>Fornecedor</th><th>Natureza</th><th title="Criar A Pagar">✓</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Cancelar</button><button class="btn-confirm" onclick="_renderImportStep3()">Avançar → Confirmar</button>`;
}

function _impSaiFornChange(i){
  const fSel=document.getElementById(`imp-sai-forn-${i}`);
  const nSel=document.getElementById(`imp-sai-nat-${i}`);
  const fCod=fSel?fSel.value||null:null;
  if(fSel)_impSaidas[i]._selFornec=fCod;
  // Auto-fill natureza from history when fornecedor changes and natureza not yet picked
  if(nSel&&fCod&&!nSel.value&&_impNatByFornec[fCod])nSel.value=_impNatByFornec[fCod];
}
function _impSaiChkChange(i){
  const chk=document.getElementById(`imp-sai-chk-${i}`);
  const row=document.getElementById(`imp-sai-row-${i}`);
  if(row)row.classList.toggle("skip-row",!chk.checked);
}

function _renderImportStep3(){
  // Capture step 2 selections
  _impSaidas.forEach((r,i)=>{
    const fSel=document.getElementById(`imp-sai-forn-${i}`);
    const nSel=document.getElementById(`imp-sai-nat-${i}`);
    const chk=document.getElementById(`imp-sai-chk-${i}`);
    r._selFornec=fSel?fSel.value||null:null;
    r._selNat=nSel?nSel.value||null:null;
    r._criar=chk?chk.checked:true;
  });
  _impStep=3;
  _setImportStepsBar(3);
  document.getElementById("import-title").textContent="Confirmar Importação";
  const conciliadas=_impEntradas.filter(r=>r._selectedRecId).length;
  const semConcil=_impEntradas.length-conciliadas;
  const saidasCriar=_impSaidas.filter(r=>r._criar).length;
  const saidasIgn=_impSaidas.length-saidasCriar;
  const total=_impRows.length;
  document.getElementById("import-body").innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;">
      <div class="tot-card"><div class="tot-lbl">Lançamentos novos</div><div class="tot-val">${total}</div></div>
      <div class="tot-card"><div class="tot-lbl">Entradas conciliadas</div><div class="tot-val green">${conciliadas}</div></div>
      <div class="tot-card"><div class="tot-lbl">Entradas sem conciliação</div><div class="tot-val">${semConcil}</div></div>
      <div class="tot-card"><div class="tot-lbl">A Pagar a criar</div><div class="tot-val red">${saidasCriar}</div></div>
      <div class="tot-card"><div class="tot-lbl">Saídas ignoradas</div><div class="tot-val">${saidasIgn}</div></div>
    </div>
    <p style="font-size:13px;color:var(--dm);">Clique em <strong>Importar</strong> para salvar tudo na base de dados. Esta ação não pode ser desfeita.</p>`;
  document.getElementById("import-acts").innerHTML=`<button class="btn-cancel" onclick="closeImport()">Cancelar</button><button class="btn-confirm" id="imp-btn-exec" onclick="_executeImport()">Importar</button>`;
}

async function _executeImport(){
  const btn=document.getElementById("imp-btn-exec");
  if(btn){btn.disabled=true;btn.textContent="Importando...";}
  try{
    // 1. Insert all new extrato rows
    const PAGE=200;
    for(let i=0;i<_impRows.length;i+=PAGE){
      await sbFetch("extrato_bancario",{method:"POST",body:_impRows.slice(i,i+PAGE),prefer:"return=minimal"});
    }

    // 2. Conciliar entradas: PATCH contas_a_receber status=PAGO + vincular no extrato
    const conciliadas=_impEntradas.filter(r=>r._selectedRecId);
    for(const r of conciliadas){
      await sbFetch(`contas_a_receber?id=eq.${r._selectedRecId}`,{method:"PATCH",body:{status:"PAGO",data_recebido:r.data_lancamento},prefer:"return=minimal"});
      await sbFetch(`extrato_bancario?id_extrato_c6=eq.${encodeURIComponent(r.id_extrato_c6)}`,{method:"PATCH",body:{titulo_a_receber:r._selectedRecId},prefer:"return=minimal"});
    }

    // 3. Criar contas_a_pagar para saídas marcadas e vincular no extrato
    const saidasCriar=_impSaidas.filter(r=>r._criar);
    for(const r of saidasCriar){
      const created=await sbFetch("contas_a_pagar",{method:"POST",body:[{
        vencimento_real:r.data_lancamento,
        valor:r.saida,
        status:"Pago",
        fornecedor_cod:r._selFornec||null,
        natureza:r._selNat||null,
        tipo:"Extrato C6",
        obs:r.titulo||r.descricao||null,
      }],prefer:"return=representation"});
      const pagId=Array.isArray(created)?created[0]?.id:created?.id;
      if(pagId){
        await sbFetch(`extrato_bancario?id_extrato_c6=eq.${encodeURIComponent(r.id_extrato_c6)}`,{method:"PATCH",body:{titulo_a_pagar:String(pagId)},prefer:"return=minimal"});
      }
    }

    closeImport();
    toast(`✅ ${_impRows.length} lançamentos importados, ${conciliadas.length} conciliados, ${saidasCriar.length} títulos a pagar criados`);
    renderExtrato();
  }catch(e){
    if(btn){btn.disabled=false;btn.textContent="Importar";}
    alert("Erro na importação: "+e.message);
  }
}

// ══════════════════════════════════════════
// IMPORTAR FATURA CARTÃO C6
// ══════════════════════════════════════════
let _iccRows = [], _iccStep = 0, _iccMesFatura = "";

function _iccStepsBar(active) {
  const steps = ["1. Upload","2. Classificar","3. Confirmar"];
  document.getElementById("icc-steps-bar").innerHTML = steps.map((s,i) =>
    `<span class="imp-step ${i<active?"done":i===active?"active":""}">${i<active?"✓ ":""} ${s}</span>`
  ).join('<span style="color:var(--br);padding:0 2px;">›</span>');
}

function _parseCartaoC6CSV(text) {
  const lines = text.split(/\r?\n/);
  // Encontra cabeçalho (linha com "Nome no Cart")
  let headerIdx = -1;
  for(let i=0;i<lines.length;i++){
    if(lines[i].includes("Nome no Cart")){headerIdx=i;break;}
  }
  if(headerIdx===-1) throw new Error("Formato inválido — cabeçalho 'Nome no Cartão' não encontrado.");
  function parseBR(s){if(!s)return null;const p=s.split("/");if(p.length!==3)return null;return`${p[2]}-${p[1].padStart(2,"0")}-${p[0].padStart(2,"0")}`;}
  function parseN(s){return parseFloat((s||"0").replace(",","."))||0;}
  const rows=[];const keyCount={};
  for(let i=headerIdx+1;i<lines.length;i++){
    const line=lines[i].trim(); if(!line) continue;
    const c=line.split(";"); if(c.length<9) continue;
    const data=parseBR(c[0]); if(!data) continue;
    const nomeCartao=c[1]||""; const finalCartao=c[2]||"";
    const categoria=c[3]||""; const descricao=c[4]||""; const parcela=c[5]||"";
    const valorUsd=parseN(c[6]); const cotacao=parseN(c[7]); const valorBrl=parseN(c[8]);
    if(valorBrl<=0) continue; // skip pagamentos (valores negativos) e zeros
    const key=`${data}||${finalCartao}||${descricao}||${valorBrl}||${parcela}`;
    keyCount[key]=(keyCount[key]||0);
    const idx=keyCount[key]++;
    const id="CC_"+_djb2(key+"||"+idx);
    rows.push({id_item_cartao:id,mes_fatura:_iccMesFatura,data_transacao:data,nome_cartao:nomeCartao,final_cartao:finalCartao,categoria,descricao,parcela,valor_usd:valorUsd,cotacao,valor_brl:valorBrl});
  }
  return rows;
}

async function _dedupCartao(rows){
  if(!rows.length) return [];
  const existing=new Set();
  const ids=rows.map(r=>r.id_item_cartao);
  for(let i=0;i<ids.length;i+=200){
    const batch=ids.slice(i,i+200);
    const res=await sbFetch(`cartao_c6?select=id_item_cartao&id_item_cartao=in.(${batch.join(",")})`);
    if(Array.isArray(res)) res.forEach(r=>existing.add(r.id_item_cartao));
  }
  return rows.filter(r=>!existing.has(r.id_item_cartao));
}

function openImportCartao(){
  _iccRows=[];_iccStep=0;_iccMesFatura="";
  _iccRenderStep0();
  document.getElementById("m-import-cartao").classList.add("open");
}
function closeImportCartao(){document.getElementById("m-import-cartao").classList.remove("open");}

function _iccRenderStep0(){
  _iccStep=0; _iccStepsBar(0);
  document.getElementById("icc-title").textContent="💳 Importar Fatura Cartão C6";
  const hoje=new Date();
  const mesPadrao=hoje.getFullYear()+"-"+String(hoje.getMonth()+1).padStart(2,"0");
  document.getElementById("icc-body").innerHTML=`
    <div style="display:flex;gap:12px;margin-bottom:16px;flex-wrap:wrap;align-items:flex-end;">
      <div style="flex:1;min-width:200px;">
        <label class="lbl">Mês de vencimento da fatura</label>
        <input type="month" class="inp" id="icc-mes" value="${mesPadrao}" style="margin-bottom:0;"/>
        <div style="font-size:11px;color:var(--dl);margin-top:4px;">Ex: fatura que vence em Fevereiro → selecione 2026-02</div>
      </div>
    </div>
    <p style="color:var(--dm);font-size:13px;margin-bottom:16px;">Exporte a fatura no app C6 → Cartão → Fatura → Exportar CSV. Arraste ou selecione o arquivo <strong>.csv</strong>.</p>
    <label class="imp-drop" id="icc-drop-zone">
      <div style="font-size:40px;margin-bottom:8px;">💳</div>
      <div style="font-weight:600;margin-bottom:4px;">Clique ou arraste o CSV da fatura aqui</div>
      <input type="file" id="icc-file-input" accept=".csv,.txt" style="display:none;" onchange="_iccOnFile(this)"/>
    </label>
    <div id="icc-err" style="color:var(--er);font-size:13px;margin-top:10px;display:none;"></div>`;
  document.getElementById("icc-acts").innerHTML=`<button class="btn-cancel" onclick="closeImportCartao()">Cancelar</button>`;
  const dz=document.getElementById("icc-drop-zone");
  dz.addEventListener("dragover",e=>{e.preventDefault();dz.classList.add("drag");});
  dz.addEventListener("dragleave",()=>dz.classList.remove("drag"));
  dz.addEventListener("drop",e=>{e.preventDefault();dz.classList.remove("drag");const f=e.dataTransfer.files[0];if(f)_iccProcessFile(f);});
}

async function _iccOnFile(inp){if(inp.files[0]) await _iccProcessFile(inp.files[0]);}

async function _iccProcessFile(file){
  const mesEl=document.getElementById("icc-mes");
  _iccMesFatura=mesEl?mesEl.value:"";
  if(!_iccMesFatura){alert("Selecione o mês de vencimento da fatura antes de continuar.");return;}
  document.getElementById("icc-body").innerHTML='<div class="empty"><div class="eicon">⏳</div>Processando arquivo...</div>';
  document.getElementById("icc-acts").innerHTML="";
  try{
    const text=await file.text();
    const allRows=_parseCartaoC6CSV(text);
    if(!allRows.length) throw new Error("Nenhuma despesa encontrada no arquivo (valores negativos/zero são ignorados).");
    const newRows=await _dedupCartao(allRows);
    _iccRows=newRows;
    if(!newRows.length){
      document.getElementById("icc-body").innerHTML=`<div class="empty"><div class="eicon">✅</div>Todos os ${allRows.length} itens já estão na base.</div>`;
      document.getElementById("icc-acts").innerHTML=`<button class="btn-cancel" onclick="closeImportCartao()">Fechar</button>`;
      return;
    }
    toast(`${newRows.length} itens novos encontrados`);
    await _iccRenderStep1();
  }catch(e){
    document.getElementById("icc-body").innerHTML=`<div class="empty"><div class="eicon">⚠️</div>${_esc(e.message)}</div>`;
    document.getElementById("icc-acts").innerHTML=`<button class="btn-cancel" onclick="closeImportCartao()">Cancelar</button><button class="btn-confirm" onclick="_iccRenderStep0()">Tentar novamente</button>`;
  }
}

async function _iccRenderStep1(){
  _iccStep=1; _iccStepsBar(1);
  document.getElementById("icc-title").textContent=`💳 Classificar Despesas (${_iccRows.length})`;
  document.getElementById("icc-body").innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando fornecedores...</div>';
  document.getElementById("icc-acts").innerHTML="";

  if(!_allFornecedores) _allFornecedores=await dbGet("fornecedores","order=nome.asc&limit=500");
  if(!_impNaturezas||!_impNaturezas.length) _impNaturezas=await dbGet("naturezas","select=cod,descricao&order=cod.asc&limit=500");

  const pagHistory=await dbGetAll("contas_a_pagar","select=fornecedor_cod,natureza&natureza=not.is.null&fornecedor_cod=not.is.null");
  const natByFornec={};
  pagHistory.forEach(r=>{
    if(!natByFornec[r.fornecedor_cod])natByFornec[r.fornecedor_cod]={};
    natByFornec[r.fornecedor_cod][r.natureza]=(natByFornec[r.fornecedor_cod][r.natureza]||0)+1;
  });
  function bestNat(fCod){if(!fCod||!natByFornec[fCod])return"";return Object.entries(natByFornec[fCod]).sort((a,b)=>b[1]-a[1])[0]?.[0]||"";}

  _iccRows=_iccRows.map(r=>({...r,_sugFornec:_suggestFornecedor(r.descricao,_allFornecedores)}));

  const fornecOpts=`<option value="">— Sem fornecedor —</option>`+(_allFornecedores||[]).map(f=>`<option value="${_esc(f.codigo)}">${_esc(f.nome)}</option>`).join("");
  const natOpts=`<option value="">— Sem natureza —</option>`+(_impNaturezas||[]).map(n=>`<option value="${_esc(n.cod)}">${_esc(n.descricao)}</option>`).join("");

  const rows=_iccRows.map((r,i)=>{
    const sf=r._sugFornec;
    const sugNat=sf?bestNat(sf.codigo):"";
    const fornecSel=fornecOpts.replace(`value="${_esc(sf?sf.codigo:"")}"`,`value="${_esc(sf?sf.codigo:"")}" selected`);
    const natSel=natOpts.replace(`value="${_esc(sugNat)}"`,`value="${_esc(sugNat)}" selected`);
    return`<tr>
      <td style="white-space:nowrap;font-size:12px;">${fmtDate(r.data_transacao)}</td>
      <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(r.descricao)}">${_esc(r.descricao)}</td>
      <td style="font-size:11px;color:var(--dl);">${_esc(r.final_cartao)}</td>
      <td style="font-size:11px;color:var(--dl);">${_esc(r.parcela)}</td>
      <td style="color:var(--er);font-weight:700;white-space:nowrap;">${fmt(r.valor_brl)}</td>
      <td>${sf?`<span class="imp-badge-match">✓ ${_esc(sf.nome)}</span>`:`<span class="imp-badge-no">—</span>`}</td>
      <td style="min-width:180px;"><select class="imp-sel" id="icc-forn-${i}" onchange="_iccSelChange(${i})">${fornecSel}</select></td>
      <td style="min-width:160px;"><select class="imp-sel" id="icc-nat-${i}">${natSel}</select></td>
      <td style="text-align:center;"><input type="checkbox" id="icc-chk-${i}" checked title="Criar A Pagar"/></td>
    </tr>`;
  }).join("");

  document.getElementById("icc-body").innerHTML=`
    <p style="font-size:13px;color:var(--dm);margin-bottom:10px;">Classifique cada despesa. Desmarque as que não devem gerar título a pagar.</p>
    <div class="table-wrap"><table class="imp-table">
      <thead><tr><th>Data</th><th>Descrição</th><th>Cartão</th><th>Parcela</th><th>Valor</th><th>Sugestão</th><th>Fornecedor</th><th>Natureza</th><th title="Criar A Pagar">✓</th></tr></thead>
      <tbody>${rows}</tbody>
    </table></div>`;
  document.getElementById("icc-acts").innerHTML=`<button class="btn-cancel" onclick="closeImportCartao()">Cancelar</button><button class="btn-confirm" onclick="_iccRenderStep2()">Avançar → Confirmar</button>`;
}

function _iccSelChange(i){
  const sel=document.getElementById(`icc-forn-${i}`);
  if(sel)_iccRows[i]._selFornec=sel.value||null;
}

function _iccRenderStep2(){
  // Captura seleções
  _iccRows.forEach((r,i)=>{
    r._selFornec=(document.getElementById(`icc-forn-${i}`)?.value)||null;
    r._selNat=(document.getElementById(`icc-nat-${i}`)?.value)||null;
    r._criar=(document.getElementById(`icc-chk-${i}`)?.checked)!==false;
  });
  _iccStep=2; _iccStepsBar(2);
  const totalBrl=_iccRows.reduce((a,r)=>a+r.valor_brl,0);
  const criar=_iccRows.filter(r=>r._criar).length;
  const ign=_iccRows.length-criar;
  const [fy,fm]=_iccMesFatura.split("-");
  const MESES=["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
  const mesFmt=MESES[parseInt(fm)-1]+" "+fy;
  document.getElementById("icc-body").innerHTML=`
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px;">
      <div class="tot-card"><div class="tot-lbl">Itens novos</div><div class="tot-val">${_iccRows.length}</div></div>
      <div class="tot-card"><div class="tot-lbl">Total da fatura</div><div class="tot-val red">${fmt(totalBrl)}</div></div>
      <div class="tot-card"><div class="tot-lbl">A Pagar a criar</div><div class="tot-val red">${criar}</div></div>
      <div class="tot-card"><div class="tot-lbl">Ignorados</div><div class="tot-val">${ign}</div></div>
    </div>
    <p style="font-size:13px;color:var(--dm);">Fatura de vencimento: <strong>${mesFmt}</strong>. Clique em <strong>Importar</strong> para salvar. Esta ação não pode ser desfeita.</p>`;
  document.getElementById("icc-acts").innerHTML=`<button class="btn-cancel" onclick="closeImportCartao()">Cancelar</button><button class="btn-confirm" id="icc-btn-exec" onclick="_iccExecute()">Importar</button>`;
}

async function _iccExecute(){
  const btn=document.getElementById("icc-btn-exec");
  if(btn){btn.disabled=true;btn.textContent="Importando...";}
  try{
    // 1. Inserir itens na cartao_c6
    const criar=_iccRows.filter(r=>r._criar);
    const PAGE=200;
    for(let i=0;i<_iccRows.length;i+=PAGE){
      await sbFetch("cartao_c6",{method:"POST",body:_iccRows.slice(i,i+PAGE),prefer:"return=minimal"});
    }

    // 2. Criar contas_a_pagar para itens marcados
    for(const r of criar){
      const created=await sbFetch("contas_a_pagar",{method:"POST",body:[{
        vencimento_real:r.data_transacao,
        valor:r.valor_brl,
        status:"Pago",
        fornecedor_cod:r._selFornec||null,
        natureza:r._selNat||null,
        tipo:"Cartão C6",
        obs:`${r.descricao||""}${r.parcela&&r.parcela!=="Única"?" (parc. "+r.parcela+")":""}`,
      }],prefer:"return=representation"});
      const pagId=Array.isArray(created)?created[0]?.id:created?.id;
      if(pagId){
        await sbFetch(`cartao_c6?id_item_cartao=eq.${encodeURIComponent(r.id_item_cartao)}`,{method:"PATCH",body:{titulo_a_pagar:pagId},prefer:"return=minimal"});
      }
    }

    closeImportCartao();
    toast(`✅ ${_iccRows.length} itens importados, ${criar.length} títulos a pagar criados`);

    // 3. Busca saída correspondente no extrato para popup
    const totalBrl=_iccRows.reduce((a,r)=>a+r.valor_brl,0);
    _iccBuscarSaidaExtrato(totalBrl, _iccMesFatura);

  }catch(e){
    if(btn){btn.disabled=false;btn.textContent="Importar";}
    alert("Erro na importação: "+e.message);
  }
}

async function _iccBuscarSaidaExtrato(totalFatura, mesFatura){
  try{
    const tol=totalFatura*0.02; // tolerância de 2%
    const min=(totalFatura-tol).toFixed(2);
    const max=(totalFatura+tol).toFixed(2);
    // Busca no mês da fatura e no mês anterior (pagamento pode cair em qualquer um)
    const [fy,fm]=mesFatura.split("-").map(Number);
    const mesAnt=fm===1?(fy-1)+"-12":(fy)+"-"+String(fm-1).padStart(2,"0");
    const rows=await sbFetch(`extrato_bancario?saida=gte.${min}&saida=lte.${max}&data_lancamento=gte.${mesAnt}-01&data_lancamento=lte.${mesFatura}-31&order=data_lancamento.desc&limit=10`);
    if(!Array.isArray(rows)||!rows.length) return;
    // Exibe popup para cada candidato encontrado
    _iccPopupSaida(rows, totalFatura);
  }catch(_){}
}

function _iccPopupSaida(candidatos, totalFatura){
  const el=document.createElement("div");
  el.id="popup-icc-saida";
  el.style.cssText="position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;";
  const lista=candidatos.map((r,i)=>`
    <label style="display:flex;align-items:center;gap:10px;padding:10px 12px;border:1.5px solid #e2e8f0;border-radius:8px;margin-bottom:6px;cursor:pointer;background:#fff;">
      <input type="checkbox" id="icc-pop-chk-${i}" data-id="${_esc(r.id_extrato_c6)}" style="accent-color:#dc2626;width:16px;height:16px;" checked>
      <span style="font-size:13px;color:var(--dk);">${fmtDate(r.data_lancamento)} — <strong>${_esc(r.titulo||r.descricao||"—")}</strong> — <span style="color:var(--er);font-weight:700;">${fmt(r.saida)}</span></span>
    </label>`).join("");
  el.innerHTML=`<div style="background:#fff;border-radius:16px;padding:28px;max-width:520px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.25);">
    <div style="font-size:17px;font-weight:800;color:var(--dk);margin-bottom:8px;">🔍 Possível pagamento da fatura no extrato</div>
    <p style="font-size:13px;color:var(--dm);margin-bottom:16px;">Encontrei ${candidatos.length===1?"uma saída que parece ser o pagamento":"saídas que podem ser o pagamento"} desta fatura (total ${fmt(totalFatura)}). Marque as que deseja apagar do extrato para evitar duplicidade:</p>
    ${lista}
    <div style="display:flex;gap:8px;margin-top:18px;">
      <button onclick="_iccConfirmDelSaida()" style="flex:1;padding:11px;background:#dc2626;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:14px;cursor:pointer;">🗑 Apagar selecionadas</button>
      <button onclick="document.getElementById('popup-icc-saida').remove()" style="padding:11px 18px;background:transparent;color:var(--dm);border:1.5px solid var(--br);border-radius:10px;font-weight:600;font-size:13px;cursor:pointer;">Manter no extrato</button>
    </div>
  </div>`;
  document.body.appendChild(el);
}

async function _iccConfirmDelSaida(){
  const chks=document.querySelectorAll("#popup-icc-saida input[type=checkbox]:checked");
  const ids=Array.from(chks).map(c=>c.dataset.id).filter(Boolean);
  document.getElementById("popup-icc-saida").remove();
  if(!ids.length) return;
  for(let i=0;i<ids.length;i+=50){
    const batch=ids.slice(i,i+50);
    await sbFetch(`extrato_bancario?id_extrato_c6=in.(${batch.map(x=>encodeURIComponent(x)).join(",")})`,{method:"DELETE"});
  }
  toast(`${ids.length} lançamento${ids.length!==1?"s":""} removido${ids.length!==1?"s":""} do extrato`);
  renderExtrato();
}

// ── Bulk delete: A Receber ──
function _recChkChange(){
  const chks=document.querySelectorAll(".rec-chk");
  const sel=Array.from(chks).filter(c=>c.checked);
  const bar=document.getElementById("rec-bulk-bar");
  const all=document.getElementById("rec-chk-all");
  if(bar){bar.style.display=sel.length?"flex":"none";}
  const ct=document.getElementById("rec-bulk-count");
  if(ct)ct.textContent=`${sel.length} selecionado${sel.length!==1?"s":""}`;
  if(all)all.indeterminate=sel.length>0&&sel.length<chks.length, all.checked=sel.length===chks.length;
}
function _recToggleAll(chkAll){
  document.querySelectorAll(".rec-chk").forEach(c=>c.checked=chkAll.checked);
  _recChkChange();
}
function _recClearSel(){
  document.querySelectorAll(".rec-chk").forEach(c=>c.checked=false);
  const all=document.getElementById("rec-chk-all"); if(all){all.checked=false;all.indeterminate=false;}
  _recChkChange();
}
async function bulkDeleteReceber(){
  const ids=Array.from(document.querySelectorAll(".rec-chk:checked")).map(c=>c.dataset.id);
  if(!ids.length)return;
  if(!confirm(`Apagar ${ids.length} título${ids.length!==1?"s":""}?\n\nEsta ação não pode ser desfeita.`))return;
  const now=new Date().toISOString();
  for(let i=0;i<ids.length;i+=50){
    const batch=ids.slice(i,i+50);
    await sbFetch(`contas_a_receber?id=in.(${batch.join(",")})`,{method:"PATCH",body:{deleted_at:now},prefer:"return=minimal"});
  }
  toast(`${ids.length} título${ids.length!==1?"s":""} apagado${ids.length!==1?"s":""}`);
  renderReceber();
}

// ══════════════════════════════════════════
// LEMBRETES WHATSAPP (Meta Cloud API)
// ══════════════════════════════════════════
let _wppParcelas = [];
let _wppModo = "vencendo";

function setWppModo(modo) {
  _wppModo = modo;
  const btnV = document.getElementById("wpp-modo-vencendo");
  const btnA = document.getElementById("wpp-modo-atrasados");
  const periodoBox = document.getElementById("wpp-periodo-box");
  if (modo === "atrasados") {
    btnA.style.background = "#A03030"; btnA.style.color = "#fff"; btnA.style.borderColor = "#A03030";
    btnV.style.background = "var(--bg)"; btnV.style.color = "var(--dk)"; btnV.style.borderColor = "var(--pr)";
    periodoBox.style.display = "none";
  } else {
    btnV.style.background = "var(--pr)"; btnV.style.color = "#fff"; btnV.style.borderColor = "var(--pr)";
    btnA.style.background = "var(--bg)"; btnA.style.color = "var(--dk)"; btnA.style.borderColor = "var(--am)";
    periodoBox.style.display = "grid";
  }
  document.getElementById("wpp-preview").style.display = "none";
  document.getElementById("wpp-result").style.display = "none";
  document.getElementById("wpp-btn-send").style.display = "none";
  _wppParcelas = [];
}

let _recWppCtx=null;
async function _recEnviarLembrete(btn){
  const id=btn.dataset.id, cod=btn.dataset.cod;
  const fichas=await sbFetch("ficha_do_evento?cod=eq."+encodeURIComponent(cod)+"&select=celular,nome_contratante&limit=1").catch(()=>[]);
  const f=fichas&&fichas[0];
  if(f&&f.celular){
    if(!confirm("Enviar lembrete WhatsApp para "+(f.nome_contratante||cod)+" ("+f.celular+")?"))return;
    await _recWppEnviar(id,null);
  }else{
    _recWppCtx={id,cod};
    document.getElementById("m-rec-wpp-nome").textContent=f?.nome_contratante||cod||"Este contratante";
    document.getElementById("m-rec-wpp-input").value="";
    document.getElementById("m-rec-wpp-tel").classList.add("open");
  }
}
async function _recWppSalvarEnviar(){
  const tel=document.getElementById("m-rec-wpp-input").value.trim();
  if(!tel){toast("Informe o WhatsApp.");return;}
  const {id,cod}=_recWppCtx||{};
  if(!id)return;
  document.getElementById("m-rec-wpp-tel").classList.remove("open");
  await _recWppEnviar(id,tel);
}
async function _recWppEnviar(parcelaId,celularOverride){
  const payload={parcela_id:parcelaId};
  if(celularOverride)payload.celular_override=celularOverride;
  const mo=document.getElementById("m-rec-wpp-res");
  const moBody=document.getElementById("m-rec-wpp-res-body");
  try{
    const res=await fetch(SB_URL+"/functions/v1/enviar-lembretes-wpp",{
      method:"POST",
      headers:{"apikey":SB_KEY,"Authorization":"Bearer "+_authToken,"Content-Type":"application/json"},
      body:JSON.stringify(payload),
    });
    const resp=await res.json();
    if(resp.enviados>0){
      moBody.innerHTML='<div style="color:#166534;font-size:28px;text-align:center;margin-bottom:8px;">✅</div><div style="font-weight:700;color:#166534;text-align:center;">Lembrete enviado!</div>';
    }else{
      const msg=resp.erro||resp.msg||"Erro ao enviar.";
      moBody.innerHTML='<div style="color:#b91c1c;font-size:22px;text-align:center;margin-bottom:8px;">⚠️</div><div style="font-weight:700;color:#b91c1c;margin-bottom:8px;text-align:center;">Não foi possível enviar</div><div style="font-size:12px;color:var(--dk);background:var(--al);border:1px solid var(--am);border-radius:8px;padding:10px;word-break:break-word;">'+_esc(msg)+'</div>';
    }
    mo.classList.add("open");
  }catch(e){
    moBody.innerHTML='<div style="color:#b91c1c;font-size:22px;text-align:center;margin-bottom:8px;">⚠️</div><div style="font-weight:700;color:#b91c1c;text-align:center;">Erro de conexão</div><div style="font-size:12px;color:var(--dk);margin-top:8px;">'+_esc(e.message)+'</div>';
    mo.classList.add("open");
  }
}

function openWppLembretes() {
  const hoje = new Date().toISOString().slice(0, 10);
  const ate = new Date(); ate.setDate(ate.getDate() + 7);
  const ateStr = ate.toISOString().slice(0, 10);
  document.getElementById("wpp-de").value = hoje;
  document.getElementById("wpp-ate").value = ateStr;
  document.getElementById("wpp-preview").style.display = "none";
  document.getElementById("wpp-result").style.display = "none";
  document.getElementById("wpp-btn-send").style.display = "none";
  document.getElementById("wpp-btn-preview").style.display = "";
  _wppParcelas = [];
  setWppModo("vencendo");
  document.getElementById("m-wpp-lembretes").classList.add("open");
}

function closeWppLembretes() {
  document.getElementById("m-wpp-lembretes").classList.remove("open");
}

async function previewWppLembretes() {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const de = _wppModo === "atrasados" ? "2000-01-01" : document.getElementById("wpp-de").value;
  const ate = _wppModo === "atrasados" ? ontem.toISOString().slice(0, 10) : document.getElementById("wpp-ate").value;
  if (!de || !ate) { toast("Preencha as datas."); return; }
  const prevDiv = document.getElementById("wpp-preview");
  prevDiv.innerHTML = "Buscando parcelas...";
  prevDiv.style.display = "";
  document.getElementById("wpp-btn-send").style.display = "none";
  try {
    const parcelas = await dbGet("contas_a_receber",
      `status=eq.NP&vencimento=gte.${de}&vencimento=lte.${ate}&select=id,cod_evento,parcela,num_parcela,valor,vencimento&order=vencimento.asc&limit=500`
    );
    if (!parcelas.length) {
      prevDiv.innerHTML = "<b>Nenhuma parcela pendente no período.</b>";
      return;
    }
    const agMap = await getAgendaMap();
    const codEvts = [...new Set(parcelas.map(p => p.cod_evento).filter(Boolean))];
    const fichas = codEvts.length
      ? await dbGet("ficha_do_evento", `cod=in.(${codEvts.join(",")})&select=cod,nome_contratante,celular&limit=500`)
      : [];
    const fichaMap = {};
    fichas.forEach(f => fichaMap[f.cod] = f);
    _wppParcelas = parcelas;
    const semTel = parcelas.filter(p => !fichaMap[p.cod_evento]?.celular).length;
    const comTel = parcelas.length - semTel;
    let html = `<b>${parcelas.length} parcela${parcelas.length !== 1 ? "s" : ""} encontrada${parcelas.length !== 1 ? "s" : ""}`;
    html += ` — ${comTel} com telefone, ${semTel} sem telefone</b><br><br>`;
    html += parcelas.map(p => {
      const ficha = fichaMap[p.cod_evento];
      const nome = ficha?.nome_contratante || "—";
      const tel = ficha?.celular || "<span style='color:#A03030'>SEM TEL</span>";
      const ev = agMap[p.cod_evento] || p.cod_evento || "?";
      return `• <b>${p.vencimento ? p.vencimento.split("-").reverse().join("/") : "—"}</b> — ${ev} — Parc. ${p.parcela || "?"}/${p.num_parcela || "?"} — R$ ${Number(p.valor || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2 })} — ${nome} ${tel}`;
    }).join("<br>");
    prevDiv.innerHTML = html;
    if (comTel > 0) document.getElementById("wpp-btn-send").style.display = "";
  } catch (e) {
    prevDiv.innerHTML = `<span style="color:#A03030">Erro: ${e.message}</span>`;
  }
}

async function sendWppLembretes() {
  const ontem = new Date(); ontem.setDate(ontem.getDate() - 1);
  const de = _wppModo === "atrasados" ? "2000-01-01" : document.getElementById("wpp-de").value;
  const ate = _wppModo === "atrasados" ? ontem.toISOString().slice(0, 10) : document.getElementById("wpp-ate").value;
  const btn = document.getElementById("wpp-btn-send");
  const resDiv = document.getElementById("wpp-result");
  btn.disabled = true; btn.textContent = "Enviando...";
  resDiv.style.display = "none";
  try {
    const res = await fetch(SB_URL + "/functions/v1/enviar-lembretes-wpp", {
      method: "POST",
      headers: { "apikey": SB_KEY, "Authorization": "Bearer " + _authToken, "Content-Type": "application/json" },
      body: JSON.stringify({ vencimento_de: de, vencimento_ate: ate, ...((_wppModo === "atrasados") ? { modo: "atrasados" } : {}) }),
    });
    const resp = await res.json();
    let html = "";
    if (resp.enviados > 0) html += `<div style="color:#1A6644;font-weight:700;">✅ ${resp.enviados} mensagem${resp.enviados !== 1 ? "ns" : ""} enviada${resp.enviados !== 1 ? "s" : ""}!</div>`;
    if (resp.erros && resp.erros.length) {
      html += `<div style="color:#A03030;margin-top:6px;font-weight:600;">⚠️ ${resp.erros.length} erro${resp.erros.length !== 1 ? "s" : ""}:</div>`;
      html += resp.erros.map(e => `<div style="font-size:11px;color:#A03030;">• ${e.cod_evento} parc.${e.parcela}: ${e.erro}</div>`).join("");
    }
    if (!resp.enviados && (!resp.erros || !resp.erros.length)) html = `<div style="color:var(--dm);">${resp.msg || "Nenhuma mensagem enviada."}</div>`;
    resDiv.innerHTML = html;
    resDiv.style.display = "";
  } catch (e) {
    resDiv.innerHTML = `<div style="color:#A03030;">Erro: ${e.message}</div>`;
    resDiv.style.display = "";
  } finally {
    btn.disabled = false; btn.textContent = "📤 Enviar";
  }
}

// ── Bulk delete: Extrato C6 ──
function _extChkChange(){
  const chks=document.querySelectorAll(".ext-chk");
  const sel=Array.from(chks).filter(c=>c.checked);
  const bar=document.getElementById("ext-bulk-bar");
  const all=document.getElementById("ext-chk-all");
  if(bar){bar.style.display=sel.length?"flex":"none";}
  const ct=document.getElementById("ext-bulk-count");
  if(ct)ct.textContent=`${sel.length} selecionado${sel.length!==1?"s":""}`;
  if(all)all.indeterminate=sel.length>0&&sel.length<chks.length, all.checked=sel.length===chks.length;
}
function _extToggleAll(chkAll){
  document.querySelectorAll(".ext-chk").forEach(c=>c.checked=chkAll.checked);
  _extChkChange();
}
function _extClearSel(){
  document.querySelectorAll(".ext-chk").forEach(c=>c.checked=false);
  const all=document.getElementById("ext-chk-all"); if(all){all.checked=false;all.indeterminate=false;}
  _extChkChange();
}
async function bulkDeleteExtrato(){
  const ids=Array.from(document.querySelectorAll(".ext-chk:checked")).map(c=>c.dataset.id);
  if(!ids.length)return;
  if(!confirm(`Apagar ${ids.length} lançamento${ids.length!==1?"s":""}?\n\nEsta ação não pode ser desfeita.`))return;
  for(let i=0;i<ids.length;i+=50){
    const batch=ids.slice(i,i+50);
    await sbFetch(`extrato_bancario?id_extrato_c6=in.(${batch.map(x=>encodeURIComponent(x)).join(",")})`,{method:"DELETE"});
  }
  toast(`${ids.length} lançamento${ids.length!==1?"s":""} apagado${ids.length!==1?"s":""}`);
  renderExtrato();
}

// ── Busca de Duplicados ──
let _duplSection = null, _duplRows = [];

async function openDuplicados(secao) {
  _duplSection = secao;
  const titles = {receber:"Duplicados — Contas a Receber", pagar:"Duplicados — Contas a Pagar", extrato:"Duplicados — Extrato C6"};
  document.getElementById("dupl-title").textContent = "🔍 " + (titles[secao]||"Duplicados");
  document.getElementById("dupl-body").innerHTML = '<div class="empty"><div class="eicon">⏳</div>Buscando duplicados...</div>';
  document.getElementById("btn-dupl-del").style.display = "none";
  document.getElementById("dupl-sel-count").textContent = "";
  document.getElementById("m-dupl").classList.add("open");

  try {
    let rows = [], groups = [];
    if(secao === "receber") {
      rows = await dbGetAll("contas_a_receber","select=id,cod_evento,parcela,valor,vencimento,status&order=vencimento.asc&limit=5000");
      groups = _groupDuplicados(rows, r=>`${r.cod_evento}||${r.valor}||${r.vencimento}`);
    } else if(secao === "pagar") {
      rows = await dbGetAll("contas_a_pagar","select=id,fornecedor_cod,natureza,valor,vencimento_real,status&order=vencimento_real.asc&limit=5000");
      groups = _groupDuplicados(rows, r=>`${r.fornecedor_cod||""}||${r.valor}||${r.vencimento_real}`);
    } else {
      rows = await sbFetch("extrato_bancario?select=id_extrato_c6,titulo,descricao,entrada,saida,data_lancamento&order=data_lancamento.asc&limit=10000");
      if(!Array.isArray(rows)) rows = [];
      groups = _groupDuplicados(rows, r=>`${r.titulo||r.descricao||""}||${r.entrada||0}||${r.saida||0}||${r.data_lancamento}`);
    }

    _duplRows = rows;
    _renderDuplGroups(groups, secao);
  } catch(e) {
    document.getElementById("dupl-body").innerHTML = `<div class="empty"><div class="eicon">⚠️</div>Erro: ${e.message}</div>`;
  }
}

function _groupDuplicados(rows, keyFn) {
  const map = {};
  rows.forEach(r => {
    const k = keyFn(r);
    if(!map[k]) map[k] = [];
    map[k].push(r);
  });
  return Object.values(map).filter(g => g.length > 1);
}

function _renderDuplGroups(groups, secao) {
  const body = document.getElementById("dupl-body");
  if(!groups.length) {
    body.innerHTML = '<div class="empty"><div class="eicon">✅</div>Nenhum duplicado encontrado.</div>';
    return;
  }
  const total = groups.reduce((a,g)=>a+g.length-1,0);
  let html = `<div style="font-size:13px;color:var(--dl);margin-bottom:12px;">${groups.length} grupo${groups.length!==1?"s":""} com duplicados — ${total} registro${total!==1?"s":""} podem ser removidos</div>`;

  groups.forEach((grp, gi) => {
    const isExt = secao === "extrato";
    const pkFn = r => isExt ? r.id_extrato_c6 : r.id;
    const labelFn = r => {
      if(secao==="receber")  return `Evento ${r.cod_evento} | Parcela ${r.parcela||"—"} | ${fmtDate(r.vencimento)} | ${fmt(r.valor)} | ${r.status||"—"}`;
      if(secao==="pagar")    return `Fornec. ${r.fornecedor_cod||"—"} | ${fmtDate(r.vencimento_real)} | ${fmt(r.valor)} | ${r.status||"—"}`;
      return `${fmtDate(r.data_lancamento)} | ${r.titulo||r.descricao||"—"} | E: ${fmt(r.entrada||0)} S: ${fmt(r.saida||0)}`;
    };

    html += `<div class="dupl-grp" style="border:1.5px solid #e2e8f0;border-radius:10px;margin-bottom:10px;overflow:hidden;">
      <div style="background:#f8fafc;padding:8px 12px;display:flex;align-items:center;justify-content:space-between;gap:8px;">
        <span style="font-size:12px;font-weight:700;color:var(--dk);">Grupo ${gi+1} — ${grp.length} registros idênticos</span>
        <button onclick="_duplSelGrp(${gi},true)" style="font-size:11px;padding:3px 10px;background:#fee2e2;color:#dc2626;border:1.5px solid #fca5a5;border-radius:6px;cursor:pointer;font-weight:700;">Marcar excedentes</button>
      </div>
      ${grp.map((r,ri)=>{
        const pk = pkFn(r);
        const label = labelFn(r);
        const isFirst = ri===0;
        return `<label style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-top:1px solid #f1f5f9;cursor:pointer;background:${isFirst?"#f0fdf4":"#fff"};">
          <input type="checkbox" class="dupl-chk" data-pk="${_esc(String(pk))}" data-sec="${secao}" onchange="_duplChkChange()" style="accent-color:#dc2626;width:15px;height:15px;cursor:pointer;" ${isFirst?"disabled title='Primeiro registro — mantido'":""}>
          <span style="font-size:12px;color:var(--dk);">${isFirst?"<strong>✓ Manter</strong> — ":""} ${label}</span>
        </label>`;
      }).join("")}
    </div>`;
  });

  body.innerHTML = html;
}

function _duplSelGrp(gi, markExcedentes) {
  const grpEls = document.querySelectorAll("#dupl-body .dupl-grp");
  const grpEl = grpEls[gi];
  if(!grpEl) return;
  grpEl.querySelectorAll(".dupl-chk:not([disabled])").forEach(c=>c.checked=markExcedentes);
  _duplChkChange();
}

function _duplChkChange() {
  const sel = document.querySelectorAll(".dupl-chk:checked");
  const btn = document.getElementById("btn-dupl-del");
  const ct = document.getElementById("dupl-sel-count");
  btn.style.display = sel.length ? "block" : "none";
  ct.textContent = sel.length ? `${sel.length} selecionado${sel.length!==1?"s":""} para apagar` : "";
}

async function bulkDeleteDuplicados() {
  const chks = Array.from(document.querySelectorAll(".dupl-chk:checked"));
  if(!chks.length) return;
  if(!confirm(`Apagar ${chks.length} registro${chks.length!==1?"s":""} duplicado${chks.length!==1?"s":""}?\n\nO primeiro de cada grupo será mantido.`)) return;

  const secao = chks[0].dataset.sec;
  const ids = chks.map(c=>c.dataset.pk);

  if(secao==="extrato") {
    for(let i=0;i<ids.length;i+=50){
      const batch=ids.slice(i,i+50);
      await sbFetch(`extrato_bancario?id_extrato_c6=in.(${batch.map(x=>encodeURIComponent(x)).join(",")})`,{method:"DELETE"});
    }
    toast(`${ids.length} duplicado${ids.length!==1?"s":""} removido${ids.length!==1?"s":""}`);
    closeDuplicados(); renderExtrato();
  } else {
    const table = secao==="receber" ? "contas_a_receber" : "contas_a_pagar";
    const now = new Date().toISOString();
    for(let i=0;i<ids.length;i+=50){
      const batch=ids.slice(i,i+50);
      await sbFetch(`${table}?id=in.(${batch.join(",")})`,{method:"PATCH",body:{deleted_at:now},prefer:"return=minimal"});
    }
    toast(`${ids.length} duplicado${ids.length!==1?"s":""} removido${ids.length!==1?"s":""}`);
    closeDuplicados();
    if(secao==="receber") renderReceber(); else renderPagar();
  }
}

function closeDuplicados() {
  document.getElementById("m-dupl").classList.remove("open");
}

// ── Bulk delete: A Pagar ──
function _pagChkChange(){
  const chks=document.querySelectorAll(".pag-chk");
  const sel=Array.from(chks).filter(c=>c.checked);
  const bar=document.getElementById("pag-bulk-bar");
  const all=document.getElementById("pag-chk-all");
  if(bar){bar.style.display=sel.length?"flex":"none";}
  const ct=document.getElementById("pag-bulk-count");
  if(ct)ct.textContent=`${sel.length} selecionado${sel.length!==1?"s":""}`;
  if(all)all.indeterminate=sel.length>0&&sel.length<chks.length, all.checked=sel.length===chks.length;
}
function _pagToggleAll(chkAll){
  document.querySelectorAll(".pag-chk").forEach(c=>c.checked=chkAll.checked);
  _pagChkChange();
}
function _pagClearSel(){
  document.querySelectorAll(".pag-chk").forEach(c=>c.checked=false);
  const all=document.getElementById("pag-chk-all"); if(all){all.checked=false;all.indeterminate=false;}
  _pagChkChange();
}
async function bulkDeletePagar(){
  const ids=Array.from(document.querySelectorAll(".pag-chk:checked")).map(c=>c.dataset.id);
  if(!ids.length)return;
  if(!confirm(`Apagar ${ids.length} título${ids.length!==1?"s":""}?\n\nEsta ação não pode ser desfeita.`))return;
  const now=new Date().toISOString();
  for(let i=0;i<ids.length;i+=50){
    const batch=ids.slice(i,i+50);
    await sbFetch(`contas_a_pagar?id=in.(${batch.join(",")})`,{method:"PATCH",body:{deleted_at:now},prefer:"return=minimal"});
  }
  toast(`${ids.length} título${ids.length!==1?"s":""} apagado${ids.length!==1?"s":""}`);
  renderPagar();
}

// ══════════════════════════════════════════
// CONCILIAÇÃO BANCÁRIA
// ══════════════════════════════════════════
// A conciliação só existia dentro do wizard de importação do extrato: quem
// pulasse o passo "Conciliar Entradas" ficava sem caminho — o vínculo tinha de
// ser digitado na mão no CRUD do extrato. Esta tela faz o mesmo trabalho sobre
// o que já está na base, a qualquer momento.
//
// Candidato aqui não é só título em aberto. Hoje 275 das 343 entradas sem
// vínculo casam com título que já foi baixado na mão (PAGO) e nunca amarrado —
// se a lista fosse só NP, o passivo continuaria sem saída. Título já baixado
// entra como candidato e conciliar só grava o vínculo, sem mexer no status nem
// na data de recebimento.

let _concAllRows=[], _concRows=[], _concCands={rec:[],pag:[]}, _concOpts={rec:"",pag:""};
let _concLbl={}, _concById={};

function _concRefDate(c){ return c.data_recebido||c.vencimento_real||c.vencimento||null; }
function _concIsEnt(r){ return (r.entrada||0)>0; }
function _concValor(r){ return _concIsEnt(r)?(r.entrada||0):(r.saida||0); }
function _concLinked(r){ return _concIsEnt(r)?(r.titulo_a_receber||null):(r.titulo_a_pagar||null); }
function _concDias(a,b){ if(!a||!b) return null; return Math.abs(new Date(a)-new Date(b))/86400000; }
function _concPago(t){ return (t.status||"").toUpperCase()==="PAGO"; }

// Mesma regra do wizard: valor igual até o centavo e data de referência a no
// máximo 45 dias do lançamento — parcela paga adiantada ou atrasada ainda casa.
// Empate de data resolve pelo título em aberto: o já baixado só ganha quando
// está mais perto (caso típico, data de baixa idêntica à do lançamento).
function _concMatch(row){
  const val=_concValor(row);
  if(!val) return null;
  const cands=(_concIsEnt(row)?_concCands.rec:_concCands.pag).filter(c=>Math.abs((c.valor||0)-val)<0.02);
  if(!cands.length) return null;
  const dist=c=>{ const d=_concDias(_concRefDate(c),row.data_lancamento); return d==null?9e9:d; };
  cands.sort((a,b)=>(dist(a)-dist(b))||((_concPago(a)?1:0)-(_concPago(b)?1:0)));
  const best=cands[0];
  return dist(best)<=45?best:null;
}

// Um título só pode casar com um lançamento. Sem isto, três parcelas de mesmo
// valor sugeririam o mesmo título e "conciliar selecionados" gravaria o vínculo
// três vezes, deixando dois lançamentos apontando para um título já usado.
function _concDedupSugestoes(rows){
  const byId={};
  rows.forEach(r=>{ if(r._sug){ const k=(_concIsEnt(r)?"r":"p")+r._sug.id; (byId[k]=byId[k]||[]).push(r); } });
  Object.keys(byId).forEach(k=>{
    const grp=byId[k];
    if(grp.length<2) return;
    grp.sort((a,b)=>{
      const da=_concDias(_concRefDate(a._sug),a.data_lancamento), db=_concDias(_concRefDate(b._sug),b.data_lancamento);
      return (da==null?9e9:da)-(db==null?9e9:db);
    });
    grp.slice(1).forEach(r=>{ r._sug=null; r._sugAmbigua=true; });
  });
}

async function _concLoadCands(){
  const [rec,pag,extLinks,agMap,fornMap]=await Promise.all([
    dbGetAll("contas_a_receber","select=id,cod_evento,parcela,num_parcela,valor,vencimento,data_recebido,status&order=vencimento.asc"),
    dbGetAll("contas_a_pagar","select=id,fornecedor_cod,obs,valor,vencimento,vencimento_real,status&order=vencimento_real.asc"),
    dbGet("extrato_bancario","select=titulo_a_receber,titulo_a_pagar&limit=5000"),
    getAgendaMap(), getFornecMap()
  ]);
  // Título já amarrado a outro lançamento sai da lista de candidatos.
  const usedRec=new Set(), usedPag=new Set();
  (extLinks||[]).forEach(e=>{
    if(e.titulo_a_receber) usedRec.add(String(e.titulo_a_receber));
    if(e.titulo_a_pagar)   usedPag.add(String(e.titulo_a_pagar));
  });
  _concLbl={}; _concById={};
  const marca=t=>_concPago(t)?" · já baixado":"";
  (rec||[]).forEach(t=>{
    _concById["r"+t.id]=t;
    _concLbl["r"+t.id]=`${agMap[t.cod_evento]||t.cod_evento||"?"} — Parc.${t.parcela||"?"}/${t.num_parcela||"?"} — ${fmt(t.valor)}`;
    t._lbl=_concLbl["r"+t.id]+` — ${_concPago(t)?"baixado":"venc"} ${fmtDate(_concRefDate(t))}${marca(t)}`;
  });
  (pag||[]).forEach(t=>{
    _concById["p"+t.id]=t;
    _concLbl["p"+t.id]=`${fornMap[t.fornecedor_cod]||t.fornecedor_cod||"Sem fornecedor"} — ${fmt(t.valor)}`;
    t._lbl=_concLbl["p"+t.id]+` — ${_concPago(t)?"baixado":"venc"} ${fmtDate(_concRefDate(t))}${t.obs?" — "+t.obs:""}${marca(t)}`;
  });
  _concCands.rec=(rec||[]).filter(t=>!usedRec.has(String(t.id)));
  _concCands.pag=(pag||[]).filter(t=>!usedPag.has(String(t.id)));
  // Em aberto primeiro na lista manual — é o que se procura no dia a dia.
  const ordena=a=>a.slice().sort((x,y)=>((_concPago(x)?1:0)-(_concPago(y)?1:0))||(String(_concRefDate(y)||"")).localeCompare(String(_concRefDate(x)||"")));
  _concOpts.rec=ordena(_concCands.rec).map(t=>`<option value="${t.id}">${_esc(t._lbl)}</option>`).join("");
  _concOpts.pag=ordena(_concCands.pag).map(t=>`<option value="${t.id}">${_esc(t._lbl)}</option>`).join("");
}

async function renderConciliacao(){
  const wr=document.getElementById("conc-list");
  if(!wr) return;
  wr.innerHTML='<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  const totWr=document.getElementById("conc-totais"); if(totWr) totWr.innerHTML="";
  _concClearSel();

  const de=(document.getElementById("conc-fil-de")||{}).value||"";
  const ate=(document.getElementById("conc-fil-ate")||{}).value||"";
  const tipo=(document.getElementById("conc-fil-tipo")||{}).value||"entradas";
  const stat=(document.getElementById("conc-fil-status")||{}).value||"pend";

  let q="order=data_lancamento.desc,id_extrato_c6.asc&limit=5000";
  if(de)  q+="&data_lancamento=gte."+de;
  if(ate) q+="&data_lancamento=lte."+ate;

  try{
    const [raw]=await Promise.all([dbGet("extrato_bancario",q),_concLoadCands()]);
    const seen=new Set();
    let rows=(raw||[]).filter(r=>{ if(seen.has(r.id_extrato_c6))return false; seen.add(r.id_extrato_c6); return true; });
    rows=rows.filter(r=>{
      const ent=_concIsEnt(r);
      if(tipo==="entradas"&&!ent) return false;
      if(tipo==="saidas"&&ent) return false;
      const conc=!!_concLinked(r);
      if(stat==="pend"&&conc) return false;
      if(stat==="conc"&&!conc) return false;
      return true;
    });
    rows.forEach(r=>{ r._sug=_concLinked(r)?null:_concMatch(r); r._sugAmbigua=false; });
    _concDedupSugestoes(rows);
    _concAllRows=rows;
    _concApplyDescFilter();
  }catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro: '+e.message+'</div>'; }
}

function _concApplyDescFilter(){
  const term=((document.getElementById("conc-fil-desc")||{}).value||"").trim().toLowerCase();
  _concRows=term?_concAllRows.filter(r=>(r.titulo||r.descricao||"").toLowerCase().includes(term)):_concAllRows;
  _concClearSel();
  _concRenderTable(!!term);
}

function _concRenderTable(filtered){
  const wr=document.getElementById("conc-list");
  const totWr=document.getElementById("conc-totais");
  const rows=_concRows;

  const pend=rows.filter(r=>!_concLinked(r));
  const comSug=pend.filter(r=>r._sug);
  const conc=rows.filter(r=>_concLinked(r));
  if(totWr) totWr.innerHTML=`
    <div class="tot-card"><div class="tot-lbl">Não conciliados</div><div class="tot-val">${pend.length}</div></div>
    <div class="tot-card"><div class="tot-lbl">Valor sem vínculo</div><div class="tot-val blue">${fmt(pend.reduce((a,r)=>a+_concValor(r),0))}</div></div>
    <div class="tot-card"><div class="tot-lbl">Com sugestão</div><div class="tot-val green">${comSug.length}</div></div>
    <div class="tot-card"><div class="tot-lbl">Conciliados</div><div class="tot-val">${conc.length}</div></div>`;

  if(!rows.length){
    wr.innerHTML='<div class="empty"><div class="eicon">🔗</div>'+(filtered?"Nenhum resultado para esse filtro.":"Nada para conciliar neste filtro.")+'</div>';
    return;
  }

  const body=rows.map((r,i)=>{
    const ent=_concIsEnt(r);
    const lig=_concLinked(r);
    const desc=r.titulo||r.descricao||"—";
    const valTd=ent
      ? `<td style="color:#2A6644;font-weight:700;white-space:nowrap;">+ ${fmt(r.entrada)}</td>`
      : `<td style="color:var(--er);font-weight:700;white-space:nowrap;">- ${fmt(r.saida)}</td>`;
    if(lig){
      const lbl=_concLbl[(ent?"r":"p")+lig];
      return `<tr>
        <td></td>
        <td style="white-space:nowrap;font-size:12px;">${fmtDate(r.data_lancamento)}</td>
        <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(desc)}">${_esc(desc)}</td>
        ${valTd}
        <td><span class="imp-badge-match">🔗 Conciliado</span></td>
        <td style="font-size:12px;color:var(--dm);">${_esc(lbl||(ent?"A receber":"A pagar"))} <span style="color:var(--dl);">#${_esc(lig)}</span></td>
        <td><button class="btn-cancel" style="padding:3px 10px;font-size:11px;" onclick="concDesconciliar(${i})">✕ Desfazer</button></td>
      </tr>`;
    }
    const badge=r._sug
      ? (_concPago(r._sug)?`<span class="imp-badge-hist">✓ Já baixado</span>`:`<span class="imp-badge-match">✓ Sugerido</span>`)
      : (r._sugAmbigua?`<span class="imp-badge-new">⚠ Valor repetido</span>`:`<span class="imp-badge-no">Sem sugestão</span>`);
    const sugOpt=r._sug?`<option value="${r._sug.id}" selected>${_esc(r._sug._lbl)}</option>`:"";
    return `<tr>
      <td><input type="checkbox" class="conc-chk" data-i="${i}" onchange="_concChkChange()" style="cursor:pointer;"${r._sug?" checked":""}/></td>
      <td style="white-space:nowrap;font-size:12px;">${fmtDate(r.data_lancamento)}</td>
      <td style="max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${_esc(desc)}">${_esc(desc)}</td>
      ${valTd}
      <td>${badge}</td>
      <td style="min-width:240px;">
        <select class="imp-sel" id="conc-sel-${i}" data-kind="${ent?"rec":"pag"}" onfocus="_concFillSel(this)" onmousedown="_concFillSel(this)">
          <option value="">— Não conciliar —</option>
          ${sugOpt}
        </select>
      </td>
      <td><button class="btn-a" style="padding:3px 10px;font-size:11px;" onclick="concConciliarRow(${i})">🔗 Conciliar</button></td>
    </tr>`;
  }).join("");

  wr.innerHTML=`<div class="table-wrap"><table class="imp-table">
    <thead><tr>
      <th style="width:32px;">${pend.length?'<input type="checkbox" id="conc-chk-all" onchange="_concToggleAll(this)" style="cursor:pointer;"/>':""}</th>
      <th>Data</th><th>Descrição</th><th>Valor</th><th>Situação</th><th>Título</th><th></th>
    </tr></thead>
    <tbody>${body}</tbody>
  </table></div>`;
  _concChkChange();
}

// A lista de títulos passa de dois mil; montar um <select> completo por linha
// estoura o DOM. Cada select nasce só com a sugestão e é preenchido no primeiro
// foco/clique.
function _concFillSel(sel){
  if(sel.dataset.full==="1") return;
  const cur=sel.value;
  sel.insertAdjacentHTML("beforeend",_concOpts[sel.dataset.kind]||"");
  const seen=new Set();
  Array.from(sel.options).forEach(o=>{ if(o.value&&seen.has(o.value)) o.remove(); else seen.add(o.value); });
  sel.value=cur;
  sel.dataset.full="1";
}

function _concChkChange(){
  const chks=document.querySelectorAll(".conc-chk");
  const sel=Array.from(chks).filter(c=>c.checked);
  const bar=document.getElementById("conc-bulk-bar");
  if(bar) bar.style.display=sel.length?"flex":"none";
  const ct=document.getElementById("conc-bulk-count");
  if(ct) ct.textContent=`${sel.length} lançamento${sel.length!==1?"s":""} selecionado${sel.length!==1?"s":""}`;
  const all=document.getElementById("conc-chk-all");
  if(all){ all.indeterminate=sel.length>0&&sel.length<chks.length; all.checked=chks.length>0&&sel.length===chks.length; }
}
function _concToggleAll(chkAll){
  document.querySelectorAll(".conc-chk").forEach(c=>c.checked=chkAll.checked);
  _concChkChange();
}
function _concClearSel(){
  document.querySelectorAll(".conc-chk").forEach(c=>c.checked=false);
  const all=document.getElementById("conc-chk-all"); if(all){ all.checked=false; all.indeterminate=false; }
  _concChkChange();
}

// Conciliar = gravar o vínculo no extrato e, se o título ainda estava em aberto,
// baixá-lo na data do lançamento (as mesmas escritas do wizard de importação).
// Título já baixado só recebe o vínculo — mexer no status reescreveria uma baixa
// que já foi conferida.
async function _concLink(row, tituloId){
  const ent=_concIsEnt(row);
  const t=_concById[(ent?"r":"p")+tituloId];
  const jaPago=t?_concPago(t):false;
  if(ent){
    if(!jaPago) await sbFetch(`contas_a_receber?id=eq.${encodeURIComponent(tituloId)}`,{method:"PATCH",body:{status:"PAGO",data_recebido:row.data_lancamento},prefer:"return=minimal"});
    await sbFetch(`extrato_bancario?id_extrato_c6=eq.${encodeURIComponent(row.id_extrato_c6)}`,{method:"PATCH",body:{titulo_a_receber:String(tituloId)},prefer:"return=minimal"});
  } else {
    if(!jaPago) await sbFetch(`contas_a_pagar?id=eq.${encodeURIComponent(tituloId)}`,{method:"PATCH",body:{status:"Pago",vencimento_real:row.data_lancamento},prefer:"return=minimal"});
    await sbFetch(`extrato_bancario?id_extrato_c6=eq.${encodeURIComponent(row.id_extrato_c6)}`,{method:"PATCH",body:{titulo_a_pagar:String(tituloId)},prefer:"return=minimal"});
  }
}

async function concConciliarRow(i){
  const r=_concRows[i]; if(!r) return;
  const sel=document.getElementById("conc-sel-"+i);
  const id=sel?sel.value:"";
  if(!id){ toast("Selecione o título antes de conciliar."); return; }
  try{
    await _concLink(r,id);
    toast("Lançamento conciliado");
    renderConciliacao();
  }catch(e){ alert("Erro ao conciliar: "+e.message); }
}

async function concConciliarSel(){
  const chks=Array.from(document.querySelectorAll(".conc-chk:checked"));
  if(!chks.length){ toast("Selecione ao menos um lançamento."); return; }
  const alvos=[], usados=new Set(), semTitulo=[], repetidos=[];
  for(const c of chks){
    const i=+c.dataset.i;
    const r=_concRows[i]; if(!r) continue;
    const sel=document.getElementById("conc-sel-"+i);
    const id=sel?sel.value:"";
    if(!id){ semTitulo.push(i); continue; }
    const key=(_concIsEnt(r)?"r":"p")+id;
    if(usados.has(key)){ repetidos.push(i); continue; }
    usados.add(key);
    alvos.push({row:r,id:id});
  }
  if(!alvos.length){ alert("Nenhum dos lançamentos selecionados tem título escolhido."); return; }
  const baixar=alvos.filter(a=>{ const t=_concById[(_concIsEnt(a.row)?"r":"p")+a.id]; return !t||!_concPago(t); }).length;
  let aviso="";
  if(baixar) aviso+=`\n${baixar} título${baixar!==1?"s":""} em aberto ${baixar!==1?"serão baixados":"será baixado"} na data do lançamento.`;
  if(alvos.length-baixar) aviso+=`\n${alvos.length-baixar} já ${alvos.length-baixar!==1?"estão baixados":"está baixado"} — só recebe${alvos.length-baixar!==1?"m":""} o vínculo.`;
  if(semTitulo.length) aviso+=`\n${semTitulo.length} sem título escolhido ${semTitulo.length===1?"será ignorado":"serão ignorados"}.`;
  if(repetidos.length) aviso+=`\n${repetidos.length} ${repetidos.length===1?"aponta":"apontam"} para título já usado nesta seleção e ${repetidos.length===1?"será ignorado":"serão ignorados"}.`;
  if(!confirm(`Conciliar ${alvos.length} lançamento${alvos.length!==1?"s":""}?\n${aviso}`)) return;

  const btn=document.getElementById("conc-btn-bulk");
  if(btn){ btn.disabled=true; btn.textContent="Conciliando..."; }
  let ok=0; const erros=[];
  for(const a of alvos){
    try{ await _concLink(a.row,a.id); ok++; }
    catch(e){ erros.push(`${fmtDate(a.row.data_lancamento)} ${fmt(_concValor(a.row))}: ${e.message}`); }
  }
  if(btn){ btn.disabled=false; btn.innerHTML="🔗 Conciliar selecionados"; }
  if(erros.length) alert(`${ok} conciliado${ok!==1?"s":""}, ${erros.length} com erro:\n\n`+erros.slice(0,10).join("\n"));
  else toast(`✅ ${ok} lançamento${ok!==1?"s":""} conciliado${ok!==1?"s":""}`);
  renderConciliacao();
}

// Desfazer devolve o título para em aberto. Quem só amarrou um título que já
// estava baixado não quer isso — por isso a pergunta separada.
async function concDesconciliar(i){
  const r=_concRows[i]; if(!r) return;
  const ent=_concIsEnt(r);
  const id=_concLinked(r);
  if(!id) return;
  if(!confirm(`Desfazer a conciliação do lançamento de ${fmtDate(r.data_lancamento)} (${fmt(_concValor(r))})?\n\nO vínculo com o título ${ent?"a receber":"a pagar"} #${id} será apagado.`)) return;
  const voltar=confirm(`Devolver o título #${id} para NP (em aberto)?\n\nOK = volta para em aberto.\nCancelar = mantém como pago, só desfaz o vínculo.`);
  try{
    await sbFetch(`extrato_bancario?id_extrato_c6=eq.${encodeURIComponent(r.id_extrato_c6)}`,{method:"PATCH",body:ent?{titulo_a_receber:null}:{titulo_a_pagar:null},prefer:"return=minimal"});
    if(voltar){
      if(ent) await sbFetch(`contas_a_receber?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:{status:"NP",data_recebido:null},prefer:"return=minimal"});
      else    await sbFetch(`contas_a_pagar?id=eq.${encodeURIComponent(id)}`,{method:"PATCH",body:{status:"NP"},prefer:"return=minimal"});
    }
    toast("Conciliação desfeita");
    renderConciliacao();
  }catch(e){ alert("Erro ao desconciliar: "+e.message); }
}
