// ══════════════════════════════════════════
// PEDIDOS
// ══════════════════════════════════════════
let _pedidoId = null, _pedidoItens = [], _pedPer = "todos";

function _pedSetPer(p) {
  _pedPer = p;
  ["todos","futuros","passados"].forEach(k=>{
    const el=document.getElementById("ped-per-"+k);
    if(el) el.classList.toggle("on", k===p);
  });
  renderPedidos();
}

async function renderPedidos() {
  const wr = document.getElementById("ped-list");
  wr.innerHTML = '<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  try {
    const busca    = (document.getElementById("ped-busca").value||"").toLowerCase().trim();
    const evFil    = document.getElementById("ped-fil-evento").value;
    const filDiverg = document.getElementById("ped-fil-diverg")?.checked;
    const hojeStr  = new Date().toISOString().slice(0,10);

    const [pedRows, evtRows] = await Promise.all([
      dbGet("pedidos","order=created_at.desc&limit=1000&select=*"),
      dbGet("agenda","select=cod,nome_evento,data_evento&order=data_evento.desc&limit=500")
    ]);
    const evMap = {}, evDateMap = {};
    evtRows.forEach(e=>{ evMap[e.cod]=e.nome_evento||e.cod; evDateMap[e.cod]=e.data_evento||""; });
    const selEv = document.getElementById("ped-fil-evento");
    if(selEv.options.length===1) {
      [...new Set(pedRows.map(r=>r.cod_evento).filter(Boolean))].sort().forEach(c=>{
        const o=document.createElement("option"); o.value=c; o.textContent=evMap[c]||c; selEv.appendChild(o);
      });
    }

    let rows = pedRows;
    if(_userEventIds) rows = rows.filter(r=>_userEventIds.includes(r.cod_evento));
    if(_pedPer==="futuros")  rows = rows.filter(r=>{ const d=evDateMap[r.cod_evento]; return d && d >= hojeStr; });
    if(_pedPer==="passados") rows = rows.filter(r=>{ const d=evDateMap[r.cod_evento]; return !d || d < hojeStr; });
    if(evFil)  rows = rows.filter(r=>r.cod_evento===evFil);
    if(busca)  rows = rows.filter(r=>(r.numero_pedido||"").toLowerCase().includes(busca)||(evMap[r.cod_evento]||"").toLowerCase().includes(busca));

    // Mapa de divergências (só carrega se filtro ativo ou para exibir badges)
    let divergMap = {}; // pedido.id → { somaItens, somaRec, diff }
    if(rows.length) {
      const pedIds  = rows.map(r=>r.id);
      const codEvts = [...new Set(rows.map(r=>r.cod_evento).filter(Boolean))];
      const codEvtsFiltrados = codEvts.filter(Boolean);
      const [itensRows, recRows] = await Promise.all([
        dbGet("itens_pedido","pedido_id=in.("+pedIds.join(",")+")"+"&select=pedido_id,quantidade,valor_unitario&limit=5000"),
        codEvtsFiltrados.length ? dbGet("contas_a_receber","cod_evento=in.("+codEvtsFiltrados.join(",")+")"+"&select=cod_evento,valor&limit=5000") : Promise.resolve([])
      ]);
      // soma itens por pedido — usa qtd×vun igual ao modal, ignora valor_subtotal salvo
      const itensByPed = {};
      itensRows.forEach(it=>{ itensByPed[it.pedido_id] = (itensByPed[it.pedido_id]||0) + (it.quantidade||0)*(it.valor_unitario||0); });
      // soma receber por evento
      const recByEv = {};
      recRows.forEach(r=>{ recByEv[r.cod_evento] = (recByEv[r.cod_evento]||0) + (r.valor||0); });

      rows.forEach(r=>{
        const somaItens = itensByPed[r.id]||0;
        const somaRec   = recByEv[r.cod_evento]??null;
        const totalPed  = r.total_pedido != null ? parseFloat(r.total_pedido) : null;
        const diff = somaRec != null && totalPed != null ? totalPed - somaRec : null;
        divergMap[r.id] = { somaItens, somaRec, diff };
      });
    }

    if(filDiverg) rows = rows.filter(r=>{ const d=divergMap[r.id]; return d && d.diff != null && Math.abs(d.diff) > 0.01; });

    if(!rows.length){ wr.innerHTML='<div class="empty"><div class="eicon">🛒</div>Nenhum pedido encontrado.</div>'; return; }

    const showVals = effIsAdmin();
    wr.innerHTML=`<div class="table-wrap"><table class="fin-table">
      <thead><tr><th>Nº Pedido</th><th>Evento</th><th>Data Evento</th>${showVals?`<th style="text-align:right;">Soma Tabela</th><th style="text-align:right;">Desconto</th><th style="text-align:right;">A Receber</th><th style="text-align:right;">Total Pedido</th><th></th>`:``}</tr></thead>
      <tbody>${rows.map(r=>{
        const rj      = _esc(JSON.stringify(r));
        const dataEv  = evDateMap[r.cod_evento];
        const isFut   = dataEv && dataEv >= hojeStr;
        const dv      = divergMap[r.id];
        const descontoVal = dv?.somaItens && r.total_pedido && dv.somaItens > r.total_pedido + 0.01 ? dv.somaItens - r.total_pedido : null;
        const divBadge = showVals && dv && dv.diff != null && Math.abs(dv.diff) > 0.01
          ? `<span title="Divergência: ${fmt(Math.abs(dv.diff))}" style="display:inline-block;background:#F0AD4E;color:#7A5C00;font-size:10px;font-weight:700;border-radius:6px;padding:1px 6px;margin-left:6px;">⚠️ ${fmt(Math.abs(dv.diff))}</span>`
          : (showVals && dv && dv.somaRec != null ? `<span style="color:#2A6644;font-size:10px;font-weight:700;margin-left:6px;">✓</span>` : "");
        return`<tr>
          <td style="font-weight:700;">${r.numero_pedido||"—"}${divBadge}</td>
          <td>${evMap[r.cod_evento]||r.cod_evento||"—"}</td>
          <td style="color:${isFut?"#2A6644":"var(--dl)"};">${dataEv?fmtDate(dataEv):"—"}</td>
          ${showVals?`<td style="text-align:right;">${dv?.somaItens ? fmt(dv.somaItens) : "—"}</td>
          <td style="text-align:right;color:#dc2626;font-weight:700;">${descontoVal ? "−"+fmt(descontoVal) : "—"}</td>
          <td style="text-align:right;color:#2A6644;">${dv?.somaRec != null ? fmt(dv.somaRec) : "—"}</td>
          <td style="text-align:right;font-weight:700;">${r.total_pedido?fmt(r.total_pedido):"—"}</td>
          <td><div class="row-acts"><button class="act-btn" title="Ver itens" onclick='openPedidoModal(JSON.parse(this.dataset.r),true)' data-r="${rj}">👁</button><button class="act-btn" title="Editar" onclick='openPedidoModal(JSON.parse(this.dataset.r),false)' data-r="${rj}">✏️</button><button class="act-btn" title="Apagar pedido" onclick='if(confirm("Apagar pedido "+JSON.parse(this.dataset.r).numero_pedido+"?"))_deletePedidoById(JSON.parse(this.dataset.r))' data-r="${rj}">🗑</button></div></td>`
          :`<td><div class="row-acts"><button class="act-btn" title="Ver itens" onclick='openPedidoModal(JSON.parse(this.dataset.r),true)' data-r="${rj}">👁</button></div></td>`}
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro: '+e.message+'</div>'; }
}

function closePedidoModal() { document.getElementById("m-pedido").classList.remove("open"); }

async function deletePedidoAtual(){
  if(!_pedidoId||!confirm("Apagar este pedido e seus itens?")) return;
  try{
    await sbFetch("itens_pedido?pedido_id=eq."+_pedidoId,{method:"DELETE",prefer:"return=minimal"});
    await sbFetch("pedidos?id=eq."+_pedidoId,{method:"PATCH",body:{deleted_at:new Date().toISOString()},prefer:"return=minimal"});
    closePedidoModal(); renderPedidos(); toast("Pedido apagado.");
  }catch(e){toast("Erro ao apagar: "+e.message);}
}
async function _deletePedidoById(ped){
  if(!effIsAdmin()) return;
  try{
    await sbFetch("itens_pedido?pedido_id=eq."+ped.id,{method:"DELETE",prefer:"return=minimal"});
    await sbFetch("pedidos?id=eq."+ped.id,{method:"PATCH",body:{deleted_at:new Date().toISOString()},prefer:"return=minimal"});
    renderPedidos(); toast("Pedido apagado.");
  }catch(e){toast("Erro ao apagar: "+e.message);}
}

let _pmInvItems = []; // cache do inventário para o modal

function _pmAddItem(it={}, readOnly) {
  const tbody = document.getElementById("pm-itens-body");
  const tr = document.createElement("tr");
  tr.dataset.id = it.id||"";
  // Opções do inventário
  const opts = _pmInvItems.map(inv=>{
    const sel = inv.cod === it.cod_item ? "selected" : "";
    return `<option value="${inv.cod}" ${sel}>${inv.cod} — ${inv.descricao||""}</option>`;
  }).join("");
  const sub = it.valor_subtotal ? fmt(it.valor_subtotal) : (it.quantidade&&it.valor_unitario ? fmt((it.quantidade||0)*(it.valor_unitario||0)) : "—");
  const dn = readOnly ? "display:none;" : "";
  const descricao = (_pmInvItems.find(x=>x.cod===it.cod_item)||{}).descricao||it.descricao||"";
  tr.innerHTML = readOnly
    ? `<td style="min-width:220px;">${descricao||it.cod_item||"—"}</td>
       <td style="text-align:right;">${it.quantidade||"—"}</td>
       <td style="${dn}"></td><td style="${dn}"></td><td style="${dn}"></td>`
    : `<td style="min-width:220px;">
        <select class="inp pm-sel-cod" style="margin:0;width:100%;" onchange="_pmSelItem(this)">
          <option value="">— Selecione item —</option>
          ${opts}
        </select>
       </td>
       <td style="display:none;" class="pm-descr">${descricao}</td>
       <td><input class="inp pm-qtd" type="number" step="1" min="0" style="margin:0;width:70px;text-align:right;" value="${it.quantidade||""}" placeholder="0" oninput="_pmCalcSub(this)"/></td>
       <td><input class="inp pm-vun" type="number" step="0.01" min="0" style="margin:0;width:100px;text-align:right;" value="${it.valor_unitario!=null?it.valor_unitario:""}" placeholder="0,00" oninput="_pmCalcSub(this)"/></td>
       <td class="pm-sub" style="text-align:right;font-weight:700;white-space:nowrap;">${sub}</td>
       <td><button class="act-btn" onclick="this.closest('tr').remove()" title="Remover">🗑</button></td>`;
  tbody.appendChild(tr);
}

function _pmSelItem(sel) {
  const tr = sel.closest("tr");
  const inv = _pmInvItems.find(i=>i.cod===sel.value);
  if(inv) {
    tr.querySelector(".pm-descr").textContent = inv.descricao||"";
    const vunInp = tr.querySelector(".pm-vun");
    if(!vunInp.value) vunInp.value = inv.valor_unitario!=null ? inv.valor_unitario : "";
    _pmCalcSub(vunInp);
  } else {
    tr.querySelector(".pm-descr").textContent = "";
  }
}

function _pmCalcSub(inp) {
  const tr = inp.closest("tr");
  const qtd = parseFloat(tr.querySelector(".pm-qtd").value)||0;
  const vun = parseFloat(tr.querySelector(".pm-vun").value)||0;
  tr.querySelector(".pm-sub").textContent = qtd&&vun ? fmt(qtd*vun) : "—";
  _pmUpdateTotais();
}

let _pmSomaReceber = null; // cache do valor a receber carregado

async function _pmUpdateTotais() {
  const panel = document.getElementById("pm-totais-panel");
  const cod_evento = document.getElementById("pm-evento").value;
  if(!cod_evento){ panel.style.display="none"; return; }
  panel.style.display="block";

  // Soma dos subtotais dos itens na tela
  const somaItens = Array.from(document.querySelectorAll("#pm-itens-body tr")).reduce((acc,tr)=>{
    const qtd = parseFloat(tr.querySelector(".pm-qtd")?.value)||0;
    const vun = parseFloat(tr.querySelector(".pm-vun")?.value)||0;
    return acc + qtd*vun;
  }, 0);
  document.getElementById("pm-soma-itens").textContent = somaItens ? fmt(somaItens) : "—";

  // Desconto = preços de tabela − total negociado no contrato
  const _totalPed = parseFloat(document.getElementById("pm-total").value)||0;
  const _descEl = document.getElementById("pm-desconto-wrap");
  if(somaItens && _totalPed && somaItens > _totalPed + 0.01) {
    document.getElementById("pm-desconto").textContent = fmt(somaItens - _totalPed);
    _descEl.style.display = "";
  } else {
    _descEl.style.display = "none";
  }

  // Busca parcelas a receber do evento (só se mudou de evento)
  if(_pmSomaReceber === null || _pmSomaReceber._cod !== cod_evento) {
    try {
      const parcelas = await dbGet("contas_a_receber","cod_evento=eq."+encodeURIComponent(cod_evento)+"&select=valor&limit=500");
      const soma = parcelas.reduce((a,r)=>a+(r.valor||0),0);
      _pmSomaReceber = { _cod: cod_evento, valor: soma };
    } catch(e){ _pmSomaReceber = { _cod: cod_evento, valor: null }; }
  }
  const somaRec = _pmSomaReceber.valor;
  document.getElementById("pm-soma-receber").textContent = somaRec != null ? fmt(somaRec) : "—";

  // Divergência: total do pedido (valor negociado) vs parcelas a receber
  const divEl  = document.getElementById("pm-divergencia");
  const divVal = document.getElementById("pm-divergencia-val");
  if(_totalPed && somaRec != null && Math.abs(_totalPed - somaRec) > 0.01) {
    const diff = _totalPed - somaRec;
    divEl.style.display = "block";
    divVal.textContent = diff > 0
      ? `Total do pedido excede parcelas em ${fmt(diff)}`
      : `Parcelas excedem total do pedido em ${fmt(Math.abs(diff))}`;
  } else {
    divEl.style.display = "none";
  }
}

async function openPedidoModal(ped, readOnly) {
  _pedidoId = ped ? ped.id : null;
  const ro = readOnly || !effIsAdmin();
  document.getElementById("ped-modal-title").textContent = ro ? "Itens do Pedido" : (ped ? "Editar Pedido" : "Novo Pedido");
  document.getElementById("pm-numero").value = ped?.numero_pedido||"";
  document.getElementById("pm-total").value = ped?.total_pedido||"";
  document.getElementById("pm-itens-body").innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--dl);">Carregando...</td></tr>';
  const sel = document.getElementById("pm-evento");
  sel.innerHTML = '<option value="">— Selecione —</option>';
  // modo leitura: oculta campos de valor e ações
  document.getElementById("pm-total").closest("div").parentElement.style.display = ro ? "none" : "";
  document.getElementById("pm-totais-panel").style.display = "none"; // revelado após carga dos itens
  document.getElementById("pm-desconto-wrap").style.display = "none";
  document.getElementById("pm-itens-table").querySelectorAll("th")[2].style.display = ro ? "none" : "";
  document.getElementById("pm-itens-table").querySelectorAll("th")[3].style.display = ro ? "none" : "";
  document.getElementById("pm-itens-table").querySelectorAll("th")[4].style.display = ro ? "none" : "";
  document.querySelector("#m-pedido .btn-cancel[onclick*='_pmAddItem']") && (document.querySelector("#m-pedido .btn-cancel[onclick*='_pmAddItem']").style.display = ro ? "none" : "");
  document.getElementById("pm-btn-save").style.display = ro ? "none" : "";
  document.getElementById("pm-btn-delete").style.display = !ro && ped ? "" : "none";
  document.querySelector("#m-pedido .macts .btn-cancel").textContent = ro ? "Fechar" : "Cancelar";
  document.getElementById("m-pedido").classList.add("open");
  try {
    const [evts, invItems, itens] = await Promise.all([
      dbGet("agenda","select=cod,nome_evento&order=data_evento.desc&limit=500"),
      dbGet("inventario","select=cod,descricao,valor_unitario&order=descricao.asc&limit=500"),
      _pedidoId ? dbGet("itens_pedido","pedido_id=eq."+_pedidoId+"&select=id,cod_item,descricao,quantidade,valor_unitario,valor_subtotal&order=id.asc&limit=500") : Promise.resolve([])
    ]);
    _pmInvItems = invItems;
    _pmSomaReceber = null;
    evts.forEach(e=>{ const o=document.createElement("option"); o.value=e.cod; o.textContent=(e.nome_evento||e.cod); if(ped&&e.cod===ped.cod_evento)o.selected=true; sel.appendChild(o); });
    document.getElementById("pm-itens-body").innerHTML = "";
    let _somaLoad = 0;
    if(itens.length) {
      itens.forEach(it=>{ _pmAddItem(it, ro); _somaLoad += (it.quantidade||0)*(it.valor_unitario||0); });
    } else {
      document.getElementById("pm-itens-body").innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--dl);">Nenhum item cadastrado neste pedido.</td></tr>';
    }
    // Painel de totais — sempre visível após carga
    const _totPanel = document.getElementById("pm-totais-panel");
    document.getElementById("pm-soma-itens").textContent = _somaLoad ? fmt(_somaLoad) : "—";
    document.getElementById("pm-soma-receber").textContent = "—";
    const _totalPedLoad = parseFloat(ped?.total_pedido)||0;
    if(_somaLoad && _totalPedLoad && _somaLoad > _totalPedLoad + 0.01) {
      document.getElementById("pm-desconto").textContent = fmt(_somaLoad - _totalPedLoad);
      document.getElementById("pm-desconto-wrap").style.display = "";
    }
    if(_somaLoad || _totalPedLoad) _totPanel.style.display = "block";
    if(!ro) await _pmUpdateTotais();
  } catch(e) {
    document.getElementById("pm-itens-body").innerHTML = '<tr><td colspan="5" style="text-align:center;padding:16px;color:#A03030;">Erro ao carregar itens: '+e.message+'</td></tr>';
  }
}

async function savePedido() {
  const btn = document.getElementById("pm-btn-save");
  btn.disabled=true; btn.textContent="Salvando...";
  try {
    const numero = document.getElementById("pm-numero").value.trim();
    const cod_evento = document.getElementById("pm-evento").value;
    const total_pedido = parseFloat(document.getElementById("pm-total").value)||null;
    if(!cod_evento){ toast("Selecione um evento."); return; }
    // Coleta itens da tabela
    const itensRows = Array.from(document.getElementById("pm-itens-body").rows).map(tr=>{
      const cod_item = tr.querySelector(".pm-sel-cod").value||null;
      const descricao = tr.querySelector(".pm-descr").textContent.trim()||null;
      const qtd = parseFloat(tr.querySelector(".pm-qtd").value)||0;
      const vun = parseFloat(tr.querySelector(".pm-vun").value)||0;
      return { cod_item, descricao, quantidade:qtd||null, valor_unitario:vun||null, valor_subtotal:qtd&&vun?qtd*vun:null };
    }).filter(r=>r.cod_item);
    let pedId = _pedidoId;
    if(pedId) {
      await dbUpdate("pedidos","id=eq."+pedId,{numero_pedido:numero,cod_evento,total_pedido});
      // Apaga todos os itens antigos antes de reinserir (DELETE real — itens são registros filhos sem dependências)
      await sbFetch("itens_pedido?pedido_id=eq."+pedId,{method:"DELETE",prefer:"return=minimal"});
    } else {
      const res = await sbFetch("pedidos",{method:"POST",body:{numero_pedido:numero,cod_evento,total_pedido},prefer:"return=representation"});
      pedId = Array.isArray(res)?res[0]?.id:res?.id;
    }
    if(itensRows.length && pedId) {
      const payload = itensRows.map(it=>({pedido_id:pedId,cod_item:it.cod_item,descricao:it.descricao,quantidade:it.quantidade,valor_unitario:it.valor_unitario,valor_subtotal:it.valor_subtotal}));
      await sbFetch("itens_pedido",{method:"POST",body:payload,prefer:"return=minimal"});
    }
    closePedidoModal(); renderPedidos(); toast("✅ Pedido salvo!");
  } catch(e){ toast("Erro: "+e.message); }
  finally { btn.disabled=false; btn.textContent="Salvar"; }
}

// ══════════════════════════════════════════
// VISITA TÉCNICA
// ══════════════════════════════════════════
const VT_TIPOS = ["Buffet","Bar","Som/Iluminação","Som","Iluminação","Decoração","Assessoria","Locação de móveis"];
let _vtId = null, _vtFornecList = [], _vtPer = "todos", _vtLinhaOrigIds = new Set();
const _VT_TIPOS_BASE = ["Assessoria","Buffet","Cerimonialista","Decoração","DJ","Filmagem","Floricultura","Fotografia","Iluminação","Som/Iluminação","Segurança","Outros"];

function _vtSetPer(p) {
  _vtPer = p;
  ["todos","futuros","passados"].forEach(k=>{
    const el=document.getElementById("vt-per-"+k);
    if(el) el.classList.toggle("on", k===p);
  });
  renderVT();
}

async function renderVT() {
  const wr = document.getElementById("vt-list");
  wr.innerHTML = '<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  try {
    const evFil = document.getElementById("vt-fil-evento").value;
    const hojeStr = new Date().toISOString().slice(0,10);
    const [vtRows, evtRows] = await Promise.all([
      dbGet("visitas_tecnicas","order=data_vt.desc&limit=500&select=*"),
      dbGet("agenda","select=cod,nome_evento,data_evento&order=data_evento.desc&limit=500")
    ]);
    const evMap = {}, evDateMap = {};
    evtRows.forEach(e=>{ evMap[e.cod]=e.nome_evento||e.cod; evDateMap[e.cod]=e.data_evento||""; });
    const selEv = document.getElementById("vt-fil-evento");
    if(selEv.options.length===1){
      [...new Set(vtRows.map(r=>r.cod_evento).filter(Boolean))].sort().forEach(c=>{
        const o=document.createElement("option"); o.value=c; o.textContent=evMap[c]||c; selEv.appendChild(o);
      });
    }
    let rows = vtRows;
    // Filtro de período baseia na data_vt da própria visita
    if(_vtPer==="futuros")  rows = rows.filter(r=> r.data_vt && r.data_vt >= hojeStr);
    if(_vtPer==="passados") rows = rows.filter(r=>!r.data_vt || r.data_vt < hojeStr);
    if(evFil) rows = rows.filter(r=>r.cod_evento===evFil);
    if(!rows.length){ wr.innerHTML='<div class="empty"><div class="eicon">🔍</div>Nenhuma visita técnica encontrada.</div>'; return; }
    wr.innerHTML=`<div class="table-wrap"><table class="fin-table">
      <thead><tr><th>Data VT</th><th>Evento</th><th>Data Evento</th><th></th></tr></thead>
      <tbody>${rows.map(r=>{
        const rj=_esc(JSON.stringify(r));
        const dataEv = evDateMap[r.cod_evento];
        const isFut = r.data_vt && r.data_vt >= hojeStr;
        return`<tr>
          <td style="font-weight:700;color:${isFut?"#2A6644":"var(--dl)"};">${r.data_vt?fmtDate(r.data_vt):"—"}</td>
          <td>${evMap[r.cod_evento]||r.cod_evento||"—"}</td>
          <td style="color:var(--dl);">${dataEv?fmtDate(dataEv):"—"}</td>
          <td><div class="row-acts"><button class="act-btn" onclick='openVTModal(JSON.parse(this.dataset.r))' data-r="${rj}">✏️</button></div></td>
        </tr>`;
      }).join("")}</tbody>
    </table></div>`;
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro: '+e.message+'</div>'; }
}

function closeVTModal() { document.getElementById("m-vt").classList.remove("open"); }

async function _vtLoadFornec() {
  // Fornecedores de evento já carregados no openVTModal; sem ação adicional aqui
}

function _vtGetTipos() {
  const fromDB = _vtFornecList.map(f=>f.tipo_servico).filter(Boolean);
  return [...new Set([..._VT_TIPOS_BASE, ...fromDB])].sort();
}

function _vtFornecDoTipo(tipo) {
  if(!tipo) return _vtFornecList;
  return _vtFornecList.filter(f=>f.tipo_servico===tipo);
}

function _vtAddLinha(ln={}) {
  const wrap = document.getElementById("vtm-linhas");
  const div = document.createElement("div");
  div.style.cssText="background:var(--bg2,#f8f9fa);border:1px solid var(--br);border-radius:10px;padding:12px;";
  div.dataset.id = ln.id||"";

  const tipos = _vtGetTipos();
  const tipoOpts = tipos.map(t=>`<option value="${t}" ${ln.tipo_fornecedor===t?"selected":""}>${t}</option>`).join("");

  // Ao carregar linha existente com código salvo, mostra todos os fornecedores para garantir que o selecionado apareça
  const fornecsFiltrados = ln.fornecedor_cod ? _vtFornecList : _vtFornecDoTipo(ln.tipo_fornecedor||"");
  const fornecOpts = fornecsFiltrados.map(f=>`<option value="${f.codigo}" ${ln.fornecedor_cod===f.codigo?"selected":""}>${f.nome||f.codigo}</option>`).join("");

  div.innerHTML=`
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;align-items:end;margin-bottom:8px;">
      <div>
        <label class="lbl">Tipo de Serviço</label>
        <select class="inp vtm-tipo" style="margin-bottom:0;" onchange="_vtTipoChange(this)">
          <option value="">— Selecione o tipo —</option>
          ${tipoOpts}
        </select>
      </div>
      <div>
        <label class="lbl">Fornecedor</label>
        <select class="inp vtm-forn-sel" style="margin-bottom:0;" onchange="_vtFornSelChange(this)">
          <option value="">— Selecione o fornecedor —</option>
          ${fornecOpts}
          <option value="__novo__">+ Adicionar novo</option>
        </select>
        <div class="vtm-novo-wrap" style="display:none;margin-top:6px;background:var(--al,#e8f4f8);border:1px solid var(--a);border-radius:8px;padding:10px;">
          <div style="font-size:11px;font-weight:600;color:var(--a);margin-bottom:6px;">Novo fornecedor</div>
          <input class="inp vtm-forn-nome" type="text" placeholder="Nome do fornecedor" style="margin-bottom:8px;" value=""/>
          <select class="inp vtm-novo-tipo" style="margin-bottom:8px;">
            <option value="">— Tipo de serviço (opcional) —</option>
            ${_VT_TIPOS_BASE.map(t=>`<option value="${t}">${t}</option>`).join("")}
          </select>
          <div style="display:flex;gap:6px;">
            <button class="btn" style="font-size:12px;padding:5px 14px;" onclick="_vtConfirmNovoForn(this)">✔ Confirmar</button>
            <button class="btn" style="font-size:12px;padding:5px 14px;background:var(--dm);" onclick="_vtCancelNovoForn(this)">✕ Cancelar</button>
          </div>
        </div>
      </div>
    </div>
    <div>
      <label class="lbl">Observações</label>
      <textarea class="inp vtm-obs" rows="3" maxlength="2000" style="margin-bottom:0;resize:vertical;" placeholder="Observações sobre este fornecedor na VT...">${ln.obs||""}</textarea>
    </div>
    <div style="display:flex;justify-content:flex-end;margin-top:6px;">
      <button class="btn-delete" style="font-size:11px;padding:3px 10px;" onclick="this.closest('[data-id]').remove()">🗑 Remover</button>
    </div>`;

  if(!ln.fornecedor_cod && ln.nome_fornecedor) {
    div.querySelector(".vtm-forn-sel").value="__novo__";
    div.querySelector(".vtm-forn-nome").style.display="block";
  }
  wrap.appendChild(div);
}

function _vtTipoChange(sel) {
  const div = sel.closest("[data-id]");
  const tipo = sel.value;
  const fornecSel = div.querySelector(".vtm-forn-sel");
  const fornecs = _vtFornecDoTipo(tipo);
  const opts = fornecs.map(f=>`<option value="${f.codigo}">${f.nome||f.codigo}</option>`).join("");
  fornecSel.innerHTML = `<option value="">— Selecione o fornecedor —</option>${opts}<option value="__novo__">+ Adicionar novo</option>`;
  const wrap = div.querySelector(".vtm-novo-wrap");
  wrap.style.display="none";
  div.querySelector(".vtm-forn-nome").value="";
}

function _vtFornSelChange(sel) {
  const div = sel.closest("[data-id]");
  const wrap = div.querySelector(".vtm-novo-wrap");
  if(sel.value==="__novo__"){
    wrap.style.display="block";
    div.querySelector(".vtm-forn-nome").focus();
  } else {
    wrap.style.display="none";
    div.querySelector(".vtm-forn-nome").value="";
  }
}

function _vtCancelNovoForn(btn) {
  const div = btn.closest("[data-id]");
  div.querySelector(".vtm-novo-wrap").style.display="none";
  div.querySelector(".vtm-forn-nome").value="";
  div.querySelector(".vtm-forn-sel").value="";
}

async function _vtConfirmNovoForn(btn) {
  const div = btn.closest("[data-id]");
  const nome = div.querySelector(".vtm-forn-nome").value.trim();
  if(!nome){ toast("Digite o nome do fornecedor."); return; }
  // Tipo: primeiro do form do novo fornecedor, depois da linha, depois null
  const tipoNovoEl = div.querySelector(".vtm-novo-tipo");
  const tipo = (tipoNovoEl?.value||div.querySelector(".vtm-tipo").value||null)||null;
  btn.disabled=true; btn.textContent="Salvando...";
  try {
    // Gera próximo código sequencial para fornecedores (busca todos e calcula max numérico)
    const { data: { session } } = await _sb.auth.getSession();
    const token = session?.access_token || _authToken;
    const fnRes = await fetch(SB_URL+"/functions/v1/dea334eb-2f35-4075-a5ee-215f7aa19b8c",{
      method:"POST",
      headers:{"apikey":SB_KEY,"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({nome,tipo_servico:tipo||undefined})
    });
    const fnData = await fnRes.json();
    if(!fnRes.ok || !fnData.ok) throw new Error(fnData.error||"Erro ao criar fornecedor");
    const novoCod = fnData.fornecedor?.codigo || String(Date.now());
    // Adiciona ao cache local
    const novoForn = {codigo:novoCod, nome, tipo_servico:tipo};
    _vtFornecList.push(novoForn);
    _vtFornecList.sort((a,b)=>(a.nome||"").localeCompare(b.nome||""));
    // Se tipo foi selecionado no form do novo fornecedor, atualiza o select da linha também
    if(tipo) div.querySelector(".vtm-tipo").value = tipo;
    // Reconstrói o select de fornecedores filtrado pelo tipo e seleciona o novo
    const fornecSel = div.querySelector(".vtm-forn-sel");
    const fornecs = _vtFornecDoTipo(tipo||"");
    const opts = fornecs.map(f=>`<option value="${f.codigo}" ${f.codigo===novoCod?"selected":""}>${f.nome||f.codigo}</option>`).join("");
    fornecSel.innerHTML = `<option value="">— Selecione o fornecedor —</option>${opts}<option value="__novo__">+ Adicionar novo</option>`;
    fornecSel.value = novoCod;
    div.querySelector(".vtm-novo-wrap").style.display="none";
    div.querySelector(".vtm-forn-nome").value="";
    toast("✅ Fornecedor "+nome+" adicionado!");
  } catch(e){ toast("Erro ao salvar fornecedor: "+e.message); }
  finally { btn.disabled=false; btn.textContent="✔ Confirmar"; }
}

async function openVTModal(vt) {
  try {
    _vtId = vt ? vt.id : null;
    document.getElementById("vt-modal-title").textContent = vt ? "Editar Visita Técnica" : "Nova Visita Técnica";
    document.getElementById("vtm-data").value = vt?.data_vt||"";
    document.getElementById("vtm-linhas").innerHTML="";
    const sel = document.getElementById("vtm-evento");
    sel.innerHTML='<option value="">— Selecione o evento —</option>';
    // Abre o modal imediatamente, carrega dados em seguida
    document.getElementById("m-vt").classList.add("open");
    const hojeVT = new Date().toISOString().slice(0,10);
    const evts = await dbGet("agenda","select=cod,nome_evento&data_evento=gte."+hojeVT+"&order=data_evento.asc&limit=500");
    evts.forEach(e=>{ const o=document.createElement("option"); o.value=e.cod; o.textContent=(e.nome_evento||e.cod); if(vt&&e.cod===vt.cod_evento)o.selected=true; sel.appendChild(o); });
    try {
      _vtFornecList = await dbGet("fornecedores","select=codigo,nome,tipo_servico&order=nome.asc&limit=500");
    } catch(fe){ _vtFornecList=[]; }
    _vtLinhaOrigIds = new Set();
    if(_vtId) {
      const linhas = await dbGet("vt_linhas","vt_id=eq."+_vtId+"&order=id.asc&limit=100");
      linhas.forEach(ln=>{ _vtLinhaOrigIds.add(ln.id); _vtAddLinha(ln); });
    }
  } catch(e) {
    toast("Erro ao abrir VT: "+e.message);
  }
}

async function saveVT() {
  const btn = document.getElementById("vtm-btn-save");
  btn.disabled=true; btn.textContent="Salvando...";
  try {
    const cod_evento = document.getElementById("vtm-evento").value;
    const data_vt = document.getElementById("vtm-data").value||null;
    if(!cod_evento){ toast("Selecione um evento."); return; }
    let vtId = _vtId;
    if(vtId) {
      await dbUpdate("visitas_tecnicas","id=eq."+vtId,{cod_evento,data_vt});
    } else {
      const res = await sbFetch("visitas_tecnicas",{method:"POST",body:{cod_evento,data_vt},prefer:"return=representation"});
      vtId = Array.isArray(res)?res[0]?.id:res?.id;
    }
    // Separa linhas existentes (com id) das novas (sem id)
    const linhaEls = document.querySelectorAll("#vtm-linhas [data-id]");
    const presentIds = new Set();
    const toInsert = [], toUpdate = [];
    linhaEls.forEach(div => {
      const id = div.dataset.id;
      const fornecedor_cod = (()=>{ const v=div.querySelector(".vtm-forn-sel").value; return(v&&v!=="__novo__")?v:null; })();
      const nome_fornecedor = (()=>{ const s=div.querySelector(".vtm-forn-sel").value; return s==="__novo__"?div.querySelector(".vtm-forn-nome").value.trim()||null:null; })();
      const tipo_fornecedor = div.querySelector(".vtm-tipo").value||null;
      const obs = div.querySelector(".vtm-obs").value.trim()||null;
      if(id) { presentIds.add(id); toUpdate.push({id, fornecedor_cod, nome_fornecedor, tipo_fornecedor, obs}); }
      else if(fornecedor_cod||nome_fornecedor||tipo_fornecedor||obs) toInsert.push({fornecedor_cod, nome_fornecedor, tipo_fornecedor, obs, vt_id:vtId});
    });
    // DELETE linhas que o usuário removeu (estavam no BD mas saíram do DOM)
    const toDelete = [..._vtLinhaOrigIds].filter(id=>!presentIds.has(id));
    for(const id of toDelete) await sbFetch("vt_linhas?id=eq."+id,{method:"DELETE",prefer:"return=minimal"});
    // UPDATE linhas existentes (tipo, obs podem ter mudado)
    for(const {id,...data} of toUpdate) await sbFetch("vt_linhas?id=eq."+id,{method:"PATCH",body:data,prefer:"return=minimal"});
    // INSERT novas linhas
    if(toInsert.length) await sbFetch("vt_linhas",{method:"POST",body:toInsert,prefer:"return=minimal"});
    closeVTModal(); renderVT(); toast("✅ Visita técnica salva!");
  } catch(e){ toast("Erro: "+e.message); }
  finally { btn.disabled=false; btn.textContent="Salvar"; }
}

// ══════════════════════════════════════════
// TABELAS DE PREÇO
// ══════════════════════════════════════════
let _tpId = null, _tpInvItems = [];

// ── helpers de linha de item (usados tanto em grupos quanto em avulsos) ──
function _tpItemOpts(codSelecionado) {
  return _tpInvItems.map(inv=>{
    const sel = inv.cod===codSelecionado?"selected":"";
    return `<option value="${inv.cod}" data-desc="${(inv.descricao||"").replace(/"/g,"&quot;")}" data-vun="${inv.valor_unitario||0}" ${sel}>${inv.cod} — ${inv.descricao||""}</option>`;
  }).join("");
}

function _tpMakeItemRow(it={}, tbody) {
  const tr = document.createElement("tr");
  tr.dataset.id = it.id||"";
  tr.dataset.grupoId = it.grupo_id||"";
  const vun = it.valor_unitario!=null ? it.valor_unitario : "";
  tr.innerHTML=`
    <td style="min-width:180px;"><select class="inp tp-sel-cod" style="margin:0;width:100%;" onchange="_tpSelItem(this)">
      <option value="">— Selecione —</option>${_tpItemOpts(it.cod_item||"")}
    </select></td>
    <td class="tp-descr" style="font-size:12px;color:var(--dm);">${(_tpInvItems.find(x=>x.cod===it.cod_item)||{}).descricao||it.descricao||""}</td>
    <td><input class="inp tp-vun" type="number" step="0.01" min="0" placeholder="0,00" value="${vun}" style="margin:0;width:110px;text-align:right;"/></td>
    <td><button class="act-btn" onclick="this.closest('tr').remove();_tpGrupoRecalc(this)">🗑</button></td>`;
  tbody.appendChild(tr);
}

function _tpSelItem(sel) {
  const tr = sel.closest("tr");
  const opt = sel.options[sel.selectedIndex];
  tr.querySelector(".tp-descr").textContent = opt ? opt.dataset.desc||"" : "";
  const vunInp = tr.querySelector(".tp-vun");
  if(!vunInp.value) vunInp.value = opt ? parseFloat(opt.dataset.vun)||"" : "";
  _tpGrupoRecalc(sel);
}

function _tpGrupoRecalc(el) {
  const grupo = el.closest(".tp-grupo");
  if(!grupo) return;
  const rows = Array.from(grupo.querySelectorAll(".tp-grupo-body tr"));
  const sub = rows.reduce((s,tr)=>s+(parseFloat(tr.querySelector(".tp-vun").value)||0),0);
  const desc = parseFloat(grupo.querySelector(".tp-grupo-desc").value)||0;
  grupo.querySelector(".tp-grupo-sub").textContent  = fmt(sub);
  grupo.querySelector(".tp-grupo-total").textContent = fmt(Math.max(0,sub-desc));
}

// ── grupos (pacotes) ──
function _tpAddGrupo(g={}, itens=[]) {
  const wrap = document.getElementById("tpm-grupos-wrap");
  const div = document.createElement("div");
  div.className = "tp-grupo";
  div.dataset.id = g.id||"";
  div.style.cssText = "border:1px solid var(--a);border-radius:10px;overflow:hidden;";
  div.innerHTML = `
    <div style="background:var(--al,#e8f4f8);padding:10px 14px;display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
      <input class="inp tp-grupo-nome" placeholder="Nome do pacote" value="${g.nome||""}"
        style="margin:0;font-weight:700;flex:1;min-width:160px;"/>
      <div style="display:flex;align-items:center;gap:6px;white-space:nowrap;">
        <label class="lbl" style="margin:0;">Desconto R$</label>
        <input class="inp tp-grupo-desc" type="number" step="0.01" min="0" placeholder="0,00"
          value="${g.desconto!=null?g.desconto:""}"
          style="margin:0;width:110px;text-align:right;" oninput="_tpGrupoRecalc(this)"/>
      </div>
      <button class="act-btn" title="Remover pacote" onclick="this.closest('.tp-grupo').remove()">🗑</button>
    </div>
    <div style="overflow-x:auto;">
      <table class="fin-table" style="margin:0;">
        <thead><tr><th style="min-width:180px;">Item</th><th>Descrição</th><th style="width:120px;">Valor Unit.</th><th style="width:40px;"></th></tr></thead>
        <tbody class="tp-grupo-body"></tbody>
      </table>
    </div>
    <div style="padding:8px 14px;display:flex;align-items:center;justify-content:space-between;border-top:1px solid var(--br);background:var(--bg2,#f8f9fa);">
      <button class="btn-cancel" style="font-size:11px;padding:3px 10px;" onclick="_tpAddItemGrupo(this)">+ Item</button>
      <div style="font-size:12px;color:var(--dm);display:flex;gap:16px;">
        <span>Subtotal: <b class="tp-grupo-sub">R$ 0,00</b></span>
        <span>Desconto: <b style="color:var(--err,#c00);">− R$ <span class="tp-grupo-desc-show">0,00</span></b></span>
        <span>Total: <b style="color:var(--a);" class="tp-grupo-total">R$ 0,00</b></span>
      </div>
    </div>`;
  // Sincroniza desconto-show ao digitar
  div.querySelector(".tp-grupo-desc").addEventListener("input", function(){
    div.querySelector(".tp-grupo-desc-show").textContent = parseFloat(this.value||0).toLocaleString("pt-BR",{minimumFractionDigits:2});
  });
  const tbody = div.querySelector(".tp-grupo-body");
  itens.forEach(it=>_tpMakeItemRow(it, tbody));
  if(!itens.length) _tpMakeItemRow({}, tbody);
  wrap.appendChild(div);
  _tpGrupoRecalc(div.querySelector(".tp-grupo-desc"));
}

function _tpAddItemGrupo(btn) {
  const tbody = btn.closest(".tp-grupo").querySelector(".tp-grupo-body");
  _tpMakeItemRow({}, tbody);
}

// ── itens avulsos ──
function _tpAddItem(it={}) {
  _tpMakeItemRow(it, document.getElementById("tpm-itens-body"));
}

// ── modal open/close ──
async function openTpModal(tp) {
  _tpId = tp ? tp.id : null;
  document.getElementById("tp-modal-title").textContent = tp ? "Editar Tabela de Preço" : "Nova Tabela de Preço";
  document.getElementById("tpm-nome").value = tp?.nome||"";
  document.getElementById("tpm-desc").value = tp?.descricao||"";
  document.getElementById("tpm-grupos-wrap").innerHTML = "";
  document.getElementById("tpm-itens-body").innerHTML = "";
  document.getElementById("m-tp").classList.add("open");
  try { _tpInvItems = await dbGet("inventario","select=cod,descricao,valor_unitario&order=descricao.asc&limit=500"); } catch(e){ _tpInvItems=[]; }
  if(tp) {
    const [grupos, itens] = await Promise.all([
      dbGet("tabelas_preco_grupos","tabela_id=eq."+tp.id+"&order=ordem.asc,id.asc&limit=100"),
      dbGet("tabelas_preco_itens","tabela_id=eq."+tp.id+"&order=id.asc&limit=1000"),
    ]);
    const itensByGrupo = {};
    const avulsos = [];
    itens.forEach(it=>{ if(it.grupo_id){ if(!itensByGrupo[it.grupo_id])itensByGrupo[it.grupo_id]=[]; itensByGrupo[it.grupo_id].push(it); } else { avulsos.push(it); } });
    grupos.forEach(g=>_tpAddGrupo(g, itensByGrupo[g.id]||[]));
    avulsos.forEach(it=>_tpAddItem(it));
  }
}

function closeTpModal() { document.getElementById("m-tp").classList.remove("open"); }

// ── save ──
async function saveTp() {
  const btn = document.getElementById("tpm-btn-save");
  btn.disabled=true; btn.textContent="Salvando...";
  try {
    const nome = document.getElementById("tpm-nome").value.trim();
    if(!nome){ toast("Informe o nome da tabela."); return; }
    const descricao = document.getElementById("tpm-desc").value.trim()||null;
    let tpId = _tpId;
    if(tpId) {
      await dbUpdate("tabelas_preco","id=eq."+tpId,{nome,descricao});
    } else {
      const res = await sbFetch("tabelas_preco",{method:"POST",body:{nome,descricao},prefer:"return=representation"});
      tpId = Array.isArray(res)?res[0]?.id:res?.id;
    }
    // Apaga tudo e reinsere
    await sbFetch("tabelas_preco_itens?tabela_id=eq."+tpId,{method:"DELETE",prefer:"return=minimal"});
    await sbFetch("tabelas_preco_grupos?tabela_id=eq."+tpId,{method:"DELETE",prefer:"return=minimal"});
    // Salva grupos
    const grupoDivs = Array.from(document.querySelectorAll("#tpm-grupos-wrap .tp-grupo"));
    for(let i=0;i<grupoDivs.length;i++){
      const div = grupoDivs[i];
      const gnome = div.querySelector(".tp-grupo-nome").value.trim();
      if(!gnome) continue;
      const gdesc = parseFloat(div.querySelector(".tp-grupo-desc").value)||0;
      const gRes = await sbFetch("tabelas_preco_grupos",{method:"POST",body:{tabela_id:tpId,nome:gnome,desconto:gdesc,ordem:i+1},prefer:"return=representation"});
      const gId = Array.isArray(gRes)?gRes[0]?.id:gRes?.id;
      const gRows = Array.from(div.querySelectorAll(".tp-grupo-body tr")).map(tr=>({
        tabela_id:tpId, grupo_id:gId,
        cod_item: tr.querySelector(".tp-sel-cod").value||null,
        descricao: tr.querySelector(".tp-descr").textContent.trim()||null,
        valor_unitario: parseFloat(tr.querySelector(".tp-vun").value)||null,
      })).filter(r=>r.cod_item);
      if(gRows.length) await sbFetch("tabelas_preco_itens",{method:"POST",body:gRows,prefer:"return=minimal"});
    }
    // Salva itens avulsos
    const avulsos = Array.from(document.getElementById("tpm-itens-body").rows).map(tr=>({
      tabela_id:tpId,
      cod_item: tr.querySelector(".tp-sel-cod").value||null,
      descricao: tr.querySelector(".tp-descr").textContent.trim()||null,
      valor_unitario: parseFloat(tr.querySelector(".tp-vun").value)||null,
    })).filter(r=>r.cod_item);
    if(avulsos.length) await sbFetch("tabelas_preco_itens",{method:"POST",body:avulsos,prefer:"return=minimal"});
    closeTpModal();
    renderTabelasPreco();
    toast("✅ Tabela salva!");
  } catch(e){ toast("Erro: "+e.message); }
  finally { btn.disabled=false; btn.textContent="Salvar"; }
}

// ── render lista ──
async function renderTabelasPreco() {
  const wr = document.getElementById("tp-list");
  wr.innerHTML = '<div class="empty"><div class="eicon">⏳</div>Carregando...</div>';
  try {
    const tabelas = await dbGet("tabelas_preco","order=id.desc&limit=200");
    if(!tabelas.length){ wr.innerHTML='<div class="empty"><div class="eicon">💲</div>Nenhuma tabela de preço criada.</div>'; return; }
    const ids = tabelas.map(t=>t.id);
    const [grupos, itens] = await Promise.all([
      dbGet("tabelas_preco_grupos","tabela_id=in.("+ids.join(",")+")"+"&order=ordem.asc,id.asc&limit=1000"),
      dbGet("tabelas_preco_itens","tabela_id=in.("+ids.join(",")+")"+"&order=id.asc&limit=5000"),
    ]);
    const gruposByTabela = {};
    grupos.forEach(g=>{ if(!gruposByTabela[g.tabela_id])gruposByTabela[g.tabela_id]=[]; gruposByTabela[g.tabela_id].push(g); });
    const itensByGrupo = {};
    const avulsosByTabela = {};
    itens.forEach(it=>{
      if(it.grupo_id){ if(!itensByGrupo[it.grupo_id])itensByGrupo[it.grupo_id]=[]; itensByGrupo[it.grupo_id].push(it); }
      else { if(!avulsosByTabela[it.tabela_id])avulsosByTabela[it.tabela_id]=[]; avulsosByTabela[it.tabela_id].push(it); }
    });
    wr.innerHTML = tabelas.map(t=>{
      const criado = t.created_at ? new Date(t.created_at).toLocaleDateString("pt-BR") : "—";
      const tGrupos = gruposByTabela[t.id]||[];
      const tAvulsos = avulsosByTabela[t.id]||[];
      const gruposHtml = tGrupos.map(g=>{
        const its = itensByGrupo[g.id]||[];
        const sub = its.reduce((s,it)=>s+(it.valor_unitario||0),0);
        const total = Math.max(0,sub-(g.desconto||0));
        const linhas = its.map(it=>`<tr>
          <td style="color:var(--dl);font-weight:600;">${it.cod_item||"—"}</td>
          <td>${it.descricao||"—"}</td>
          <td style="text-align:right;">${it.valor_unitario!=null?fmt(it.valor_unitario):"—"}</td>
        </tr>`).join("");
        return `<div style="border:1px solid var(--a);border-radius:10px;margin-bottom:10px;overflow:hidden;">
          <div style="background:var(--al,#e8f4f8);padding:10px 14px;font-weight:700;font-size:13px;color:var(--dk);">📦 ${g.nome||"Pacote"}</div>
          <div class="table-wrap" style="margin:0;"><table class="fin-table" style="margin:0;">
            <thead><tr><th>Código</th><th>Descrição</th><th style="text-align:right;">Valor Unit.</th></tr></thead>
            <tbody>${linhas}</tbody>
          </table></div>
          <div style="padding:8px 14px;background:var(--bg2,#f8f9fa);border-top:1px solid var(--br);display:flex;justify-content:flex-end;gap:20px;font-size:12px;">
            <span>Subtotal: <b>${fmt(sub)}</b></span>
            <span style="color:var(--err,#c00);">Desconto: <b>− ${fmt(g.desconto||0)}</b></span>
            <span style="color:var(--a);">Total: <b>${fmt(total)}</b></span>
          </div>
        </div>`;
      }).join("");
      const avulsosHtml = tAvulsos.length ? `
        <div style="margin-top:10px;">
          <div style="font-weight:600;font-size:12px;color:var(--dm);margin-bottom:6px;">Itens avulsos</div>
          <div class="table-wrap" style="margin:0;border:1px solid var(--br);border-radius:10px;overflow:hidden;">
            <table class="fin-table" style="margin:0;">
              <thead><tr><th>Código</th><th>Descrição</th><th style="text-align:right;">Valor Unit.</th></tr></thead>
              <tbody>${tAvulsos.map(it=>`<tr>
                <td style="color:var(--dl);font-weight:600;">${it.cod_item||"—"}</td>
                <td>${it.descricao||"—"}</td>
                <td style="text-align:right;">${it.valor_unitario!=null?fmt(it.valor_unitario):"—"}</td>
              </tr>`).join("")}</tbody>
            </table>
          </div>
        </div>` : "";
      return `<div style="background:var(--card,#fff);border:1px solid var(--br);border-radius:12px;margin-bottom:20px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid var(--br);background:var(--al,#f0f7ff);">
          <div>
            <div style="font-weight:700;font-size:15px;color:var(--dk);">${t.nome||"Sem nome"}</div>
            ${t.descricao?`<div style="font-size:12px;color:var(--dm);margin-top:2px;">${t.descricao}</div>`:""}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="font-size:11px;color:var(--dm);">Criada em ${criado}</span>
            <button class="act-btn" title="Editar" onclick='openTpModal(${JSON.stringify(t).replace(/'/g,"&#39;")})'>✏️</button>
            <button class="act-btn" title="Excluir" onclick="_tpDelete(${t.id},'${(t.nome||"").replace(/'/g,"&#39;")}')">🗑</button>
          </div>
        </div>
        <div style="padding:14px 16px;">${gruposHtml||""}${avulsosHtml||(!gruposHtml?'<div style="font-size:13px;color:var(--dm);">Nenhum item cadastrado.</div>':"")}
        </div>
      </div>`;
    }).join("");
  } catch(e){ wr.innerHTML='<div class="empty"><div class="eicon">⚠️</div>Erro: '+e.message+'</div>'; }
}

async function _tpDelete(id, nome) {
  if(!confirm("Excluir a tabela \""+nome+"\"?")) return;
  try {
    await sbFetch("tabelas_preco_itens?tabela_id=eq."+id,{method:"DELETE",prefer:"return=minimal"});
    await sbFetch("tabelas_preco_grupos?tabela_id=eq."+id,{method:"DELETE",prefer:"return=minimal"});
    await dbUpdate("tabelas_preco","id=eq."+id,{deleted_at:new Date().toISOString()});
    renderTabelasPreco();
    toast("Tabela excluída.");
  } catch(e){ toast("Erro: "+e.message); }
}
