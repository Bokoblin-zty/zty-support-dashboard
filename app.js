const SUPABASE_URL = "https://nmjjgqlcwiqbvpjkyink.supabase.co";
const SUPABASE_KEY = "sb_publishable_lcaNfMEmLYmIk3Yhlu7Rzw_WfF5qtgX";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let DATA = { events:[], records:[], birthRecords:[], rewardStatus:[], aliases:[], rewardRules:[], birthRewardRules:[], birthRewardStatus:[], specialRankRewards:[] };
let state = { view:'overview', event:'', user:null };

const num = v => {
  if (v === null || v === undefined || v === '') return 0;
  const cleaned = String(v).replace(/,/g,'').trim();
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
};
const fmt = n => num(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const fmtVotes = n => num(n).toLocaleString('zh-CN',{minimumFractionDigits:2,maximumFractionDigits:2});
const byAmountDesc = (a,b) => num(b.value ?? b.total ?? b.amount) - num(a.value ?? a.total ?? a.amount);
const byNameAsc = (a,b) => String(a.name ?? a.user_name ?? '').localeCompare(String(b.name ?? b.user_name ?? ''),'zh-Hans-CN');
const canon = name => {
  const raw = String(name||'').trim();
  const hit = DATA.aliases.find(a=>a.alias_name===raw);
  return hit ? hit.canonical_name : raw;
};
const escapeHtml = s => String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

async function loadAll(){
  const [events, records, birth, status, aliases, rewardRules, birthRewardRules, birthRewardStatus, specialRankRewards] = await Promise.all([
    sb.from('pk_events').select('*').order('sort_order',{ascending:true}),
    sb.from('pk_records').select('*'),
    sb.from('birth_fund_records').select('*'),
    sb.from('reward_status').select('*'),
    sb.from('name_aliases').select('*'),
    sb.from('reward_rules').select('*').order('sort_order',{ascending:true}),
    sb.from('birth_reward_rules').select('*').order('sort_order',{ascending:true}),
    sb.from('birth_reward_status').select('*'),
    sb.from('special_rank_rewards').select('*').order('created_at',{ascending:false})
  ]);
  for(const res of [events,records,birth,status,aliases,rewardRules,birthRewardRules,birthRewardStatus,specialRankRewards]){
    if(res.error){ alert('读取数据失败：'+res.error.message); console.error(res.error); }
  }
  DATA.events = events.data || [];
  DATA.records = (records.data || []).map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.birthRecords = (birth.data || []).map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.rewardStatus = status.data || [];
  DATA.aliases = aliases.data || [];
  DATA.rewardRules = (rewardRules.data || []).map(r=>({
    event_name:r.event_name,
    threshold:num(r.threshold),
    reward_name:r.reward_name,
    sort_order:num(r.sort_order||0)
  }));
  DATA.birthRewardRules = (birthRewardRules.data || []).map(r=>({
    threshold:num(r.threshold ?? r.min_amount ?? r.amount),
    reward_name:r.reward_name ?? r.reward ?? r.name ?? r.title,
    sort_order:num(r.sort_order||0)
  })).filter(r=>r.reward_name);
  DATA.birthRewardStatus = birthRewardStatus.data || [];
  DATA.specialRankRewards = (specialRankRewards.data || []).map(r=>({
    ...r,
    target_rank: num(r.target_rank),
    winner_name: canon(r.winner_name),
    fulfilled: !!r.fulfilled
  }));
  DATA.records = (records.data || []).map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.birthRecords = (birth.data || []).map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  if(!state.event && DATA.events.length) state.event = DATA.events[0].event_name;
  initControls();
  setActive(state.view);
  renderAll();
  if(state.user){ renderAdminRewards(); renderSpecialRankAdmin(); renderUnfulfilledAdmin(); }
}

function pkEvents(){ return DATA.events.filter(e=>e.is_general_election !== false); }
function eventDate(name){ return DATA.events.find(e=>e.event_name===name)?.event_date || ''; }

function aggregateByUser(records){
  const map = new Map();
  for(const r of records){
    const name = canon(r.user_name);
    if(!map.has(name)) map.set(name,{name,total:0,count:0,events:{},best:0});
    const p = map.get(name);
    p.total += +r.amount||0;
    p.count += 1;
    p.events[r.event_name] = (p.events[r.event_name]||0) + (+r.amount||0);
    p.best = Math.max(p.best,+r.amount||0);
  }
  return [...map.values()].sort((a,b)=>byAmountDesc(a,b) || byNameAsc(a,b));
}
function birthByUser(){
  const map = new Map();
  for(const r of DATA.birthRecords){
    const name=canon(r.user_name);
    map.set(name,(map.get(name)||0)+(+r.amount||0));
  }
  return [...map.entries()].map(([name,total])=>({name,total})).sort((a,b)=>byAmountDesc(a,b) || byNameAsc(a,b));
}
function allNames(){
  return [...new Set([...DATA.records.map(r=>r.user_name), ...DATA.birthRecords.map(r=>r.user_name)])].sort((a,b)=>a.localeCompare(b,'zh-Hans-CN'));
}
function getRewardStatus(user,event,reward){
  const u=canon(user);
  return DATA.rewardStatus.find(s=>canon(s.user_name)===u && s.event_name===event && s.reward_name===reward);
}
function getBirthRewardStatus(user,reward){
  const u=canon(user);
  return DATA.birthRewardStatus.find(s=>canon(s.user_name)===u && (s.reward_name ?? s.reward ?? s.name ?? s.title)===reward);
}
function rewardItemsFor(user,event,amount){
  return DATA.rewardRules
    .filter(x=>x.event_name===event)
    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || b.threshold-a.threshold)
    .filter(x=>(+amount||0)>=x.threshold)
    .map(x=>{
      const st = getRewardStatus(user,event,x.reward_name);
      const fulfilled = !!st?.fulfilled || x.reward_name==="印象瓶";
      const date = st?.fulfilled_date || (x.reward_name==="印象瓶" ? "5.18" : "");
      return {min:x.threshold, reward:x.reward_name, fulfilled, date};
    });
}
function birthRewardItemsFor(user,amount){
  return DATA.birthRewardRules
    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || b.threshold-a.threshold)
    .filter(x=>num(amount)>=num(x.threshold))
    .map(x=>{
      const st = getBirthRewardStatus(user,x.reward_name);
      return {
        min:x.threshold,
        reward:x.reward_name,
        fulfilled: !!st?.fulfilled,
        date: st?.fulfilled_date || st?.date || ''
      };
    });
}
function allEarnedRewards(){
  const out=[];
  for(const r of DATA.records){
    const items = rewardItemsFor(r.user_name, r.event_name, r.amount);
    for(const item of items){
      out.push({user_name:r.user_name,event_name:r.event_name,amount:r.amount,reward_name:item.reward,fulfilled:item.fulfilled,fulfilled_date:item.date});
    }
  }
  return out;
}

function initControls(){
  const sel=document.getElementById('eventSelect');
  sel.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
  if(state.event) sel.value=state.event;
  sel.onchange=e=>{state.event=e.target.value; state.view='event'; setActive('event'); renderAll();};
  document.getElementById('nameOptions').innerHTML = allNames().map(n=>`<option value="${escapeHtml(n)}"></option>`).join('');
  const personalInput=document.getElementById('personalLookup');
  if(personalInput) personalInput.oninput=renderPersonalSearch;
  const clearPersonal=document.getElementById('clearPersonalLookup');
  if(clearPersonal) clearPersonal.onclick=()=>{document.getElementById('personalLookup').value='';renderPersonalSearch();};
  const specialEvent=document.getElementById('specialEventName');
  if(specialEvent) specialEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
  const unfulfilledEvent=document.getElementById('unfulfilledEventSelect');
  if(unfulfilledEvent){
    unfulfilledEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
    unfulfilledEvent.onchange=()=>{
      populateUnfulfilledRewardSelect();
      renderUnfulfilledAdmin();
    };
    populateUnfulfilledRewardSelect();
  }
}
function setActive(v){
  const pkViews=['personal','participant','event','birth'];
  const mainView = pkViews.includes(v) ? 'pk' : (v==='overview' ? 'overview' : v);

  document.querySelectorAll('.btn[data-main-view]').forEach(b=>b.classList.toggle('active',b.dataset.mainView===mainView));
  document.querySelectorAll('.btn[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));

  const pkSub=document.getElementById('pkSubNav');
  if(pkSub) pkSub.classList.toggle('hidden', mainView!=='pk');

  const pkSubTitle=document.getElementById('pkSubTitle');
  if(pkSubTitle && mainView==='pk'){
    const labelMap={personal:'总数据排名',participant:'总选排名',event:'单场总选',birth:'生公排名'};
    pkSubTitle.textContent='集资排名分类 · ' + (labelMap[v] || '总数据排名');
  }

  const eventBox=document.getElementById('eventFilterBox');
  if(eventBox) eventBox.classList.toggle('hidden', v!=='event');
}
document.querySelectorAll('.btn[data-main-view]').forEach(b=>b.onclick=()=>{const mv=b.dataset.mainView;state.view=mv==='pk'?'personal':mv;setActive(state.view);renderAll();});
  document.querySelectorAll('.btn[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;setActive(state.view);renderAll();});
document.getElementById('clearLookup').onclick=()=>{document.getElementById('nameLookup').value='';renderLookup();};
document.getElementById('nameLookup').oninput=renderLookup;
document.getElementById('onlyUnfulfilled').onchange=renderLookup;

function renderAll(){
  const pk = DATA.records;
  const participants = aggregateByUser(pk);
  const total = pk.reduce((s,r)=>s+(+r.amount||0),0);
  const birthUsers=birthByUser();
  const btotal=DATA.birthRecords.reduce((s,r)=>s+(+r.amount||0),0);
  const fundTotal=document.getElementById('fundTotal');
  const fundUsers=document.getElementById('fundUsers');
  if(fundTotal) fundTotal.textContent = fmt(total + btotal);
  if(fundUsers) fundUsers.textContent = allNames().length;
  document.getElementById('kEvents').textContent = pkEvents().length;
  document.getElementById('kTotal').textContent = fmt(total);
  document.getElementById('kUsers').textContent = participants.length;
  document.getElementById('kAvg').textContent = fmt(total / Math.max(participants.length,1));
  document.getElementById('bTotal').textContent = fmt(btotal);
  document.getElementById('bUsers').textContent = birthUsers.length;
  document.getElementById('bAvg').textContent = fmt(btotal/Math.max(birthUsers.length,1));
  const bRecords=document.getElementById('bRecords');
  if(bRecords) bRecords.textContent = DATA.birthRecords.length;
  const personalCard=document.getElementById('personalLookupCard');
  const rewardCard=document.getElementById('lookupCard');
  const mainTableCard=document.getElementById('mainTableCard');
  if(personalCard) personalCard.classList.toggle('hidden', state.view!=='personal');
  if(rewardCard) rewardCard.classList.toggle('hidden', state.view!=='rewards');
  if(mainTableCard) mainTableCard.classList.toggle('hidden', state.view==='rewards');
  renderTable();
  renderLookup();
  renderPersonalSearch();
}

function renderTable(){
  const searchEl=document.getElementById('search');
  const kw=searchEl ? searchEl.value.trim().toLowerCase() : '';
  const thead=document.getElementById('thead'), tbody=document.getElementById('tbody'), title=document.getElementById('tableTitle');
  let rows=[];
  if(state.view==='overview'){
    title.textContent='集资数据总览';
    thead.innerHTML='';
    const pkList=aggregateByUser(DATA.records);
    const birthList=birthByUser();
    const pkTotal=pkList.reduce((s,p)=>s+num(p.total),0);
    const birthTotal=birthList.reduce((s,p)=>s+num(p.total),0);
    const allUserCount=allNames().length;
    const totalContribution=pkTotal+birthTotal;
    const combinedRows=allNames().map(name=>{
      const pkAmount=pkList.find(p=>p.name===name)?.total || 0;
      const birthAmount=birthList.find(p=>p.name===name)?.total || 0;
    return {name,total:pkAmount+birthAmount,pk:pkAmount,birth:birthAmount};
    }).sort((a,b)=>num(b.total)-num(a.total) || byNameAsc(a,b));
    const topList = (rows, type) => rows.slice(0,3).map((r,i)=>`
      <div class="overviewRankItem rank-${i+1}">
        <div class="rankIdentity">
          <span class="pill rankPill ${i===0?'top1':(i===1?'top2':'top3')}">#${i+1}</span>
          <b>${escapeHtml(r.name)}</b>
        </div>
        <div class="small rankBreakdown">${type==='total'?`总选 ${fmt(r.pk)} ｜ 生公 ${fmt(r.birth)}`:(type==='pk'?'总选金额':'生公金额')}</div>
        <div class="rankAmount"><strong>${fmt(r.total)}</strong></div>
      </div>`).join('') || '<div class="small">暂无数据</div>';
    tbody.innerHTML=`
      <tr class="overviewHeroRow">
        <td colspan="3">
          <div class="overviewPanel">
            <div class="overviewTitle">集资数据总览</div>
            <div class="overviewDesc">数据分为总选集资与生公集资两部分；首页展示总数据、总选数据和生公数据的核心统计与排名摘要。</div>
            <div class="overviewGrid">
              <div class="overviewMini primary"><span>集资总额</span><b>${fmt(totalContribution)}</b></div>
              <div class="overviewMini"><span>总选集资</span><b>${fmt(pkTotal)}</b></div>
              <div class="overviewMini"><span>生公集资</span><b>${fmt(birthTotal)}</b></div>
              <div class="overviewMini"><span>总参与人数</span><b>${allUserCount}</b></div>
            </div>
            <div class="overviewRankGrid">
              <div class="overviewRankCard"><h3>总数据 TOP3</h3>${topList(combinedRows,'total')}</div>
              <div class="overviewRankCard"><h3>总选 TOP3</h3>${topList(pkList.map(p=>({name:p.name,total:p.total})),'pk')}</div>
              <div class="overviewRankCard"><h3>生公 TOP3</h3>${topList(birthList.map(p=>({name:p.name,total:p.total})),'birth')}</div>
            </div>
          </div>
        </td>
      </tr>
    `;
    return;
  }else if(state.view==='participant'){
    title.textContent='总选集资排名';
    thead.innerHTML='<tr class="noteRow"><td colspan="3" class="small">票数按 33.5 元折算 1 票，仅用于总选相关榜单展示。</td></tr><tr><th>排名</th><th>名称</th><th>总选金额</th></tr>';
    rows=aggregateByUser(DATA.records).map((p,i)=>({rank:i+1,name:p.name,value:p.total,votes:p.total/33.5,showVotes:true,search:p.name}));
  }else if(state.view==='event'){
    const event=state.event || pkEvents()[0]?.event_name;
    title.textContent=`${event} · 单场总选排名`;
    thead.innerHTML='<tr class="noteRow"><td colspan="3" class="small">票数按 33.5 元折算 1 票，仅用于总选相关榜单展示。</td></tr><tr><th>排名</th><th>名称</th><th>金额</th></tr>';
    rows=DATA.records.filter(r=>r.event_name===event)
      .sort((a,b)=>byAmountDesc(a,b) || String(a.user_name).localeCompare(String(b.user_name),'zh-Hans-CN'))
      .map((r,i)=>({rank:i+1,name:r.user_name,value:num(r.amount),votes:num(r.amount)/33.5,showVotes:true,search:`${r.user_name} ${r.event_name}`}));
  }else if(state.view==='birth'){
    title.textContent='生公集资排名';
    thead.innerHTML='<tr><th>排名</th><th>名称</th><th>生公金额</th></tr>';
    rows=birthByUser().map((p,i)=>({rank:i+1,name:p.name,value:p.total,search:p.name}));
  }else if(state.view==='personal'){
    title.textContent='总数据排名';
    thead.innerHTML='<tr><th>排名</th><th>名称</th><th>贡献合计</th></tr>';
    const pkMap=new Map(aggregateByUser(DATA.records).map(p=>[p.name,p.total]));
    const bMap=new Map(birthByUser().map(p=>[p.name,p.total]));
    rows=allNames().map(name=>({name,value:(pkMap.get(name)||0)+(bMap.get(name)||0),pk:pkMap.get(name)||0,b:bMap.get(name)||0,search:name}))
      .sort((a,b)=>byAmountDesc(a,b) || byNameAsc(a,b))
      .map((r,i)=>({...r,rank:i+1}));
  }else if(state.view==='rewards'){
    title.textContent='奖励兑现查询';
    thead.innerHTML='';
    rows=[];
    tbody.innerHTML='';
    return;
  }else if(state.view==='lottery'){
    title.textContent='抽奖结果';
    thead.innerHTML='<tr><th>类型</th><th>说明</th><th>状态</th></tr>';
    rows=[];
    tbody.innerHTML='<tr><td><span class="pill">抽奖</span></td><td><div class="emptyState"><b>抽奖结果待配置</b><div class="small">后续可显示月度 PK 抽奖和总贡献抽奖结果；当前入口保留。</div></div></td><td>待配置</td></tr>';
    return;
  }else if(state.view==='announcements'){
    title.textContent='公告通知';
    thead.innerHTML='<tr><th>类型</th><th>说明</th><th>状态</th></tr>';
    rows=[];
    tbody.innerHTML='<tr><td><span class="pill warn">公告</span></td><td><div class="announcementCard"><b>暂无新增公告</b><div class="small">公告入口与红点提示保留。后台发布公告后，可在此区域以卡片形式查看通知内容。</div></div></td><td>待更新</td></tr>';
    return;
  }else{
    title.textContent='说明';
    thead.innerHTML='<tr><th>项目</th><th>说明</th><th></th></tr>';
    rows=[];
    tbody.innerHTML='<tr><td><span class="pill">提示</span></td><td><b>请选择上方功能。</b></td><td></td></tr>';
    return;
  }
  rows=rows.filter(r=>!kw || r.search.toLowerCase().includes(kw));
  tbody.innerHTML=rows.map(r=>{
    const rankClass = r.rank===1 ? 'top1' : (r.rank===2 ? 'top2' : (r.rank===3 ? 'top3' : 'normal'));
    const rowClass = r.rank<=3 ? ` class="rank-${r.rank}"` : '';
    return `<tr${rowClass}><td><span class="pill rankPill ${rankClass}">#${r.rank}</span></td><td><b class="${r.rank<=3?'topName':''}">${escapeHtml(r.name)}</b>${state.view==='personal'?`<div class="small">总选 ${fmt(r.pk)} ｜ 生公 ${fmt(r.b)}</div>`:''}</td><td>${fmt(r.value)}${r.showVotes?`<div class="small">折合 ${fmtVotes(r.votes)} 票</div>`:''}</td></tr>`;
  }).join('') || '<tr><td colspan="3" class="small">无匹配数据</td></tr>';
}


function renderPersonalSearch(){
  const card=document.getElementById('personalLookupCard');
  const input=document.getElementById('personalLookup');
  const out=document.getElementById('personalLookupResult');
  if(!card || !input || !out || state.view!=='personal') return;

  const kw=(input.value||'').trim().toLowerCase();
  if(!kw){
    out.className='lookupResult small';
    out.innerHTML='输入完整或部分ID后，将显示你的个人总览。';
    return;
  }

  const matches=allNames().filter(n=>n.toLowerCase().includes(kw));
  if(!matches.length){
    out.className='lookupResult small';
    out.innerHTML='未找到匹配ID。';
    return;
  }

  const name=matches[0];
  const candidates = matches.length>1
    ? `<div class="small" style="margin-bottom:10px">匹配结果：${matches.map(n=>`<span class="pill personal-candidate-pill" data-name="${escapeHtml(n)}" style="cursor:pointer">${escapeHtml(n)}</span>`).join('')}</div>`
    : '';

  const pkRows=pkEvents().map(e=>({
    name:e.event_name,
    date:e.event_date,
    amount:DATA.records.filter(r=>r.user_name===name&&r.event_name===e.event_name).reduce((s,r)=>s+num(r.amount),0)
  }));
  const pkTotal=pkRows.reduce((s,r)=>s+num(r.amount),0);
  const bTotal=DATA.birthRecords.filter(r=>r.user_name===name).reduce((s,r)=>s+num(r.amount),0);
  const grandTotal=pkTotal+bTotal;
  const joinedPk=pkRows.filter(r=>num(r.amount)>0).length;
  const best=pkRows.reduce((m,r)=>num(r.amount)>num(m.amount)?r:m,{name:'-',amount:0,date:''});

  out.className='lookupResult';
  out.innerHTML=candidates+`
    <div class="lookupSummary">
      <div class="lookupMini"><span class="small">名称</span><b>${escapeHtml(name)}</b></div>
      <div class="lookupMini"><span class="small">贡献合计</span><b>${fmt(grandTotal)}</b></div>
      <div class="lookupMini"><span class="small">参与总选场次</span><b>${joinedPk}</b></div>
    </div>
    <div class="lookupSummary">
      <div class="lookupMini"><span class="small">总选金额</span><b>${fmt(pkTotal)}</b></div>
      <div class="lookupMini"><span class="small">生公金额</span><b>${fmt(bTotal)}</b></div>
      <div class="lookupMini"><span class="small">最高单场</span><b>${escapeHtml(best.name)} ${fmt(best.amount)}</b></div>
    </div>
    <div class="small" style="margin:2px 0 8px">集资合计仅供个人查询参考；总选排名只计算总选金额，生公不计入总选排名。</div>
    <div class="eventAmountList">
      ${pkRows.map(r=>`<div class="eventAmountItem"><div><b>${escapeHtml(r.name)}</b><div class="small">${escapeHtml(r.date||'')}</div></div><div class="amt">${fmt(r.amount)}</div></div>`).join('')}
      <div class="eventAmountItem"><div><b>生公专项</b><div class="small">独立统计，不计入总选</div></div><div class="amt">${fmt(bTotal)}</div></div>
    </div>
  `;

  out.querySelectorAll('.personal-candidate-pill').forEach(el=>{
    el.onclick=()=>{
      document.getElementById('personalLookup').value=el.dataset.name;
      renderPersonalSearch();
    };
  });
}

function renderLookup(){
  const kw=(document.getElementById('nameLookup').value||'').trim().toLowerCase();
  const out=document.getElementById('lookupResult');
  document.getElementById('lookupTitle').textContent = state.view==='rewards' ? '奖励兑现查询' : '个人集资查询';
  if(!kw){
    out.className='lookupResult small';
    out.innerHTML=state.view==='rewards' ? '输入名称查看奖励兑现情况。' : '输入完整或部分名称后，将显示该参与者信息。';
    return;
  }
  const matches=allNames().filter(n=>n.toLowerCase().includes(kw));
  if(!matches.length){out.className='lookupResult small'; out.innerHTML='未找到匹配名称。'; return;}
  const name=matches[0];
  const candidates = matches.length>1 ? `<div class="small" style="margin-bottom:10px">匹配结果：${matches.map(n=>`<span class="pill candidate-pill" data-name="${escapeHtml(n)}" style="cursor:pointer">${escapeHtml(n)}</span>`).join('')}</div>` : '';
  if(state.view==='rewards'){
    renderRewardLookup(name,candidates,out);
  }else{
    renderPersonalLookup(name,candidates,out);
  }
  out.querySelectorAll('.candidate-pill').forEach(el=>el.onclick=()=>{document.getElementById('nameLookup').value=el.dataset.name;renderLookup();});
}

function renderPersonalLookup(name,candidates,out){
  const pkRows=pkEvents().map(e=>({name:e.event_name,date:e.event_date,amount:DATA.records.filter(r=>r.user_name===name&&r.event_name===e.event_name).reduce((s,r)=>s+r.amount,0)}));
  const pkTotal=pkRows.reduce((s,r)=>s+r.amount,0);
  const bTotal=DATA.birthRecords.filter(r=>r.user_name===name).reduce((s,r)=>s+r.amount,0);
  out.className='lookupResult';
  out.innerHTML=candidates+`
    <div class="lookupSummary">
      <div class="lookupMini"><span class="small">名称</span><b>${escapeHtml(name)}</b></div>
      <div class="lookupMini"><span class="small">总选金额</span><b>${fmt(pkTotal)}</b></div>
      <div class="lookupMini"><span class="small">生公金额</span><b>${fmt(bTotal)}</b></div>
    </div>
    <div class="small" style="margin:2px 0 8px">个人集资合计：${fmt(pkTotal+bTotal)}。该合计仅供个人查询参考，不参与总选排名。</div>
    <div class="eventAmountList">
      ${pkRows.map(r=>`<div class="eventAmountItem"><div><b>${escapeHtml(r.name)}</b><div class="small">${escapeHtml(r.date||'')}</div></div><div class="amt">${fmt(r.amount)}</div></div>`).join('')}
      <div class="eventAmountItem"><div><b>生公专项</b><div class="small">独立统计，不计入总选</div></div><div class="amt">${fmt(bTotal)}</div></div>
    </div>`;
}

function renderRewardLookup(name,candidates,out){
  const only=document.getElementById('onlyUnfulfilled').checked;
  const rows=pkEvents().map(e=>{
    const amount=DATA.records.filter(r=>r.user_name===name&&r.event_name===e.event_name).reduce((s,r)=>s+r.amount,0);
    let rewards=rewardItemsFor(name,e.event_name,amount);
    if(only) rewards=rewards.filter(x=>!x.fulfilled);
    return {event:e.event_name,date:e.event_date,amount,rewards};
  }).filter(r=>r.amount>0 && r.rewards.length);
  const birthAmount=DATA.birthRecords.filter(r=>r.user_name===name).reduce((s,r)=>s+r.amount,0);
  let birthRewards=birthRewardItemsFor(name,birthAmount);
  if(only) birthRewards=birthRewards.filter(x=>!x.fulfilled);
  out.className='lookupResult';
  out.innerHTML=candidates+`
    <div class="lookupSummary">
      <div class="lookupMini"><span class="small">名称</span><b>${escapeHtml(name)}</b></div>
      <div class="lookupMini"><span class="small">显示范围</span><b>${only?'未兑现':'全部'}</b></div>
      <div class="lookupMini"><span class="small">说明</span><b>各档兼得</b></div>
    </div>
    ${rows.map(r=>`<details class="rewardDetails">
      <summary><span>${escapeHtml(r.event)} <span class="small">${escapeHtml(r.date||'')}</span></span><span>${fmt(r.amount)}</span></summary>
      <div class="rewardList">
        ${r.rewards.map(x=>`<div class="rewardItem"><div><b>${escapeHtml(x.reward)}</b><div class="small">达标金额：${fmt(x.min)}</div></div><div>${x.fulfilled?`<span class="pill good">已兑现${x.date?' '+escapeHtml(x.date):''}</span>`:`<span class="pill warn">未兑现</span>`}</div></div>`).join('')}
      </div>
    </details>`).join('') || '<div class="small">暂无符合条件的金额门槛奖励。</div>'}
    <details class="rewardDetails" open>
      <summary><span>生公奖励 <span class="small">生公集资合计</span></span><span>${fmt(birthAmount)}</span></summary>
      <div class="rewardList">
        ${birthRewards.map(x=>`<div class="rewardItem"><div><b>${escapeHtml(x.reward)}</b><div class="small">达标金额：${fmt(x.min)}</div></div><div>${x.fulfilled?`<span class="pill good">已兑现${x.date?' '+escapeHtml(x.date):''}</span>`:`<span class="pill warn">未兑现</span>`}</div></div>`).join('') || '<div class="small">暂无符合条件的生公奖励。</div>'}
      </div>
    </details>
    ${renderSpecialRankRewardsForUser(name)}
    <div class="hint">总选奖励按单场总选金额判断；生公奖励按生公集资合计判断。特殊排名奖励由提供者独立提供，按后台记录显示。</div>`;
}


function specialStatusText(status){
  return {
    pending:'待确认',
    awarded:'正常获得',
    passed_down:'顺延获得',
    waived:'已放弃',
    skipped:'已跳过'
  }[status] || status || '待确认';
}
function specialStatusPill(status){
  const cls = status==='passed_down' || status==='awarded' ? 'good' : (status==='pending' ? 'warn' : 'bad');
  return `<span class="pill ${cls}">${escapeHtml(specialStatusText(status))}</span>`;
}
function renderSpecialRankRewardsForUser(name){
  const items = DATA.specialRankRewards
    .filter(r=>canon(r.winner_name)===canon(name))
    .sort((a,b)=>String(a.event_name).localeCompare(String(b.event_name),'zh-Hans-CN') || num(a.target_rank)-num(b.target_rank));

  if(!items.length) return '';

  return `
    <div style="margin-top:14px">
      <h3 style="margin:4px 0 8px">特殊排名奖励</h3>
      <div class="rewardList">
        ${items.map(r=>`<div class="rewardItem">
          <div>
            <b>${escapeHtml(r.reward_name)}</b>
            <div class="small">
              ${escapeHtml(r.event_name || '未关联场次')} ｜ 原定第${escapeHtml(r.target_rank || '-')}名
              ${r.provider_name ? `｜ 提供者：${escapeHtml(r.provider_name)}` : ''}
            </div>
            ${r.note ? `<div class="small">备注：${escapeHtml(r.note)}</div>` : ''}
          </div>
          <div>
            ${specialStatusPill(r.status)}
            ${r.fulfilled ? `<span class="pill good">已兑现${r.fulfilled_date?' '+escapeHtml(r.fulfilled_date):''}</span>` : `<span class="pill warn">未兑现</span>`}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
}


// Admin
let titlePressTimer=null;
document.getElementById('title').ondblclick=()=>openAdmin();
document.getElementById('title').addEventListener('touchstart',()=>{titlePressTimer=setTimeout(openAdmin,5000)});
document.getElementById('title').addEventListener('touchend',()=>clearTimeout(titlePressTimer));
document.getElementById('closeAdmin').onclick=()=>document.getElementById('adminModal').classList.remove('show');

async function openAdmin(){
  document.getElementById('adminModal').classList.add('show');
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  updateAuthUI();
  if(user){ renderAdminRewards(); renderSpecialRankAdmin(); renderUnfulfilledAdmin(); }
}
function updateAuthUI(){
  document.getElementById('loginBox').classList.toggle('hidden',!!state.user);
  document.getElementById('adminBox').classList.toggle('hidden',!state.user);
  document.getElementById('adminUser').textContent=state.user?`已登录：${state.user.email}`:'';
}
document.getElementById('loginBtn').onclick=async()=>{
  const email=document.getElementById('adminEmail').value.trim();
  const password=document.getElementById('adminPassword').value;
  const res=await sb.auth.signInWithPassword({email,password});
  if(res.error){document.getElementById('loginStatus').textContent='登录失败：'+res.error.message;return;}
  state.user=res.data.user; updateAuthUI(); renderAdminRewards(); renderSpecialRankAdmin(); renderUnfulfilledAdmin();
};
document.getElementById('logoutBtn').onclick=async()=>{await sb.auth.signOut(); state.user=null; updateAuthUI();};

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.adminSection').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); document.getElementById(t.dataset.adminTab).classList.add('active');
});

document.getElementById('reloadRewards').onclick=()=>renderAdminRewards();
document.getElementById('rewardSearch').oninput=()=>renderAdminRewards();

function renderAdminRewards(){
  const kw=(document.getElementById('rewardSearch').value||'').toLowerCase().trim();
  let rows=allEarnedRewards();
  rows=rows.filter(r=>!kw || `${r.user_name} ${r.event_name} ${r.reward_name}`.toLowerCase().includes(kw));
  document.getElementById('rewardAdminBody').innerHTML=rows.map((r,i)=>`
    <tr>
      <td>${r.fulfilled?`<span class="pill good">已兑现${r.fulfilled_date?' '+escapeHtml(r.fulfilled_date):''}</span>`:`<span class="pill warn">未兑现</span>`}</td>
      <td><b>${escapeHtml(r.user_name)}</b><div class="small">${escapeHtml(r.event_name)} ｜ ${fmt(r.amount)} ｜ ${escapeHtml(r.reward_name)}</div></td>
      <td><button class="btn ${r.fulfilled?'bad':'good'} reward-toggle" data-i="${i}">${r.fulfilled?'标为未兑现':'标为已兑现'}</button></td>
    </tr>`).join('') || '<tr><td colspan="3" class="small">暂无奖励数据</td></tr>';
  document.querySelectorAll('.reward-toggle').forEach(btn=>btn.onclick=()=>toggleReward(rows[+btn.dataset.i]));
}

async function toggleReward(r){
  const newVal=!r.fulfilled;
  const date = newVal ? (document.getElementById('rewardDate').value.trim() || r.fulfilled_date || '') : null;
  const payload={user_name:r.user_name,event_name:r.event_name,reward_name:r.reward_name,fulfilled:newVal,fulfilled_date:date};
  const res=await sb.from('reward_status').upsert(payload,{onConflict:'user_name,event_name,reward_name'});
  if(res.error){alert('保存失败：'+res.error.message);return;}
  await loadAll();
}

document.getElementById('addEventBtn').onclick=async()=>{
  const event_name=document.getElementById('newEventName').value.trim();
  const event_date=document.getElementById('newEventDate').value.trim();
  const sort_order=+(document.getElementById('newEventOrder').value||0);
  if(!event_name){document.getElementById('eventAdminStatus').textContent='请填写场次名称';return;}
  const res=await sb.from('pk_events').insert({event_name,event_date,sort_order,is_general_election:true});
  document.getElementById('eventAdminStatus').textContent=res.error?'新增失败：'+res.error.message:'新增成功';
  if(!res.error) await loadAll();
};

function parseCsv(text){
  return text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map(line=>{
    const delimiter = line.includes('\t') ? '\t' : ',';
    const parts=[]; let cur='', inQ=false;
    for(let i=0;i<line.length;i++){
      const ch=line[i];
      if(ch==='"'){inQ=!inQ; continue;}
      if(ch===delimiter&&!inQ){parts.push(cur.trim()); cur='';} else cur+=ch;
    }
    parts.push(cur.trim());
    return parts;
  });
}
document.getElementById('importPkBtn').onclick=async()=>{
  const rows=parseCsv(document.getElementById('pkCsv').value);
  const data=rows.filter(r=>r.length>=3 && !/event/i.test(r[0])).map(r=>({event_name:r[0],user_name:r[1],amount:num(r[2])})).filter(r=>r.event_name&&r.user_name&&Number.isFinite(num(r.amount)));
  if(!data.length){document.getElementById('pkImportStatus').textContent='没有识别到有效数据';return;}
  const res=await sb.from('pk_records').insert(data);
  document.getElementById('pkImportStatus').textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error) await loadAll();
};
document.getElementById('importBirthBtn').onclick=async()=>{
  const rows=parseCsv(document.getElementById('birthCsv').value);
  const data=rows.filter(r=>r.length>=2 && !/user/i.test(r[0])).map(r=>({user_name:r[0],amount:num(r[1]),batch_name:r[2]||''})).filter(r=>r.user_name&&Number.isFinite(num(r.amount)));
  if(!data.length){document.getElementById('birthImportStatus').textContent='没有识别到有效数据';return;}
  const res=await sb.from('birth_fund_records').insert(data);
  document.getElementById('birthImportStatus').textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error) await loadAll();
};

document.getElementById('importRuleBtn').onclick=async()=>{
  const rows=parseCsv(document.getElementById('ruleCsv').value);
  const data=rows
    .filter(r=>r.length>=3 && !/event/i.test(r[0]) && !/threshold/i.test(r[1]))
    .map((r,i)=>({
      event_name:r[0],
      threshold:num(r[1]),
      reward_name:r[2],
      sort_order: r[3]!==undefined && r[3]!=='' ? num(r[3]) : i+1
    }))
    .filter(r=>r.event_name && r.reward_name && Number.isFinite(num(r.threshold)));
  if(!data.length){document.getElementById('ruleImportStatus').textContent='没有识别到有效奖励规则';return;}
  const res=await sb.from('reward_rules').upsert(data,{onConflict:'event_name,threshold,reward_name'});
  document.getElementById('ruleImportStatus').textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error) await loadAll();
};



function getUnfulfilledRewards(){
  const eventSelect=document.getElementById('unfulfilledEventSelect');
  const rewardSelect=document.getElementById('unfulfilledRewardSelect');
  const selectedEvent=eventSelect ? eventSelect.value : '';
  const selectedReward=rewardSelect ? rewardSelect.value : '';
  const rows = [];

  if(!selectedEvent || !selectedReward) return rows;

  for(const r of DATA.records){
    if(r.event_name !== selectedEvent) continue;
    const rewards = rewardItemsFor(r.user_name, r.event_name, r.amount);
    for(const item of rewards){
      if(item.reward === selectedReward && !item.fulfilled){
        const eventRows = DATA.records
          .filter(x=>x.event_name===r.event_name)
          .sort((a,b)=>byAmountDesc(a,b) || String(a.user_name).localeCompare(String(b.user_name),'zh-Hans-CN'));
        const rank = eventRows.findIndex(x=>x.user_name===r.user_name && num(x.amount)===num(r.amount)) + 1;
        rows.push({
          type:'金额门槛奖励',
          rank: rank || '',
          user_name:r.user_name,
          event_name:r.event_name,
          reward_name:item.reward,
          amount:num(r.amount),
          threshold:num(item.min),
          provider_name:'应援会',
          status:'未兑现',
          note:''
        });
      }
    }
  }

  for(const r of DATA.specialRankRewards || []){
    if(r.event_name !== selectedEvent) continue;
    if(r.reward_name !== selectedReward) continue;
    if(!r.fulfilled){
      rows.push({
        type:'特殊排名奖励',
        rank: r.target_rank ? `原定第${r.target_rank}名` : '',
        user_name:r.winner_name,
        event_name:r.event_name,
        reward_name:r.reward_name,
        amount:'',
        threshold:'',
        provider_name:r.provider_name || '',
        status:specialStatusText(r.status),
        note:r.note || ''
      });
    }
  }

  return rows.sort((a,b)=>
    String(a.type||'').localeCompare(String(b.type||''),'zh-Hans-CN') ||
    num(a.rank)-num(b.rank) ||
    String(a.user_name||'').localeCompare(String(b.user_name||''),'zh-Hans-CN')
  );
}

function populateUnfulfilledRewardSelect(){
  const eventSelect=document.getElementById('unfulfilledEventSelect');
  const rewardSelect=document.getElementById('unfulfilledRewardSelect');
  if(!eventSelect || !rewardSelect) return;

  const eventName=eventSelect.value || pkEvents()[0]?.event_name || '';
  const normalRewards = DATA.rewardRules
    .filter(r=>r.event_name===eventName)
    .sort((a,b)=>num(a.sort_order)-num(b.sort_order) || num(b.threshold)-num(a.threshold))
    .map(r=>r.reward_name);

  const specialRewards = (DATA.specialRankRewards || [])
    .filter(r=>r.event_name===eventName)
    .map(r=>r.reward_name);

  const rewards=[...new Set([...normalRewards, ...specialRewards])];

  const current=rewardSelect.value;
  rewardSelect.innerHTML = rewards.map(r=>`<option>${escapeHtml(r)}</option>`).join('');
  if(rewards.includes(current)) rewardSelect.value=current;
  rewardSelect.onchange=renderUnfulfilledAdmin;
}

function renderUnfulfilledAdmin(){
  populateUnfulfilledRewardSelect();
  const body=document.getElementById('unfulfilledBody');
  if(!body) return;
  const rows=getUnfulfilledRewards();
  const countPill=document.getElementById('unfulfilledCountPill');
  if(countPill) countPill.textContent=`未兑现 ${rows.length} 人`;

  body.innerHTML = rows.map(r=>`
    <tr>
      <td><span class="pill ${r.type==='特殊排名奖励'?'warn':''}">${escapeHtml(r.rank || r.type)}</span></td>
      <td>
        <b>${escapeHtml(r.user_name || '-')}</b>
        <div class="small">${escapeHtml(r.event_name || '-')} ｜ ${escapeHtml(r.reward_name || '-')}</div>
        <div class="small">
          ${r.type==='金额门槛奖励'
            ? `PK金额：${fmt(r.amount)} ｜ 门槛：${fmt(r.threshold)} ｜ 提供者：应援会`
            : `特殊排名奖励｜提供者：${escapeHtml(r.provider_name || '-')} ${r.note ? '｜备注：'+escapeHtml(r.note) : ''}`}
        </div>
      </td>
      <td><span class="pill warn">${escapeHtml(r.status || '未兑现')}</span></td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="small">该奖励暂无未兑现名单</td></tr>';
}

function unfulfilledToCsv(rows){
  const headers=['type','rank','user_name','event_name','reward_name','amount','threshold','provider_name','status','note'];
  const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
  return [headers.join(','), ...rows.map(r=>headers.map(h=>esc(r[h])).join(','))].join('\n');
}

function unfulfilledToText(rows){
  const eventName=document.getElementById('unfulfilledEventSelect')?.value || '';
  const rewardName=document.getElementById('unfulfilledRewardSelect')?.value || '';
  if(!rows.length) return `${eventName}｜${rewardName}\n暂无未兑现名单`;
  return [
    `${eventName}｜${rewardName}｜未兑现名单（${rows.length}人）`,
    ...rows.map((r,i)=>{
      if(r.type==='金额门槛奖励'){
        return `${i+1}. ${r.user_name}｜${r.rank ? '#'+r.rank : ''}｜PK金额 ${fmt(r.amount)}｜门槛 ${fmt(r.threshold)}`;
      }
      return `${i+1}. ${r.user_name}｜${r.rank || ''}｜特殊排名奖励｜提供者：${r.provider_name || '-'}｜状态：${r.status || '-'}${r.note ? '｜备注：'+r.note : ''}`;
    })
  ].join('\n');
}

function downloadText(filename, text, mime='text/plain;charset=utf-8'){
  const blob=new Blob([text],{type:mime});
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a');
  a.href=url; a.download=filename;
  document.body.appendChild(a); a.click();
  a.remove(); URL.revokeObjectURL(url);
}


function renderSpecialRankAdmin(){
  const body=document.getElementById('specialRankBody');
  if(!body) return;
  const rows=[...DATA.specialRankRewards].sort((a,b)=>String(a.event_name).localeCompare(String(b.event_name),'zh-Hans-CN') || num(a.target_rank)-num(b.target_rank));
  body.innerHTML = rows.map(r=>`
    <tr>
      <td>
        ${specialStatusPill(r.status)}
        ${r.fulfilled ? `<span class="pill good">已兑现${r.fulfilled_date?' '+escapeHtml(r.fulfilled_date):''}</span>` : `<span class="pill warn">未兑现</span>`}
      </td>
      <td>
        <b>${escapeHtml(r.reward_name)}</b>
        <div class="small">${escapeHtml(r.event_name)} ｜ 原定第${escapeHtml(r.target_rank)}名 ｜ 当前获得人：${escapeHtml(r.winner_name || '-')}</div>
        <div class="small">提供者：${escapeHtml(r.provider_name || '-')}</div>
        ${r.note ? `<div class="small">备注：${escapeHtml(r.note)}</div>` : ''}
      </td>
      <td>
        <div class="row" style="justify-content:flex-end;gap:6px">
          <button class="btn special-edit" data-id="${r.id}" type="button">编辑</button>
          <button class="btn ${r.fulfilled?'bad':'good'} special-toggle" data-id="${r.id}" type="button">${r.fulfilled?'标为未兑现':'标为已兑现'}</button>
          <button class="btn bad special-delete" data-id="${r.id}" type="button">删除</button>
        </div>
      </td>
    </tr>`).join('') || '<tr><td colspan="3" class="small">暂无特殊排名奖励</td></tr>';

  body.querySelectorAll('.special-toggle').forEach(btn=>{
    btn.onclick=()=>toggleSpecialRankFulfilled(btn.dataset.id);
  });
  body.querySelectorAll('.special-edit').forEach(btn=>{
    btn.onclick=()=>startEditSpecialRank(btn.dataset.id);
  });
  body.querySelectorAll('.special-delete').forEach(btn=>{
    btn.onclick=()=>deleteSpecialRank(btn.dataset.id);
  });
}

function clearSpecialRankForm(){
  document.getElementById('specialEditId').value='';
  document.getElementById('specialRewardName').value='';
  document.getElementById('specialProviderName').value='';
  document.getElementById('specialTargetRank').value='';
  document.getElementById('specialWinnerName').value='';
  document.getElementById('specialStatus').value='pending';
  document.getElementById('specialFulfilledDate').value='';
  document.getElementById('specialNote').value='';
  const cancel=document.getElementById('cancelSpecialEditBtn');
  if(cancel) cancel.style.display='none';
  document.getElementById('addSpecialRankBtn').textContent='保存特殊奖励';
}

function startEditSpecialRank(id){
  const item=DATA.specialRankRewards.find(r=>String(r.id)===String(id));
  if(!item) return;
  document.getElementById('specialEditId').value=item.id;
  document.getElementById('specialEventName').value=item.event_name || '';
  document.getElementById('specialRewardName').value=item.reward_name || '';
  document.getElementById('specialProviderName').value=item.provider_name || '';
  document.getElementById('specialTargetRank').value=item.target_rank || '';
  document.getElementById('specialWinnerName').value=item.winner_name || '';
  document.getElementById('specialStatus').value=item.status || 'pending';
  document.getElementById('specialFulfilledDate').value=item.fulfilled_date || '';
  document.getElementById('specialNote').value=item.note || '';
  const cancel=document.getElementById('cancelSpecialEditBtn');
  if(cancel) cancel.style.display='inline-block';
  document.getElementById('addSpecialRankBtn').textContent='保存修改';
  document.getElementById('specialRankStatus').textContent='正在编辑：' + (item.reward_name || '');
}

async function toggleSpecialRankFulfilled(id){
  const item=DATA.specialRankRewards.find(r=>String(r.id)===String(id));
  if(!item) return;
  const newVal=!item.fulfilled;
  const dateInput=document.getElementById('specialFulfilledDate');
  const date = newVal ? ((dateInput?.value || '').trim() || item.fulfilled_date || '') : null;
  const res=await sb.from('special_rank_rewards').update({fulfilled:newVal, fulfilled_date:date}).eq('id', id);
  if(res.error){alert('保存失败：'+res.error.message);return;}
  await loadAll();
}

async function deleteSpecialRank(id){
  const item=DATA.specialRankRewards.find(r=>String(r.id)===String(id));
  if(!item) return;
  const ok=confirm(`确认删除这条特殊排名奖励吗？\n\n${item.event_name}｜${item.reward_name}｜${item.winner_name || ''}`);
  if(!ok) return;
  const res=await sb.from('special_rank_rewards').delete().eq('id', id);
  if(res.error){alert('删除失败：'+res.error.message);return;}
  clearSpecialRankForm();
  await loadAll();
}

document.getElementById('cancelSpecialEditBtn').onclick=()=>{
  clearSpecialRankForm();
  document.getElementById('specialRankStatus').textContent='已取消编辑';
};

document.getElementById('addSpecialRankBtn').onclick=async()=>{
  const editId=document.getElementById('specialEditId').value;
  const event_name=document.getElementById('specialEventName').value.trim();
  const reward_name=document.getElementById('specialRewardName').value.trim();
  const provider_name=document.getElementById('specialProviderName').value.trim();
  const target_rank=num(document.getElementById('specialTargetRank').value);
  const winner_name=document.getElementById('specialWinnerName').value.trim();
  const status=document.getElementById('specialStatus').value;
  const fulfilled_date=document.getElementById('specialFulfilledDate').value.trim();
  const note=document.getElementById('specialNote').value.trim();

  if(!event_name || !reward_name || !winner_name || !target_rank){
    document.getElementById('specialRankStatus').textContent='请填写场次、奖励名称、原定名次和当前获得人';
    return;
  }

  const payload={
    event_name,
    reward_name,
    provider_name,
    target_rank,
    winner_name: canon(winner_name),
    status,
    fulfilled: !!fulfilled_date,
    fulfilled_date: fulfilled_date || null,
    note
  };

  const res = editId
    ? await sb.from('special_rank_rewards').update(payload).eq('id', editId)
    : await sb.from('special_rank_rewards').insert(payload);

  document.getElementById('specialRankStatus').textContent=res.error
    ? (editId ? '修改失败：' : '新增失败：') + res.error.message
    : (editId ? '修改成功' : '新增成功');

  if(!res.error){
    clearSpecialRankForm();
    await loadAll();
  }
};



const refreshUnfulfilledBtn=document.getElementById('refreshUnfulfilledBtn');
if(refreshUnfulfilledBtn) refreshUnfulfilledBtn.onclick=renderUnfulfilledAdmin;

const copyUnfulfilledBtn=document.getElementById('copyUnfulfilledBtn');
if(copyUnfulfilledBtn) copyUnfulfilledBtn.onclick=async()=>{
  const text=unfulfilledToText(getUnfulfilledRewards());
  try{
    await navigator.clipboard.writeText(text);
    alert('已复制未兑现清单');
  }catch(e){
    alert('复制失败，请改用导出CSV');
  }
};

const downloadUnfulfilledBtn=document.getElementById('downloadUnfulfilledBtn');
if(downloadUnfulfilledBtn) downloadUnfulfilledBtn.onclick=()=>{
  const csv='\ufeff'+unfulfilledToCsv(getUnfulfilledRewards());
  downloadText('未兑现奖励总表.csv', csv, 'text/csv;charset=utf-8');
};


document.getElementById('addAliasBtn').onclick=async()=>{
  const alias_name=document.getElementById('aliasName').value.trim();
  const canonical_name=document.getElementById('canonicalName').value.trim();
  if(!alias_name||!canonical_name){document.getElementById('aliasStatus').textContent='请填写别名和统一名称';return;}
  const res=await sb.from('name_aliases').upsert({alias_name,canonical_name},{onConflict:'alias_name'});
  document.getElementById('aliasStatus').textContent=res.error?'保存失败：'+res.error.message:'保存成功';
  if(!res.error) await loadAll();
};

(async function(){
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  await loadAll();
})();
