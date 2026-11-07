/*
 * SmartFlow ERP — browser-first data layer.
 * Replace LocalStorageAdapter with a repository backed by Cloudflare D1/API later;
 * UI code consumes the same normalized data model and refresh() entry point.
 */
const STORAGE_KEY = 'smartflow-erp-v1';
const STORE_SCHEMA_VERSION = 1;
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const escapeHTML = (value = '') => String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const number = value => Number(value) || 0;
const fmt = value => number(value).toLocaleString('ko-KR');
const todayISO = () => new Date().toISOString().slice(0, 10);
const shiftDate = days => { const date = new Date(); date.setDate(date.getDate() + days); return date.toISOString().slice(0, 10); };
const percent = (value, digits = 1) => `${number(value).toFixed(digits)}%`;
const dateLabel = value => value ? new Date(`${value}T00:00:00`).toLocaleDateString('ko-KR', {month:'numeric',day:'numeric'}) : '—';
const makeId = prefix => `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,7)}`;

const initialState = () => ({schemaVersion:STORE_SCHEMA_VERSION,items:[
  {id:'itm_001',code:'PRD-001',name:'스마트 센서 모듈',spec:'SF-SM200 / 산업용',unit:'EA',safetyStock:150,openingStock:380},
  {id:'itm_002',code:'PRD-002',name:'제어 보드 어셈블리',spec:'CB-A100 / 4층 PCB',unit:'EA',safetyStock:100,openingStock:240},
  {id:'itm_003',code:'PRD-003',name:'정밀 구동 모터',spec:'MTR-45 / 24V DC',unit:'EA',safetyStock:80,openingStock:145},
  {id:'itm_004',code:'PRD-004',name:'산업용 전원 모듈',spec:'PSU-240 / 240W',unit:'EA',safetyStock:60,openingStock:95},
  {id:'itm_005',code:'PRD-005',name:'알루미늄 케이스',spec:'AL-C90 / 아노다이징',unit:'EA',safetyStock:120,openingStock:220}
],plans:[
  {id:'pln_001',number:'PL-2605-001',itemId:'itm_001',date:shiftDate(-1),target:500,note:'정기 생산'},
  {id:'pln_002',number:'PL-2605-002',itemId:'itm_002',date:todayISO(),target:320,note:'정기 생산'},
  {id:'pln_003',number:'PL-2605-003',itemId:'itm_003',date:todayISO(),target:240,note:'수요 대응'},
  {id:'pln_004',number:'PL-2605-004',itemId:'itm_004',date:shiftDate(1),target:180,note:'정기 생산'},
  {id:'pln_005',number:'PL-2605-005',itemId:'itm_005',date:shiftDate(2),target:350,note:'월간 생산계획'}
],productions:[
  {id:'prd_001',itemId:'itm_001',planId:'pln_001',date:shiftDate(-1),lot:'LOT-260505-A01',quantity:462},
  {id:'prd_002',itemId:'itm_002',planId:'pln_002',date:todayISO(),lot:'LOT-260506-B01',quantity:248},
  {id:'prd_003',itemId:'itm_003',planId:'pln_003',date:todayISO(),lot:'LOT-260506-C01',quantity:225},
  {id:'prd_004',itemId:'itm_001',planId:'pln_001',date:shiftDate(-4),lot:'LOT-260502-A01',quantity:485},
  {id:'prd_005',itemId:'itm_004',planId:'pln_004',date:shiftDate(-3),lot:'LOT-260503-D01',quantity:176},
  {id:'prd_006',itemId:'itm_005',planId:'pln_005',date:shiftDate(-5),lot:'LOT-260501-E01',quantity:332},
  {id:'prd_007',itemId:'itm_003',planId:'pln_003',date:shiftDate(-6),lot:'LOT-260430-C01',quantity:218}
],quality:[
  {id:'qc_001',itemId:'itm_001',lot:'LOT-260505-A01',date:shiftDate(-1),quantity:462,defects:9,defectType:'치수 편차',checkItem:'외관 및 치수 검사',standard:'치수 공차 ±0.1mm'},
  {id:'qc_002',itemId:'itm_002',lot:'LOT-260506-B01',date:todayISO(),quantity:248,defects:6,defectType:'납땜 불량',checkItem:'외관 및 납땜 검사',standard:'납땜 연결 이상 없음'},
  {id:'qc_003',itemId:'itm_003',lot:'LOT-260506-C01',date:todayISO(),quantity:225,defects:4,defectType:'회전 소음',checkItem:'회전 속도 및 소음',standard:'소음 45dB 이하'},
  {id:'qc_004',itemId:'itm_004',lot:'LOT-260503-D01',date:shiftDate(-3),quantity:176,defects:3,defectType:'전압 편차',checkItem:'출력 전압 검사',standard:'정격 전압 ±3%'},
  {id:'qc_005',itemId:'itm_005',lot:'LOT-260501-E01',date:shiftDate(-5),quantity:332,defects:7,defectType:'표면 스크래치',checkItem:'외관 및 코팅 검사',standard:'외관 찍힘 및 스크래치 없음'}
],movements:[{id:'mov_001',itemId:'itm_002',date:shiftDate(-2),type:'out',quantity:30,lot:'',note:'샘플 출고'},{id:'mov_002',itemId:'itm_004',date:shiftDate(-4),type:'in',quantity:12,lot:'LOT-260502-D01',note:'검사 합격 입고'}],settings:{}});

const LocalStorageAdapter = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return initialState();
      const saved = JSON.parse(raw);
      if (!saved || typeof saved !== 'object' || !Array.isArray(saved.items)) return initialState();
      return {...initialState(),...saved,schemaVersion:STORE_SCHEMA_VERSION};
    } catch (error) { console.warn('SmartFlow local data could not be loaded:', error); return initialState(); }
  },
  save(nextState) { try { localStorage.setItem(STORAGE_KEY, JSON.stringify(nextState)); return true; } catch (error) { console.error('SmartFlow local data could not be saved:', error); toast('저장 공간이 부족하거나 저장할 수 없습니다.'); return false; } }
};
let state = LocalStorageAdapter.load();
let modalKind = null, editingId = null, toastTimer = null;

function itemFor(id) { return state.items.find(item => item.id === id); }
function planFor(id) { return state.plans.find(plan => plan.id === id); }
function productionsForPlan(id) { return state.productions.filter(row => row.planId === id).reduce((sum,row) => sum + number(row.quantity),0); }
function productionTotal(itemId) { return state.productions.filter(row => !itemId || row.itemId === itemId).reduce((sum,row) => sum + number(row.quantity),0); }
function inventoryFor(itemId) {
  const item = itemFor(itemId); if (!item) return 0;
  return Math.max(0, number(item.openingStock) + state.movements.filter(row => row.itemId === itemId).reduce((sum,row) => sum + (row.type === 'in' ? number(row.quantity) : -number(row.quantity)),0) + state.quality.filter(row => row.itemId === itemId).reduce((sum,row) => sum + Math.max(0, number(row.quantity) - number(row.defects)),0));
}
function passRate() { const inspected = state.quality.reduce((sum,row) => sum + number(row.quantity),0); const defects = state.quality.reduce((sum,row) => sum + number(row.defects),0); return inspected ? (inspected-defects)/inspected*100 : 0; }
function saveAndRefresh(message) { if (!LocalStorageAdapter.save(state)) return; refresh(); if (message) toast(message); }
function toast(message) { const el = $('#toast'); el.textContent = message; el.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'),2600); }
function emptyRow(columns, message='등록된 데이터가 없습니다.') { return `<tr><td class="table-empty" colspan="${columns}">${escapeHTML(message)}</td></tr>`; }
function itemCell(item) { return item ? `<div class="item-cell"><span class="item-avatar">${escapeHTML(item.name.slice(0,1))}</span><span><strong>${escapeHTML(item.name)}</strong><small>${escapeHTML(item.code)}</small></span></div>` : '<span class="muted">삭제된 품목</span>'; }
function actionButtons(kind,id) { return `<div class="action-group"><button class="action-button" data-edit="${escapeHTML(kind)}:${escapeHTML(id)}">수정</button><button class="action-button action-delete" data-delete="${escapeHTML(kind)}:${escapeHTML(id)}">삭제</button></div>`; }
function badge(text,type='gray') { return `<span class="tag tag-${type}">${escapeHTML(text)}</span>`; }
function statCard(label,value,unit,icon,color,foot) { return `<article class="stat-card"><div class="stat-top"><span class="stat-label">${label}</span><span class="stat-icon icon-${color}">${icon}</span></div><div class="stat-value">${value}<small>${unit}</small></div><div class="stat-foot">${foot}</div></article>`; }

function renderDashboard() {
  const today = todayISO();
  const todayPlans = state.plans.filter(plan => plan.date === today);
  const todayActual = state.productions.filter(row => row.date === today).reduce((sum,row) => sum+number(row.quantity),0);
  const todayTarget = todayPlans.reduce((sum,plan) => sum+number(plan.target),0);
  const inspected = state.quality.reduce((sum,row) => sum+number(row.quantity),0);
  const defects = state.quality.reduce((sum,row) => sum+number(row.defects),0);
  const totalStock = state.items.reduce((sum,item) => sum+inventoryFor(item.id),0);
  const lowStock = state.items.filter(item => inventoryFor(item.id) <= number(item.safetyStock)).length;
  $('#dashboard-stats').innerHTML = [
    statCard('오늘 생산량',fmt(todayActual),'EA','▥','blue',`<span class="positive">${todayPlans.length}건</span> 오늘의 생산 실적`),
    statCard('생산 달성률',percent(todayTarget?todayActual/todayTarget*100:0),'','↗','green',`목표 ${fmt(todayTarget)} EA 기준`),
    statCard('품질 합격률',percent(passRate()),'','✓','orange',`불량 ${fmt(defects)} / 검사 ${fmt(inspected)} EA`),
    statCard('총 재고',fmt(totalStock),'EA','▣','purple',`${lowStock?`<span class="negative">${lowStock}개 품목</span>`:'<span class="positive">안정</span>'} 안전재고 점검 필요`)
  ].join('');
  const lastDates = Array.from({length:7},(_,i)=>shiftDate(i-6));
  const max = Math.max(1,...lastDates.flatMap(date => {const actual=state.productions.filter(row=>row.date===date).reduce((sum,row)=>sum+number(row.quantity),0);const target=state.plans.filter(row=>row.date===date).reduce((sum,row)=>sum+number(row.target),0);return [actual,target]}));
  $('#production-chart').innerHTML = `<div class="bar-chart">${lastDates.map(date=>{const actual=state.productions.filter(row=>row.date===date).reduce((sum,row)=>sum+number(row.quantity),0);const target=state.plans.filter(row=>row.date===date).reduce((sum,row)=>sum+number(row.target),0);return `<div class="bar-group"><span class="bar bar-plan" style="height:${Math.max(target?2:0,target/max*100)}%" title="계획 ${fmt(target)} EA"></span><span class="bar bar-actual" style="height:${Math.max(actual?2:0,actual/max*100)}%" title="실제 ${fmt(actual)} EA"></span><span class="bar-label">${dateLabel(date)}</span></div>`}).join('')}</div>`;
  const rate=passRate(),bad=100-rate;
  $('#quality-chart').innerHTML=`<div class="donut" style="background:conic-gradient(#3ab586 0% ${rate}%,#f0a0a0 ${rate}% 100%)"><div class="donut-label"><strong>${percent(rate,1)}</strong><small>합격률</small></div></div>`;
  $('#quality-legend').innerHTML=`<span><i style="background:#3ab586"></i>합격 ${percent(rate,1)}</span><span><i style="background:#f0a0a0"></i>불량 ${percent(bad,1)}</span>`;
  const recent=[...state.productions].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,4);
  $('#recent-production').innerHTML=recent.length?recent.map(row=>{const plan=planFor(row.planId);const achievement=plan?row.quantity/Math.max(1,plan.target)*100:0;return `<tr><td>${itemCell(itemFor(row.itemId))}</td><td>${dateLabel(row.date)}</td><td>${fmt(row.quantity)} EA</td><td><div class="progress-inline"><span class="progress-track"><span class="progress-fill" style="display:block;width:${Math.min(100,achievement)}%"></span></span>${percent(achievement,0)}</div></td></tr>`}).join(''):emptyRow(4);
  $('#inventory-overview').innerHTML=state.items.slice(0,5).map(item=>{const stock=inventoryFor(item.id),ratio=item.safetyStock?Math.min(100,stock/item.safetyStock*55):70;return `<div class="inventory-row"><span class="inventory-name">${escapeHTML(item.name)}</span><span class="inventory-track"><span class="inventory-fill ${stock<=item.safetyStock?'low':''}" style="display:block;width:${ratio}%"></span></span><span class="inventory-number">${fmt(stock)} ${escapeHTML(item.unit)}</span></div>`}).join('')||'<p class="form-note">등록된 품목이 없습니다.</p>';
}

function renderItems(query='') {
  const rows=state.items.filter(item=>`${item.code} ${item.name} ${item.spec}`.toLowerCase().includes(query.toLowerCase()));
  $('#items-count').textContent=`전체 ${rows.length}개`;
  $('#items-table').innerHTML=rows.length?rows.map(item=>`<tr><td><strong>${escapeHTML(item.code)}</strong></td><td>${itemCell(item)}</td><td>${escapeHTML(item.spec||'—')}</td><td>${escapeHTML(item.unit)}</td><td>${fmt(item.safetyStock)} ${escapeHTML(item.unit)}</td><td>${fmt(inventoryFor(item.id))} ${escapeHTML(item.unit)}</td><td>${actionButtons('item',item.id)}</td></tr>`).join(''):emptyRow(7,'검색 결과가 없습니다.');
}
function renderPlans(query='') {
  const rows=[...state.plans].sort((a,b)=>b.date.localeCompare(a.date)).filter(plan=>`${plan.number} ${itemFor(plan.itemId)?.name||''}`.toLowerCase().includes(query.toLowerCase()));
  $('#plans-count').textContent=`전체 ${rows.length}개`;
  $('#plans-table').innerHTML=rows.length?rows.map(plan=>{const actual=productionsForPlan(plan.id),achievement=actual/Math.max(1,number(plan.target))*100;const status=achievement>=100?badge('완료','green'):plan.date<todayISO()?badge('미달','red'):actual?badge('진행 중','blue'):badge('대기','gray');return `<tr><td><strong>${escapeHTML(plan.number)}</strong></td><td>${dateLabel(plan.date)}</td><td>${itemCell(itemFor(plan.itemId))}</td><td>${fmt(plan.target)} ${escapeHTML(itemFor(plan.itemId)?.unit||'EA')}</td><td>${fmt(actual)}</td><td><div class="progress-inline"><span class="progress-track"><span class="progress-fill" style="display:block;width:${Math.min(100,achievement)}%"></span></span>${percent(achievement,0)}</div></td><td>${status}</td><td>${actionButtons('plan',plan.id)}</td></tr>`}).join(''):emptyRow(8,'등록된 생산계획이 없습니다.');
}
function renderProduction(query='') {
  const rows=[...state.productions].sort((a,b)=>b.date.localeCompare(a.date)).filter(row=>`${itemFor(row.itemId)?.name||''} ${row.lot} ${planFor(row.planId)?.number||''}`.toLowerCase().includes(query.toLowerCase()));
  $('#production-count').textContent=`전체 ${rows.length}건`;
  $('#production-table').innerHTML=rows.length?rows.map(row=>{const plan=planFor(row.planId);const achievement=plan?row.quantity/Math.max(1,plan.target)*100:null;return `<tr><td>${dateLabel(row.date)}</td><td>${itemCell(itemFor(row.itemId))}</td><td>${escapeHTML(plan?.number||'—')}</td><td>${escapeHTML(row.lot||'—')}</td><td><strong>${fmt(row.quantity)}</strong> ${escapeHTML(itemFor(row.itemId)?.unit||'EA')}</td><td>${achievement===null?badge('계획 없음','gray'):`<div class="progress-inline"><span class="progress-track"><span class="progress-fill" style="display:block;width:${Math.min(100,achievement)}%"></span></span>${percent(achievement,0)}</div>`}</td><td>${actionButtons('production',row.id)}</td></tr>`}).join(''):emptyRow(7,'등록된 생산실적이 없습니다.');
}
function renderQuality(query='') {
  const rows=[...state.quality].sort((a,b)=>b.date.localeCompare(a.date)).filter(row=>`${itemFor(row.itemId)?.name||''} ${row.lot} ${row.defectType} ${row.checkItem}`.toLowerCase().includes(query.toLowerCase()));
  const inspected=state.quality.reduce((sum,row)=>sum+number(row.quantity),0),defects=state.quality.reduce((sum,row)=>sum+number(row.defects),0);
  $('#quality-summary').innerHTML=`<div class="summary-box"><span>누적 검사 수량</span><strong>${fmt(inspected)} EA</strong></div><div class="summary-box"><span>누적 불량 수량</span><strong>${fmt(defects)} EA</strong></div><div class="summary-box"><span>품질 합격률</span><strong>${percent(passRate())}</strong></div>`;
  $('#quality-count').textContent=`전체 ${rows.length}건`;
  $('#quality-table').innerHTML=rows.length?rows.map(row=>`<tr><td>${dateLabel(row.date)}</td><td>${itemCell(itemFor(row.itemId))}</td><td>${escapeHTML(row.lot||'—')}</td><td><span title="${escapeHTML(row.standard||'')}">${escapeHTML(row.checkItem||'—')}</span></td><td>${fmt(row.quantity)}</td><td>${fmt(row.defects)}</td><td>${escapeHTML(row.defectType||'—')}</td><td>${number(row.defects)===0?badge('합격','green'):number(row.defects)<number(row.quantity)*.05?badge('부분 불량','orange'):badge('불합격','red')}</td><td>${actionButtons('quality',row.id)}</td></tr>`).join(''):emptyRow(9,'등록된 품질검사 내역이 없습니다.');
}
function renderInventory(query='') {
  const items=state.items.filter(item=>`${item.code} ${item.name}`.toLowerCase().includes(query.toLowerCase()));
  const total=state.items.reduce((sum,item)=>sum+inventoryFor(item.id),0),low=state.items.filter(item=>inventoryFor(item.id)<=number(item.safetyStock)).length;
  $('#inventory-summary').innerHTML=`<div class="summary-box"><span>전체 품목 재고</span><strong>${fmt(total)} EA</strong></div><div class="summary-box"><span>관리 품목 수</span><strong>${fmt(state.items.length)} 종</strong></div><div class="summary-box"><span>안전재고 미달</span><strong>${fmt(low)} 품목</strong></div>`;
  $('#inventory-count').textContent=`전체 ${items.length}개 품목`;
  $('#inventory-table').innerHTML=items.length?items.map(item=>{const stock=inventoryFor(item.id);const lastIn=[...state.movements].filter(row=>row.itemId===item.id&&row.type==='in').sort((a,b)=>b.date.localeCompare(a.date))[0];const lastOut=[...state.movements].filter(row=>row.itemId===item.id&&row.type==='out').sort((a,b)=>b.date.localeCompare(a.date))[0];return `<tr><td><strong>${escapeHTML(item.code)}</strong></td><td>${itemCell(item)}</td><td><strong>${fmt(stock)}</strong> ${escapeHTML(item.unit)}</td><td>${fmt(item.safetyStock)} ${escapeHTML(item.unit)}</td><td>${stock<=item.safetyStock?badge('재고 부족','red'):stock<=item.safetyStock*1.3?badge('재고 주의','orange'):badge('정상','green')}</td><td>${lastIn?dateLabel(lastIn.date):'—'}</td><td>${lastOut?dateLabel(lastOut.date):'—'}</td><td><button class="action-button" data-stock-for="${escapeHTML(item.id)}">입출고</button></td></tr>`}).join(''):emptyRow(8,'등록된 품목이 없습니다.');
  const movements=[...state.movements].sort((a,b)=>b.date.localeCompare(a.date)).slice(0,7);
  $('#movements-table').innerHTML=movements.length?movements.map(row=>`<tr><td>${dateLabel(row.date)}</td><td>${itemCell(itemFor(row.itemId))}</td><td>${row.type==='in'?badge('입고','green'):badge('출고','orange')}</td><td>${row.type==='in'?'+':'−'}${fmt(row.quantity)}</td><td>${escapeHTML(row.lot||'—')}</td><td>${escapeHTML(row.note||'—')}</td></tr>`).join(''):emptyRow(6,'재고 입출고 내역이 없습니다.');
}
function renderAnalytics() {
  const totalProduction=productionTotal(),totalPlan=state.plans.reduce((sum,row)=>sum+number(row.target),0),achievement=totalPlan?totalProduction/totalPlan*100:0,inspected=state.quality.reduce((sum,row)=>sum+number(row.quantity),0),defects=state.quality.reduce((sum,row)=>sum+number(row.defects),0);
  $('#analytics-stats').innerHTML=[statCard('누적 생산량',fmt(totalProduction),'EA','▥','blue',`총 ${state.productions.length}건의 생산실적`),statCard('계획 달성률',percent(achievement),'','↗','green',`전체 목표 ${fmt(totalPlan)} EA 대비`),statCard('누적 품질 합격률',percent(passRate()),'','✓','orange',`검사 ${fmt(inspected)} EA 기준`),statCard('누적 불량 수량',fmt(defects),'EA','!','purple',`불량률 ${percent(inspected?defects/inspected*100:0)}`)].join('');
  const months=Array.from({length:6},(_,index)=>{const date=new Date();date.setMonth(date.getMonth()-(5-index));return {key:`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`,label:date.toLocaleDateString('ko-KR',{month:'short'}).replace('.','')}});
  const monthVals=months.map(month=>state.productions.filter(row=>row.date.startsWith(month.key)).reduce((sum,row)=>sum+number(row.quantity),0)),max=Math.max(1,...monthVals);
  $('#monthly-chart').innerHTML=`<div class="bar-chart">${months.map((month,i)=>`<div class="bar-group"><span class="bar bar-actual" style="width:18px;height:${Math.max(monthVals[i]?2:0,monthVals[i]/max*100)}%" title="${fmt(monthVals[i])} EA"></span><span class="bar-label">${escapeHTML(month.label)}</span></div>`).join('')}</div>`;
  const ranked=[...state.items].map(item=>({item,total:productionTotal(item.id)})).sort((a,b)=>b.total-a.total).slice(0,5),rankMax=Math.max(1,...ranked.map(row=>row.total));
  $('#item-ranking').innerHTML=ranked.length?ranked.map((row,i)=>`<div class="ranking-row"><span class="rank-number">${String(i+1).padStart(2,'0')}</span><span class="rank-name">${escapeHTML(row.item.name)}</span><span class="rank-bar"><span style="width:${row.total/rankMax*100}%"></span></span><span class="rank-value">${fmt(row.total)}</span></div>`).join(''):'<p class="form-note">분석할 품목이 없습니다.</p>';
  const defectMap={};state.quality.forEach(row=>{const key=row.defectType||'미분류';defectMap[key]=(defectMap[key]||0)+number(row.defects)});
  const defectRows=Object.entries(defectMap).sort((a,b)=>b[1]-a[1]).slice(0,5),defectMax=Math.max(1,...defectRows.map(row=>row[1]));
  $('#defect-ranking').innerHTML=defectRows.length?defectRows.map(([name,count],i)=>`<div class="ranking-row"><span class="rank-number">${String(i+1).padStart(2,'0')}</span><span class="rank-name">${escapeHTML(name)}</span><span class="rank-bar"><span style="width:${count/defectMax*100}%;background:#e5a074"></span></span><span class="rank-value">${fmt(count)}</span></div>`).join(''):'<p class="form-note">등록된 불량 기록이 없습니다.</p>';
  const done=state.plans.filter(plan=>productionsForPlan(plan.id)>=number(plan.target)).length,inProgress=state.plans.filter(plan=>{const actual=productionsForPlan(plan.id);return actual>0&&actual<number(plan.target)}).length,pending=Math.max(0,state.plans.length-done-inProgress),total=Math.max(1,state.plans.length);
  $('#plan-status').innerHTML=[['완료',done,'success'],['진행 중',inProgress,''],['대기 / 미달',pending,'']].map(([label,count,cls])=>`<div><div class="status-line"><span>${label}</span><strong>${fmt(count)}건</strong></div><div class="status-progress ${cls}"><span style="width:${count/total*100}%"></span></div></div>`).join('');
}
function refresh() { renderDashboard();renderItems($('[data-search="items"]')?.value||'');renderPlans($('[data-search="plans"]')?.value||'');renderProduction($('[data-search="production"]')?.value||'');renderQuality($('[data-search="quality"]')?.value||'');renderInventory($('[data-search="inventory"]')?.value||'');renderAnalytics(); }

const itemSelect = selected => `<option value="">품목을 선택하세요</option>${state.items.map(item=>`<option value="${escapeHTML(item.id)}" ${selected===item.id?'selected':''}>${escapeHTML(item.code)} · ${escapeHTML(item.name)}</option>`).join('')}`;
const planSelect = (selected,itemId) => `<option value="">계획 미연결</option>${state.plans.filter(plan=>!itemId||plan.itemId===itemId).map(plan=>`<option value="${escapeHTML(plan.id)}" ${selected===plan.id?'selected':''}>${escapeHTML(plan.number)} · ${dateLabel(plan.date)} · ${escapeHTML(itemFor(plan.itemId)?.name||'')}</option>`).join('')}`;
function field(name,label,value='',type='text',opts={}) { const id=`field-${name}`;const required=opts.required!==false?'required':'';if(type==='select')return `<div class="field ${opts.full?'full-width':''}"><label for="${id}">${label}${required?' *':''}</label><select id="${id}" name="${name}" ${required}>${opts.options||''}</select></div>`;if(type==='textarea')return `<div class="field ${opts.full?'full-width':''}"><label for="${id}">${label}</label><textarea id="${id}" name="${name}" placeholder="${escapeHTML(opts.placeholder||'')}">${escapeHTML(value)}</textarea></div>`;return `<div class="field ${opts.full?'full-width':''}"><label for="${id}">${label}${required?' *':''}</label><input id="${id}" name="${name}" type="${type}" value="${escapeHTML(value)}" ${required} ${opts.min!==undefined?`min="${opts.min}"`:''} ${opts.step!==undefined?`step="${opts.step}"`:''} placeholder="${escapeHTML(opts.placeholder||'')}"></div>`; }
function openModal(kind,id=null,extra={}) {
  modalKind=kind;editingId=id;const existing=id?({item:itemFor(id),plan:planFor(id),production:state.productions.find(row=>row.id===id),quality:state.quality.find(row=>row.id===id),stock:state.movements.find(row=>row.id===id)}[kind]):null;
  if(id&&!existing){toast('수정할 데이터를 찾을 수 없습니다.');return;}
  const labels={item:'품목',plan:'생산계획',production:'생산실적',quality:'품질검사',stock:'재고 입출고'};
  $('#modal-title').textContent=`${existing?'품목 수정'.replace('품목',labels[kind]):'새 '+labels[kind]+' 등록'}`;
  let fields='';
  if(kind==='item')fields=field('code','품목코드',existing?.code||'')+field('name','품목명',existing?.name||'')+field('spec','규격',existing?.spec||'')+field('unit','단위',existing?.unit||'EA')+field('safetyStock','안전재고',existing?.safetyStock??0,'number',{min:0})+field('openingStock','기초 재고',existing?.openingStock??0,'number',{min:0})+`<p class="form-note full-width">현재고는 기초 재고 + 품질검사 합격 수량 + 수동 입고 − 수동 출고로 자동 계산됩니다.</p>`;
  if(kind==='plan')fields=field('number','계획번호',existing?.number||`PL-${todayISO().replaceAll('-','').slice(2)}-${String(state.plans.length+1).padStart(3,'0')}`)+field('date','생산 예정일',existing?.date||todayISO(),'date')+field('itemId','생산 품목',existing?.itemId||extra.itemId||'','select',{options:itemSelect(existing?.itemId||extra.itemId)})+field('target','목표 수량',existing?.target??'','number',{min:1})+field('note','메모',existing?.note||'','text',{full:true,required:false,placeholder:'생산 관련 참고사항'})+`<p class="form-note full-width">생산계획에 실적을 연결하면 품목별 달성률이 자동 계산됩니다.</p>`;
  if(kind==='production')fields=field('itemId','생산 품목',existing?.itemId||extra.itemId||'','select',{options:itemSelect(existing?.itemId||extra.itemId)})+field('planId','연결 생산계획',existing?.planId||extra.planId||'','select',{options:planSelect(existing?.planId,existing?.itemId||extra.itemId)})+field('date','생산일',existing?.date||todayISO(),'date')+field('quantity','실제 생산 수량',existing?.quantity??'','number',{min:1})+field('lot','LOT 번호',existing?.lot||`LOT-${todayISO().replaceAll('-','').slice(2)}-A01`)+`<p class="form-note full-width">연결된 생산계획이 있으면 달성률이 자동 반영됩니다.</p>`;
  if(kind==='quality')fields=field('itemId','검사 품목',existing?.itemId||extra.itemId||'','select',{options:itemSelect(existing?.itemId||extra.itemId)})+field('lot','LOT 번호',existing?.lot||extra.lot||'')+field('date','검사일',existing?.date||todayISO(),'date')+field('quantity','검사 수량',existing?.quantity??'','number',{min:1})+field('defects','불량 수량',existing?.defects??0,'number',{min:0})+field('checkItem','검사 항목',existing?.checkItem||'외관 검사')+field('standard','합격 기준',existing?.standard||'이상 없음')+field('defectType','불량 유형',existing?.defectType||'', 'text',{placeholder:'불량이 없으면 비워 두세요'})+`<p class="form-note full-width">검사 수량 − 불량 수량을 합격 수량으로 보고 자동 입고 처리합니다.</p>`;
  if(kind==='stock')fields=field('itemId','재고 품목',existing?.itemId||extra.itemId||'','select',{options:itemSelect(existing?.itemId||extra.itemId)})+`<div class="field"><label>유형 *</label><div class="stock-direction"><label><input type="radio" name="type" value="in" ${existing?.type!=='out'?'checked':''}><span>＋ 입고</span></label><label><input type="radio" name="type" value="out" ${existing?.type==='out'?'checked':''}><span>− 출고</span></label></div></div>`+field('date','처리일',existing?.date||todayISO(),'date')+field('quantity','수량',existing?.quantity??'','number',{min:1})+field('lot','LOT 번호',existing?.lot||'', 'text',{required:false})+field('note','메모',existing?.note||'','text',{full:true,required:false,placeholder:'입고 / 출고 사유'});
  $('#modal-fields').innerHTML=fields;$('#modal-backdrop').hidden=false;document.body.style.overflow='hidden';$('#modal-fields input:not([type=radio]), #modal-fields select')?.focus();
}
function closeModal() { $('#modal-backdrop').hidden=true;document.body.style.overflow='';$('#record-form').reset();modalKind=null;editingId=null; }
function submitForm(event) {
  event.preventDefault();const form=new FormData(event.currentTarget),data=Object.fromEntries(form.entries());
  for(const key of ['quantity','target','safetyStock','openingStock','defects'])if(data[key]!==undefined)data[key]=Number(data[key]);
  if(data.itemId&&!itemFor(data.itemId)){toast('품목을 선택하세요.');return;}
  if(modalKind==='item'){
    if(state.items.some(item=>item.code.toLowerCase()===data.code.toLowerCase()&&item.id!==editingId)){toast('이미 사용 중인 품목코드입니다.');return;}
    if(editingId){const old=itemFor(editingId);Object.assign(old,data);}else state.items.unshift({id:makeId('itm'),...data});
  }
  if(modalKind==='plan'){
    if(state.plans.some(plan=>plan.number.toLowerCase()===data.number.toLowerCase()&&plan.id!==editingId)){toast('이미 사용 중인 계획번호입니다.');return;}
    if(editingId){if(state.productions.some(row=>row.planId===editingId&&row.itemId!==data.itemId)){toast('생산실적이 연결된 계획의 품목은 변경할 수 없습니다.');return;}Object.assign(planFor(editingId),data);}else state.plans.unshift({id:makeId('pln'),...data});
  }
  if(modalKind==='production'){
    const linkedPlan=data.planId?planFor(data.planId):null;if(data.planId&&(!linkedPlan||linkedPlan.itemId!==data.itemId)){toast('선택한 품목에 해당하는 생산계획을 연결하세요.');return;}
    if(editingId)Object.assign(state.productions.find(row=>row.id===editingId),data);else state.productions.unshift({id:makeId('prd'),...data});
  }
  if(modalKind==='quality'){
    if(data.defects>data.quantity){toast('불량 수량은 검사 수량보다 클 수 없습니다.');return;}
    if(editingId)Object.assign(state.quality.find(row=>row.id===editingId),data);else state.quality.unshift({id:makeId('qc'),...data});
  }
  if(modalKind==='stock'){
    const previousMovement=editingId?state.movements.find(row=>row.id===editingId):null;
    const available=inventoryFor(data.itemId)+(previousMovement?.type==='out'?number(previousMovement.quantity):0);
    if(data.type==='out'&&number(data.quantity)>available){toast(`출고 수량이 현재 재고(${fmt(available)})를 초과합니다.`);return;}
    if(editingId)Object.assign(state.movements.find(row=>row.id===editingId),data);else state.movements.unshift({id:makeId('mov'),...data});
  }
  const message=`${editingId?'수정':'등록'}되었습니다.`;closeModal();saveAndRefresh(message);
}

function deleteRecord(kind,id) {
  const collections={item:'items',plan:'plans',production:'productions',quality:'quality',stock:'movements'},collection=collections[kind];if(!collection)return;
  const record=state[collection].find(row=>row.id===id);if(!record)return;
  if(kind==='item'&&(state.plans.some(row=>row.itemId===id)||state.productions.some(row=>row.itemId===id)||state.quality.some(row=>row.itemId===id)||state.movements.some(row=>row.itemId===id))){toast('생산·품질·재고 내역에 연결된 품목은 삭제할 수 없습니다.');return;}
  if(kind==='plan'&&state.productions.some(row=>row.planId===id)){toast('생산실적이 연결된 계획은 삭제할 수 없습니다.');return;}
  if(kind==='stock'&&record.type==='out'&&inventoryFor(record.itemId)+number(record.quantity)<0){toast('이 출고 기록을 삭제하면 재고가 음수가 되어 삭제할 수 없습니다.');return;}
  if(!window.confirm('이 데이터를 삭제하시겠습니까? 삭제된 데이터는 복구할 수 없습니다.'))return;
  state[collection]=state[collection].filter(row=>row.id!==id);saveAndRefresh('삭제되었습니다.');
}
function navigate(page) {
  const target=$(`#page-${page}`);if(!target)return;
  $$('.page-view').forEach(view=>view.classList.toggle('active',view===target));$$('.nav-item[data-page]').forEach(button=>button.classList.toggle('active',button.dataset.page===page));
  const active=$(`.nav-item[data-page="${page}"] span:last-child`);$('#breadcrumb-current').textContent=active?.textContent||'통합 대시보드';$('#sidebar').classList.remove('open');window.scrollTo({top:0,behavior:'smooth'});
}
function exportData() { const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=`smartflow-backup-${todayISO()}.json`;link.click();URL.revokeObjectURL(url);toast('현재 데이터를 JSON 파일로 백업했습니다.'); }
function exportCSV() {
  const rows=[['생산일','품목코드','품목명','계획번호','LOT 번호','생산 수량','목표 수량','달성률(%)'],...state.productions.map(row=>{const item=itemFor(row.itemId),plan=planFor(row.planId);return [row.date,item?.code||'',item?.name||'',plan?.number||'',row.lot||'',row.quantity,plan?.target||'',plan?((row.quantity/Math.max(1,plan.target))*100).toFixed(1):'']})];
  const csv='\ufeff'+rows.map(row=>row.map(value=>`"${String(value).replaceAll('"','""')}"`).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=document.createElement('a');link.href=url;link.download=`smartflow-production-${todayISO()}.csv`;link.click();URL.revokeObjectURL(url);toast('생산 분석 데이터를 CSV로 내보냈습니다.');
}

document.addEventListener('click',event=>{
  const page=event.target.closest('[data-page]');if(page){navigate(page.dataset.page);return;}
  const nav=event.target.closest('[data-navigate]');if(nav){navigate(nav.dataset.navigate);return;}
  const open=event.target.closest('[data-open-modal]');if(open){openModal(open.dataset.openModal);return;}
  const edit=event.target.closest('[data-edit]');if(edit){const [kind,id]=edit.dataset.edit.split(':');openModal(kind,id);return;}
  const del=event.target.closest('[data-delete]');if(del){const [kind,id]=del.dataset.delete.split(':');deleteRecord(kind,id);return;}
  const stock=event.target.closest('[data-stock-for]');if(stock){openModal('stock',null,{itemId:stock.dataset.stockFor});return;}
  if(event.target.id==='modal-close'||event.target.id==='modal-cancel'||event.target.id==='modal-backdrop')closeModal();
});
document.addEventListener('input',event=>{const key=event.target.dataset.search;if(key){({items:renderItems,plans:renderPlans,production:renderProduction,quality:renderQuality,inventory:renderInventory}[key])(event.target.value)}});
document.addEventListener('change',event=>{if(event.target.name==='itemId'&&modalKind==='production'){const planField=$('#field-planId');if(planField)planField.innerHTML=planSelect('',event.target.value);}});
$('#record-form').addEventListener('submit',submitForm);$('#mobile-menu').addEventListener('click',()=>$('#sidebar').classList.toggle('open'));$('#export-data').addEventListener('click',exportData);$('#analytics-export').addEventListener('click',exportCSV);
$('#reset-demo').addEventListener('click',()=>{if(!window.confirm('현재 저장된 데이터를 초기 샘플 데이터로 바꾸시겠습니까?'))return;state=initialState();saveAndRefresh('초기 샘플 데이터로 복원했습니다.');});
document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!$('#modal-backdrop').hidden)closeModal();});
$('#today-label').textContent=new Date().toLocaleDateString('ko-KR',{year:'numeric',month:'long',day:'numeric',weekday:'short'});
refresh();