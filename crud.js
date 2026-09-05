// ══════════════════════════════════════════
// CRUD ENGINE
// ══════════════════════════════════════════

const CRUD_CFG = {
  contas_a_receber: {
    title:"Título a Receber", pk:"id",
    fields:[
      {n:"cod_evento",    l:"Evento",         t:"lookup", src:"agenda",           vf:"cod",     df:"nome_evento", req:true},
      {n:"parcela",       l:"Parcela nº",      t:"number"},
      {n:"num_parcela",   l:"Total parcelas",  t:"number"},
      {n:"valor",         l:"Valor (R$)",      t:"decimal"},
      {n:"vencimento",    l:"Vencimento",      t:"date"},
      {n:"status",        l:"Status",          t:"select", opts:["NP","PAGO"]},
      {n:"obs",           l:"Observação",      t:"text"},
    ]
  },
  contas_a_pagar: {
    title:"Título a Pagar", pk:"id",
    fields:[
      {n:"fornecedor_cod",  l:"Fornecedor",      t:"lookup", src:"fornecedores",    vf:"codigo",  df:"nome", nullable:true, createNew:true},
      {n:"devolver_para",   l:"Devolver para",   t:"text",   nullable:true},
      {n:"natureza",        l:"Natureza",        t:"lookup", src:"naturezas",       vf:"cod",     df:"descricao"},
      {n:"centro_custo_cod",l:"Centro de Custo", t:"lookup", src:"centros_de_custo",vf:"codigo",  df:"nome", nullable:true},
      {n:"vencimento_real", l:"Vencimento",      t:"date"},
      {n:"valor",           l:"Valor (R$)",      t:"decimal"},
      {n:"status",          l:"Status",          t:"select", opts:["NP","Pago"]},
      {n:"tipo",            l:"Tipo",            t:"text"},
      {n:"obs",             l:"Observação",      t:"text"},
    ]
  },
  assessorias: {
    title:"Assessoria", pk:"cod",
    fields:[
      {n:"cod",  l:"Código", t:"text", req:true},
      {n:"nome", l:"Nome",   t:"text", req:true},
    ]
  },
  fornecedores: {
    title:"Fornecedor", pk:"codigo",
    fields:[
      {n:"codigo",       l:"Código",        t:"text", req:true},
      {n:"nome",         l:"Nome",          t:"text", req:true},
      {n:"nome_contato", l:"Contato",       t:"text"},
      {n:"telefone",     l:"Telefone",      t:"text"},
      {n:"tipo_servico", l:"Tipo de Serviço",t:"text"},
      {n:"obs",          l:"Observação",    t:"text"},
    ]
  },
  inventario: {
    title:"Item do Inventário", pk:"cod",
    fields:[
      {n:"cod",              l:"Código",                    t:"text",    req:true},
      {n:"descricao",        l:"Descrição",                 t:"text",    req:true},
      {n:"quantidade_max",   l:"Qtd. Máxima",               t:"number"},
      {n:"valor_reposicao",  l:"Valor Reposição",           t:"decimal"},
      {n:"obs",              l:"Observação",                t:"text"},
      {n:"exibir_orcamento", l:"Exibir no Orçamento",      t:"boolean"},
      {n:"imagem",           l:"Imagem (nome do arquivo)", t:"text"},
      {n:"descricao_orc",    l:"Descrição p/ Orçamento",  t:"text"},
    ]
  },
  naturezas: {
    title:"Natureza", pk:"cod",
    fields:[
      {n:"cod",      l:"Código",    t:"text", req:true},
      {n:"descricao",l:"Descrição", t:"text", req:true},
    ]
  },
  extrato_bancario: {
    // Entrada não entra aqui: uma movimentação pode pagar vários títulos,
    // então o vínculo a receber é rateio, feito em openRateio().
    title:"Associar Título ao Extrato", pk:"id_extrato_c6",
    fields:[
      {n:"titulo_a_pagar",   l:"Título a Pagar (saída)",    t:"lookup", src:"_pagar_label",   vf:"id", df:"_label", nullable:true, statusFilter:true},
    ]
  }
};

let _crudTable = null, _crudRec = null;
let _lkCache = {};   // {src: [{vf_value, label, ...}]}
let _crudAfterSave = null; // callback após salvar

function _esc(s){ return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;").replace(/</g,"&lt;"); }

async function _loadLkSrc(src) {
  if(_lkCache[src]) return _lkCache[src];
  let rows;
  if(src==="agenda")           rows = await dbGet("agenda","select=cod,nome_evento&order=data_evento.desc&limit=2000");
  else if(src==="fornecedores")rows = await dbGet("fornecedores","select=codigo,nome&order=nome.asc&limit=500");
  else if(src==="naturezas")   rows = await dbGet("naturezas","select=cod,descricao&order=descricao.asc&limit=500");
  else if(src==="centros_de_custo") rows = await dbGet("centros_de_custo","select=codigo,nome&order=nome.asc&limit=200");
  else if(src==="_pagar_label") {
    const [pags, conciliados, fornecMap] = await Promise.all([
      dbGetAll("contas_a_pagar","select=id,fornecedor_cod,natureza,valor,vencimento_real,status&valor=gt.0&order=fornecedor_cod.asc,vencimento_real.asc"),
      sbFetch("extrato_bancario?select=titulo_a_pagar&titulo_a_pagar=not.is.null&limit=5000"),
      getFornecMap()
    ]);
    const concilSet = new Set((conciliados||[]).map(e=>String(e.titulo_a_pagar)));
    const currentVal = _crudRec ? String(_crudRec["titulo_a_pagar"]||"") : "";
    rows = pags
      .filter(r=>!concilSet.has(String(r.id)) || String(r.id)===currentVal)
      .map(r=>({id:r.id, _label:`${fornecMap[r.fornecedor_cod]||r.fornecedor_cod||"Sem fornecedor"} — ${r.natureza||"?"} — ${fmt(r.valor||0)} — ${r.vencimento_real||"?"}`}));
  } else rows = [];
  _lkCache[src] = rows;
  return rows;
}

async function openCrud(tableName, rec=null, afterSave=null) {
  _crudTable = tableName;
  _crudRec = rec;
  _crudAfterSave = afterSave;
  const cfg = CRUD_CFG[tableName];
  if(!cfg) return;
  document.getElementById("crud-title").textContent = (rec?"Editar ":"Novo ") + cfg.title;
  const delBtn = document.getElementById("crud-btn-del");
  delBtn.style.display = rec?"inline-flex":"none";
  delBtn.disabled = false; delBtn.textContent = "🗑 Apagar";
  const saveBtn = document.getElementById("crud-btn-save");
  saveBtn.disabled = false; saveBtn.textContent = "Salvar";
  document.getElementById("crud-err").style.display = "none";
  document.getElementById("crud-form").innerHTML = '<div style="text-align:center;padding:20px;color:var(--dl);">Carregando...</div>';
  document.getElementById("m-crud").classList.add("open");
  // Pre-load lookups
  const lkFields = cfg.fields.filter(f=>f.t==="lookup");
  await Promise.all(lkFields.map(f=>_loadLkSrc(f.src)));
  document.getElementById("crud-form").innerHTML = _buildCrudForm(cfg.fields, rec);
}

function _buildCrudForm(fields, rec) {
  return fields.map(f=>{
    const val = rec ? (rec[f.n]??""): "";
    const req = f.req ? '<span style="color:var(--er)"> *</span>' : '';
    let inp = "";
    if(f.t==="lookup") {
      const rows = _lkCache[f.src]||[];
      const vf = f.vf, df = f.df;
      const optHtml = (f.nullable?'<option value="">— Nenhum —</option>':'')+rows.map(r=>{
        const v = String(r[vf]??r._val??"");
        const lbl = df==="_label"?r._label:(r[df]||v);
        return `<option value="${_esc(v)}" ${String(val)===v?"selected":""}>${_esc(lbl)}</option>`;
      }).join("");
      const newBtn = f.createNew ? `<button type="button" style="margin-top:4px;font-size:11px;padding:3px 10px;background:var(--al);border:1px solid var(--am);border-radius:6px;cursor:pointer;" onclick="openCrud('fornecedores',null,()=>{_lkCache['fornecedores']=null;openCrud('${_crudTable}',_crudRec,_crudAfterSave);})">+ Novo fornecedor</button>` : "";
      const statusBar = f.statusFilter ? `<div style="display:flex;gap:10px;margin-bottom:5px;font-size:12px;">
        <label style="cursor:pointer;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="lkst-np-${f.n}" checked onchange="_reloadLkStatus('${f.n}','${f.src}','${f.vf}','${f.df}',${!!f.nullable})"> NP</label>
        <label style="cursor:pointer;display:flex;align-items:center;gap:4px;"><input type="checkbox" id="lkst-pg-${f.n}" onchange="_reloadLkStatus('${f.n}','${f.src}','${f.vf}','${f.df}',${!!f.nullable})"> Pago</label>
      </div>` : "";
      inp = `${statusBar}<input class="inp inp-inline lk-search" type="text" placeholder="Filtrar..." oninput="lkFilter(this,'lksel-${f.n}')" style="margin-bottom:3px;"/>
             <select class="lk-sel" id="lksel-${f.n}">${optHtml}</select>${newBtn}`;
    } else if(f.t==="select") {
      const optHtml = (f.opts||[]).map(o=>`<option value="${o}" ${String(val)===o?"selected":""}>${o}</option>`).join("");
      inp = `<select class="inp inp-inline" id="fld-${f.n}" style="margin-bottom:0;">${optHtml}</select>`;
    } else if(f.t==="date") {
      inp = `<input class="inp inp-inline" type="date" id="fld-${f.n}" value="${_esc(String(val))}" style="margin-bottom:0;"/>`;
    } else if(f.t==="number") {
      inp = `<input class="inp inp-inline" type="number" id="fld-${f.n}" value="${val!==""?val:""}" style="margin-bottom:0;"/>`;
    } else if(f.t==="decimal") {
      inp = `<input class="inp inp-inline" type="number" step="0.01" id="fld-${f.n}" value="${val!==""?val:""}" style="margin-bottom:0;"/>`;
    } else if(f.t==="boolean") {
      inp = `<label style="display:flex;align-items:center;gap:8px;cursor:pointer;"><input type="checkbox" id="fld-${f.n}" ${val===true||val==="true"?"checked":""} style="width:16px;height:16px;accent-color:var(--a);"/><span style="font-size:13px;color:var(--dm)">${f.l}</span></label>`;
    } else {
      inp = `<input class="inp inp-inline" type="text" id="fld-${f.n}" value="${_esc(String(val))}" style="margin-bottom:0;"/>`;
    }
    return `<div style="margin-bottom:14px;"><label class="lbl">${_esc(f.l)}${req}</label>${inp}</div>`;
  }).join("") + ((!rec && ((_crudTable==="contas_a_receber")||(_crudTable==="contas_a_pagar"))) ? `
    <div style="border-top:1px solid var(--br);margin-top:12px;padding-top:12px;">
      <label class="lbl">Repetir por quantos meses?</label>
      <div style="display:flex;align-items:center;gap:10px;margin-top:6px;">
        <input type="number" id="fld-repeat-months" min="1" max="60" value="1" class="inp" style="width:80px;margin-bottom:0;"/>
        <span style="font-size:11px;color:var(--dl);">1 = sem repetição</span>
      </div>
    </div>` : "");
}

function lkFilter(inp, selId) {
  const q = inp.value.toLowerCase();
  const sel = document.getElementById(selId);
  if(!sel) return;
  Array.from(sel.options).forEach(o => {
    o.style.display = !q || o.text.toLowerCase().includes(q) ? "" : "none";
  });
}

async function _reloadLkStatus(fName, src, vf, df, nullable) {
  const npChk = document.getElementById(`lkst-np-${fName}`);
  const pgChk = document.getElementById(`lkst-pg-${fName}`);
  const showNP = npChk ? npChk.checked : true;
  const showPago = pgChk ? pgChk.checked : false;
  const sel = document.getElementById(`lksel-${fName}`);
  if(!sel) return;
  const curVal = sel.value;
  sel.innerHTML = '<option value="">— carregando... —</option>';

  let rows = [];

  if(src === "_pagar_label") {
    let q = "select=id,fornecedor_cod,natureza,valor,vencimento_real,status&valor=gt.0&order=fornecedor_cod.asc,vencimento_real.asc";
    const statuses = [showNP?"NP":null, showPago?"Pago":null].filter(Boolean);
    if(statuses.length === 1) q += `&status=eq.${statuses[0]}`;
    else if(statuses.length === 0) { sel.innerHTML = nullable?'<option value="">— Nenhum —</option>':''; return; }
    const pags = await dbGetAll("contas_a_pagar", q);
    const conciliados = await sbFetch("extrato_bancario?select=titulo_a_pagar&titulo_a_pagar=not.is.null&limit=5000");
    const concilSet = new Set((conciliados||[]).map(e=>String(e.titulo_a_pagar)));
    const currentVal = _crudRec ? String(_crudRec["titulo_a_pagar"]||"") : "";
    const fornecMap = await getFornecMap();
    rows = pags
      .filter(r=>!concilSet.has(String(r.id)) || String(r.id)===currentVal)
      .map(r=>({id:r.id, _label:`${fornecMap[r.fornecedor_cod]||r.fornecedor_cod||"Sem fornecedor"} — ${r.natureza||"?"} — ${fmt(r.valor||0)} — ${r.vencimento_real||"?"} [${r.status}]`}));
  }

  sel.innerHTML = (nullable?'<option value="">— Nenhum —</option>':'')+rows.map(r=>{
    const v = String(r[vf]??r._val??"");
    const lbl = df==="_label"?r._label:(r[df]||v);
    return `<option value="${_esc(v)}" ${curVal===v?"selected":""}>${_esc(lbl)}</option>`;
  }).join("");
}

function _addMonths(dateStr, months) {
  if(!dateStr) return null;
  const d = new Date(dateStr + "T12:00:00");
  d.setMonth(d.getMonth() + months);
  return d.toISOString().slice(0, 10);
}

function _getCrudData() {
  const cfg = CRUD_CFG[_crudTable];
  const data = {};
  for(const f of cfg.fields) {
    let v;
    if(f.t==="lookup") {
      const sel = document.getElementById("lksel-"+f.n);
      v = sel ? sel.value : null;
    } else {
      const el = document.getElementById("fld-"+f.n);
      v = el ? el.value : null;
    }
    if(v==="" || v===null) { if(!f.nullable && f.t!=="text") data[f.n]=null; else data[f.n]=null; }
    else if(f.t==="number") data[f.n] = parseInt(v)||null;
    else if(f.t==="decimal") data[f.n] = parseFloat(v)||null;
    else if(f.t==="boolean") data[f.n] = document.getElementById("fld-"+f.n)?.checked||false;
    else data[f.n] = v||null;
  }
  return data;
}

async function saveCrud() {
  const cfg = CRUD_CFG[_crudTable];
  const errEl = document.getElementById("crud-err");
  errEl.style.display="none";
  // Validate required
  for(const f of cfg.fields) {
    if(!f.req) continue;
    let v;
    if(f.t==="lookup") { const s=document.getElementById("lksel-"+f.n); v=s?s.value:""; }
    else { const e=document.getElementById("fld-"+f.n); v=e?e.value:""; }
    if(!v) { errEl.textContent="Campo obrigatório: "+f.l; errEl.style.display="block"; return; }
  }
  const btn = document.getElementById("crud-btn-save");
  btn.disabled=true; btn.textContent="Salvando...";
  try {
    const data = _getCrudData();
    if(_crudRec && _crudRec[cfg.pk]) {
      // UPDATE
      await sbFetch(_crudTable+"?"+cfg.pk+"=eq."+_crudRec[cfg.pk], {method:"PATCH", body:data, prefer:"return=minimal"});
    } else {
      // INSERT — verifica repetição por meses
      const repeatEl = document.getElementById("fld-repeat-months");
      const repeatN = repeatEl ? Math.max(1, Math.min(60, parseInt(repeatEl.value)||1)) : 1;
      if(repeatN > 1) {
        const vencField = _crudTable==="contas_a_receber" ? "vencimento" : "vencimento_real";
        const baseVenc = data[vencField];
        const registros = [];
        for(let i=0; i<repeatN; i++) {
          const rec = {...data};
          rec[vencField] = _addMonths(baseVenc, i);
          if(_crudTable==="contas_a_receber") { rec.parcela=String(i+1); rec.num_parcela=String(repeatN); }
          registros.push(rec);
        }
        await sbFetch(_crudTable, {method:"POST", body:registros, prefer:"return=minimal"});
        const t=_crudTable, cb=_crudAfterSave;
        closeCrud();
        toast(`✅ ${repeatN} títulos criados`);
        if(cb) cb(); else _refreshAfterCrud(t);
        return;
      }
      await sbFetch(_crudTable, {method:"POST", body:data, prefer:"return=minimal"});
    }
    // Invalida caches relevantes
    if(_crudTable==="fornecedores") { _fornecMap=null; _lkCache["fornecedores"]=null; }
    if(_crudTable==="naturezas")   { _naturezaMap=null; _lkCache["naturezas"]=null; }
    if(_crudTable==="inventario") { /* reset inventario cache */ }
    const t=_crudTable, cb=_crudAfterSave;
    closeCrud();
    if(cb) cb();
    else _refreshAfterCrud(t);
  } catch(e) {
    errEl.textContent = "Erro: "+e.message; errEl.style.display="block";
  } finally {
    btn.disabled=false; btn.textContent="Salvar";
  }
}

async function confirmDeleteCrud() {
  const cfg = CRUD_CFG[_crudTable];
  if(!_crudRec || !_crudRec[cfg.pk]) return;
  if(!confirm("Apagar este registro?\n\nEsta ação não pode ser desfeita.")) return;
  const btn = document.getElementById("crud-btn-del");
  btn.disabled=true; btn.textContent="Apagando...";
  try {
    if(SOFT_DELETE_TABLES.has(_crudTable)){
      await sbFetch(_crudTable+"?"+cfg.pk+"=eq."+_crudRec[cfg.pk], {method:"PATCH", body:{deleted_at: new Date().toISOString()}, prefer:"return=minimal"});
    } else {
      await sbFetch(_crudTable+"?"+cfg.pk+"=eq."+_crudRec[cfg.pk], {method:"DELETE", prefer:"return=minimal"});
    }
    if(_crudTable==="fornecedores") { _fornecMap=null; _lkCache["fornecedores"]=null; }
    if(_crudTable==="naturezas")   { _naturezaMap=null; _lkCache["naturezas"]=null; }
    const t=_crudTable;
    closeCrud();
    _refreshAfterCrud(t);
  } catch(e) {
    document.getElementById("crud-err").textContent="Erro: "+e.message;
    document.getElementById("crud-err").style.display="block";
    btn.disabled=false; btn.textContent="🗑 Apagar";
  }
}

function _refreshAfterCrud(t) {
  if(t==="contas_a_receber") renderReceber();
  else if(t==="contas_a_pagar") renderPagar();
  else if(t==="fornecedores") { _fornecMap=null; renderFornec && renderFornec(); }
  else if(t==="inventario") { _agendaTabelaCache=null; renderInventario(); }
  else if(t==="extrato_bancario") renderExtrato();
  else if(t==="naturezas") renderNaturezas();
}

function closeCrud() {
  document.getElementById("m-crud").classList.remove("open");
  _crudTable=null; _crudRec=null;
}

// ══════════════════════════════════════════
// EDITAR USUÁRIO
// ══════════════════════════════════════════
let _euId=null, _euRole=null, _euEvIds=[];

function closeEditUser() { document.getElementById("m-edit-user").classList.remove("open"); }

async function deleteUser(u) {
  if(!confirm("Remover " + u.name + "?\nEsta ação não pode ser desfeita.")) return;
  try {
    if(u.role === "admin") {
      const admins = await dbGet("app_users","role=eq.admin&status=eq.approved&select=id");
      if(admins.length <= 1) { toast("Não é possível remover: deve existir pelo menos um admin."); return; }
    }
    await sbFetch("app_users?id=eq."+u.id, {method:"DELETE", prefer:"return=minimal"});
    renderUsers();
    toast("✅ Usuário removido.");
  } catch(e) { toast("Erro ao remover: "+e.message); }
}

function _euPickRole(role, el) {
  _euRole=role;
  document.querySelectorAll("#m-edit-user .ropt").forEach(r=>r.classList.remove("sel"));
  el.classList.add("sel");
  const wrap=document.getElementById("eu-eswrap");
  const assWrap=document.getElementById("eu-assessoria-wrap");
  if(role==="admin"||role==="equipe") {
    wrap.style.display="none"; assWrap.style.display="none"; _euEvIds=[]; return;
  }
  if(role==="assessoria"){
    wrap.style.display="none"; assWrap.style.display="block"; _euEvIds=[];
  } else if(role==="cliente"||role==="fornecedor"){
    wrap.style.display="block"; assWrap.style.display="none";
    document.getElementById("eu-eslbl").textContent=role==="cliente"?"Vincular ao evento":"Vincular aos eventos";
  } else { wrap.style.display="none"; assWrap.style.display="none"; _euEvIds=[]; }
}

function _euTogEv(cod, el) {
  if(_euRole==="cliente"){
    _euEvIds=[cod];
    document.querySelectorAll("#eu-esl .esitem").forEach(i=>i.classList.remove("sel"));
    el.classList.add("sel");
  } else {
    const i=_euEvIds.indexOf(cod);
    if(i>-1){_euEvIds.splice(i,1);el.classList.remove("sel");}
    else{_euEvIds.push(cod);el.classList.add("sel");}
  }
}

async function openEditUser(u) {
  _euId=u.id; _euRole=u.role; _euEvIds=[...(u.event_ids||[])];
  document.getElementById("eu-sub").textContent="Editando: "+u.name;
  document.querySelectorAll("#m-edit-user .ropt").forEach(r=>r.classList.remove("sel"));
  const roleIdx={equipe:0,fornecedor:1,assessoria:2,cliente:3,admin:4};
  const ropts=document.querySelectorAll("#m-edit-user .ropt");
  if(ropts[roleIdx[u.role]] !== undefined) ropts[roleIdx[u.role]].classList.add("sel");
  document.getElementById("eu-senha-atual").value = u.password || "";
  document.getElementById("eu-nova-senha").value = "";
  document.getElementById("eu-senha-wrap").style.display = "none";
  const wrap=document.getElementById("eu-eswrap");
  const assWrapEu=document.getElementById("eu-assessoria-wrap");
  if(u.role==="assessoria"){
    wrap.style.display="none"; assWrapEu.style.display="block";
  } else if(u.role==="cliente"||u.role==="fornecedor"){
    wrap.style.display="block"; assWrapEu.style.display="none";
    document.getElementById("eu-eslbl").textContent=u.role==="cliente"?"Vincular ao evento":"Vincular aos eventos";
  } else { wrap.style.display="none"; assWrapEu.style.display="none"; }
  const [evts, assRows] = await Promise.all([
    dbGet("agenda","order=assessoria_cod.asc.nullslast,data_evento.desc&select=cod,nome_evento,tipo_evento,data_evento,assessoria_cod&limit=500"),
    dbGet("assessorias","select=cod,nome&order=nome.asc&limit=500")
  ]);
  const assMapLocal={}; assRows.forEach(a=>assMapLocal[a.cod]=a.nome);
  const esl=document.getElementById("eu-esl"); esl.innerHTML="";
  evts.forEach(ev=>{
    const it=document.createElement("div"); it.className="esitem"; it.dataset.id=ev.cod;
    if(_euEvIds.includes(ev.cod)) it.classList.add("sel");
    it.onclick=()=>_euTogEv(ev.cod,it);
    const assTag=ev.assessoria_cod&&assMapLocal[ev.assessoria_cod]
      ?`<span style="color:#60a5fa;font-weight:700;">${assMapLocal[ev.assessoria_cod]}</span> · `:"";
    it.innerHTML=`<div style="font-weight:700;font-size:12px;">${assTag}${ev.nome_evento||ev.cod}</div><div style="font-size:10px;color:#7A8F96;">${ev.data_evento||""} · ${getEvLabel(ev)}</div>`;
    esl.appendChild(it);
  });
  const sel=document.getElementById("eu-assessoria");
  sel.innerHTML='<option value="">— Nenhuma —</option>';
  assRows.forEach(a=>{
    const o=document.createElement("option"); o.value=a.cod; o.textContent=a.nome;
    if(a.cod===u.assessoria_cod) o.selected=true;
    sel.appendChild(o);
  });
  document.getElementById("m-edit-user").classList.add("open");
}

async function saveEditUser() {
  if(!_euRole){toast("Selecione um perfil.");return;}
  if((_euRole==="cliente"||_euRole==="fornecedor")&&!_euEvIds.length){toast("Selecione ao menos um evento.");return;}
  if(_euRole==="assessoria"&&!document.getElementById("eu-assessoria").value){toast("Selecione a assessoria.");return;}
  const btn=document.getElementById("eu-btn-save");
  btn.disabled=true; btn.textContent="Salvando...";
  try {
    const patch={role:_euRole,event_ids:_euRole==="assessoria"?[]:_euEvIds,assessoria_cod:_euRole==="assessoria"?document.getElementById("eu-assessoria").value||null:null};
    await dbUpdate("app_users","id=eq."+_euId,patch);
    // Atualizar papel e/ou senha no Supabase Auth
    const novaSenha=(document.getElementById("eu-nova-senha").value||"").trim();
    const us=await dbGet("app_users","id=eq."+_euId+"&select=email");
    if(us.length&&us[0].email){
      const authPatch={user_email:us[0].email,role:_euRole};
      if(novaSenha) authPatch.password=novaSenha;
      await fetch(SB_URL+"/functions/v1/set-user-role",{
        method:"POST",
        headers:{"apikey":SB_KEY,"Authorization":"Bearer "+_authToken,"Content-Type":"application/json"},
        body:JSON.stringify(authPatch)
      });
    }
    closeEditUser(); renderUsers(); toast("✅ Acesso atualizado!");
  } catch(e){ toast("Erro: "+e.message); }
  finally { btn.disabled=false; btn.textContent="Salvar"; }
}
