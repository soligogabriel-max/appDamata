/* ── Orçamentos Realizados ────────────────────────────────── */
const ORC_STATUS_LABEL={lead:"Lead (incompleto)",orcado:"Orçado",pendente:"Pendente",convertido:"Convertido",expirado:"Expirado"};
const ORC_STATUS_COLOR={lead:"#94a3b8",orcado:"#3b82f6",pendente:"#E8A52A",convertido:"#27ae60",expirado:"#e74c3c"};
async function renderOrcamentos(){
  const status=document.getElementById("orc-fil-status")?.value||"";
  const busca=(document.getElementById("orc-fil-busca")?.value||"").toLowerCase();
  const filDe=document.getElementById("orc-fil-de")?.value||"";
  const filAte=document.getElementById("orc-fil-ate")?.value||"";
  let q="orcamentos?order=created_at.desc&limit=200";
  if(status) q+=`&status=eq.${status}`;
  const rows=await sbFetch(q)||[];
  _orcRowsCache=rows;
  const list=document.getElementById("orc-list");
  let filtered=rows.filter(r=>{
    if(busca&&![r.nome_noiva,r.nome_noivo,r.nome_contratante,r.tipo_evento].some(v=>v&&v.toLowerCase().includes(busca))) return false;
    if(filDe&&r.data_evento&&r.data_evento<filDe) return false;
    if(filAte&&r.data_evento&&r.data_evento>filAte) return false;
    return true;
  });
  const cnt=document.getElementById("orc-count");
  if(cnt){cnt.textContent=filtered.length+" orçamento"+(filtered.length!==1?"s":"");cnt.style.display=filtered.length?"inline":"none";}
  if(!filtered.length){list.innerHTML=`<div style="padding:40px;text-align:center;color:var(--dl)">Nenhum orçamento encontrado.</div>`;return;}
  list.innerHTML=`<table style="width:100%;border-collapse:collapse;font-size:13px;">
    <thead><tr style="background:#f5f6f7;text-align:left;">
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Solicitação</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Evento</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Nome</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Tipo</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Convidados</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Valor</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Validade</th>
      <th style="padding:10px 12px;font-weight:700;color:var(--dl);">Status</th>
      <th style="padding:10px 12px;"></th>
    </tr></thead>
    <tbody>${filtered.map(r=>{
      const hoje=new Date().toISOString().slice(0,10);
      const exp=r.validade&&r.validade<hoje&&r.status==="pendente";
      const statusReal=exp?"expirado":r.status||"pendente";
      const nomes=[r.nome_noiva,r.nome_noivo].filter(Boolean).join(" e ")||r.nome_contratante||"—";
      return `<tr style="border-bottom:1px solid var(--br);">
        <td style="padding:10px 12px;">${r.created_at?r.created_at.slice(0,10).split("-").reverse().join("/"):"—"}</td>
        <td style="padding:10px 12px;">${r.data_evento?r.data_evento.split("-").reverse().join("/"):"—"}</td>
        <td style="padding:10px 12px;font-weight:600;cursor:pointer;" onclick="verOrcamento(${r.id})">${nomes}</td>
        <td style="padding:10px 12px;">${r.tipo_evento||"—"}</td>
        <td style="padding:10px 12px;text-align:center;">${r.num_convidados||"—"}</td>
        <td style="padding:10px 12px;font-weight:700;">R$ ${r.valor_total?Number(r.valor_total).toLocaleString("pt-BR",{minimumFractionDigits:2}):"—"}</td>
        <td style="padding:10px 12px;">${r.validade?r.validade.split("-").reverse().join("/"):"—"}</td>
        <td style="padding:10px 12px;"><span style="background:${ORC_STATUS_COLOR[statusReal]}22;color:${ORC_STATUS_COLOR[statusReal]};padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;">${ORC_STATUS_LABEL[statusReal]||statusReal}</span></td>
        <td style="padding:10px 12px;white-space:nowrap;display:flex;gap:5px;">
          <button onclick="verOrcamento(${r.id})" title="Ver detalhes" style="padding:4px 8px;border:1px solid var(--br);color:var(--dm);border-radius:6px;background:#fff;font-size:11px;" >👁</button>
          <button onclick="efetivarOrcamento(${r.id})" title="Efetivar → gerar contrato" style="padding:4px 9px;border:1px solid var(--a);color:#fff;background:var(--a);border-radius:6px;font-size:11px;font-weight:700;white-space:nowrap;">📄</button>
          <button onclick="editarOrcamento(${r.id})" title="Editar orçamento" style="padding:4px 8px;border:1px solid #3b82f6;color:#3b82f6;border-radius:6px;background:#fff;font-size:11px;">✏</button>
          <button onclick="excluirOrcamento(${r.id})" title="Excluir orçamento" style="padding:4px 8px;border:1px solid var(--er);color:var(--er);border-radius:6px;background:#fff;font-size:11px;">🗑</button>
        </td>
      </tr>`;
    }).join("")}</tbody>
  </table>`;
}
async function orcSetStatus(id,status){
  await sbFetch(`orcamentos?id=eq.${id}`,{method:"PATCH",body:{status}});
  renderOrcamentos();
}
let _orcDetId=null;
function verOrcamento(id){
  const row=(_orcRowsCache||[]).find(r=>r.id===id);
  if(!row) return;
  _orcDetId=id;
  const hoje=new Date().toISOString().slice(0,10);
  const exp=row.validade&&row.validade<hoje&&row.status==="pendente";
  const statusReal=exp?"expirado":row.status||"pendente";
  const nomes=[row.nome_noiva,row.nome_noivo].filter(Boolean).join(" e ")||row.nome_contratante||"—";
  const itens=row.itens||[];
  const fmt=v=>"R$ "+Number(v).toLocaleString("pt-BR",{minimumFractionDigits:2});
  const itensTpl=itens.length
    ?itens.map(i=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--br);font-size:13px;"><span>${_esc(i.descricao||i.cod||"—")}${i.qty>1?" × "+i.qty:""}</span><span style="color:var(--dm);white-space:nowrap;margin-left:12px">${i.subtotal?fmt(i.subtotal):""}</span></div>`).join("")
    :`<div style="color:var(--dl);font-size:13px;padding:8px 0;">Nenhum item registrado.</div>`;
  document.getElementById("orc-det-title").textContent=nomes;
  document.getElementById("orc-det-body").innerHTML=`
    <div style="margin-bottom:12px;"><span style="background:${ORC_STATUS_COLOR[statusReal]}22;color:${ORC_STATUS_COLOR[statusReal]};padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;">${ORC_STATUS_LABEL[statusReal]||statusReal}</span></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;margin-bottom:14px;font-size:13px;">
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Tipo</div><div style="font-weight:600;">${_esc(row.tipo_evento||"—")}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Data do evento</div><div style="font-weight:600;">${row.data_evento?row.data_evento.split("-").reverse().join("/"):"—"}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Salão</div><div style="font-weight:600;">${_esc(row.salao||"—")}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Convidados</div><div style="font-weight:600;">${row.num_convidados||"—"}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Contratante</div><div style="font-weight:600;">${_esc(row.nome_contratante||"—")}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">WhatsApp</div><div style="font-weight:600;">${_esc(row.whatsapp||"—")}</div></div>
      ${row.email?`<div style="grid-column:span 2"><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">E-mail</div><div style="font-weight:600;">${_esc(row.email)}</div></div>`:""}
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Solicitado em</div><div>${row.created_at?row.created_at.slice(0,10).split("-").reverse().join("/"):"—"}</div></div>
      <div><div style="font-size:10px;font-weight:700;color:var(--dl);text-transform:uppercase;letter-spacing:.8px;">Válido até</div><div>${row.validade?row.validade.split("-").reverse().join("/"):"—"}</div></div>
    </div>
    <div style="font-size:11px;font-weight:700;color:var(--dl);letter-spacing:1px;text-transform:uppercase;margin-bottom:6px;">Itens orçados</div>
    ${itensTpl}
    <div style="display:flex;justify-content:space-between;align-items:center;padding:12px 0;margin-top:4px;border-top:2px solid var(--br);"><span style="font-size:15px;font-weight:700;">Total</span><span style="font-size:20px;font-weight:700;color:var(--a);">${row.valor_total?fmt(row.valor_total):"—"}</span></div>
    <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap;">
      <button onclick="efetivarOrcamento(${id});closeOrcDet()" style="flex:1;padding:7px;border:1px solid var(--a);color:#fff;background:var(--a);border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">📄 Efetivar</button>
      <button onclick="orcSetStatus(${id},'convertido');closeOrcDet()" style="flex:1;padding:7px;border:1px solid #27ae60;color:#27ae60;border-radius:8px;background:#fff;font-size:12px;font-weight:700;cursor:pointer;">✓ Convertido</button>
      <button onclick="orcSetStatus(${id},'expirado');closeOrcDet()" style="flex:1;padding:7px;border:1px solid #e74c3c;color:#e74c3c;border-radius:8px;background:#fff;font-size:12px;font-weight:700;cursor:pointer;">✕ Expirado</button>
    </div>`;
  document.getElementById("m-orc-det").classList.add("open");
}
function closeOrcDet(){document.getElementById("m-orc-det").classList.remove("open");}
function editarOrcamento(id){
  closeOrcDet();
  const row=(_orcRowsCache||[]).find(r=>r.id===id);
  if(!row){toast&&toast("Orçamento não encontrado.");return;}
  const conv=parseInt(row.num_convidados)||0;
  const salao=row.salao||(conv<=100?"Bromélias":"Tumbergia");
  _orc={
    step:1,tipo_evento:row.tipo_evento||"Casamento",data_evento:row.data_evento||"",
    num_convidados:row.num_convidados||"",nome_noiva:row.nome_noiva||"",
    nome_noivo:row.nome_noivo||"",nome_contratante:row.nome_contratante||"",
    whatsapp:row.whatsapp||"",email:row.email||"",salao:salao,
    pacote_cod:row.pacote_cod||null,pacote_grupo_id:null,pacote_nome:"",
    pacote_valor:row.valor_total||0,pacote_itens_desc:"",extras:{},
    _pacotes:[],_invItems:[],valor_total:row.valor_total||0,
    _selectedItems:(row.itens||[]).map(i=>({cod_item:i.cod,descricao:i.descricao,qty:i.qty||1,valor_unitario:i.valor_unitario||0,subtotal:i.subtotal||0})),
    _subtotal:row.valor_total||0,_discount:0,_discountPkg:null,
    _saved:true,_activePkg:null,_uSel:{},_dbId:row.id,_stage:row.status||"lead"
  };
  (row.itens||[]).forEach(i=>{if(i.cod)_orc._uSel[i.cod]={qty:i.qty||1,vun:i.valor_unitario||0};});
  _orc._admin=effIsAdmin();
  _orc._valorAjustado=true;
  showSc("orcamento");
  _orcStep();
}
async function excluirOrcamento(id){
  if(!confirm("Excluir este orçamento permanentemente? Esta ação não pode ser desfeita.")) return;
  await sbFetch(`orcamentos?id=eq.${id}`,{method:"DELETE"});
  closeOrcDet();
  toast&&toast("Orçamento excluído.");
  renderOrcamentos();
}
let _orcRowsCache=[];
async function efetivarOrcamento(id){
  const orc=(_orcRowsCache||[]).find(r=>r.id===id);
  if(!orc){toast&&toast("Orçamento não encontrado.");return;}
  // Marca como convertido
  try{ await sbFetch(`orcamentos?id=eq.${id}`,{method:"PATCH",body:{status:"convertido"}}); }catch(_){}
  // Abre o gerador na aba Contratos e pré-preenche com os dados do orçamento
  setTab("contratos");
  const iframe=document.querySelector("#p-contratos iframe");
  if(iframe){
    const send=()=>iframe.contentWindow.postMessage({type:"damata_init_orcamento",orc},"*");
    if(iframe.contentDocument?.readyState==="complete") send();
    else iframe.addEventListener("load",send,{once:true});
    // garante envio mesmo se já carregado
    setTimeout(send,300);
  }
  toast&&toast("Orçamento efetivado — revise e salve o contrato.");
}

/* ── Completar Contrato (cliente, público) ────────────────── */
let _ccEvt=null;
async function abrirCompletarContrato(cod){
  showSc("completar");
  const body=document.getElementById("cc-body");
  body.innerHTML=`<div class="orc-card"><div style="text-align:center;padding:24px;color:var(--dl)">Carregando contrato…</div></div>`;
  try{
    const rows=await sbFetch(`agenda?cod=eq.${encodeURIComponent(cod)}&select=cod,nome_evento,tipo_evento,data_evento,valor_locacao,cliente_json,assinatura_status`);
    const ev=rows&&rows[0];
    if(!ev){ body.innerHTML=`<div class="orc-card"><div style="text-align:center;padding:30px;color:var(--er)">Contrato não encontrado. Confira o link.</div></div>`; return; }
    _ccEvt=ev;
    _ccRenderForm(ev);
  }catch(e){
    body.innerHTML=`<div class="orc-card"><div style="text-align:center;padding:30px;color:var(--er)">Erro ao carregar o contrato.</div></div>`;
  }
}
function _ccRenderForm(ev){
  const c=ev.cliente_json||{};
  document.getElementById("cc-body").innerHTML=`<div class="orc-card">
    <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--dk);margin-bottom:6px;">Complete seus dados</div>
    <div style="font-size:13px;color:var(--dl);margin-bottom:18px;">Contrato <strong>${ev.cod}</strong> — ${_esc(ev.nome_evento||ev.tipo_evento||'')}${ev.data_evento?(' · '+ev.data_evento.split('-').reverse().join('/')):''}</div>
    <label class="lbl">Nome completo *</label><input id="cc-nome" class="inp" value="${_esc(c.nome||'')}"/>
    <label class="lbl">CPF *</label><input id="cc-cpf" class="inp" value="${_esc(c.cpf||'')}" placeholder="000.000.000-00"/>
    <label class="lbl">RG</label><input id="cc-rg" class="inp" value="${_esc(c.rg||'')}"/>
    <label class="lbl">Endereço completo *</label><input id="cc-end" class="inp" value="${_esc(c.endereco||'')}" placeholder="Rua, nº, bairro, cidade/UF, CEP"/>
    <label class="lbl">WhatsApp * <span style="font-size:10px;color:var(--dl);font-weight:400;">(inclua código do país, ex: +55)</span></label><input id="cc-wpp" class="inp" value="${_esc(c.whatsapp||'+55 ')}" placeholder="+55 (11) 99999-9999"/>
    <label class="lbl">E-mail</label><input id="cc-email" class="inp" value="${_esc(c.email||'')}"/>
    <div id="cc-err" class="err"></div>
    <button class="orc-btn-next" style="width:100%;margin-top:8px" id="cc-btn" onclick="_ccSalvar()">Enviar e assinar por WhatsApp</button>
    <div style="font-size:11px;color:var(--dl);margin-top:10px;text-align:center">Ao enviar, você receberá o contrato para assinatura no WhatsApp informado.</div>
  </div>`;
}
async function _ccSalvar(){
  const c={
    nome:document.getElementById("cc-nome").value.trim(),
    cpf:document.getElementById("cc-cpf").value.trim(),
    rg:document.getElementById("cc-rg").value.trim(),
    endereco:document.getElementById("cc-end").value.trim(),
    whatsapp:document.getElementById("cc-wpp").value.trim(),
    email:document.getElementById("cc-email").value.trim()
  };
  const err=document.getElementById("cc-err");
  if(!c.nome||!c.cpf||!c.endereco||!c.whatsapp){err.style.display="block";err.textContent="Preencha os campos obrigatórios (*)";return;}
  const ccWppErr=validarFmtWpp(c.whatsapp);
  if(ccWppErr){err.style.display="block";err.textContent=ccWppErr;return;}
  const btn=document.getElementById("cc-btn"); btn.disabled=true; btn.textContent="Enviando…";
  try{
    await sbFetch(`agenda?cod=eq.${encodeURIComponent(_ccEvt.cod)}`,{method:"PATCH",body:{cliente_json:c,assinatura_status:"dados_preenchidos"}});
    // Retroalimenta ficha_do_evento com os dados preenchidos pelo cliente (upsert)
    sbFetch(`ficha_do_evento?on_conflict=cod`,{method:"POST",headers:{"Prefer":"resolution=merge-duplicates,return=minimal"},body:{
      cod:_ccEvt.cod, nome_contratante:c.nome, cpf:c.cpf, rg:c.rg||null,
      endereco:c.endereco, celular:c.whatsapp, email:c.email||null
    }}).catch(()=>{});
    // Fase B: aqui a Edge Function enviará o contrato ao Autentique p/ assinatura por WhatsApp
    document.getElementById("cc-body").innerHTML=`<div class="orc-card" style="text-align:center;padding:40px 24px;">
      <div style="font-size:48px;margin-bottom:16px">✅</div>
      <div style="font-family:'DM Serif Display',serif;font-size:22px;color:var(--dk);margin-bottom:12px">Dados recebidos!</div>
      <div style="font-size:14px;color:var(--dm);line-height:1.6">Em instantes você receberá o contrato para assinatura no WhatsApp <strong>${_esc(c.whatsapp)}</strong>.</div>
    </div>`;
  }catch(e){
    err.style.display="block"; err.textContent="Erro ao enviar. Tente novamente.";
    btn.disabled=false; btn.textContent="Enviar e assinar por WhatsApp";
  }
}

/* ── Orçamento Wizard ─────────────────────────────────────── */
const ORC_TIPOS=["Casamento","Aniversário","Debutante","Corporativo","Batizado","Confraternização","Outro"];

const ORC_ITEM_INFO=[
  {k:'Tumbérgia',         d:'Salão integrado à natureza · 1000m² · climatizado · até 450 pessoas · estacionamento 300 carros · inclui 10 mesas + 100 cadeiras + 3 staffs + insumos de banheiro', img:'espacotumbergia.png'},
  {k:'Bromélias',         d:'Salão rústico na antiga sede da Fazenda · 300m² · até 150 pessoas · 70 pontos de LED · inclui 10 mesas + 100 cadeiras + 3 staffs + insumos de banheiro',           img:'espacobromelias.png'},
  {k:'Peroba Rosa',       d:'Cerimônia coberta com paisagismo ou ao ar livre no gramado · até 400 pessoas · inclui 30 bancos de madeira',                                                        img:'peroba.png'},
  {k:'Casa Flamboyant',   d:'350m² para os noivos · climatizada · lavabo · cozinha americana equipada',                                                                                          img:'casaflamboyant.png'},
  {k:'Loft Flamboyant',   d:'70m² · climatizado · integrado à natureza · suíte com cama king size',                                                                                              img:'loft.jpg'},
  {k:'Suite Flamboyant 5',d:'4 camas de solteiro · ar condicionado · enxoval de cama e banho',                                                                                                  img:'suiteflamboyant5.jpg'},
  {k:'Suite Flamboyant 4',d:'3 camas de solteiro · ar condicionado · enxoval de cama e banho',                                                                                                  img:'suiteflamboyant4.jpg'},
  {k:'Suite Flamboyant 3',d:'4 camas de solteiro · ar condicionado · enxoval de cama e banho',                                                                                                  img:'suiteflamboyant3.jpg'},
  {k:'Suite Flamboyant 2',d:'Cama king size · ar condicionado · enxoval de cama e banho',                                                                                                       img:'suiteflamboyant2.jpg'},
  {k:'Suite Flamboyant 1',d:'Cama king size · ar condicionado · enxoval de cama e banho',                                                                                                       img:'suiteflamboyant1.jpg'},
  {k:'Suíte/Camarim',     d:'Suíte reservada para equipe de assessoria durante o evento',                                                                                                        img:null},
  {k:'Suite Bromélias 3', d:'Suíte quádrupla: duas camas de casal · ar condicionado · enxoval · frigobar',                                                                                      img:'bromelias3.jpg'},
  {k:'Suite Bromélias 2', d:'Suíte dupla: cama de casal · ar condicionado · enxoval · frigobar',                                                                                                img:'bromelias2.jpg'},
  {k:'Suite Bromélias 1', d:'Suíte tripla: casal + solteiro · ar condicionado · enxoval · frigobar',                                                                                            img:'bromelias1.jpg'},
  {k:'Hospedagem Flamboyant',d:'Casa Flamboyant + Loft + Suítes 1 a 5 · acomoda até 25 pessoas · 1 diária',                                                                                    img:'casaflamboyant.png'},
  {k:'Hospedagem Bromélias', d:'Suítes Bromélias 1, 2 e 3 · acomoda até 9 pessoas · enxoval · frigobar · 1 diária',                                                                            img:'bromelias1.jpg'},
  {k:'Mesas Madeira',     d:'Madeira maciça com pés de ferro · 2,20m × 1,10m · capacidade 10 pessoas por mesa',                                                                                 img:'mesas.png'},
  {k:'Bancos Madeira',    d:'Madeira maciça · 2,00m × 0,45m · capacidade 4/5 pessoas por banco',                                                                                                img:'bancos.png'},
  {k:'Bar Hexagonal',         d:'Bar hexagonal modular em madeira maciça · diâmetro 9,9m · altura 1,10m',                           img:null},
  {k:'Cadeira Tiffany',       d:'Cadeira modelo Tiffany · cor marrom Supreme',                                                        img:null},
  {k:'Staff',                 d:'Profissional de suporte durante o evento · banheiros, salão ou estacionamento · por diária',          img:null},
  {k:'Day Use Piscina',       d:'Acesso à piscina por pessoa · por dia',                                                               img:null},
  {k:'Mesa Madeira Adicional',d:'Mesa adicional além das 10 inclusas no pacote · madeira maciça com pés de ferro · 2,20m × 1,10m',   img:'mesas.png'},
  {k:'Diária Montagem',       d:'Diária para montagem ou desmontagem · dia anterior ou posterior ao evento',                          img:null},
  {k:'Staff Adicional',       d:'Staff adicional além dos inclusos no pacote · por diária',                                           img:null},
];
function _orcNorm(s){return(s||'').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g,'');}
// Token-based matching between inventory description and price-table item description
const _ORC_STOP=new Set(['de','da','do','com','e','o','a','os','as','em','para','no','na','pe','pes','x','diaria','diarias','inclusa','inclusas','adicional','alem','pacote']);
function _orcCoreTokens(s){
  return _orcNorm(s)
    .replace(/\([^)]*\)/g,' ')          // remove parentheticals like (casal king)
    .replace(/[^a-z0-9 ]/g,' ')
    .split(/\s+/)
    .filter(t=>t.length&&!_ORC_STOP.has(t));
}
function _orcMatchInv(pkgDesc){
  const pkgTokens=new Set(_orcCoreTokens(pkgDesc));
  return (_orc._invOrc||[]).find(inv=>{
    const invTokens=_orcCoreTokens(inv.descricao);
    if(!invTokens.length) return false;
    return invTokens.every(t=>pkgTokens.has(t));
  })||null;
}
// Inventory record for a price item, by cod_item (exact relation)
function _orcInvOf(item){
  if(!item) return null;
  const cod=typeof item==="object"?item.cod_item:item;
  if(cod==null) return null;
  return (_orc._invByCod||{})[cod]||null;
}
function _orcItemInfo(item){
  const inv=_orcInvOf(item);
  if(inv) return {k:inv.descricao, d:inv.descricao_orc||'', img:inv.imagem||null};
  return null;
}
// Display description: inventory is source of truth (by cod_item), fallback to stored descricao
function _orcDesc(i){const inv=_orcInvOf(i);return inv?inv.descricao:(i.descricao||'');}

// Grupos de seleção obrigatória
const ORC_GROUP_FLAM=/casa flamboyant|loft flamboyant|suite flamboyant|su[i|í]te flamboyant/i;
const ORC_GROUP_BROM=/suite brom|su[i|í]te brom/i;
function _orcGetGroup(desc){
  if(ORC_GROUP_FLAM.test(_orcNorm(desc))) return 'flam';
  if(ORC_GROUP_BROM.test(_orcNorm(desc))) return 'brom';
  return null;
}
function _orcGroupSync(changedId, checked){
  // find all loaded items and sync group
  const allItems=[...(_orc._allGroupItems||[]),...(_orc._invItems||[])];
  const changed=allItems.find(x=>x.id===changedId||String(x.id)===String(changedId));
  if(!changed) return;
  const grp=_orcGetGroup(changed.descricao||'');
  if(!grp) return;
  allItems.forEach(x=>{
    if(_orcGetGroup(x.descricao||'')===grp){
      const ck=document.getElementById('orc-ck-'+x.id);
      if(ck) ck.checked=checked;
    }
  });
}

let _orc={step:1,tipo_evento:"",data_evento:"",num_convidados:"",nome_noiva:"",nome_noivo:"",nome_contratante:"",whatsapp:"",email:"",salao:"",pacote_cod:null,pacote_grupo_id:null,pacote_nome:"",pacote_valor:0,pacote_itens_desc:"",extras:{},_pacotes:[],_invItems:[],valor_total:0,_selectedItems:[],_subtotal:0,_discount:0,_discountPkg:null,_saved:false,_activePkg:null,_uSel:{},_dbId:null,_stage:"lead"};

function abrirVisitaDirecta(){
  // Abre o modal de orçamento já no step 4 (agendamento de visita) sem exigir dados
  _orc={step:4,tipo_evento:"",data_evento:"",num_convidados:"",nome_noiva:"",nome_noivo:"",nome_contratante:"",whatsapp:"",email:"",salao:"",pacote_cod:null,pacote_grupo_id:null,pacote_nome:"",pacote_valor:0,pacote_itens_desc:"",extras:{},_pacotes:[],_invItems:[],valor_total:0,_stage:"lead",_dbId:null};
  const ov=document.getElementById("orc-overlay");
  const wrap=document.getElementById("orc-wizard-wrap");
  if(ov) ov.style.display="flex";
  // Esconde os indicadores de step (não fazem sentido sem passar pelos steps anteriores)
  const steps=document.getElementById("orc-steps-ind");
  if(steps) steps.style.display="none";
  _orcStep();
}

function abrirOrcamento(){
  _orc={step:1,tipo_evento:"",data_evento:"",num_convidados:"",nome_noiva:"",nome_noivo:"",nome_contratante:"",whatsapp:"",email:"",salao:"",pacote_cod:null,pacote_grupo_id:null,pacote_nome:"",pacote_valor:0,pacote_itens_desc:"",extras:{},_pacotes:[],_invItems:[],valor_total:0,_selectedItems:[],_subtotal:0,_discount:0,_discountPkg:null,_saved:false,_activePkg:null,_uSel:{},_dbId:null,_stage:"lead"};
  _orc._admin=false;
  showSc("orcamento");
  _orcStep();
}
// Abre o wizard de dentro do app (admin) — permite ajustar valores no resumo
function abrirOrcamentoAdmin(){
  abrirOrcamento();
  _orc._admin=effIsAdmin();
}
// Botão voltar do wizard: admin retorna ao app; público vai ao login
function _orcVoltar(){ showSc(_orc._admin?"app":"login"); }
// Admin: alterar valor total no resumo
function _orcToggleEdit(){
  const box=document.getElementById("orc-edit-box");
  if(box) box.style.display = box.style.display==="none" ? "block" : "none";
}
function _orcAplicarValor(){
  const v=parseFloat(document.getElementById("orc-edit-total").value);
  if(isNaN(v)||v<0) return;
  _orc.valor_total=v;
  _orc._valorAjustado=true;
  document.getElementById("orc-wizard-body").innerHTML=_orcHTML4();
}

function _orcStep(){
  [1,2,3,4].forEach(i=>{
    const el=document.getElementById("osi-"+i);
    if(el) el.classList.toggle("on",i===_orc.step);
  });
  const sep4=document.getElementById("osi-sep-4"), ind4=document.getElementById("osi-4");
  if(sep4) sep4.style.display=(_orc.step>=4)?"":"none";
  if(ind4) ind4.style.display=(_orc.step>=4)?"":"none";
  const body=document.getElementById("orc-wizard-body");
  if(_orc.step===1) body.innerHTML=_orcHTML1();
  else if(_orc.step===2) _orcLoadPacotes();
  else if(_orc.step===3){body.innerHTML=_orcHTML4();}
  else if(_orc.step===4) _orcLoadSlots();
}

// Insere o orçamento na 1ª passagem e atualiza nas seguintes (captura de lead)
async function _orcUpsertLead(){
  const validade=new Date(); validade.setDate(validade.getDate()+7);
  const body={
    data_evento:_orc.data_evento||null,
    nome_noiva:_orc.nome_noiva||null,
    nome_noivo:_orc.nome_noivo||null,
    nome_contratante:_orc.nome_contratante||null,
    tipo_evento:_orc.tipo_evento||null,
    num_convidados:_orc.num_convidados||null,
    salao:_orc.salao||null,
    pacote_cod:_orc.pacote_cod||null,
    itens:(_orc._selectedItems||[]).map(i=>({cod:i.cod_item,descricao:i.descricao,qty:i.qty,valor_unitario:i.valor_unitario,subtotal:i.subtotal})),
    valor_total:_orc.valor_total||null,
    validade:validade.toISOString().slice(0,10),
    whatsapp:_orc.whatsapp||null,
    email:_orc.email||null,
    status:_orc._stage||"lead",
    visitor_id: (()=>{try{return localStorage.getItem('dmv_sid');}catch(e){return null;}})()
  };
  try{
    if(_orc._dbId){
      await sbFetch("orcamentos?id=eq."+_orc._dbId,{method:"PATCH",body});
    }else{
      const r=await sbFetch("orcamentos",{method:"POST",body});
      if(r&&r[0]&&r[0].id) _orc._dbId=r[0].id;
    }
  }catch(_){}
}

function _orcNameFieldsHTML(tipo){
  const nv=_orc.nome_noiva||'', no=_orc.nome_noivo||'';
  if(tipo==='Casamento'){
    return `<label class="lbl">Nome da noiva</label>
    <input type="text" id="orc-noiva" class="inp" value="${nv}" placeholder="Primeiro nome"/>
    <label class="lbl">Nome do noivo</label>
    <input type="text" id="orc-noivo" class="inp" value="${no}" placeholder="Primeiro nome"/>`;
  }
  if(tipo==='Corporativo'||tipo==='Confraternização'){
    return `<label class="lbl">Nome da empresa</label>
    <input type="text" id="orc-noiva" class="inp" value="${nv}" placeholder="Razão social ou nome fantasia"/>`;
  }
  if(tipo==='Debutante'){
    return `<label class="lbl">Nome da debutante</label>
    <input type="text" id="orc-noiva" class="inp" value="${nv}" placeholder="Nome"/>`;
  }
  if(tipo==='Batizado'){
    return `<label class="lbl">Nome do batizando</label>
    <input type="text" id="orc-noiva" class="inp" value="${nv}" placeholder="Nome"/>`;
  }
  if(tipo==='Aniversário'){
    return `<label class="lbl">Nome do aniversariante</label>
    <input type="text" id="orc-noiva" class="inp" value="${nv}" placeholder="Nome"/>`;
  }
  return `<label class="lbl">Nome do homenageado</label>
    <input type="text" id="orc-noiva" class="inp" value="${nv}" placeholder="Nome"/>`;
}
function _orcRenderNames(){
  const nvEl=document.getElementById('orc-noiva'); if(nvEl)_orc.nome_noiva=nvEl.value.trim();
  const noEl=document.getElementById('orc-noivo'); _orc.nome_noivo=noEl?noEl.value.trim():'';
  const tipo=document.getElementById('orc-tipo').value;
  document.getElementById('orc-name-fields').innerHTML=_orcNameFieldsHTML(tipo);
}
async function _orcBuscarExistentes(){
  const raw=(document.getElementById("orc-busca-wpp")||{}).value||"";
  const wpp=raw.replace(/\D/g,"");
  const res=document.getElementById("orc-busca-res");
  if(!res) return;
  if(wpp.length<10){res.innerHTML='<div style="color:#b45309;font-size:13px;">Informe um WhatsApp válido.</div>';return;}
  res.innerHTML='<div style="color:var(--dl);font-size:13px;">Buscando…</div>';
  try{
    const q=encodeURIComponent(raw.startsWith("+")?raw:("+55"+wpp.replace(/^55/,"")));
    // tenta com + na frente e sem
    const [r1,r2]=await Promise.all([
      sbFetch("orcamentos?whatsapp=eq."+q+"&select=id,created_at,tipo_evento,data_evento,nome_contratante,valor_total,status&order=created_at.desc&limit=10"),
      sbFetch("orcamentos?whatsapp=eq."+encodeURIComponent(wpp.replace(/^55/,""))+"&select=id,created_at,tipo_evento,data_evento,nome_contratante,valor_total,status&order=created_at.desc&limit=10"),
    ]);
    const seen=new Set(); const rows=[...r1,...r2].filter(r=>{if(seen.has(r.id))return false;seen.add(r.id);return true;});
    if(!rows.length){res.innerHTML='<div style="color:var(--dl);font-size:13px;padding:8px 0;">Nenhum orçamento encontrado para este número.</div>';return;}
    res.innerHTML='<div style="font-size:12px;font-weight:700;color:var(--dk);margin-bottom:8px;">'+rows.length+' orçamento(s) encontrado(s):</div>'+rows.map(r=>{
      const d=r.data_evento?r.data_evento.split("-").reverse().join("/"):"—";
      const v=r.valor_total?("R$ "+Number(r.valor_total).toLocaleString("pt-BR",{minimumFractionDigits:2})):"—";
      const st=r.status||"lead";
      const stColor=st==="pendente"?"#2563eb":st==="aprovado"?"#16a34a":"#9ca3af";
      return`<div style="background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;margin-bottom:8px;">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;flex-wrap:wrap;">
          <div>
            <div style="font-weight:700;font-size:13px;color:var(--dk);">${_esc(r.tipo_evento||"Evento")} · ${d}</div>
            <div style="font-size:12px;color:var(--dl);margin-top:2px;">${_esc(r.nome_contratante||"")} · <span style="color:${stColor};font-weight:600;">${st}</span></div>
          </div>
          <div style="font-weight:800;font-size:14px;color:#1A4A7C;white-space:nowrap;">${v}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:10px;">
          <button onclick="_orcVerPdf('${r.id}')" style="flex:1;padding:7px 0;background:#f0f9ff;border:1.5px solid #bae6fd;border-radius:8px;color:#0369a1;font-size:12px;font-weight:700;cursor:pointer;">📄 Ver PDF</button>
          <button onclick="_orcCarregarExistente(${r.id})" style="flex:1;padding:7px 0;background:var(--a);color:#fff;border:none;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;">✏️ Editar</button>
        </div>
      </div>`;
    }).join("");
  }catch(e){res.innerHTML='<div style="color:var(--er);font-size:13px;">Erro: '+e.message+'</div>';}
}

async function _orcVerPdf(id){
  const w=window.open("","_blank");
  if(!w){alert("Permita pop-ups para visualizar o PDF.");return;}
  w.document.write('<html><body style="font-family:sans-serif;text-align:center;padding:40px;color:#666">Carregando…</body></html>');
  try{
    const resp=await fetch(SB_URL+"/functions/v1/orcamento-publico?id="+encodeURIComponent(id),{headers:{apikey:SB_KEY}});
    const html=await resp.text();
    w.document.open();
    w.document.write(html);
    w.document.close();
  }catch(e){
    w.document.open();
    w.document.write('<html><body style="font-family:sans-serif;padding:40px;color:#c00">Erro ao carregar orçamento: '+e.message+'</body></html>');
    w.document.close();
  }
}

async function _orcCarregarExistente(id){
  const res=document.getElementById("orc-busca-res");
  if(res) res.innerHTML='<div style="color:var(--dl);font-size:13px;">Carregando…</div>';
  try{
    const rows=await sbFetch("orcamentos?id=eq."+id+"&select=*&limit=1");
    const o=rows&&rows[0];
    if(!o){alert("Orçamento não encontrado.");return;}
    // Restaura _orc com os dados salvos
    _orc.tipo_evento=o.tipo_evento||""; _orc.data_evento=o.data_evento||"";
    _orc.num_convidados=o.num_convidados||""; _orc.salao=o.salao||"";
    _orc.nome_contratante=o.nome_contratante||""; _orc.nome_noiva=o.nome_noiva||""; _orc.nome_noivo=o.nome_noivo||"";
    _orc.whatsapp=o.whatsapp||""; _orc.email=o.email||"";
    _orc.pacote_cod=o.pacote_cod||null; _orc._dbId=o.id; _orc._stage=o.status||"pendente";
    const itens=Array.isArray(o.itens)?o.itens:(typeof o.itens==="string"?JSON.parse(o.itens||"[]"):[]);
    _orc._selectedItems=itens.map(i=>({cod_item:i.cod,descricao:i.descricao,qty:i.qty||1,valor_unitario:i.valor_unitario||0,subtotal:i.subtotal||0}));
    _orc._subtotal=_orc._selectedItems.reduce((a,i)=>a+(i.subtotal||0),0);
    _orc.valor_total=o.valor_total||_orc._subtotal;
    _orc._discount=Math.max(0,_orc._subtotal-_orc.valor_total);
    _orc._discountPkg=o.pacote_cod||null; _orc._saved=true;
    _orc.step=1; _orcStep();
  }catch(e){if(res) res.innerHTML='<div style="color:var(--er);font-size:13px;">Erro: '+e.message+'</div>';}
}

function _orcHTML1(){
  const curTipo=_orc.tipo_evento||ORC_TIPOS[0];
  const tipos=ORC_TIPOS.map(t=>`<option value="${t}" ${curTipo===t?"selected":""}>${t}</option>`).join("");
  return `<div class="orc-card" style="background:#f0f7f0;border:1.5px solid #c8e6c9;margin-bottom:12px;">
    <div style="font-size:14px;font-weight:700;color:#2A6644;margin-bottom:8px;">🔍 Já fez um orçamento conosco?</div>
    <div style="font-size:13px;color:#555;margin-bottom:12px;">Coloque seu WhatsApp cadastrado e veja seus orçamentos.</div>
    <div style="display:flex;gap:8px;align-items:flex-start;">
      <input type="tel" id="orc-busca-wpp" class="inp" placeholder="+55 (11) 99999-9999" style="margin-bottom:0;flex:1;" onkeydown="if(event.key==='Enter')_orcBuscarExistentes()"/>
      <button onclick="_orcBuscarExistentes()" style="padding:10px 16px;background:#2A6644;color:#fff;border:none;border-radius:10px;font-weight:700;font-size:13px;cursor:pointer;white-space:nowrap;">Buscar</button>
    </div>
    <div id="orc-busca-res" style="margin-top:10px;"></div>
  </div>
  <div style="text-align:center;color:var(--dl);font-size:12px;font-weight:600;letter-spacing:.5px;margin:4px 0 12px;">— ou faça um novo orçamento —</div>
  <div class="orc-card">
    <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--dk);margin-bottom:20px;">Conte-nos sobre o seu evento</div>
    <label class="lbl">Tipo de evento *</label>
    <select id="orc-tipo" class="inp" onchange="_orcRenderNames()">${tipos}</select>
    <label class="lbl">Data do evento *</label>
    <input type="date" id="orc-data" class="inp" value="${_orc.data_evento}" min="${new Date().toISOString().slice(0,10)}" onchange="_orcCheckDataConflito()"/>
    <div id="orc-warn-data" style="display:none;color:#b45309;font-size:12px;margin:-10px 0 14px;"></div>
    <label class="lbl">Número de convidados *</label>
    <input type="number" id="orc-conv" class="inp" value="${_orc.num_convidados}" placeholder="ex: 80" min="1" max="450"/>
    <div id="orc-name-fields">${_orcNameFieldsHTML(curTipo)}</div>
    <label class="lbl">Nome do contratante *</label>
    <input type="text" id="orc-cont" class="inp" value="${_orc.nome_contratante}" placeholder="Nome completo"/>
    <label class="lbl">WhatsApp * <span style="font-size:10px;color:var(--dl);font-weight:400;">(inclua código do país, ex: +55)</span></label>
    <input type="tel" id="orc-wpp" class="inp" value="${_orc.whatsapp||'+55 '}" placeholder="+55 (11) 99999-9999"/>
    <label class="lbl">E-mail</label>
    <input type="email" id="orc-email" class="inp" value="${_orc.email}" placeholder="seu@email.com"/>
    <div id="orc-err1" class="err"></div>
  </div>
  <div class="orc-nav">
    <button class="orc-btn-next" onclick="_orcNext1()">Próximo →</button>
  </div>`;
}

async function _orcCheckDataConflito(){
  const data=document.getElementById("orc-data").value;
  const warn=document.getElementById("orc-warn-data");
  if(!data){warn.style.display="none";return;}
  try{
    const conflito=await checkDateConflict(data,data,null);
    if(conflito){
      warn.style.display="block";
      warn.textContent="⚠️ Já existe um evento próximo a esta data. Você pode enviar a solicitação, mas a disponibilidade será confirmada pela nossa equipe.";
    } else {
      warn.style.display="none";
    }
  }catch(e){ warn.style.display="none"; }
}

async function _orcNext1(){
  const tipo=document.getElementById("orc-tipo").value;
  const data=document.getElementById("orc-data").value;
  const conv=parseInt(document.getElementById("orc-conv").value)||0;
  const cont=document.getElementById("orc-cont").value.trim();
  const wpp=document.getElementById("orc-wpp").value.trim();
  const err=document.getElementById("orc-err1");
  if(!tipo||!data||!conv||!cont||!wpp){err.style.display="block";err.textContent="Preencha os campos obrigatórios (*)";return;}
  const wppErr=validarFmtWpp(wpp);
  if(wppErr){err.style.display="block";err.textContent=wppErr;return;}
  if(conv>450){err.style.display="block";err.textContent="Capacidade máxima: 450 convidados (Tumbergia). Entre em contato para eventos maiores.";return;}
  _orc.tipo_evento=tipo; _orc.data_evento=data; _orc.num_convidados=conv;
  const nvEl=document.getElementById("orc-noiva"); _orc.nome_noiva=nvEl?nvEl.value.trim():'';
  const noEl=document.getElementById("orc-noivo"); _orc.nome_noivo=noEl?noEl.value.trim():'';
  _orc.nome_contratante=cont; _orc.whatsapp=wpp;
  _orc.email=document.getElementById("orc-email").value.trim();
  _orc.salao=conv<=100?"Bromélias":"Tumbergia";
  // Grava o lead já ao sair da fase 1 (captura mesmo quem desistir adiante)
  _orc._stage="lead";
  await _orcUpsertLead();
  _orc.step=2; _orcStep();
}

async function _orcLoadPacotes(){
  const body=document.getElementById("orc-wizard-body");
  body.innerHTML=`<div class="orc-card"><div style="text-align:center;padding:20px;color:var(--dl)">Carregando pacotes…</div></div>`;
  try{
    // Load packages + items
    if(!_orc._pacotes.length){
      const tabelas=await sbFetch("tabelas_preco?select=id,nome&order=id.asc")||[];
      if(tabelas.length){
        const ids=tabelas.map(t=>t.id).join(",");
        const [grupos,itens]=await Promise.all([
          sbFetch("tabelas_preco_grupos?tabela_id=in.("+ids+")&select=id,tabela_id,nome,desconto,ordem&order=tabela_id.asc,ordem.asc,id.asc")||[],
          sbFetch("tabelas_preco_itens?tabela_id=in.("+ids+")&select=id,tabela_id,grupo_id,cod_item,descricao,valor_unitario&order=id.asc")||[]
        ]);
        _orc._pacotes=tabelas.map(t=>({
          id:t.id,cod:String(t.id),nome:t.nome,
          grupos:grupos.filter(g=>g.tabela_id===t.id),
          itens:itens.filter(i=>i.tabela_id===t.id)
        }));
      }
    }
    // Always reload inventario items for orçamento
    const invOrc=await sbFetch("inventario?exibir_orcamento=eq.true&select=cod,descricao,imagem,descricao_orc&order=descricao.asc")||[];
    _orc._invOrc=invOrc;
    _orc._invByCod={};
    invOrc.forEach(r=>{_orc._invByCod[r.cod]=r;});
  }catch(e){
    body.innerHTML=`<div class="orc-card"><div style="text-align:center;padding:20px;color:var(--er)">Erro ao carregar pacotes.</div><div style="font-size:11px;color:var(--dl);padding:8px 16px;word-break:break-all;">${e.message||e}</div><div class="orc-nav"><button class="orc-btn-back" onclick="_orc.step=1;_orcStep()">← Voltar</button><button class="orc-btn-next" onclick="_orcLoadPacotes()">Tentar novamente</button></div></div>`;
    return;
  }
  body.innerHTML=_orcHTML2();
}

// Build unified item list (dedup by cod_item) + packages with their cod members
function _orcBuildUnified(){
  const seen=new Set();
  const pkgs=[];
  _orc._pacotes.forEach(p=>{
    (p.grupos||[]).forEach(g=>{
      if(seen.has(g.nome)) return;
      seen.add(g.nome);
      const cods=(p.itens||[]).filter(i=>i.grupo_id===g.id&&i.cod_item&&_orcInvOf(i)).map(i=>i.cod_item);
      if(!cods.length) return;
      pkgs.push({id:g.id,nome:g.nome,desconto:parseFloat(g.desconto||0),cods:[...new Set(cods)]});
    });
  });
  const byCod={};const order=[];
  _orc._pacotes.forEach(p=>{
    (p.itens||[]).forEach(i=>{
      if(!i.cod_item||!_orcInvOf(i)) return;
      if(!byCod[i.cod_item]){byCod[i.cod_item]={cod:i.cod_item,vun:(i.valor_unitario||0)};order.push(i.cod_item);}
      else if(!byCod[i.cod_item].vun&&i.valor_unitario){byCod[i.cod_item].vun=i.valor_unitario;}
    });
  });
  _orc._uPkgs=pkgs;
  _orc._uByCod=byCod;
  _orc._uItems=order.map(c=>byCod[c]);
  if(!_orc._uSel) _orc._uSel={};
}

function _orcHTML2(){
  _orcBuildUnified();
  if(!_orc._uItems.length) return `<div class="orc-card"><div style="text-align:center;padding:20px;color:var(--dl)">Nenhum item habilitado para orçamento. Marque itens em Inventário → "Exibir no Orçamento".</div></div><div class="orc-nav"><button class="orc-btn-back" onclick="_orc.step=1;_orcStep()">← Voltar</button></div>`;
  // Package shortcut buttons
  const pkgBtns=_orc._uPkgs.map(pk=>{
    const active=_orc._activePkg===pk.id;
    const descTxt=pk.desconto>0?` · -R$${pk.desconto.toLocaleString("pt-BR",{minimumFractionDigits:2})}`:'';
    return `<button type="button" id="orc-pkgbtn-${pk.id}" onclick="_orcTogglePkg(${pk.id})" style="text-align:left;padding:10px 14px;border-radius:10px;border:2px solid ${active?'var(--a)':'var(--br)'};background:${active?'var(--a)':'#fff'};color:${active?'#fff':'var(--dk)'};cursor:pointer;font-size:13px;font-weight:700;transition:all .15s;">${pk.nome}<span style="font-weight:500;opacity:.85">${descTxt}</span></button>`;
  }).join("");
  // Unified item rows
  const itemRowU=(u)=>{
    const inv=_orc._invByCod[u.cod];
    const label=inv?inv.descricao:u.cod;
    const sub=inv&&inv.descricao_orc?inv.descricao_orc:'';
    const imgUrl=inv&&inv.imagem?`./${inv.imagem}`:'';
    const prev=_orc._uSel[u.cod];
    const ck=prev?'checked':'';
    const qty=(prev&&prev.qty)||1;
    return `<label style="display:flex;align-items:flex-start;gap:10px;padding:10px 0;border-bottom:1px solid var(--br);cursor:pointer;">
      <input type="checkbox" id="orc-ck-${u.cod}" data-cod="${u.cod}" data-vun="${u.vun}" ${ck} style="width:16px;height:16px;accent-color:var(--a);flex-shrink:0;margin-top:3px" onchange="_orcItemToggle('${u.cod}')">
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;color:var(--dk)">${label}</div>
        ${sub?`<div style="font-size:11px;color:var(--dl);margin-top:2px;line-height:1.4">${sub}</div>`:''}
      </div>
      ${imgUrl?`<div style="position:relative;flex-shrink:0;width:80px;height:60px;" class="orc-img-wrap"><img src="${imgUrl}" onerror="this.parentElement.style.display='none'" style="width:80px;height:60px;object-fit:cover;border-radius:6px;cursor:zoom-in;transition:transform .2s;display:block;" onmouseenter="this.style.cssText='width:80px;height:60px;object-fit:cover;border-radius:6px;cursor:zoom-out;display:block;position:absolute;width:240px;height:180px;z-index:99;box-shadow:0 8px 32px rgba(0,0,0,.3);border-radius:10px;top:0;right:0;'" onmouseleave="this.style.cssText='width:80px;height:60px;object-fit:cover;border-radius:6px;cursor:zoom-in;display:block;'"></div>`:''}<input type="number" id="orc-qt-${u.cod}" value="${qty}" min="1" style="width:44px;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:12px;text-align:center;background:var(--bg);flex-shrink:0;margin-top:3px">
    </label>`;
  };
  const itemsHtml=_orc._uItems.map(itemRowU).join("");
  return `<div class="orc-card">
    <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--dk);margin-bottom:4px;">Monte seu orçamento</div>
    <div style="font-size:13px;color:var(--dl);margin-bottom:14px;">Salão: <strong>${_orc.salao}</strong> · ${_orc.num_convidados} convidados</div>
    ${_orc._uPkgs.length?`<div style="font-size:12px;font-weight:700;color:var(--dl);letter-spacing:.5px;text-transform:uppercase;margin-bottom:8px">Selecione seu pacote para obter os descontos indicados</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">${pkgBtns}</div>`:''}
    <div style="font-size:12px;font-weight:700;color:var(--dl);letter-spacing:.5px;text-transform:uppercase;margin:16px 0 0">Itens</div>
    ${itemsHtml}
    <div id="orc-err2" class="err" style="margin-top:10px"></div>
  </div>
  <div class="orc-nav">
    <button class="orc-btn-back" onclick="_orc.step=1;_orcStep()">← Voltar</button>
    <button class="orc-btn-next" onclick="_orcNext2()">Ver resumo →</button>
  </div>`;
}

// Click a package: check/uncheck its member items in the unified list
function _orcTogglePkg(id){
  const pk=(_orc._uPkgs||[]).find(p=>p.id===id);
  if(!pk) return;
  const turnOn=_orc._activePkg!==id;
  // Capacidade: salão Bromélias comporta até 100 convidados
  if(turnOn && /brom[eé]/i.test(_orcNorm(pk.nome)) && (parseInt(_orc.num_convidados)||0)>100){
    const e=document.getElementById("orc-err2");
    if(e){e.style.display="block";e.textContent="Número de convidados excede o limite do salão Bromélias (máx. 100).";}
    return;
  }
  // Clear any previously active package's items first
  if(_orc._activePkg!=null){
    const prev=(_orc._uPkgs||[]).find(p=>p.id===_orc._activePkg);
    if(prev) prev.cods.forEach(c=>{const ck=document.getElementById('orc-ck-'+c);if(ck)ck.checked=false;});
  }
  const e0=document.getElementById("orc-err2"); if(e0) e0.style.display="none";
  _orc._activePkg=turnOn?id:null;
  pk.cods.forEach(c=>{const ck=document.getElementById('orc-ck-'+c);if(ck)ck.checked=turnOn;});
  document.querySelectorAll('[id^="orc-pkgbtn-"]').forEach(b=>{b.style.background='#fff';b.style.color='var(--dk)';b.style.borderColor='var(--br)';});
  if(turnOn){const b=document.getElementById('orc-pkgbtn-'+id);if(b){b.style.background='var(--a)';b.style.color='#fff';b.style.borderColor='var(--a)';}}
}

// Manual item toggle: keep all-or-nothing physical groups (suites flamboyant / bromelias) in sync
function _orcItemToggle(cod){
  const inv=_orc._invByCod[cod];
  if(!inv) return;
  // Capacidade: não permite o salão Bromélias acima de 100 convidados
  if(/espaco bromel/i.test(_orcNorm(inv.descricao||'')) && (parseInt(_orc.num_convidados)||0)>100){
    const ck0=document.getElementById('orc-ck-'+cod); if(ck0) ck0.checked=false;
    const e=document.getElementById("orc-err2");
    if(e){e.style.display="block";e.textContent="Número de convidados excede o limite do salão Bromélias (máx. 100).";}
    return;
  }
  const grp=_orcGetGroup(inv.descricao||'');
  if(!grp) return;
  const checked=document.getElementById('orc-ck-'+cod)?.checked;
  (_orc._uItems||[]).forEach(u=>{
    const inv2=_orc._invByCod[u.cod];
    if(inv2&&_orcGetGroup(inv2.descricao||'')===grp){
      const ck=document.getElementById('orc-ck-'+u.cod);
      if(ck) ck.checked=checked;
    }
  });
}

async function _orcNext2(){
  _orc._valorAjustado=false;
  const e=document.getElementById("orc-err2");
  const checked=Array.from(document.querySelectorAll('[id^="orc-ck-"]:checked'));
  if(!checked.length){if(e){e.style.display="block";e.textContent="Selecione ao menos um item.";}return;}
  const selectedItems=[];let subtotal=0;const selCods=new Set();
  checked.forEach(ck=>{
    const cod=ck.dataset.cod;
    const u=_orc._uByCod[cod];
    if(!u) return;
    const qty=parseFloat(document.getElementById("orc-qt-"+cod)?.value||1);
    const s=(u.vun||0)*qty;
    const inv=_orc._invByCod[cod];
    selectedItems.push({cod_item:cod,descricao:inv?inv.descricao:cod,valor_unitario:u.vun,qty,subtotal:s});
    subtotal+=s;selCods.add(cod);
  });
  // Best group discount: fully-selected package
  let bestDiscount=0,bestGrupoNome=null;
  (_orc._uPkgs||[]).forEach(pk=>{
    if(pk.cods.length&&pk.cods.every(c=>selCods.has(c))){
      if(pk.desconto>bestDiscount){bestDiscount=pk.desconto;bestGrupoNome=pk.nome;}
    }
  });
  // Persist selection (for restore when going back)
  _orc._uSel={};
  selectedItems.forEach(i=>{_orc._uSel[i.cod_item]={qty:i.qty};});
  _orc._selectedItems=selectedItems;
  _orc._subtotal=subtotal;
  _orc._discount=bestDiscount;
  _orc._discountPkg=bestGrupoNome;
  _orc.pacote_nome=bestGrupoNome||'';
  _orc.pacote_valor=subtotal-bestDiscount;
  _orc.valor_total=_orc.pacote_valor;
  _orc.pacote_itens_desc=selectedItems.map(i=>i.descricao+(i.qty>1?' × '+i.qty:'')).join(", ");
  // Atualiza a gravação com os itens/valor ao passar da fase 2 para a 3
  _orc._stage="orcado";
  await _orcUpsertLead();
  _orc.step=3;_orcStep();
}

function _orcHTML3_OBSOLETE(){
  const pkg=_orc._pacotes.find(p=>String(p.id)===_orc.pacote_cod);
  if(!pkg) return `<div class="orc-card"><div style="text-align:center;padding:20px;color:var(--dl)">Pacote não encontrado.</div></div><div class="orc-nav"><button class="orc-btn-back" onclick="_orc.step=2;_orcStep()">← Voltar</button></div>`;
  const grupos=pkg.grupos||[];
  const itens=pkg.itens||[];
  // If coming back, restore previous selection; otherwise pre-check items of selected group
  const hasPrev=(_orc._selectedItems||[]).length>0;
  const prevQty={};
  const prevSel=new Set();
  if(hasPrev){
    (_orc._selectedItems).forEach(i=>{prevSel.add(i.id);prevQty[i.id]=i.qty;});
  }
  const itemRow=(i,defaultChecked)=>{
    const ck=(hasPrev?prevSel.has(i.id):defaultChecked)?'checked':'';
    const qty=prevQty[i.id]||1;
    return `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid var(--br);cursor:pointer;">
      <input type="checkbox" id="orc-ck-${i.id}" data-vun="${i.valor_unitario||0}" ${ck} style="width:16px;height:16px;accent-color:var(--a);flex-shrink:0">
      <span style="flex:1;font-size:13px;color:var(--dk)">${i.descricao||''}</span>
      <input type="number" id="orc-qt-${i.id}" value="${qty}" min="1" style="width:48px;padding:4px;border:1px solid var(--br);border-radius:6px;font-size:12px;text-align:center;background:var(--bg)">
    </label>`;
  };
  let html='';
  grupos.forEach(g=>{
    const gItens=itens.filter(i=>i.grupo_id===g.id);
    if(!gItens.length) return;
    const isSelectedGrp=g.id===_orc.pacote_grupo_id;
    html+=`<div style="font-size:11px;font-weight:700;color:var(--dl);letter-spacing:1px;text-transform:uppercase;padding:12px 0 4px">${g.nome}</div>`;
    gItens.forEach(i=>{html+=itemRow(i,isSelectedGrp);});
  });
  const avulsos=itens.filter(i=>!i.grupo_id);
  if(avulsos.length){
    if(grupos.length) html+=`<div style="font-size:11px;font-weight:700;color:var(--dl);letter-spacing:1px;text-transform:uppercase;padding:12px 0 4px">Itens avulsos</div>`;
    avulsos.forEach(i=>{html+=itemRow(i,false);});
  }
  return `<div class="orc-card">
    <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--dk);margin-bottom:4px;">Selecione os itens</div>
    <div style="font-size:13px;color:var(--dl);margin-bottom:18px;">Pacote: <strong>${_orc.pacote_nome}</strong></div>
    ${html||`<div style="padding:20px;text-align:center;color:var(--dl)">Nenhum item cadastrado.</div>`}
    <div id="orc-err3" class="err" style="margin-top:10px"></div>
  </div>
  <div class="orc-nav">
    <button class="orc-btn-back" onclick="_orc._selectedItems=[];_orc.step=2;_orcStep()">← Voltar</button>
    <button class="orc-btn-next" onclick="_orcNext3()">Ver resumo →</button>
  </div>`;
}

function _orcNext3(){
  const pkg=_orc._pacotes.find(p=>String(p.id)===_orc.pacote_cod);
  const e=document.getElementById("orc-err3");
  if(!pkg){if(e){e.style.display="block";e.textContent="Pacote não encontrado.";}return;}
  const checked=Array.from(document.querySelectorAll('[id^="orc-ck-"]:checked'));
  if(!checked.length){if(e){e.style.display="block";e.textContent="Selecione ao menos um item.";}return;}
  const selectedItems=[];
  let subtotal=0;
  checked.forEach(ck=>{
    const id=parseInt(ck.id.replace("orc-ck-",""));
    const item=pkg.itens.find(i=>i.id===id);
    if(!item) return;
    const qty=parseFloat(document.getElementById("orc-qt-"+id)?.value||1);
    const sub=(item.valor_unitario||0)*qty;
    selectedItems.push({...item,qty,subtotal:sub});
    subtotal+=sub;
  });
  const selectedIds=new Set(selectedItems.map(i=>i.id));
  let bestDiscount=0,bestGrupoNome=null;
  (pkg.grupos||[]).forEach(g=>{
    const gItens=pkg.itens.filter(i=>i.grupo_id===g.id);
    if(!gItens.length) return;
    const allMatch=gItens.every(i=>selectedIds.has(i.id));
    if(allMatch){
      const disc=parseFloat(g.desconto||0);
      if(disc>bestDiscount){bestDiscount=disc;bestGrupoNome=g.nome;}
    }
  });
  _orc._selectedItems=selectedItems;
  _orc._subtotal=subtotal;
  _orc._discount=bestDiscount;
  _orc._discountPkg=bestGrupoNome;
  _orc.pacote_valor=subtotal-bestDiscount;
  _orc.valor_total=_orc.pacote_valor;
  _orc.pacote_itens_desc=selectedItems.map(i=>_orcDesc(i)+(i.qty>1?' × '+i.qty:'')).join(", ");
  _orc.step=4;_orcStep();
}

function _orcCalcSimulacao(valorTotal, dataEvento) {
  if(!dataEvento || !valorTotal) return null;
  const today = new Date();
  const ev = new Date(dataEvento + "T00:00:00");
  const todayYr = today.getFullYear(), todayMn = today.getMonth() + 1;
  const evYr = ev.getFullYear(), evMn = ev.getMonth() + 1;
  let mbMn = evMn - 1, mbYr = evYr;
  if(mbMn === 0) { mbMn = 12; mbYr--; }
  let fMn = todayMn + 1, fYr = todayYr;
  if(fMn === 13) { fMn = 1; fYr++; }
  let n = (mbYr * 12 + mbMn) - (fYr * 12 + fMn) + 1;
  if(n <= 0) return null;
  while(n > 1 && valorTotal / n < 1200) n--;
  const parcela = valorTotal / n;
  const discPct = (n / 2) * 0.5;
  const desconto = valorTotal * (discPct / 100);
  const valorAVista = valorTotal - desconto;
  const parcelas = [];
  let m = fMn, y = fYr;
  for(let i = 0; i < n; i++) {
    parcelas.push({ mes: MONTHS[m - 1], ano: y, valor: parcela });
    m++; if(m > 12) { m = 1; y++; }
  }
  return { n, parcela, discPct, desconto, valorAVista, parcelas };
}

function _orcHTML4(){
  if(!_orc._valorAjustado) _orc.valor_total=_orc.pacote_valor;
  const validade=new Date(); validade.setDate(validade.getDate()+7);
  const valStr=validade.toLocaleDateString("pt-BR");
  const nomes=[_orc.nome_noiva,_orc.nome_noivo].filter(Boolean).join(" e ")||_orc.nome_contratante;
  const fmt=v=>"R$ "+v.toLocaleString("pt-BR",{minimumFractionDigits:2});
  // Linhas de itens selecionados
  const itemLines=(_orc._selectedItems||[]).map(i=>`
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid var(--br)">
      <span style="color:var(--dk)">${_orcDesc(i)}${i.qty>1?' × '+i.qty:''}</span>
      <span style="color:var(--dm);white-space:nowrap;margin-left:12px">${fmt(i.subtotal)}</span>
    </div>`).join("");
  // Extras do inventário
  const extrasLines=Object.entries(_orc.extras).map(([cod,qty])=>{
    const it=_orc._invItems.find(x=>x.cod===cod);
    return it?`<div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid var(--br)"><span style="color:var(--dk)">${it.descricao} × ${qty}</span><span style="color:var(--dl)">—</span></div>`:"";
  }).filter(Boolean).join("");
  const discountLine=_orc._discount>0?`
    <div style="display:flex;justify-content:space-between;padding:8px 0;font-size:13px;border-bottom:1px solid var(--br)">
      <span style="color:var(--ok);font-weight:600">Desconto — ${_orc._discountPkg}</span>
      <span style="color:var(--ok);font-weight:600">− ${fmt(_orc._discount)}</span>
    </div>`:"";
  const subtotalLine=_orc._discount>0?`
    <div style="display:flex;justify-content:space-between;padding:6px 0;font-size:13px;border-bottom:1px solid var(--br)">
      <span style="color:var(--dl)">Subtotal</span>
      <span style="color:var(--dl)">${fmt(_orc._subtotal)}</span>
    </div>`:"";
  const sim = _orcCalcSimulacao(_orc.valor_total, _orc.data_evento);
  const simHTML = sim ? `
    <div style="border-top:2px solid var(--br);margin-top:10px;padding-top:16px;">
      <div style="font-size:13px;font-weight:700;color:var(--dk);margin-bottom:12px;letter-spacing:.3px;">💳 Condições de Pagamento</div>
      <div style="background:#EEF4FF;border:1.5px solid #B8D0FF;border-radius:10px;padding:14px;margin-bottom:10px;">
        <div style="font-size:13px;font-weight:700;color:#2A4A7A;margin-bottom:10px;">
          Parcelamento em ${sim.n}× de ${fmt(sim.parcela)} <span style="font-weight:400;font-size:12px;color:#555;">(sem juros)</span>
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:12px;">
          <thead><tr style="background:#DDE8FF;">
            <th style="padding:5px 8px;text-align:left;font-weight:600;color:#2A4A7A;">Mês</th>
            <th style="padding:5px 8px;text-align:right;font-weight:600;color:#2A4A7A;">Valor</th>
          </tr></thead>
          <tbody>${sim.parcelas.map(p=>`
            <tr style="border-bottom:1px solid #C8DEFF;">
              <td style="padding:5px 8px;color:var(--dk);">${p.mes}/${p.ano}</td>
              <td style="padding:5px 8px;text-align:right;font-weight:600;">${fmt(p.valor)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>
      <div style="background:#EFFFF5;border:1.5px solid #A8E6C0;border-radius:10px;padding:14px;">
        <div style="font-size:13px;font-weight:700;color:#2A6644;">À vista: ${fmt(sim.valorAVista)}</div>
        <div style="font-size:11px;color:#2A6644;margin-top:4px;">${sim.discPct.toFixed(1)}% de desconto — economia de ${fmt(sim.desconto)}</div>
      </div>
    </div>` : '';
  return `<div class="orc-card">
    <div style="font-family:'DM Serif Display',serif;font-size:20px;color:var(--dk);margin-bottom:20px;">Resumo do orçamento</div>
    <div style="display:flex;flex-direction:column;gap:2px;font-size:14px;">
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--br)"><span style="color:var(--dl)">Evento</span><span style="font-weight:600">${_orc.tipo_evento}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--br)"><span style="color:var(--dl)">Data</span><span style="font-weight:600">${_orc.data_evento.split("-").reverse().join("/")}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--br)"><span style="color:var(--dl)">Convidados</span><span style="font-weight:600">${_orc.num_convidados}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid var(--br)"><span style="color:var(--dl)">Salão</span><span style="font-weight:600">${_orc.salao}</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:2px solid var(--br);margin-bottom:6px"><span style="color:var(--dl)">Nome(s)</span><span style="font-weight:600">${nomes}</span></div>
      <div style="font-size:11px;font-weight:700;color:var(--dl);letter-spacing:1px;text-transform:uppercase;padding:6px 0">Itens selecionados</div>
      ${itemLines}
      ${extrasLines}
      ${subtotalLine}
      ${discountLine}
      <div style="display:flex;justify-content:space-between;padding:14px 0;margin-top:6px;align-items:center;">
        <span style="font-size:16px;font-weight:700;color:var(--dk)">Total</span>
        <span style="font-size:22px;font-weight:700;color:var(--a)">${fmt(_orc.valor_total)}</span>
      </div>
      ${simHTML}
      ${_orc._admin?`<div style="border-top:1px dashed var(--br);padding-top:12px;margin-top:4px;">
        <button onclick="_orcToggleEdit()" id="orc-edit-btn" style="padding:7px 14px;background:transparent;color:var(--a);border:1.5px solid var(--a);border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;">✏️ Alterar valor (admin)</button>
        <div id="orc-edit-box" style="display:none;margin-top:10px;">
          <label class="lbl">Valor total ajustado (R$)</label>
          <div style="display:flex;gap:8px;align-items:center;">
            <input type="number" id="orc-edit-total" class="inp inp-inline" step="0.01" value="${_orc.valor_total}" style="max-width:160px;margin-bottom:0;">
            <button onclick="_orcAplicarValor()" style="padding:8px 14px;background:var(--a);color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:700;font-size:12px;">Aplicar</button>
          </div>
          <div style="font-size:11px;color:var(--dl);margin-top:4px;">Sobrescreve o valor calculado. Use para negociações.</div>
        </div>
      </div>`:''}
    </div>
    <div style="background:#f5f6f7;border-radius:10px;padding:12px 16px;font-size:12px;color:var(--dl);margin-top:8px;">
      ⏱ Este orçamento tem validade até <strong>${valStr}</strong>. Após isso, os valores poderão ser reajustados.
    </div>
    <div id="orc-err4" class="err"></div>
  </div>
  <div class="orc-nav">
    <button class="orc-btn-back" onclick="_orc.step=2;_orcStep()">← Voltar</button>
    <button class="orc-btn-next" id="orc-btn-salvar" onclick="_orcSalvar()">Salvar orçamento em PDF</button>
  </div>`;
}

async function _orcSalvar(){
  const btn=document.getElementById("orc-btn-salvar");
  btn.disabled=true; btn.textContent="Gerando PDF…";
  _orc._stage="pendente";
  await _orcUpsertLead();
  _orcAbrirPDF();
  btn.disabled=false; btn.textContent="Salvar orçamento em PDF";
  // Envia orçamento via WhatsApp em background (silencioso)
  if(_orc._dbId && _orc.whatsapp){
    fetch(SB_URL+"/functions/v1/enviar-orcamento-wpp",{
      method:"POST",
      headers:{"apikey":SB_KEY,"Authorization":"Bearer "+_authToken,"Content-Type":"application/json"},
      body:JSON.stringify({id:_orc._dbId})
    }).then(r=>r.json()).then(d=>{
      if(d.ok) toast("📱 Orçamento enviado por WhatsApp!");
    }).catch(()=>{});
  }
  // Após salvar PDF, oferecer agendamento de visita
  _orc.step=4; _orcStep();
}

function _orcAbrirPDF(){
  const fmt=v=>"R$ "+v.toLocaleString("pt-BR",{minimumFractionDigits:2});
  const nomes=[_orc.nome_noiva,_orc.nome_noivo].filter(Boolean).join(" e ")||_orc.nome_contratante;
  const validade=new Date(); validade.setDate(validade.getDate()+7);
  const sim=_orcCalcSimulacao(_orc.valor_total,_orc.data_evento);
  const simPDF=sim?`
  <div style="margin-top:28px;border-top:2px solid #ddd;padding-top:18px;">
    <div style="font-size:15px;font-weight:700;color:#333;margin-bottom:14px;">Condições de Pagamento</div>
    <div style="background:#EEF4FF;border:1.5px solid #B8D0FF;border-radius:8px;padding:14px;margin-bottom:12px;">
      <div style="font-size:13px;font-weight:700;color:#2A4A7A;margin-bottom:10px;">Parcelamento em ${sim.n}× de ${fmt(sim.parcela)} (sem juros)</div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <thead><tr style="background:#DDE8FF;">
          <th style="padding:5px 8px;text-align:left;color:#2A4A7A;">Mês</th>
          <th style="padding:5px 8px;text-align:right;color:#2A4A7A;">Valor</th>
        </tr></thead>
        <tbody>${sim.parcelas.map(p=>`<tr style="border-bottom:1px solid #C8DEFF;"><td style="padding:5px 8px;">${p.mes}/${p.ano}</td><td style="padding:5px 8px;text-align:right;font-weight:600;">${fmt(p.valor)}</td></tr>`).join("")}</tbody>
      </table>
    </div>
    <div style="background:#EFFFF5;border:1.5px solid #A8E6C0;border-radius:8px;padding:14px;">
      <div style="font-size:13px;font-weight:700;color:#2A6644;">À vista: ${fmt(sim.valorAVista)}</div>
      <div style="font-size:11px;color:#2A6644;margin-top:4px;">${sim.discPct.toFixed(1)}% de desconto — economia de ${fmt(sim.desconto)}</div>
    </div>
  </div>`:'';
  const itemRows=(_orc._selectedItems||[]).map(i=>{
    const info=_orcItemInfo(i);
    const det=info?info.d:null;
    return `<tr><td><div style="font-weight:600">${_orcDesc(i)}${i.qty>1?' × '+i.qty:''}</div>${det?`<div style="font-size:11px;color:#777;margin-top:3px">${det}</div>`:''}</td><td style="text-align:right;vertical-align:top;white-space:nowrap;padding-left:16px">${fmt(i.subtotal)}</td></tr>`;
  }).join("");
  const subtotalRow=_orc._discount>0?`<tr style="color:#888"><td>Subtotal</td><td style="text-align:right">${fmt(_orc._subtotal)}</td></tr>`:"";
  const discRow=_orc._discount>0?`<tr style="color:#2a7a2a;font-weight:600"><td>Desconto — ${_orc._discountPkg}</td><td style="text-align:right">− ${fmt(_orc._discount)}</td></tr>`:"";
  const html=`<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8">
<title>Orçamento – Fazenda Damata</title>
<style>
  body{font-family:Arial,sans-serif;color:#222;padding:40px;max-width:700px;margin:auto}
  h1{color:#8b5a2b;font-size:22px;margin-bottom:4px}
  .sub{color:#666;font-size:13px;margin-bottom:24px}
  table{width:100%;border-collapse:collapse;margin-top:8px}
  th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#888;padding:6px 0;border-bottom:2px solid #ddd}
  td{padding:8px 0;border-bottom:1px solid #eee;font-size:13px}
  .total-row td{font-size:17px;font-weight:700;color:#8b5a2b;border-top:2px solid #ddd;border-bottom:none;padding-top:12px}
  .info{display:grid;grid-template-columns:1fr 1fr;gap:6px 20px;font-size:13px;margin-bottom:20px}
  .info span{color:#888;font-size:11px;display:block}
  .footer{margin-top:24px;font-size:11px;color:#888;border-top:1px solid #eee;padding-top:12px}
  @media print{body{padding:20px}}
</style></head><body>
<h1>Orçamento – Fazenda Damata</h1>
<div class="sub">Emitido em ${new Date().toLocaleDateString("pt-BR")} · Válido até ${validade.toLocaleDateString("pt-BR")}</div>
<div class="info">
  <div><span>Contratante</span>${_orc.nome_contratante}</div>
  <div><span>WhatsApp</span>${_orc.whatsapp}</div>
  <div><span>Evento</span>${_orc.tipo_evento}</div>
  <div><span>Data</span>${_orc.data_evento.split("-").reverse().join("/")}</div>
  <div><span>Salão</span>${_orc.salao}</div>
  <div><span>Convidados</span>${_orc.num_convidados}</div>
  ${nomes?`<div><span>Nome(s)</span>${nomes}</div>`:''}
  ${_orc.email?`<div><span>E-mail</span>${_orc.email}</div>`:''}
</div>
<table>
  <thead><tr><th>Item</th><th style="text-align:right">Valor</th></tr></thead>
  <tbody>
    ${itemRows}
    ${subtotalRow}
    ${discRow}
    <tr class="total-row"><td>Total</td><td style="text-align:right">${fmt(_orc.valor_total)}</td></tr>
  </tbody>
</table>
${simPDF}
<div class="footer">Fazenda Damata · fazendadamata.com · (19) 99638-3386<br>Este orçamento é válido por 7 dias a partir da data de emissão. Os valores poderão ser reajustados após o prazo.</div>
<script>window.onload=function(){window.print();}<\/script>

<!-- MODAL BIOMETRIA -->
<div id="bio-modal" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:9999;align-items:center;justify-content:center;padding:20px">
  <div id="bio-modal-inner" style="background:white;border-radius:20px;padding:32px 28px;max-width:340px;width:100%;text-align:center;box-shadow:0 20px 60px rgba(0,0,0,.25)">
    <div style="font-size:44px;margin-bottom:12px">🔐</div>
    <div style="font-weight:700;font-size:17px;color:#1e293b;margin-bottom:8px">Habilitar login com biometria?</div>
    <div style="font-size:13px;color:#64748b;line-height:1.6;margin-bottom:24px">Na próxima visita, entre com sua digital ou Face ID — sem precisar digitar a senha.</div>
    <div style="display:flex;gap:10px;justify-content:center;flex-wrap:wrap">
      <button onclick="hideBioModal()" style="background:white;border:1.5px solid #e2e8f0;color:#64748b;padding:10px 20px;border-radius:10px;font-size:14px;cursor:pointer;font-family:inherit">Agora não</button>
      <button id="btn-bio-reg" onclick="registerBiometric()" style="background:#1e3a5f;color:white;border:none;padding:10px 20px;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;font-family:inherit">Habilitar</button>
    </div>
  </div>
</div>
</body></html>`;
  const w=window.open('','_blank','width=750,height=900');
  if(!w){alert("Permita pop-ups para gerar o PDF.");return;}
  w.document.open();
  w.document.write(html);
  w.document.close();
}
