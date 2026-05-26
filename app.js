/* =========================
   Supabase 初始化
========================= */
const SUPABASE_URL = "https://nmjjgqlcwiqbvpjkyink.supabase.co";
const SUPABASE_KEY = "sb_publishable_lcaNfMEmLYmIk3Yhlu7Rzw_WfF5qtgX";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);

let DATA = { events:[], records:[], birthRecords:[], rewardStatus:[], aliases:[], autoNames:new Map(), rewardRules:[], birthRewardRules:[], birthRewardStatus:[], specialRankRewards:[], announcements:[], lotteryRecords:[] };
let state = { view:'overview', event:'', user:null, questionFilter:'pending' };
let pendingPkExcelRows = [];
let pendingBirthExcelRows = [];

/* =========================
   工具函数
========================= */
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

/* =========================
   名称统一与别名系统
========================= */
const cleanName = name => String(name||'')
  .normalize('NFKC')
  .trim()
  .replace(/\s+/g,' ')
  .replace(/^[\s._\-·•。．,，、~～!！?？:：;；'"“”‘’()[\]{}<>《》|/\\]+|[\s._\-·•。．,，、~～!！?？:：;；'"“”‘’()[\]{}<>《》|/\\]+$/g,'')
  .trim();
const nameKey = name => cleanName(name)
  .toLowerCase()
  .replace(/[\s._\-·•。．,，、~～!！?？:：;；'"“”‘’()[\]{}<>《》|/\\]+/g,'');
function displayNameScore(name){
  const s=cleanName(name);
  let score=0;
  if(/[A-Z]/.test(s) && /[a-z]/.test(s)) score+=4;
  if(!/^[A-Z0-9]+$/.test(s)) score+=1;
  score-=Math.max(0,s.length-16)*0.1;
  return score;
}
function pickDisplayName(current,next){
  const a=cleanName(current);
  const b=cleanName(next);
  if(!a) return b;
  if(!b) return a;
  const da=displayNameScore(a);
  const db=displayNameScore(b);
  if(db!==da) return db>da ? b : a;
  if(b.length!==a.length) return b.length<a.length ? b : a;
  return a.localeCompare(b,'zh-Hans-CN')<=0 ? a : b;
}
function buildAutoNameMap(names=[]){
  // 合并后台别名与自动清洗结果，保证类似 ID 在统计和查询时归到同一人。
  const map=new Map();
  (DATA.aliases||[]).forEach(a=>{
    const canonical=cleanName(a.canonical_name);
    if(!canonical) return;
    const aliasKey=nameKey(a.alias_name);
    const canonicalKey=nameKey(canonical);
    if(aliasKey) map.set(aliasKey,canonical);
    if(canonicalKey) map.set(canonicalKey,canonical);
  });
  names.forEach(name=>{
    const cleaned=cleanName(name);
    const key=nameKey(cleaned);
    if(!key || map.has(key)) return;
    map.set(key,pickDisplayName(map.get(key),cleaned));
  });
  return map;
}
const canon = name => {
  const raw = cleanName(name);
  const key = nameKey(raw);
  if(!key) return '';
  return DATA.autoNames.get(key) || raw;
};
const escapeHtml = s => String(s??'').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

/* =========================
   数据加载
========================= */
async function loadAll(){
  // 一次性读取页面所需数据，并在进入渲染前完成名称统一和数字格式整理。
  const [events, records, birth, status, aliases, rewardRules, birthRewardRules, birthRewardStatus, specialRankRewards, announcements, lotteryRecords] = await Promise.all([
    sb.from('pk_events').select('*').order('sort_order',{ascending:true}),
    sb.from('pk_records').select('*'),
    sb.from('birth_fund_records').select('*'),
    sb.from('reward_status').select('*'),
    sb.from('name_aliases').select('*'),
    sb.from('reward_rules').select('*').order('sort_order',{ascending:true}),
    sb.from('birth_reward_rules').select('*').order('sort_order',{ascending:true}),
    sb.from('birth_reward_status').select('*'),
    sb.from('special_rank_rewards').select('*').order('created_at',{ascending:false}),
    sb.from('announcements').select('*').order('created_at',{ascending:false}),
    sb.from('lottery_records').select('*').order('created_at',{ascending:false})
  ]);
  for(const res of [events,records,birth,status,aliases,rewardRules,birthRewardRules,birthRewardStatus,specialRankRewards,announcements,lotteryRecords]){
    if(res.error){ alert('读取数据失败：'+res.error.message); console.error(res.error); }
  }
  DATA.aliases = aliases.data || [];
  const rawRecords = records.data || [];
  const rawBirthRecords = birth.data || [];
  const rawRewardStatus = status.data || [];
  const rawBirthRewardStatus = birthRewardStatus.data || [];
  const rawSpecialRankRewards = specialRankRewards.data || [];
  DATA.autoNames = buildAutoNameMap([
    ...rawRecords.map(r=>r.user_name),
    ...rawBirthRecords.map(r=>r.user_name),
    ...rawRewardStatus.map(r=>r.user_name),
    ...rawBirthRewardStatus.map(r=>r.user_name),
    ...rawSpecialRankRewards.map(r=>r.winner_name),
    ...DATA.aliases.map(a=>a.alias_name),
    ...DATA.aliases.map(a=>a.canonical_name)
  ]);
  DATA.events = events.data || [];
  DATA.records = rawRecords.map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.birthRecords = rawBirthRecords.map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.rewardStatus = rawRewardStatus.map(r=>({...r,user_name:canon(r.user_name)}));
  DATA.rewardRules = (rewardRules.data || []).map(r=>({
    id:r.id,
    event_name:r.event_name,
    threshold:num(r.threshold),
    reward_name:r.reward_name,
    sort_order:num(r.sort_order||0)
  }));
  DATA.birthRewardRules = (birthRewardRules.data || []).map(r=>({
    reward_group:r.reward_group,
    threshold:num(r.threshold),
    reward_name:r.reward_name,
    sort_order:num(r.sort_order||0)
  })).filter(r=>r.reward_group && r.reward_name);
  DATA.birthRewardStatus = rawBirthRewardStatus.map(r=>({
    ...r,
    user_name:canon(r.user_name),
    reward_group:r.reward_group,
    reward_name:r.reward_name,
    fulfilled:!!r.fulfilled
  }));
  DATA.announcements = announcements.data || [];
  DATA.lotteryRecords = lotteryRecords.data || [];
  DATA.specialRankRewards = rawSpecialRankRewards.map(r=>({
    ...r,
    target_rank: num(r.target_rank),
    winner_name: canon(r.winner_name),
    fulfilled: !!r.fulfilled
  }));
  if(!state.event && DATA.events.length) state.event = DATA.events[0].event_name;
  initControls();
  setActive(state.view);
  renderAll();
  if(state.user){ renderAdminRewards(); renderSpecialRankAdmin(); renderUnfulfilledAdmin(); renderAnnouncementAdmin(); renderLotteryAdmin(); }
}

/* =========================
   排名与统计
========================= */
function pkEvents(){ return DATA.events.filter(e=>e.is_general_election !== false); }

function aggregateByUser(records){
  // 按统一名称汇总多条记录，用于总榜和个人合计。
  const map = new Map();
  for(const r of records){
    const name = canon(r.user_name);
    const key = nameKey(name);
    if(!key) continue;
    if(!map.has(key)) map.set(key,{name,total:0,count:0,events:{},best:0});
    const p = map.get(key);
    p.name = pickDisplayName(p.name,name);
    p.total += +r.amount||0;
    p.count += 1;
    p.events[r.event_name] = (p.events[r.event_name]||0) + (+r.amount||0);
    p.best = Math.max(p.best,+r.amount||0);
  }
  return [...map.values()].sort((a,b)=>byAmountDesc(a,b) || byNameAsc(a,b));
}
function aggregateByEventUser(records,eventName=''){
  const map = new Map();
  for(const r of records){
    if(eventName && r.event_name!==eventName) continue;
    const name=canon(r.user_name);
    if(!name) continue;
    const key=`${r.event_name}|||${nameKey(name)}`;
    const item=map.get(key) || {event_name:r.event_name,user_name:name,amount:0};
    item.user_name=pickDisplayName(item.user_name,name);
    item.amount+=num(r.amount);
    map.set(key,item);
  }
  return [...map.values()].sort((a,b)=>String(a.event_name).localeCompare(String(b.event_name),'zh-Hans-CN') || byAmountDesc(a,b) || String(a.user_name).localeCompare(String(b.user_name),'zh-Hans-CN'));
}
function birthByUser(){
  const map = new Map();
  for(const r of DATA.birthRecords){
    const name=canon(r.user_name);
    const key=nameKey(name);
    if(!key) continue;
    const prev=map.get(key) || {name,total:0};
    prev.name=pickDisplayName(prev.name,name);
    prev.total+=(+r.amount||0);
    map.set(key,prev);
  }
  return [...map.values()].sort((a,b)=>byAmountDesc(a,b) || byNameAsc(a,b));
}
function allNames(){
  const map=new Map();
  [...DATA.records.map(r=>r.user_name), ...DATA.birthRecords.map(r=>r.user_name)].forEach(name=>{
    const display=canon(name);
    const key=nameKey(display);
    if(key) map.set(key,pickDisplayName(map.get(key),display));
  });
  return [...map.values()].sort((a,b)=>a.localeCompare(b,'zh-Hans-CN'));
}

/* =========================
   奖励系统
========================= */
function getRewardStatus(user,event,reward){
  const u=canon(user);
  return DATA.rewardStatus.find(s=>canon(s.user_name)===u && s.event_name===event && s.reward_name===reward);
}
function getBirthRewardStatus(user,group,reward){
  const u=canon(user);
  return DATA.birthRewardStatus.find(s=>s.user_name===u && s.reward_group===group && s.reward_name===reward);
}
function isHighestOnlyBirthReward(rule){
  return /生日留言册/.test(`${rule.reward_group || ''} ${rule.reward_name || ''}`);
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
  // 生公奖励按组计算；生日留言册类奖励只保留最高达标档。
  const eligible = DATA.birthRewardRules
    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || b.threshold-a.threshold)
    .filter(x=>num(amount)>=num(x.threshold));
  const selected = [];
  const highestOnlyGroups = new Map();
  for(const rule of eligible){
    if(isHighestOnlyBirthReward(rule)){
      const key=rule.reward_group || rule.reward_name || '生日留言册';
      const current=highestOnlyGroups.get(key);
      if(!current || num(rule.threshold)>num(current.threshold) || (num(rule.threshold)===num(current.threshold) && num(rule.sort_order)<num(current.sort_order))){
        highestOnlyGroups.set(key, rule);
      }
    }else{
      selected.push(rule);
    }
  }
  selected.push(...highestOnlyGroups.values());
  return selected
    .sort((a,b)=>(a.sort_order||0)-(b.sort_order||0) || b.threshold-a.threshold)
    .map(x=>{
      const st = getBirthRewardStatus(user,x.reward_group,x.reward_name);
      return {
        group:x.reward_group,
        min:x.threshold,
        reward:x.reward_name,
        highestOnly:isHighestOnlyBirthReward(x),
        fulfilled: !!st?.fulfilled,
        date: st?.fulfilled_date || '',
        note: st?.note || ''
      };
    });
}
function allEarnedRewards(){
  const out=[];
  for(const r of aggregateByEventUser(DATA.records)){
    const items = rewardItemsFor(r.user_name, r.event_name, r.amount);
    for(const item of items){
      out.push({user_name:r.user_name,event_name:r.event_name,amount:r.amount,reward_name:item.reward,fulfilled:item.fulfilled,fulfilled_date:item.date});
    }
  }
  return out;
}

/* =========================
   公告系统
========================= */
function visibleAnnouncements(){
  return (DATA.announcements || [])
    .filter(a=>a.is_visible !== false)
    .sort((a,b)=>Number(!!b.is_pinned)-Number(!!a.is_pinned) || String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
function announcementPayload(content){
  const raw=String(content||'');
  try{
    const parsed=JSON.parse(raw);
    if(parsed && typeof parsed==='object'){
      return {
        body:parsed.body ?? parsed.content ?? raw,
        image_url:parsed.image_url ?? parsed.imageUrl ?? ''
      };
    }
  }catch(e){}
  return {body:raw,image_url:''};
}
function composeAnnouncementContent(body,imageUrl){
  return imageUrl ? JSON.stringify({body,image_url:imageUrl}) : body;
}
function setAnnouncementImageStatus(text){
  const el=document.getElementById('announcementImageStatus');
  if(el) el.textContent=text;
}
function setAnnouncementImagePreview(src){
  const img=document.getElementById('announcementImagePreview');
  if(!img) return;
  img.src=src || '';
  img.classList.toggle('hidden', !src);
}
function renderAnnouncementDetail(a){
  const data=announcementPayload(a.content);
  return `<details class="announcementCard">
    <summary><span><b>${escapeHtml(a.title||'公告通知')}</b>${a.created_at?`<span class="small">${escapeHtml(String(a.created_at).slice(0,10))}</span>`:''}<span class="small announcementHint">点击查看全文</span></span></summary>
    <div class="announcementBody">${escapeHtml(data.body||'')}</div>
    ${data.image_url?`<img class="announcementImage" src="${escapeHtml(data.image_url)}" alt="${escapeHtml(a.title||'公告配图')}" loading="lazy">`:''}
  </details>`;
}
function visibleLotteryRecords(){
  return (DATA.lotteryRecords || [])
    .sort((a,b)=>String(b.created_at||'').localeCompare(String(a.created_at||'')));
}
function updateAnnouncementBadge(){
  const badge=document.getElementById('announcementBadge');
  if(!badge) return;
  const latest=visibleAnnouncements()[0]?.created_at || '';
  const seen=localStorage.getItem('zty_last_seen_announcement') || '';
  badge.classList.toggle('hidden', !latest || latest<=seen);
}
function markAnnouncementsSeen(){
  const latest=visibleAnnouncements()[0]?.created_at || '';
  if(latest) localStorage.setItem('zty_last_seen_announcement', latest);
  updateAnnouncementBadge();
}

/* =========================
   抽奖系统
========================= */
function jsonText(value){
  if(value === null || value === undefined || value === '') return '';
  try{return JSON.stringify(value,null,2);}catch{return String(value);}
}
function parseJsonField(text,label){
  const raw=text.trim();
  if(!raw) return {value:null};
  try{return {value:JSON.parse(raw)};}
  catch{return {error:`${label} 不是有效 JSON`};}
}
function winnerText(item){
  if(item === null || item === undefined) return '';
  if(typeof item === 'string' || typeof item === 'number') return `中奖人：${String(item)} 奖品：未填写`;
  if(Array.isArray(item)) return item.map(winnerText).filter(Boolean).join(' / ');
  const name=item.name || item.user_name || item.winner || item.winner_name || '';
  const prize=item.prize || item.prize_name || item.reward || item.reward_name || '';
  return name ? `中奖人：${name} 奖品：${prize || '未填写'}` : JSON.stringify(item);
}
function lotteryWinnerList(value){
  if(value && !Array.isArray(value) && Array.isArray(value.winners)) return value.winners;
  return Array.isArray(value) ? value : (value ? [value] : []);
}
function lotteryDrawTime(value){
  if(value && !Array.isArray(value)) return value.drawn_at || value.draw_time || value.created_at || '';
  return '';
}
function formatDateTime(value){
  if(!value) return '';
  const date=new Date(value);
  if(Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString('zh-CN',{hour12:false});
}
function lotteryTypeLabel(type){
  return {
    monthly:'月份抽奖',
    single:'单场抽奖',
    general:'综合抽奖',
    pk:'总选抽奖',
    birth:'生公抽奖',
    other:'其他抽奖'
  }[type] || '抽奖';
}
function publicLotteryRule(record){
  const type=record.lottery_type;
  const pool=Array.isArray(record.pool_json) ? record.pool_json : [];
  if(type==='monthly' || type==='single'){
    const amounts=pool.map(x=>num(x.amount)).filter(x=>Number.isFinite(x));
    const threshold=amounts.length ? Math.min(...amounts) : null;
    if(type==='monthly'){
      const month=(record.lottery_name || '').match(/\d{4}-\d{2}/)?.[0] || '';
      return `${month || '本月'}达到${threshold!==null?fmt(threshold):'对应'}门槛`;
    }
    const eventName=pool[0]?.event_name || '';
    return `${eventName || '本场'}达到${threshold!==null?fmt(threshold):'对应'}门槛`;
  }
  return record.rule_text || '';
}
function renderLotteryWinners(value){
  const list=lotteryWinnerList(value);
  if(!list.length) return '<span class="small">暂无获奖结果</span>';
  const drawTime=lotteryDrawTime(value);
  return `<div class="lotteryResult">${drawTime?`<div class="small">抽奖时间：${escapeHtml(formatDateTime(drawTime))}</div>`:''}${list.map(item=>`<div class="lotteryWinner"><b>${escapeHtml(winnerText(item) || '获奖结果')}</b></div>`).join('')}</div>`;
}
function renderLotteryPool(pool){
  const list=Array.isArray(pool) ? pool : [];
  if(!list.length) return '';
  return `<details class="lotteryPool">
    <summary>查看奖池（${list.length} 个资格）</summary>
    <div class="lotteryPoolList">
      ${list.map(item=>`<div class="small">#${escapeHtml(item.ticket_no || '-')} ${escapeHtml(item.name || item.user_name || '-')} ${item.event_name?`｜${escapeHtml(item.event_name)}`:''} ${item.amount?`｜${fmt(item.amount)}`:''}</div>`).join('')}
    </div>
  </details>`;
}
function renderLotteryResult(record){
  return `${renderLotteryWinners(record.winners_json)}${renderLotteryPool(record.pool_json)}`;
}
function hasLotteryWinners(value){
  return lotteryWinnerList(value).length > 0;
}

/* =========================
   匿名提问系统
========================= */
function generateQuestionCode(){
  const chars='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code='Q';
  for(let i=0;i<7;i++) code+=chars[Math.floor(Math.random()*chars.length)];
  return code;
}
function questionStatusPill(row){
  return `<span class="pill ${row.answer_text?'good':'warn'}">${row.answer_text?'已回复':'待回复'}</span>`;
}

/* =========================
   管理后台
========================= */
function operationActionLabel(action){
  return {
    update_reward_status:'更新奖励兑现',
    create_pk_event:'新增总选场次',
    import_pk_records:'导入总选 CSV',
    import_birth_fund_records:'导入生公 CSV',
    import_reward_rules:'导入奖励规则',
    import_pk_excel_records:'导入总选 Excel',
    import_birth_excel_records:'导入生公 Excel',
    create_announcement:'发布公告',
    update_announcement:'修改公告',
    delete_announcement:'删除公告',
    draw_lottery_result:'生成抽奖结果',
    create_lottery_record:'新增抽奖记录',
    update_lottery_record:'修改抽奖记录',
    delete_lottery_record:'删除抽奖记录',
    create_special_rank_reward:'新增特殊排名奖励',
    update_special_rank_reward:'修改特殊排名奖励',
    update_special_rank_fulfilled:'更新特殊奖励兑现',
    delete_special_rank_reward:'删除特殊排名奖励',
    upsert_name_alias:'保存名称别名',
    answer_question:'回复匿名提问'
  }[action] || action || '-';
}

/* =========================
   抽奖系统
========================= */
function eventMonthKey(dateText){
  const raw=String(dateText||'').trim();
  if(!raw) return '';
  let m=raw.match(/(20\d{2})[-/.年](\d{1,2})/);
  if(m) return `${m[1]}-${String(+m[2]).padStart(2,'0')}`;
  m=raw.match(/(?:^|[^\d])(\d{1,2})\s*(?:月|[.\/-])\s*\d{1,2}/);
  if(m) return `${new Date().getFullYear()}-${String(+m[1]).padStart(2,'0')}`;
  m=raw.match(/(?:^|[^\d])(\d{1,2})\s*月/);
  if(m) return `${new Date().getFullYear()}-${String(+m[1]).padStart(2,'0')}`;
  return '';
}
function eventQualifiedRows(eventName,threshold){
  const map=new Map();
  for(const r of DATA.records.filter(x=>x.event_name===eventName)){
    const name=canon(r.user_name);
    map.set(name,(map.get(name)||0)+num(r.amount));
  }
  return [...map.entries()]
    .map(([name,amount])=>({name,amount}))
    .filter(r=>r.amount>=threshold)
    .sort((a,b)=>num(b.amount)-num(a.amount) || byNameAsc(a,b));
}
function setLotteryBuilderVisibility(){
  const mode=document.getElementById('lotteryBuildMode')?.value || 'monthly';
  const month=document.getElementById('lotteryMonth');
  const single=document.getElementById('lotterySingleEvent');
  if(month) month.style.display=mode==='monthly'?'block':'none';
  if(single) single.style.display=mode==='single'?'block':'none';
}
function buildLotteryPool(){
  // 按月份或单场 PK 生成待确认奖池，每条达标记录对应一次抽奖资格。
  const mode=document.getElementById('lotteryBuildMode').value;
  const threshold=num(document.getElementById('lotteryThreshold').value);
  const status=document.getElementById('lotteryAdminStatus');
  if(!Number.isFinite(threshold) || threshold<=0){status.textContent='请填写有效达标金额';return;}
  let events=[];
  if(mode==='monthly'){
    const month=document.getElementById('lotteryMonth').value;
    if(!month){status.textContent='请选择月份';return;}
    events=pkEvents().filter(e=>eventMonthKey(e.event_date)===month);
    if(!events.length){status.textContent='这个月份没有匹配到带日期的单场 PK';return;}
  }else{
    const eventName=document.getElementById('lotterySingleEvent').value;
    const event=pkEvents().find(e=>e.event_name===eventName);
    if(!event){status.textContent='请选择单场 PK';return;}
    events=[event];
  }
  let ticket=1;
  const pool=[];
  for(const event of events){
    for(const row of eventQualifiedRows(event.event_name,threshold)){
      pool.push({
        ticket_no: ticket++,
        name: row.name,
        event_name: event.event_name,
        event_date: event.event_date || '',
        amount: row.amount
      });
    }
  }
  document.getElementById('lotteryPoolJson').value=jsonText(pool);
  document.getElementById('lotteryWinnersJson').value='';
  document.getElementById('drawLotteryBtn').disabled=false;
  document.getElementById('lotteryType').value=mode;
  const monthText=document.getElementById('lotteryMonth').value;
  const eventText=document.getElementById('lotterySingleEvent').value;
  const name=mode==='monthly' ? `${monthText} 达标抽奖` : `${eventText} 达标抽奖`;
  if(!document.getElementById('lotteryName').value.trim()) document.getElementById('lotteryName').value=name;
  document.getElementById('lotteryRule').value=mode==='monthly'
    ? `${monthText} 内每场单场 PK 达到 ${fmt(threshold)} 元获得 1 次抽奖资格。`
    : `${eventText} 达到 ${fmt(threshold)} 元获得 1 次抽奖资格。`;
  if(!pool.length){
    status.textContent='已生成奖池：0 个资格。请检查月份/场次日期是否匹配，或降低达标金额。';
    return;
  }
  status.textContent=`已生成奖池：${pool.length} 个资格，确认无误后点击“确认抽选”，系统会直接生成抽奖记录。`;
}
async function drawLotteryFromPool(){
  // 洗牌后截取中奖名单，并立即调用保存逻辑锁定抽奖结果。
  const status=document.getElementById('lotteryAdminStatus');
  const currentWinners=parseJsonField(document.getElementById('lotteryWinnersJson').value,'获奖结果 JSON');
  if(currentWinners.error){status.textContent=currentWinners.error;return;}
  if(hasLotteryWinners(currentWinners.value)){
    status.textContent='这条抽奖已经有结果，不能重复抽选。如确需重抽，请删除该记录后重新创建。';
    return;
  }
  const pool=parseJsonField(document.getElementById('lotteryPoolJson').value,'参与池 JSON');
  if(pool.error){status.textContent=pool.error;return;}
  const entries=Array.isArray(pool.value) ? [...pool.value] : [];
  if(!entries.length){status.textContent='请先生成或填写参与池';return;}
  const count=Math.max(1,Math.floor(num(document.getElementById('lotteryWinnerCount').value)||1));
  const prize=document.getElementById('lotteryPrizeText').value.trim();
  for(let i=entries.length-1;i>0;i--){
    const j=Math.floor(Math.random()*(i+1));
    [entries[i],entries[j]]=[entries[j],entries[i]];
  }
  const winners=entries.slice(0,Math.min(count,entries.length)).map((x,i)=>({
    rank:i+1,
    name:x.name || x.user_name || String(x),
    prize:prize || undefined,
    ticket_no:x.ticket_no || null,
    event_name:x.event_name || '',
    amount:x.amount || null
  }));
  const result={drawn_at:new Date().toISOString(),winners};
  document.getElementById('lotteryWinnersJson').value=jsonText(result);
  status.textContent=`已抽出 ${winners.length} 个结果：${winners.map(w=>w.name).join('、')}，正在直接生成抽奖记录...`;
  await saveLottery({keepForm:true,fromDraw:true});
}

/* =========================
   初始化与事件绑定
========================= */
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
  const pkExcelEvent=document.getElementById('pkExcelEvent');
  if(pkExcelEvent) pkExcelEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
  const ruleEventSelect=document.getElementById('ruleEventSelect');
  if(ruleEventSelect){
    ruleEventSelect.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
    if(!ruleEventSelect.value && pkEvents()[0]) ruleEventSelect.value=pkEvents()[0].event_name;
    ruleEventSelect.onchange=renderRuleRows;
    renderRuleRows();
  }
  const lotterySingleEvent=document.getElementById('lotterySingleEvent');
  if(lotterySingleEvent) lotterySingleEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
  const lotteryMonth=document.getElementById('lotteryMonth');
  if(lotteryMonth && !lotteryMonth.value){
    const now=new Date();
    lotteryMonth.value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  }
  setLotteryBuilderVisibility();
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
document.querySelectorAll('.btn[data-view]').forEach(b=>b.onclick=()=>{
  state.view=b.dataset.view;
  if(state.view==='announcements') markAnnouncementsSeen();
  setActive(state.view);
  renderAll();
});
document.getElementById('clearLookup').onclick=()=>{document.getElementById('nameLookup').value='';renderLookup();};
document.getElementById('nameLookup').oninput=renderLookup;
document.getElementById('onlyUnfulfilled').onchange=renderLookup;

function renderAll(){
  // 根据当前视图统一刷新统计卡片、主表格和查询区域。
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
  const personalCard=document.getElementById('personalLookupCard');
  const rewardCard=document.getElementById('lookupCard');
  const mainTableCard=document.getElementById('mainTableCard');
  if(personalCard) personalCard.classList.toggle('hidden', state.view!=='personal');
  if(rewardCard) rewardCard.classList.toggle('hidden', state.view!=='rewards');
  if(mainTableCard) mainTableCard.classList.toggle('hidden', state.view==='rewards');
  updateAnnouncementBadge();
  renderTable();
  renderLookup();
  renderPersonalSearch();
}

function renderTable(){
  // 主内容区渲染入口：按当前 state.view 切换首页、榜单、公告、抽奖和匿名提问。
  const searchEl=document.getElementById('search');
  const kw=searchEl ? searchEl.value.trim().toLowerCase() : '';
  const thead=document.getElementById('thead'), tbody=document.getElementById('tbody'), title=document.getElementById('tableTitle');
  const mainTable=thead.closest('table');
  if(mainTable) mainTable.classList.remove('lotteryTable');
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
    rows=aggregateByEventUser(DATA.records,event)
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
    if(mainTable) mainTable.classList.add('lotteryTable');
    thead.innerHTML='<tr><th>类型</th><th>说明</th><th>结果</th></tr>';
    const items=visibleLotteryRecords();
    tbody.innerHTML=items.map(r=>{
      const rule=publicLotteryRule(r);
      return `<tr><td><span class="pill">${escapeHtml(lotteryTypeLabel(r.lottery_type))}</span></td><td><b>${escapeHtml(r.lottery_name||'抽奖结果')}</b>${rule?`<div class="small">${escapeHtml(rule)}</div>`:''}</td><td>${renderLotteryResult(r)}</td></tr>`;
    }).join('') || '<tr><td><span class="pill">抽奖</span></td><td><div class="emptyState"><b>暂无抽奖结果</b><div class="small">后台发布抽奖结果后，将在此处展示。</div></div></td><td>待更新</td></tr>';
    return;
  }else if(state.view==='announcements'){
    title.textContent='公告通知';
    thead.innerHTML='<tr><th>类型</th><th>说明</th><th>状态</th></tr>';
    const items=visibleAnnouncements();
    tbody.innerHTML=items.map(a=>{
      return `<tr><td><span class="pill ${a.is_pinned?'warn':''}">${a.is_pinned?'置顶':'公告'}</span></td><td>${renderAnnouncementDetail(a)}</td><td>已发布</td></tr>`;
    }).join('') || '<tr><td><span class="pill warn">公告</span></td><td><div class="announcementCard"><b>暂无新增公告</b><div class="small">后台发布公告后，可在此区域查看通知内容。</div></div></td><td>待更新</td></tr>';
    return;
  }else if(state.view==='questions'){
    title.textContent='匿名提问';
    thead.innerHTML='';
    tbody.innerHTML=`<tr><td colspan="3">
      <div class="questionPanel">
        <div class="questionBox">
          <h3>提交匿名提问</h3>
          <textarea id="questionText" placeholder="请输入想提问的内容"></textarea>
          <button class="btn good" id="submitQuestionBtn" type="button">提交提问并生成查询码</button>
          <div class="status" id="questionSubmitStatus"></div>
        </div>
        <div class="questionBox">
          <h3>查询回答</h3>
          <div class="lookupBox">
            <input id="questionCodeInput" placeholder="输入查询码，例如 QABCD123">
            <button class="btn" id="lookupQuestionBtn" type="button">查询</button>
          </div>
          <div class="status" id="questionLookupStatus"></div>
          <div id="questionLookupResult" class="questionResult"></div>
        </div>
      </div>
    </td></tr>`;
    document.getElementById('submitQuestionBtn').onclick=submitQuestion;
    document.getElementById('lookupQuestionBtn').onclick=lookupQuestion;
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
  const kwKey=nameKey(kw);
  if(!kw){
    out.className='lookupResult small';
    out.innerHTML='输入完整或部分ID后，将显示你的个人总览。';
    return;
  }

  const matches=allNames().filter(n=>n.toLowerCase().includes(kw) || (kwKey && nameKey(n).includes(kwKey)));
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
  const kwKey=nameKey(kw);
  const out=document.getElementById('lookupResult');
  document.getElementById('lookupTitle').textContent = state.view==='rewards' ? '奖励兑现查询' : '个人集资查询';
  if(!kw){
    out.className='lookupResult small';
    out.innerHTML=state.view==='rewards' ? '输入名称查看奖励兑现情况。' : '输入完整或部分名称后，将显示该参与者信息。';
    return;
  }
  const matches=allNames().filter(n=>n.toLowerCase().includes(kw) || (kwKey && nameKey(n).includes(kwKey)));
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
      <div class="lookupMini"><span class="small">说明</span><b>点开查看</b></div>
    </div>
    ${rows.map(r=>`<details class="rewardDetails">
      <summary><span>${escapeHtml(r.event)} <span class="small">${escapeHtml(r.date||'')}</span><span class="small rewardDetailHint">点击查看详情</span></span><span>${fmt(r.amount)}</span></summary>
      <div class="rewardList">
        ${r.rewards.map(x=>`<div class="rewardItem"><div><b>${escapeHtml(x.reward)}</b><div class="small">达标金额：${fmt(x.min)}</div></div><div>${x.fulfilled?`<span class="pill good">已兑现${x.date?' '+escapeHtml(x.date):''}</span>`:`<span class="pill warn">未兑现</span>`}</div></div>`).join('')}
      </div>
    </details>`).join('') || '<div class="small">暂无符合条件的金额门槛奖励。</div>'}
    ${renderBirthRewardGroups(birthRewards,birthAmount)}
    ${renderSpecialRankRewardsForUser(name)}
    <div class="hint">总选奖励按单场总选金额判断；生公奖励按生公集资合计判断，其中生日留言册只显示最高达标档。特殊排名奖励由提供者独立提供，按后台记录显示。</div>`;
}

function renderBirthRewardGroups(items,birthAmount){
  const groups = [...new Set(items.map(x=>x.group))];
  if(!groups.length){
    return `<details class="rewardDetails">
      <summary><span>生公奖励 <span class="small">生公集资合计</span><span class="small rewardDetailHint">点击查看详情</span></span><span>${fmt(birthAmount)}</span></summary>
      <div class="rewardList"><div class="small">暂无符合条件的生公奖励。</div></div>
    </details>`;
  }
  return groups.map(group=>{
    const groupItems = items.filter(x=>x.group===group);
    const groupRuleHint = groupItems.some(x=>x.highestOnly) ? '仅显示最高达标档' : '各档兼得';
    return `<details class="rewardDetails">
      <summary><span>生公奖励 · ${escapeHtml(group)} <span class="small">生公集资合计 ｜ ${escapeHtml(groupRuleHint)}</span><span class="small rewardDetailHint">点击查看详情</span></span><span>${fmt(birthAmount)}</span></summary>
      <div class="rewardList">
        ${groupItems.map(x=>`<div class="rewardItem"><div><b>${escapeHtml(x.reward)}</b><div class="small">达标金额：${fmt(x.min)}${x.note?' ｜ '+escapeHtml(x.note):''}</div></div><div>${x.fulfilled?`<span class="pill good">已兑现${x.date?' '+escapeHtml(x.date):''}</span>`:`<span class="pill warn">未兑现</span>`}</div></div>`).join('')}
      </div>
    </details>`;
  }).join('');
}


/* =========================
   特殊排名奖励
========================= */
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


/* =========================
   管理后台
========================= */
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
async function logOperation(action,detail='',metadata=null){
  if(!state.user) return;
  try{
    await sb.from('operation_logs').insert({
      admin_email: state.user.email || null,
      action,
      detail,
      metadata
    });
  }catch(e){}
}
document.getElementById('loginBtn').onclick=async()=>{
  const email=document.getElementById('adminEmail').value.trim();
  const password=document.getElementById('adminPassword').value;
  const res=await sb.auth.signInWithPassword({email,password});
  if(res.error){document.getElementById('loginStatus').textContent='登录失败：'+res.error.message;return;}
  state.user=res.data.user; updateAuthUI(); renderAdminRewards(); renderSpecialRankAdmin(); renderUnfulfilledAdmin(); renderAnnouncementAdmin(); renderLotteryAdmin();
};
document.getElementById('logoutBtn').onclick=async()=>{await sb.auth.signOut(); state.user=null; updateAuthUI();};

document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>{
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.adminSection').forEach(x=>x.classList.remove('active'));
  t.classList.add('active'); document.getElementById(t.dataset.adminTab).classList.add('active');
  if(t.dataset.adminTab==='announcementAdmin') renderAnnouncementAdmin();
  if(t.dataset.adminTab==='lotteryAdmin') renderLotteryAdmin();
  if(t.dataset.adminTab==='questionAdmin') renderQuestionAdmin();
  if(t.dataset.adminTab==='operationLogAdmin') renderOperationLogs();
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
  await logOperation('update_reward_status', `${r.user_name}｜${r.event_name}｜${r.reward_name}`, payload);
  await loadAll();
}

document.getElementById('addEventBtn').onclick=async()=>{
  const event_name=document.getElementById('newEventName').value.trim();
  const event_date=document.getElementById('newEventDate').value.trim();
  const sort_order=+(document.getElementById('newEventOrder').value||0);
  if(!event_name){document.getElementById('eventAdminStatus').textContent='请填写场次名称';return;}
  const res=await sb.from('pk_events').insert({event_name,event_date,sort_order,is_general_election:true});
  document.getElementById('eventAdminStatus').textContent=res.error?'新增失败：'+res.error.message:'新增成功';
  if(!res.error){await logOperation('create_pk_event', event_name, {event_name,event_date,sort_order}); await loadAll();}
};

/* =========================
   Excel 导入系统
========================= */
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
function normalizeHeader(value){
  return String(value||'').replace(/\s+/g,'').toLowerCase();
}
function nameHeaderScore(value){
  const h=normalizeHeader(value);
  if(/(商品|店铺|订单|编号|手机|电话|地址|sku|skuid|规格|编码|货号|条码|单号|id$)/i.test(h)) return 0;
  if(/收货人/.test(h)) return 10;
  if(/(收件人|联系人)/.test(h)) return 8;
  if(/(买家昵称|买家姓名|买家)/.test(h)) return 6;
  if(/(姓名|名称|名字|昵称|用户|粉丝)/.test(h)) return 4;
  return 0;
}
function looksLikeAmountHeader(value){
  const h=normalizeHeader(value);
  return /(实付金额|实付|实收金额|实收|支付金额|付款金额|订单金额|应付金额|收入金额|合计金额|总价)/i.test(h) && !/(退款|运费|优惠|成本|原价|时间|日期|付款时间|支付时间|发货时间|创建时间)/i.test(h);
}
function looksLikeStatusHeader(value){
  const h=normalizeHeader(value);
  return /(订单状态|交易状态|状态|发货状态)/i.test(h);
}
function isValidOrderStatus(value){
  const text=String(value||'').trim();
  return /待发货/.test(text);
}
function parseAmountCell(value){
  if(typeof value === 'number') return value;
  const match=String(value||'').replace(/,/g,'').match(/-?\d+(?:\.\d+)?/);
  return match ? num(match[0]) : NaN;
}
function findHeaderRow(rows){
  // 在微店导出的杂项表格中自动寻找名称、实付金额和订单状态列。
  let best={index:-1,score:-1,nameCol:-1,amountCol:-1,statusCol:-1};
  rows.slice(0,20).forEach((row,index)=>{
    let nameCol=-1, amountCol=-1, statusCol=-1, score=0;
    row.forEach((cell,col)=>{
      const nameScore=nameHeaderScore(cell);
      if(nameScore>0 && (nameCol<0 || nameScore>nameHeaderScore(row[nameCol]))){nameCol=col; score+=nameScore;}
      if(amountCol<0 && looksLikeAmountHeader(cell)){amountCol=col; score+=2;}
      if(statusCol<0 && looksLikeStatusHeader(cell)){statusCol=col; score+=2;}
    });
    if(nameCol>=0 && amountCol>=0 && statusCol>=0 && score>best.score) best={index,score,nameCol,amountCol,statusCol};
  });
  return best.index>=0 ? best : null;
}
function rowsFromWorkbook(workbook){
  const out=[];
  for(const sheetName of workbook.SheetNames){
    const sheet=workbook.Sheets[sheetName];
    const rows=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:''});
    if(rows.length) out.push(...rows);
  }
  return out;
}
function extractNameAmountRows(rows){
  // 只提取待发货订单，并按识别出的收货人与实付金额生成待确认数据。
  const header=findHeaderRow(rows);
  if(!header) return [];
  return rows.slice(header.index+1).filter(row=>isValidOrderStatus(row[header.statusCol])).map(row=>({
    user_name:canon(row[header.nameCol]),
    amount:parseAmountCell(row[header.amountCol])
  })).filter(r=>r.user_name && Number.isFinite(r.amount) && r.amount>0);
}
function mergeImportRows(rows){
  const map=new Map();
  rows.forEach(r=>{
    const name=canon(r.user_name);
    const key=nameKey(name);
    if(!key) return;
    const prev=map.get(key) || {user_name:name,amount:0};
    prev.user_name=pickDisplayName(prev.user_name,name);
    prev.amount+=num(r.amount);
    map.set(key,prev);
  });
  return [...map.values()].sort((a,b)=>num(b.amount)-num(a.amount) || byNameAsc(a,b));
}
function mergePkImportRows(rows){
  const map=new Map();
  rows.forEach(r=>{
    const event_name=String(r.event_name||'').trim();
    const user_name=canon(r.user_name);
    const amount=num(r.amount);
    if(!event_name || !user_name || amount<=0) return;
    const key=`${event_name}|||${nameKey(user_name)}`;
    const prev=map.get(key) || {event_name,user_name,amount:0};
    prev.user_name=pickDisplayName(prev.user_name,user_name);
    prev.amount+=amount;
    map.set(key,prev);
  });
  return [...map.values()].sort((a,b)=>String(a.event_name).localeCompare(String(b.event_name),'zh-Hans-CN') || byNameAsc(a,b));
}
function mergeBirthImportRows(rows){
  const map=new Map();
  rows.forEach(r=>{
    const user_name=canon(r.user_name);
    const batch_name=String(r.batch_name||'').trim();
    const amount=num(r.amount);
    if(!user_name || amount<=0) return;
    const key=`${batch_name}|||${nameKey(user_name)}`;
    const prev=map.get(key) || {user_name,batch_name,amount:0};
    prev.user_name=pickDisplayName(prev.user_name,user_name);
    prev.amount+=amount;
    map.set(key,prev);
  });
  return [...map.values()].sort((a,b)=>String(a.batch_name||'').localeCompare(String(b.batch_name||''),'zh-Hans-CN') || byNameAsc(a,b));
}
async function readExcelRows(file){
  // 读取全部工作表后合并同名订单，给后台预览确认后再写入数据库。
  if(!window.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:'array'});
  return mergeImportRows(extractNameAmountRows(rowsFromWorkbook(workbook)));
}
function renderImportPreview(targetId, rows){
  const el=document.getElementById(targetId);
  if(!el) return;
  el.classList.remove('hidden');
  const total=rows.reduce((s,r)=>s+num(r.amount),0);
  el.innerHTML=`<div class="small">识别到 ${rows.length} 个名称，合计 ${fmt(total)}。请确认后导入。</div>
    <div class="list"><table class="table"><thead><tr><th>名称</th><th>金额</th><th>操作</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><input class="excelNameInput" value="${escapeHtml(r.user_name)}"></td><td><input class="excelAmountInput" type="number" step="0.01" value="${num(r.amount)}"></td><td><button class="btn bad excelRemoveRow" type="button">剔除</button></td></tr>`).join('')}
    </tbody></table></div>`;
  el.querySelectorAll('.excelRemoveRow').forEach(btn=>{
    btn.onclick=()=>{
      btn.closest('tr')?.remove();
      const adjusted=readAdjustedPreview(targetId);
      renderImportPreview(targetId, adjusted);
    };
  });
}
function readAdjustedPreview(targetId){
  const el=document.getElementById(targetId);
  if(!el) return [];
  return [...el.querySelectorAll('tbody tr')].map(tr=>({
    user_name:canon(tr.querySelector('.excelNameInput')?.value),
    amount:num(tr.querySelector('.excelAmountInput')?.value)
  })).filter(r=>r.user_name && Number.isFinite(r.amount) && r.amount>0);
}
function applyExcelPreviewEdits(kind){
  const isPk=kind==='pk';
  const rows=readAdjustedPreview(isPk?'pkExcelPreview':'birthExcelPreview');
  const status=document.getElementById(isPk?'pkImportStatus':'birthImportStatus');
  if(!rows.length){status.textContent='调整后的预览表没有有效名称和金额';return;}
  if(isPk){
    const eventName=document.getElementById('pkExcelEvent').value;
    pendingPkExcelRows=rows.map(r=>({event_name:eventName,user_name:r.user_name,amount:r.amount}));
    renderImportPreview('pkExcelPreview', rows);
  }else{
    const batchName=document.getElementById('birthExcelBatch').value.trim();
    pendingBirthExcelRows=rows.map(r=>({user_name:r.user_name,amount:r.amount,batch_name:batchName}));
    renderImportPreview('birthExcelPreview', rows);
  }
  status.textContent='手动调整已应用，请确认导入';
}
async function previewOrderExcel(kind){
  const isPk=kind==='pk';
  const file=document.getElementById(isPk?'pkExcelFile':'birthExcelFile').files?.[0];
  const status=document.getElementById(isPk?'pkImportStatus':'birthImportStatus');
  const confirmBtn=document.getElementById(isPk?'confirmPkExcelBtn':'confirmBirthExcelBtn');
  const applyBtn=document.getElementById(isPk?'applyPkExcelEditBtn':'applyBirthExcelEditBtn');
  if(!file){status.textContent='请先选择微店订单 Excel 文件';return;}
  try{
    const rows=await readExcelRows(file);
    if(!rows.length){status.textContent='没有识别到待发货订单，请检查表头是否包含名称/买家/收货人、实付/金额和订单状态字段';return;}
    if(isPk){
      const eventName=document.getElementById('pkExcelEvent').value;
      pendingPkExcelRows=rows.map(r=>({event_name:eventName,user_name:r.user_name,amount:r.amount}));
      renderImportPreview('pkExcelPreview', rows);
    }else{
      const batchName=document.getElementById('birthExcelBatch').value.trim();
      pendingBirthExcelRows=rows.map(r=>({user_name:r.user_name,amount:r.amount,batch_name:batchName}));
      renderImportPreview('birthExcelPreview', rows);
    }
    applyBtn.classList.remove('hidden');
    confirmBtn.classList.remove('hidden');
    status.textContent='识别完成，请核对预览表';
  }catch(e){
    status.textContent='识别失败：'+e.message;
  }
}
async function confirmExcelImport(kind){
  const isPk=kind==='pk';
  const adjusted=readAdjustedPreview(isPk?'pkExcelPreview':'birthExcelPreview');
  if(adjusted.length) applyExcelPreviewEdits(kind);
  const data=isPk ? pendingPkExcelRows : pendingBirthExcelRows;
  const status=document.getElementById(isPk?'pkImportStatus':'birthImportStatus');
  if(!data.length){status.textContent='没有可导入的识别数据';return;}
  const res=await sb.from(isPk?'pk_records':'birth_fund_records').insert(data);
  status.textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error){
    await logOperation(isPk?'import_pk_excel_records':'import_birth_excel_records', `导入 ${data.length} 条`, {count:data.length});
    if(isPk) pendingPkExcelRows=[]; else pendingBirthExcelRows=[];
    await loadAll();
  }
}
document.getElementById('importPkBtn').onclick=async()=>{
  const rows=parseCsv(document.getElementById('pkCsv').value);
  const data=mergePkImportRows(rows.filter(r=>r.length>=3 && !/event/i.test(r[0])).map(r=>({event_name:r[0],user_name:r[1],amount:num(r[2])})));
  if(!data.length){document.getElementById('pkImportStatus').textContent='没有识别到有效数据';return;}
  const res=await sb.from('pk_records').insert(data);
  document.getElementById('pkImportStatus').textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error){await logOperation('import_pk_records', `导入 ${data.length} 条`, {count:data.length}); await loadAll();}
};
document.getElementById('importBirthBtn').onclick=async()=>{
  const rows=parseCsv(document.getElementById('birthCsv').value);
  const data=mergeBirthImportRows(rows.filter(r=>r.length>=2 && !/user/i.test(r[0])).map(r=>({user_name:r[0],amount:num(r[1]),batch_name:r[2]||''})));
  if(!data.length){document.getElementById('birthImportStatus').textContent='没有识别到有效数据';return;}
  const res=await sb.from('birth_fund_records').insert(data);
  document.getElementById('birthImportStatus').textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error){await logOperation('import_birth_fund_records', `导入 ${data.length} 条`, {count:data.length}); await loadAll();}
};

function ruleRowsForEvent(eventName){
  return DATA.rewardRules
    .filter(r=>r.event_name===eventName)
    .sort((a,b)=>num(a.sort_order)-num(b.sort_order) || num(a.threshold)-num(b.threshold));
}
function ruleRowHtml(row={}, index=0){
  return `<tr data-rule-id="${escapeHtml(row.id || '')}">
    <td><input class="ruleThresholdInput" type="number" step="0.01" min="0" value="${row.threshold!==undefined?escapeHtml(row.threshold):''}" placeholder="例如 128"></td>
    <td><input class="ruleRewardInput" value="${escapeHtml(row.reward_name || '')}" placeholder="例如 拼豆挂件"></td>
    <td><input class="ruleOrderInput" type="number" step="1" value="${row.sort_order!==undefined?escapeHtml(row.sort_order || index+1):index+1}" placeholder="排序"></td>
    <td><button class="btn bad removeRuleRowBtn" type="button">删除</button></td>
  </tr>`;
}
function bindRuleRowButtons(){
  document.querySelectorAll('.removeRuleRowBtn').forEach(btn=>{
    btn.onclick=()=>{
      btn.closest('tr')?.remove();
      if(!document.querySelector('#ruleRowsBox tbody tr')) addRuleRow();
    };
  });
}
function renderRuleRows(){
  const box=document.getElementById('ruleRowsBox');
  const eventName=document.getElementById('ruleEventSelect')?.value || '';
  if(!box) return;
  const existing=ruleRowsForEvent(eventName);
  const rows=existing.length ? existing : [{threshold:'',reward_name:'',sort_order:1}];
  box.innerHTML=`<div class="small">当前场次：${escapeHtml(eventName || '未选择')}。${existing.length ? `已读取 ${existing.length} 档现有规则，可直接修改后提交。` : '暂无现有规则，可新增后提交。'}</div>
    <div class="list ruleRowsList">
      <table class="table ruleTable">
        <thead><tr><th>金额门槛</th><th>对应奖励</th><th>排序</th><th>操作</th></tr></thead>
        <tbody>${rows.map(ruleRowHtml).join('')}</tbody>
      </table>
    </div>`;
  bindRuleRowButtons();
}
function addRuleRow(){
  const tbody=document.querySelector('#ruleRowsBox tbody');
  if(!tbody){renderRuleRows();return;}
  const count=tbody.querySelectorAll('tr').length;
  tbody.insertAdjacentHTML('beforeend', ruleRowHtml({sort_order:count+1}, count));
  bindRuleRowButtons();
}
function readRuleRows(){
  const eventName=document.getElementById('ruleEventSelect')?.value || '';
  return [...document.querySelectorAll('#ruleRowsBox tbody tr')].map((tr,i)=>({
    id:tr.dataset.ruleId || '',
    event_name:eventName,
    threshold:num(tr.querySelector('.ruleThresholdInput')?.value),
    reward_name:String(tr.querySelector('.ruleRewardInput')?.value || '').trim(),
    sort_order:num(tr.querySelector('.ruleOrderInput')?.value) || i+1
  })).filter(r=>r.event_name && r.reward_name && Number.isFinite(num(r.threshold)) && num(r.threshold)>0);
}
async function submitRuleRows(){
  const data=readRuleRows();
  if(!data.length){document.getElementById('ruleImportStatus').textContent='请至少填写一条有效的金额门槛和奖励名称';return;}
  const eventName=data[0].event_name;
  const existingIds=ruleRowsForEvent(eventName).map(r=>String(r.id)).filter(Boolean);
  const keptIds=data.map(r=>String(r.id)).filter(Boolean);
  const deleteIds=existingIds.filter(id=>!keptIds.includes(id));
  const updates=data.filter(r=>r.id).map(r=>({
    id:r.id,
    payload:{event_name:r.event_name,threshold:r.threshold,reward_name:r.reward_name,sort_order:r.sort_order}
  }));
  const inserts=data.filter(r=>!r.id).map(({id,...r})=>r);

  const errors=[];
  for(const id of deleteIds){
    const res=await sb.from('reward_rules').delete().eq('id', id);
    if(res.error) errors.push(res.error.message);
  }
  for(const item of updates){
    const res=await sb.from('reward_rules').update(item.payload).eq('id', item.id);
    if(res.error) errors.push(res.error.message);
  }
  if(inserts.length){
    const res=await sb.from('reward_rules').insert(inserts);
    if(res.error) errors.push(res.error.message);
  }
  document.getElementById('ruleImportStatus').textContent=errors.length?`提交失败：${errors[0]}`:`提交成功：${data.length} 档奖励规则`;
  if(!errors.length){await logOperation('import_reward_rules', `提交 ${data.length} 档`, {count:data.length,event_name:eventName}); await loadAll();}
}



function getUnfulfilledRewards(){
  const eventSelect=document.getElementById('unfulfilledEventSelect');
  const rewardSelect=document.getElementById('unfulfilledRewardSelect');
  const selectedEvent=eventSelect ? eventSelect.value : '';
  const selectedReward=rewardSelect ? rewardSelect.value : '';
  const rows = [];

  if(!selectedEvent || !selectedReward) return rows;

  const eventRows = aggregateByEventUser(DATA.records, selectedEvent);
  for(const r of eventRows){
    const rewards = rewardItemsFor(r.user_name, r.event_name, r.amount);
    for(const item of rewards){
      if(item.reward === selectedReward && !item.fulfilled){
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

async function submitQuestion(){
  // 前台匿名提交后只返回查询码，用户凭查询码查看后续回复。
  const text=document.getElementById('questionText').value.trim();
  const status=document.getElementById('questionSubmitStatus');
  if(!text){status.textContent='请先填写提问内容';return;}
  const query_code=generateQuestionCode();
  const payload={query_code,question_text:text,answer_text:null,answered_at:null};
  const res=await sb.from('questions').insert(payload);
  if(res.error){
    status.textContent='提交失败：'+res.error.message;
    return;
  }
  document.getElementById('questionText').value='';
  status.innerHTML=`提交成功，请保存查询码：<b>${escapeHtml(query_code)}</b>`;
}
async function lookupQuestion(){
  // 通过数据库函数按查询码读取单条提问，避免前台暴露完整问题列表。
  const code=document.getElementById('questionCodeInput').value.trim().toUpperCase();
  const status=document.getElementById('questionLookupStatus');
  const result=document.getElementById('questionLookupResult');
  if(!code){status.textContent='请输入查询码';return;}
  const res=await sb.rpc('get_question_by_code',{code});
  if(res.error){
    status.textContent='查询失败：'+res.error.message;
    result.innerHTML='';
    return;
  }
  const row=Array.isArray(res.data) ? res.data[0] : res.data;
  if(!row){
    status.textContent='没有找到这个查询码';
    result.innerHTML='';
    return;
  }
  status.textContent=row.answer_text?'已回复':'尚未回复，请稍后再查';
  result.innerHTML=`<div class="questionAnswer">
    <div class="small">查询码：${escapeHtml(row.query_code)}</div>
    <b>提问</b>
    <div>${escapeHtml(row.question_text||'')}</div>
    <b>回答</b>
    <div>${row.answer_text?escapeHtml(row.answer_text):'暂未回复'}</div>
  </div>`;
}

function renderAnnouncementAdmin(){
  const body=document.getElementById('announcementAdminBody');
  if(!body) return;
  const rows=[...(DATA.announcements || [])];
  body.innerHTML=rows.map(a=>{
    const visible=a.is_visible !== false;
    const data=announcementPayload(a.content);
    return `<tr>
      <td>${a.is_pinned?'<span class="pill warn">置顶</span>':''}<span class="pill ${visible?'good':'warn'}">${visible?'显示':'隐藏'}</span></td>
      <td><b>${escapeHtml(a.title||'公告通知')}</b><div class="small">${escapeHtml(String(a.created_at||'').slice(0,10))}${data.image_url?' ｜ 已配图':''}</div><div class="small">${escapeHtml(data.body||'')}</div></td>
      <td><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn announcement-edit" data-id="${a.id}" type="button">编辑</button><button class="btn bad announcement-delete" data-id="${a.id}" type="button">删除</button></div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="small">暂无公告</td></tr>';
  body.querySelectorAll('.announcement-edit').forEach(btn=>btn.onclick=()=>startEditAnnouncement(btn.dataset.id));
  body.querySelectorAll('.announcement-delete').forEach(btn=>btn.onclick=()=>deleteAnnouncement(btn.dataset.id));
}

function clearAnnouncementForm(){
  document.getElementById('announcementEditId').value='';
  document.getElementById('announcementTitle').value='';
  document.getElementById('announcementContent').value='';
  document.getElementById('announcementImageUrl').value='';
  const imageFile=document.getElementById('announcementImageFile');
  if(imageFile) imageFile.value='';
  setAnnouncementImageStatus('未选择配图');
  setAnnouncementImagePreview('');
  document.getElementById('announcementStatus').value='visible';
  document.getElementById('announcementPinned').checked=false;
  document.getElementById('saveAnnouncementBtn').textContent='保存公告';
  document.getElementById('cancelAnnouncementEditBtn').style.display='none';
}

function startEditAnnouncement(id){
  const item=DATA.announcements.find(a=>String(a.id)===String(id));
  if(!item) return;
  const data=announcementPayload(item.content);
  document.getElementById('announcementEditId').value=item.id;
  document.getElementById('announcementTitle').value=item.title || '';
  document.getElementById('announcementContent').value=data.body || '';
  document.getElementById('announcementImageUrl').value=data.image_url || '';
  const imageFile=document.getElementById('announcementImageFile');
  if(imageFile) imageFile.value='';
  setAnnouncementImageStatus(data.image_url ? '已加载原配图，可重新选择本地图片替换' : '未选择配图');
  setAnnouncementImagePreview(data.image_url || '');
  document.getElementById('announcementStatus').value=item.is_visible === false ? 'hidden' : 'visible';
  document.getElementById('announcementPinned').checked=!!item.is_pinned;
  document.getElementById('saveAnnouncementBtn').textContent='保存修改';
  document.getElementById('cancelAnnouncementEditBtn').style.display='inline-block';
}

async function saveAnnouncement(){
  const id=document.getElementById('announcementEditId').value;
  const title=document.getElementById('announcementTitle').value.trim();
  const content=document.getElementById('announcementContent').value.trim();
  const imageUrl=document.getElementById('announcementImageUrl').value.trim();
  const status=document.getElementById('announcementStatus').value;
  const pinned=document.getElementById('announcementPinned').checked;
  if(!title || !content){document.getElementById('announcementAdminStatus').textContent='请填写公告标题和内容';return;}
  const payload={title,content:composeAnnouncementContent(content,imageUrl),is_pinned:pinned,is_visible:status==='visible'};
  const res=id
    ? await sb.from('announcements').update(payload).eq('id', id)
    : await sb.from('announcements').insert(payload);
  document.getElementById('announcementAdminStatus').textContent=res.error?'保存失败：'+res.error.message:'保存成功';
  if(!res.error){await logOperation(id?'update_announcement':'create_announcement', title, {...payload,id:id||null}); clearAnnouncementForm(); await loadAll();}
}

async function deleteAnnouncement(id){
  if(!confirm('确认删除这条公告吗？')) return;
  const res=await sb.from('announcements').delete().eq('id', id);
  if(res.error){alert('删除失败：'+res.error.message);return;}
  await logOperation('delete_announcement', `id=${id}`, {id});
  await loadAll();
}

function renderLotteryAdmin(){
  const body=document.getElementById('lotteryAdminBody');
  if(!body) return;
  const rows=[...(DATA.lotteryRecords || [])];
  body.innerHTML=rows.map(r=>{
    const drawTime=lotteryDrawTime(r.winners_json);
    return `<tr>
      <td><span class="pill good">已记录</span></td>
      <td><b>${escapeHtml(r.lottery_name||'抽奖结果')}</b><div class="small">${escapeHtml(r.lottery_type||'general')} ｜ ${escapeHtml(String(r.created_at||'').slice(0,10))}</div>${drawTime?`<div class="small">抽奖时间：${escapeHtml(formatDateTime(drawTime))}</div>`:''}${r.rule_text?`<div class="small">${escapeHtml(r.rule_text)}</div>`:''}<div class="small">获奖结果：${escapeHtml(lotteryWinnerList(r.winners_json).map(winnerText).filter(Boolean).join(' / ')||'暂无')}</div></td>
      <td><div class="row" style="justify-content:flex-end;gap:6px"><button class="btn lottery-edit" data-id="${r.id}" type="button">编辑</button><button class="btn bad lottery-delete" data-id="${r.id}" type="button">删除</button></div></td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="small">暂无抽奖记录</td></tr>';
  body.querySelectorAll('.lottery-edit').forEach(btn=>btn.onclick=()=>startEditLottery(btn.dataset.id));
  body.querySelectorAll('.lottery-delete').forEach(btn=>btn.onclick=()=>deleteLottery(btn.dataset.id));
}

function clearLotteryForm(){
  document.getElementById('lotteryEditId').value='';
  document.getElementById('lotteryName').value='';
  document.getElementById('lotteryType').value='general';
  document.getElementById('lotteryRule').value='';
  document.getElementById('lotteryPoolJson').value='';
  document.getElementById('lotteryWinnersJson').value='';
  document.getElementById('drawLotteryBtn').disabled=false;
  document.getElementById('saveLotteryBtn').textContent='保存手动记录';
  document.getElementById('cancelLotteryEditBtn').style.display='none';
}

function startEditLottery(id){
  const item=DATA.lotteryRecords.find(r=>String(r.id)===String(id));
  if(!item) return;
  document.getElementById('lotteryEditId').value=item.id;
  document.getElementById('lotteryName').value=item.lottery_name || '';
  document.getElementById('lotteryType').value=item.lottery_type || 'general';
  document.getElementById('lotteryRule').value=item.rule_text || '';
  document.getElementById('lotteryPoolJson').value=jsonText(item.pool_json);
  document.getElementById('lotteryWinnersJson').value=jsonText(item.winners_json);
  document.getElementById('drawLotteryBtn').disabled=hasLotteryWinners(item.winners_json);
  document.getElementById('saveLotteryBtn').textContent='保存修改';
  document.getElementById('cancelLotteryEditBtn').style.display='inline-block';
}

async function saveLottery(options={}){
  // 保存抽奖记录时校验奖池和结果，并阻止已保存结果被直接改写。
  const id=document.getElementById('lotteryEditId').value;
  const lottery_name=document.getElementById('lotteryName').value.trim();
  const lottery_type=document.getElementById('lotteryType').value;
  const rule_text=document.getElementById('lotteryRule').value.trim();
  const pool=parseJsonField(document.getElementById('lotteryPoolJson').value,'参与池 JSON');
  const winners=parseJsonField(document.getElementById('lotteryWinnersJson').value,'获奖结果 JSON');
  if(!lottery_name){document.getElementById('lotteryAdminStatus').textContent='请填写抽奖名称';return;}
  if(pool.error || winners.error){document.getElementById('lotteryAdminStatus').textContent=pool.error || winners.error;return;}
  const poolItems=Array.isArray(pool.value) ? pool.value : [];
  const winnerItems=lotteryWinnerList(winners.value);
  if(poolItems.length && !winnerItems.length){
    document.getElementById('lotteryAdminStatus').textContent='已生成奖池，但还没有抽奖结果。请先点击“确认抽选”再保存。';
    return;
  }
  const existing=id ? DATA.lotteryRecords.find(r=>String(r.id)===String(id)) : null;
  if(existing && hasLotteryWinners(existing.winners_json) && !options.fromDraw){
    const existingText=jsonText(existing.winners_json);
    if(existingText !== jsonText(winners.value)){
      document.getElementById('lotteryAdminStatus').textContent='已保存的抽奖结果不能修改。如确需重抽，请删除该记录后重新创建。';
      return;
    }
  }
  const payload={lottery_name,lottery_type,rule_text:rule_text||null,pool_json:pool.value,winners_json:winners.value};
  const res=id
    ? await sb.from('lottery_records').update(payload).eq('id', id)
    : await sb.from('lottery_records').insert(payload);
  document.getElementById('lotteryAdminStatus').textContent=res.error?'保存失败：'+res.error.message:(options.fromDraw?'抽奖记录已生成，结果已锁定':'保存成功');
  if(!res.error){
    await logOperation(options.fromDraw?'draw_lottery_result':(id?'update_lottery_record':'create_lottery_record'), lottery_name, {...payload,id:id||null});
    await loadAll();
    if(options.keepForm){
      document.getElementById('drawLotteryBtn').disabled=true;
      renderLotteryAdmin();
    }else{
      clearLotteryForm();
    }
  }
}

async function deleteLottery(id){
  if(!confirm('确认删除这条抽奖记录吗？')) return;
  const res=await sb.from('lottery_records').delete().eq('id', id);
  if(res.error){alert('删除失败：'+res.error.message);return;}
  await logOperation('delete_lottery_record', `id=${id}`, {id});
  await loadAll();
}

async function renderOperationLogs(){
  const body=document.getElementById('operationLogBody');
  const status=document.getElementById('operationLogStatus');
  if(!body) return;
  status.textContent='正在读取操作日志...';
  const res=await sb.from('operation_logs').select('*').order('created_at',{ascending:false}).limit(100);
  if(res.error){
    status.textContent='读取失败：'+res.error.message;
    body.innerHTML='<tr><td colspan="3" class="small">暂无可显示日志</td></tr>';
    return;
  }
  status.textContent=`已读取 ${res.data.length} 条日志`;
  body.innerHTML=(res.data||[]).map(row=>`
    <tr>
      <td><div>${escapeHtml(formatDateTime(row.created_at))}</div><div class="small">${escapeHtml(row.admin_email || '-')}</div></td>
      <td><span class="pill">${escapeHtml(operationActionLabel(row.action))}</span><div class="small">${escapeHtml(row.action || '-')}</div></td>
      <td><b>${escapeHtml(row.detail || '-')}</b>${row.metadata?`<div class="small">${escapeHtml(JSON.stringify(row.metadata))}</div>`:''}</td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="small">暂无操作日志</td></tr>';
}

async function renderQuestionAdmin(){
  // 管理后台按状态筛选匿名提问，并在同一行内完成回复。
  const body=document.getElementById('questionAdminBody');
  const status=document.getElementById('questionAdminStatus');
  if(!body) return;
  status.textContent='正在读取提问...';
  const res=await sb.from('questions').select('*').order('created_at',{ascending:false}).limit(100);
  if(res.error){
    status.textContent='读取失败：'+res.error.message;
    body.innerHTML='<tr><td colspan="3" class="small">暂无可显示提问</td></tr>';
    return;
  }
  const rows=(res.data||[]).filter(row=>{
    if(state.questionFilter==='pending') return !row.answer_text;
    if(state.questionFilter==='answered') return !!row.answer_text;
    return true;
  });
  status.textContent=`当前显示 ${rows.length} 条提问`;
  body.innerHTML=rows.map(row=>`
    <tr>
      <td>${questionStatusPill(row)}<div class="small">${escapeHtml(row.query_code || '-')}</div><div class="small">${escapeHtml(formatDateTime(row.created_at))}</div></td>
      <td><b>${escapeHtml(row.question_text || '-')}</b>${row.answer_text?`<div class="small">当前回答：${escapeHtml(row.answer_text)}</div>`:''}</td>
      <td>
        <textarea class="questionAnswerInput" data-id="${row.id}" placeholder="输入回复内容">${escapeHtml(row.answer_text || '')}</textarea>
        <button class="btn good question-answer-save" data-id="${row.id}" type="button">保存回复</button>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="small">暂无符合条件的提问</td></tr>';
  body.querySelectorAll('.question-answer-save').forEach(btn=>{
    btn.onclick=()=>saveQuestionAnswer(btn.dataset.id);
  });
}

async function saveQuestionAnswer(id){
  const input=document.querySelector(`.questionAnswerInput[data-id="${CSS.escape(String(id))}"]`);
  const answer=input?.value.trim() || '';
  const status=document.getElementById('questionAdminStatus');
  if(!answer){status.textContent='请填写回复内容';return;}
  const payload={answer_text:answer,answered_at:new Date().toISOString()};
  const res=await sb.from('questions').update(payload).eq('id', id);
  if(res.error){status.textContent='保存失败：'+res.error.message;return;}
  await logOperation('answer_question', `id=${id}`, {id});
  status.textContent='回复已保存';
  await renderQuestionAdmin();
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
  await logOperation('update_special_rank_fulfilled', `${item.event_name}｜${item.reward_name}`, {id,fulfilled:newVal,fulfilled_date:date});
  await loadAll();
}

async function deleteSpecialRank(id){
  const item=DATA.specialRankRewards.find(r=>String(r.id)===String(id));
  if(!item) return;
  const ok=confirm(`确认删除这条特殊排名奖励吗？\n\n${item.event_name}｜${item.reward_name}｜${item.winner_name || ''}`);
  if(!ok) return;
  const res=await sb.from('special_rank_rewards').delete().eq('id', id);
  if(res.error){alert('删除失败：'+res.error.message);return;}
  await logOperation('delete_special_rank_reward', `${item.event_name}｜${item.reward_name}`, {id});
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
    provider_name: provider_name || null,
    target_rank,
    winner_name: canon(winner_name),
    status,
    fulfilled: !!fulfilled_date,
    fulfilled_date: fulfilled_date || null,
    note: note || null
  };

  const res = editId
    ? await sb.from('special_rank_rewards').update(payload).eq('id', editId)
    : await sb.from('special_rank_rewards').insert(payload);

  document.getElementById('specialRankStatus').textContent=res.error
    ? (editId ? '修改失败：' : '新增失败：') + res.error.message
    : (editId ? '修改成功' : '新增成功');

  if(!res.error){
    await logOperation(editId?'update_special_rank_reward':'create_special_rank_reward', `${event_name}｜${reward_name}`, {...payload,id:editId||null});
    clearSpecialRankForm();
    await loadAll();
  }
};



const refreshUnfulfilledBtn=document.getElementById('refreshUnfulfilledBtn');
if(refreshUnfulfilledBtn) refreshUnfulfilledBtn.onclick=renderUnfulfilledAdmin;

const previewPkExcelBtn=document.getElementById('previewPkExcelBtn');
if(previewPkExcelBtn) previewPkExcelBtn.onclick=()=>previewOrderExcel('pk');
const applyPkExcelEditBtn=document.getElementById('applyPkExcelEditBtn');
if(applyPkExcelEditBtn) applyPkExcelEditBtn.onclick=()=>applyExcelPreviewEdits('pk');
const confirmPkExcelBtn=document.getElementById('confirmPkExcelBtn');
if(confirmPkExcelBtn) confirmPkExcelBtn.onclick=()=>confirmExcelImport('pk');
const previewBirthExcelBtn=document.getElementById('previewBirthExcelBtn');
if(previewBirthExcelBtn) previewBirthExcelBtn.onclick=()=>previewOrderExcel('birth');
const applyBirthExcelEditBtn=document.getElementById('applyBirthExcelEditBtn');
if(applyBirthExcelEditBtn) applyBirthExcelEditBtn.onclick=()=>applyExcelPreviewEdits('birth');
const confirmBirthExcelBtn=document.getElementById('confirmBirthExcelBtn');
if(confirmBirthExcelBtn) confirmBirthExcelBtn.onclick=()=>confirmExcelImport('birth');

const addRuleRowBtn=document.getElementById('addRuleRowBtn');
if(addRuleRowBtn) addRuleRowBtn.onclick=addRuleRow;
const resetRuleRowsBtn=document.getElementById('resetRuleRowsBtn');
if(resetRuleRowsBtn) resetRuleRowsBtn.onclick=()=>{
  const eventName=document.getElementById('ruleEventSelect')?.value || '';
  const box=document.getElementById('ruleRowsBox');
  if(box){
    box.innerHTML=`<div class="small">当前场次：${escapeHtml(eventName || '未选择')}。已清空，请重新填写。</div>
      <div class="list ruleRowsList">
        <table class="table ruleTable">
          <thead><tr><th>金额门槛</th><th>对应奖励</th><th>排序</th><th>操作</th></tr></thead>
          <tbody>${ruleRowHtml({sort_order:1},0)}</tbody>
        </table>
      </div>`;
    bindRuleRowButtons();
  }
  document.getElementById('ruleImportStatus').textContent='已清空当前表格，未影响已保存数据';
};
const importRuleBtn=document.getElementById('importRuleBtn');
if(importRuleBtn) importRuleBtn.onclick=submitRuleRows;

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

const saveAnnouncementBtn=document.getElementById('saveAnnouncementBtn');
if(saveAnnouncementBtn) saveAnnouncementBtn.onclick=saveAnnouncement;
const announcementImageFile=document.getElementById('announcementImageFile');
if(announcementImageFile) announcementImageFile.onchange=()=>{
  const file=announcementImageFile.files?.[0];
  if(!file){
    document.getElementById('announcementImageUrl').value='';
    setAnnouncementImageStatus('未选择配图');
    setAnnouncementImagePreview('');
    return;
  }
  if(!file.type.startsWith('image/')){
    announcementImageFile.value='';
    setAnnouncementImageStatus('请选择图片文件');
    setAnnouncementImagePreview('');
    return;
  }
  if(file.size > 1024 * 1024){
    announcementImageFile.value='';
    setAnnouncementImageStatus('图片过大，请选择 1MB 以内的图片');
    setAnnouncementImagePreview('');
    return;
  }
  const reader=new FileReader();
  reader.onload=()=>{
    document.getElementById('announcementImageUrl').value=String(reader.result||'');
    setAnnouncementImageStatus(`已选择配图：${file.name}`);
    setAnnouncementImagePreview(String(reader.result||''));
  };
  reader.onerror=()=>setAnnouncementImageStatus('图片读取失败，请重新选择');
  reader.readAsDataURL(file);
};
const cancelAnnouncementEditBtn=document.getElementById('cancelAnnouncementEditBtn');
if(cancelAnnouncementEditBtn) cancelAnnouncementEditBtn.onclick=()=>{
  clearAnnouncementForm();
  document.getElementById('announcementAdminStatus').textContent='已取消编辑';
};
const reloadAnnouncementsBtn=document.getElementById('reloadAnnouncementsBtn');
if(reloadAnnouncementsBtn) reloadAnnouncementsBtn.onclick=async()=>{await loadAll(); renderAnnouncementAdmin();};

const saveLotteryBtn=document.getElementById('saveLotteryBtn');
if(saveLotteryBtn) saveLotteryBtn.onclick=saveLottery;
const lotteryBuildMode=document.getElementById('lotteryBuildMode');
if(lotteryBuildMode) lotteryBuildMode.onchange=setLotteryBuilderVisibility;
const buildLotteryPoolBtn=document.getElementById('buildLotteryPoolBtn');
if(buildLotteryPoolBtn) buildLotteryPoolBtn.onclick=buildLotteryPool;
const drawLotteryBtn=document.getElementById('drawLotteryBtn');
if(drawLotteryBtn) drawLotteryBtn.onclick=drawLotteryFromPool;
const cancelLotteryEditBtn=document.getElementById('cancelLotteryEditBtn');
if(cancelLotteryEditBtn) cancelLotteryEditBtn.onclick=()=>{
  clearLotteryForm();
  document.getElementById('lotteryAdminStatus').textContent='已取消编辑';
};
const reloadLotteryBtn=document.getElementById('reloadLotteryBtn');
if(reloadLotteryBtn) reloadLotteryBtn.onclick=async()=>{await loadAll(); renderLotteryAdmin();};

const reloadOperationLogsBtn=document.getElementById('reloadOperationLogsBtn');
if(reloadOperationLogsBtn) reloadOperationLogsBtn.onclick=renderOperationLogs;
const reloadQuestionsBtn=document.getElementById('reloadQuestionsBtn');
if(reloadQuestionsBtn) reloadQuestionsBtn.onclick=renderQuestionAdmin;
document.querySelectorAll('.questionFilterBtn').forEach(btn=>{
  btn.onclick=()=>{
    state.questionFilter=btn.dataset.questionFilter;
    document.querySelectorAll('.questionFilterBtn').forEach(x=>x.classList.toggle('active',x===btn));
    renderQuestionAdmin();
  };
});

document.getElementById('addAliasBtn').onclick=async()=>{
  const alias_name=cleanName(document.getElementById('aliasName').value);
  const canonical_name=cleanName(document.getElementById('canonicalName').value);
  if(!alias_name||!canonical_name){document.getElementById('aliasStatus').textContent='请填写别名和统一名称';return;}
  const res=await sb.from('name_aliases').upsert({alias_name,canonical_name},{onConflict:'alias_name'});
  document.getElementById('aliasStatus').textContent=res.error?'保存失败：'+res.error.message:'保存成功';
  if(!res.error){await logOperation('upsert_name_alias', `${alias_name} => ${canonical_name}`, {alias_name,canonical_name}); await loadAll();}
};

(async function(){
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  await loadAll();
})();
