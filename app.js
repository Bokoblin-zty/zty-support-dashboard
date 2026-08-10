/* =========================
   Supabase 初始化
========================= */
const SUPABASE_URL = "https://nmjjgqlcwiqbvpjkyink.supabase.co";
const SUPABASE_KEY = "sb_publishable_lcaNfMEmLYmIk3Yhlu7Rzw_WfF5qtgX";
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_KEY);
const VISITOR_ID_STORAGE_KEY = "zty_support_visitor_id";
const VISIT_LOG_DEDUPE_PREFIX = "zty_support_visit_";
const VISIT_LOG_DEDUPE_MS = 5 * 60 * 1000;
const PK_VOTE_UNIT_AMOUNT = 33;
const VISIT_VIEW_LABELS = {
  overview:'数据总览',
  personal:'总数据排名',
  participant:'总选排名',
  event:'总选单场',
  birth:'生公排名',
  election2026:'2026总选',
  lookup:'奖励查询',
  announcements:'公告通知',
  lottery:'抽奖结果',
  questions:'匿名提问'
};

const ELECTION_2026_SOURCE_LABELS = {
  public_vote:'明票榜',
  dark_unrevealed:'未翻明暗票',
  dark_revealed:'已翻明暗票',
  dark_link_amount:'暗账链接金额'
};
const ELECTION_2026_SOURCE_ORDER = ['public_vote','dark_unrevealed','dark_revealed','dark_link_amount'];

let DATA = { events:[], records:[], birthRecords:[], election2026Records:[], election2026RewardRules:[], election2026ManualRewards:[], election2026RewardStatus:[], rewardStatus:[], aliases:[], autoNames:new Map(), rawNameEntries:[], rewardRules:[], birthRewardRules:[], birthRewardStatus:[], specialRankRewards:[], announcements:[], lotteryRecords:[], rewardProgress:[], rewardChoiceOptions:[], rewardChoices:[], rewardLedger:[] };
let state = { view:'overview', event:'', user:null, questionFilter:'pending', dataAdminPanel:'import', rewardAdminPanel:'ledger', election2026Mode:'contribution', election2026Available:true, election2026RewardsAvailable:true, rewardProgressAvailable:true, rewardChoicesAvailable:true, rewardLedgerAvailable:true, visitLogsAvailable:true, lastSavedRewardProgress:'' };
const IS_ADMIN_PAGE = document.body.classList.contains('adminPage');
let pendingPkExcelRows = [];
let pendingBirthExcelRows = [];
let pendingElection2026Rows = [];
let currentRewardAdminRows = [];
let currentRewardProgressRows = [];
const REWARD_PROVIDER_TYPES = {
  support_club:'应援会提供',
  zhou_tongyue:'周童玥提供'
};
const SUPPORT_CLUB_PROGRESS_STATUSES = ['设计中','打样中','生产中','待抽取','已抽取','待领取','已完结'];
const ZHOU_TONGYUE_PROGRESS_STATUSES = ['待兑现','已兑现'];
const REWARD_PROGRESS_STATUSES = [...SUPPORT_CLUB_PROGRESS_STATUSES, ...ZHOU_TONGYUE_PROGRESS_STATUSES, '已完结'];

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
const fmtVotes = n => num(n).toLocaleString('zh-CN',{minimumFractionDigits:1,maximumFractionDigits:1});
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
  const [events, records, birth, status, aliases, rewardRules, birthRewardRules, birthRewardStatus, specialRankRewards, announcements, lotteryRecords, rewardProgress, rewardChoiceOptions, rewardChoices, rewardLedger, election2026Records, election2026RewardRules, election2026ManualRewards, election2026RewardStatus] = await Promise.all([
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
    sb.from('lottery_records').select('*').order('created_at',{ascending:false}),
    sb.from('reward_progress').select('*').order('reward_name',{ascending:true}),
    sb.from('reward_choice_options').select('*').order('reward_name',{ascending:true}),
    sb.from('reward_choices').select('*'),
    sb.from('reward_ledger').select('*'),
    sb.from('election_2026_vote_records').select('*').order('source_type',{ascending:true}),
    sb.from('election_2026_reward_rules').select('*').order('sort_order',{ascending:true}).order('threshold_votes',{ascending:true}),
    sb.from('election_2026_manual_rewards').select('*').order('created_at',{ascending:false}),
    sb.from('election_2026_reward_status').select('*')
  ]);
  for(const res of [events,records,birth,status,aliases,rewardRules,birthRewardRules,birthRewardStatus,specialRankRewards,announcements,lotteryRecords]){
    if(res.error){ alert('读取数据失败：'+res.error.message); console.error(res.error); }
  }
  state.rewardProgressAvailable = !rewardProgress.error;
  if(rewardProgress.error) console.warn('reward_progress unavailable:', rewardProgress.error);
  state.rewardChoicesAvailable = !rewardChoiceOptions.error && !rewardChoices.error;
  if(rewardChoiceOptions.error) console.warn('reward_choice_options unavailable:', rewardChoiceOptions.error);
  if(rewardChoices.error) console.warn('reward_choices unavailable:', rewardChoices.error);
  state.rewardLedgerAvailable = !rewardLedger.error;
  if(rewardLedger.error) console.warn('reward_ledger unavailable:', rewardLedger.error);
  state.election2026Available = !election2026Records.error;
  if(election2026Records.error) console.warn('election_2026_vote_records unavailable:', election2026Records.error);
  state.election2026RewardsAvailable = !election2026RewardRules.error && !election2026ManualRewards.error && !election2026RewardStatus.error;
  if(election2026RewardRules.error) console.warn('election_2026_reward_rules unavailable:', election2026RewardRules.error);
  if(election2026ManualRewards.error) console.warn('election_2026_manual_rewards unavailable:', election2026ManualRewards.error);
  if(election2026RewardStatus.error) console.warn('election_2026_reward_status unavailable:', election2026RewardStatus.error);
  DATA.aliases = aliases.data || [];
  const rawRecords = records.data || [];
  const rawBirthRecords = birth.data || [];
  const rawElection2026Records = election2026Records.error ? [] : (election2026Records.data || []);
  const rawElection2026RewardRules = election2026RewardRules.error ? [] : (election2026RewardRules.data || []);
  const rawElection2026ManualRewards = election2026ManualRewards.error ? [] : (election2026ManualRewards.data || []);
  const rawElection2026RewardStatus = election2026RewardStatus.error ? [] : (election2026RewardStatus.data || []);
  const rawRewardStatus = status.data || [];
  const rawBirthRewardStatus = birthRewardStatus.data || [];
  const rawSpecialRankRewards = specialRankRewards.data || [];
  const rawRewardChoices = rewardChoices.error ? [] : (rewardChoices.data || []);
  const rawNameEntries=[];
  const addRawNameEntry=(name,source,amount=0)=>{
    const raw=String(name ?? '').trim();
    const cleaned=cleanName(raw);
    const key=nameKey(cleaned);
    if(key) rawNameEntries.push({raw,cleaned,key,source,amount:num(amount)});
  };
  rawRecords.forEach(r=>addRawNameEntry(r.user_name,'总选',r.amount));
  rawBirthRecords.forEach(r=>addRawNameEntry(r.user_name,'生公',r.amount));
  rawElection2026Records.forEach(r=>addRawNameEntry(r.user_name,'2026总选',r.value));
  rawElection2026ManualRewards.forEach(r=>addRawNameEntry(r.user_name,'2026总选奖励'));
  rawRewardStatus.forEach(r=>addRawNameEntry(r.user_name,'总选奖励'));
  rawBirthRewardStatus.forEach(r=>addRawNameEntry(r.user_name,'生公奖励'));
  rawSpecialRankRewards.forEach(r=>addRawNameEntry(r.winner_name,'特殊奖励'));
  rawRewardChoices.forEach(r=>addRawNameEntry(r.user_name,'奖励选择'));
  DATA.aliases.forEach(a=>{
    addRawNameEntry(a.alias_name,'合并规则');
    addRawNameEntry(a.canonical_name,'合并规则');
  });
  DATA.rawNameEntries = rawNameEntries;
  DATA.autoNames = buildAutoNameMap(rawNameEntries.map(entry=>entry.raw));
  DATA.events = events.data || [];
  DATA.records = rawRecords.map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.birthRecords = rawBirthRecords.map(r=>({...r,user_name:canon(r.user_name),amount:num(r.amount)}));
  DATA.election2026Records = rawElection2026Records.map(r=>({
    ...r,
    source_type:r.source_type,
    user_name:canon(r.user_name),
    value:num(r.value)
  }));
  DATA.election2026RewardRules = rawElection2026RewardRules.map(r=>({
    ...r,
    threshold_votes:num(r.threshold_votes),
    sort_order:num(r.sort_order)
  }));
  DATA.election2026ManualRewards = rawElection2026ManualRewards.map(r=>({
    ...r,
    user_name:canon(r.user_name),
    fulfilled:!!r.fulfilled
  }));
  DATA.election2026RewardStatus = rawElection2026RewardStatus.map(r=>({
    ...r,
    user_name:canon(r.user_name),
    fulfilled:!!r.fulfilled
  }));
  DATA.rewardStatus = rawRewardStatus.map(r=>({...r,user_name:canon(r.user_name)}));
  DATA.rewardRules = (rewardRules.data || []).map(r=>({
    id:r.id,
    event_name:r.event_name,
    threshold:num(r.threshold),
    reward_name:r.reward_name,
    sort_order:num(r.sort_order||0),
    provider_type:r.provider_type || inferRewardProviderType(r.threshold, r.reward_name)
  }));
  DATA.birthRewardRules = (birthRewardRules.data || []).map(r=>({
    id:r.id,
    reward_group:r.reward_group,
    threshold:num(r.threshold),
    reward_name:r.reward_name,
    sort_order:num(r.sort_order||0),
    provider_type:r.provider_type || 'support_club'
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
  DATA.rewardProgress = rewardProgress.error ? [] : (rewardProgress.data || []).map(r=>({
    ...r,
    provider_type:r.provider_type || inferRewardProviderType(null, r.reward_name)
  }));
  DATA.rewardChoiceOptions = rewardChoiceOptions.error ? [] : (rewardChoiceOptions.data || []);
  DATA.rewardChoices = rawRewardChoices.map(r=>({...r,user_name:canon(r.user_name)}));
  DATA.rewardLedger = rewardLedger.error ? [] : (rewardLedger.data || []).map(r=>({...r,user_name:canon(r.user_name)}));
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
  if(state.user){
    renderAdminOverview();
    renderRewardTaskAdmin();
    renderRewardLedgerAdmin();
    renderAdminRewards();
    renderRewardProgressAdmin();
    renderRewardChoiceAdmin();
    renderSpecialRankAdmin();
    renderAnnouncementAdmin();
    renderLotteryAdmin();
    renderAliasAdmin();
    renderElection2026Admin();
    renderElection2026RewardAdmin();
  }
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
function election2026SourceLabel(sourceType){
  return ELECTION_2026_SOURCE_LABELS[sourceType] || sourceType || '未知来源';
}
function election2026ValueLabel(sourceType){
  return sourceType==='dark_link_amount' ? '金额' : '票数';
}
function election2026PkRecords(){
  const eventSet=new Set(pkEvents().map(e=>e.event_name));
  return DATA.records.filter(r=>!eventSet.size || eventSet.has(r.event_name));
}
function emptyElection2026Row(name){
  return {
    name,
    publicVotes:0,
    darkUnrevealedVotes:0,
    darkRevealedVotes:0,
    darkLinkAmount:0,
    darkLinkVotes:0,
    pkAmount:0,
    pkVotes:0,
    totalContribution:0,
    totalDarkVotes:0
  };
}
function election2026Rows(){
  // 2026 总选口径：贡献值叠加明票、未翻明暗票和 PK 折算；暗票单独叠加三类暗票来源。
  const map=new Map();
  const ensure=name=>{
    const display=canon(name);
    const key=nameKey(display);
    if(!key) return null;
    const item=map.get(key) || emptyElection2026Row(display);
    item.name=pickDisplayName(item.name,display);
    map.set(key,item);
    return item;
  };
  DATA.election2026Records.forEach(record=>{
    const item=ensure(record.user_name);
    if(!item) return;
    const value=num(record.value);
    if(record.source_type==='public_vote') item.publicVotes+=value;
    if(record.source_type==='dark_unrevealed') item.darkUnrevealedVotes+=value;
    if(record.source_type==='dark_revealed') item.darkRevealedVotes+=value;
    if(record.source_type==='dark_link_amount') item.darkLinkAmount+=value;
  });
  aggregateByUser(election2026PkRecords()).forEach(row=>{
    const item=ensure(row.name);
    if(!item) return;
    item.pkAmount+=num(row.total);
  });
  return [...map.values()].map(row=>{
    row.pkVotes=row.pkAmount/PK_VOTE_UNIT_AMOUNT;
    row.darkLinkVotes=row.darkLinkAmount/PK_VOTE_UNIT_AMOUNT;
    row.totalContribution=row.publicVotes+row.darkUnrevealedVotes+row.pkVotes;
    row.totalDarkVotes=row.darkUnrevealedVotes+row.darkRevealedVotes+row.darkLinkVotes;
    return row;
  }).filter(row=>
    row.totalContribution>0 ||
    row.totalDarkVotes>0 ||
    row.publicVotes>0 ||
    row.darkUnrevealedVotes>0 ||
    row.darkRevealedVotes>0 ||
    row.darkLinkAmount>0 ||
    row.pkAmount>0
  );
}
function sortedElection2026Rows(mode='contribution'){
  const valueKey=mode==='dark' ? 'totalDarkVotes' : 'totalContribution';
  return election2026Rows()
    .filter(row=>num(row[valueKey])>0)
    .sort((a,b)=>num(b[valueKey])-num(a[valueKey]) || byNameAsc(a,b));
}
function election2026Summary(rows=election2026Rows()){
  return rows.reduce((summary,row)=>{
    summary.publicVotes+=num(row.publicVotes);
    summary.darkUnrevealedVotes+=num(row.darkUnrevealedVotes);
    summary.darkRevealedVotes+=num(row.darkRevealedVotes);
    summary.darkLinkAmount+=num(row.darkLinkAmount);
    summary.darkLinkVotes+=num(row.darkLinkVotes);
    summary.pkAmount+=num(row.pkAmount);
    summary.pkVotes+=num(row.pkVotes);
    summary.totalContribution+=num(row.totalContribution);
    summary.totalDarkVotes+=num(row.totalDarkVotes);
    if(num(row.totalContribution)>0) summary.contributionUsers+=1;
    if(num(row.totalDarkVotes)>0) summary.darkUsers+=1;
    return summary;
  },{publicVotes:0,darkUnrevealedVotes:0,darkRevealedVotes:0,darkLinkAmount:0,darkLinkVotes:0,pkAmount:0,pkVotes:0,totalContribution:0,totalDarkVotes:0,contributionUsers:0,darkUsers:0});
}
function election2026RewardRuleKey(rule){
  return `rule:${rule?.id || ''}`;
}
function election2026ManualRewardKey(row){
  return `manual:${row?.id || ''}`;
}
function election2026RewardStatusFor(userName,rewardKey){
  const key=nameKey(canon(userName));
  return (DATA.election2026RewardStatus || []).find(row=>nameKey(row.user_name)===key && row.reward_key===rewardKey) || null;
}
function election2026ContributionRowForUser(userName){
  const key=nameKey(canon(userName));
  return election2026Rows().find(row=>nameKey(row.name)===key) || emptyElection2026Row(canon(userName));
}
function election2026RewardsForUser(userName){
  const name=canon(userName);
  const key=nameKey(name);
  if(!key) return [];
  const contribution=election2026ContributionRowForUser(name);
  const autoRows=(DATA.election2026RewardRules || [])
    .filter(rule=>num(contribution.totalContribution)>=num(rule.threshold_votes))
    .sort((a,b)=>num(a.sort_order)-num(b.sort_order) || num(a.threshold_votes)-num(b.threshold_votes) || String(a.reward_name).localeCompare(String(b.reward_name),'zh-Hans-CN'))
    .map(rule=>{
      const rewardKey=election2026RewardRuleKey(rule);
      const st=election2026RewardStatusFor(name,rewardKey);
      return {
        source_type:'rule',
        source_id:rule.id,
        reward_key:rewardKey,
        user_name:name,
        reward_name:rule.reward_name,
        threshold_votes:num(rule.threshold_votes),
        note:rule.note || '',
        fulfilled:!!st?.fulfilled,
        fulfilled_date:st?.fulfilled_date || '',
        totalContribution:contribution.totalContribution
      };
    });
  const manualRows=(DATA.election2026ManualRewards || [])
    .filter(row=>nameKey(row.user_name)===key)
    .map(row=>({
      source_type:'manual',
      source_id:row.id,
      reward_key:election2026ManualRewardKey(row),
      user_name:row.user_name,
      reward_name:row.reward_name,
      threshold_votes:null,
      note:row.note || '',
      fulfilled:!!row.fulfilled,
      fulfilled_date:row.fulfilled_date || '',
      totalContribution:contribution.totalContribution
    }));
  return [...autoRows, ...manualRows].sort((a,b)=>
    Number(a.fulfilled)-Number(b.fulfilled)
    || (a.source_type==='rule' ? 0 : 1) - (b.source_type==='rule' ? 0 : 1)
    || num(a.threshold_votes)-num(b.threshold_votes)
    || String(a.reward_name).localeCompare(String(b.reward_name),'zh-Hans-CN')
  );
}
function allElection2026RewardRows(){
  const names=new Set();
  election2026Rows().forEach(row=>names.add(row.name));
  (DATA.election2026ManualRewards || []).forEach(row=>names.add(row.user_name));
  return [...names].flatMap(name=>election2026RewardsForUser(name)).sort((a,b)=>
    Number(a.fulfilled)-Number(b.fulfilled)
    || String(a.user_name).localeCompare(String(b.user_name),'zh-Hans-CN')
    || String(a.reward_name).localeCompare(String(b.reward_name),'zh-Hans-CN')
  );
}
function election2026RewardSourceText(row){
  if(row.source_type==='manual') return '单独增加';
  return `总贡献值达到 ${fmtVotes(row.threshold_votes)} 票`;
}
function election2026RewardStatusPill(row){
  return row.fulfilled
    ? `<span class="pill good">已兑现${row.fulfilled_date?' '+escapeHtml(row.fulfilled_date):''}</span>`
    : '<span class="pill warn">待兑现</span>';
}
function allNames(){
  const map=new Map();
  [...DATA.records.map(r=>r.user_name), ...DATA.birthRecords.map(r=>r.user_name), ...DATA.election2026Records.map(r=>r.user_name), ...DATA.election2026ManualRewards.map(r=>r.user_name), ...DATA.specialRankRewards.map(r=>r.winner_name)].forEach(name=>{
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
      return {min:x.threshold, reward:x.reward_name, fulfilled, date, provider_type:x.provider_type || inferRewardProviderType(x.threshold, x.reward_name)};
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
        note: st?.note || '',
        provider_type:x.provider_type || 'support_club'
      };
    });
}
function allEarnedRewards(){
  const out=[];
  for(const r of aggregateByEventUser(DATA.records)){
    const items = rewardItemsFor(r.user_name, r.event_name, r.amount);
    for(const item of items){
      out.push({source_type:'pk',user_name:r.user_name,event_name:r.event_name,amount:r.amount,reward_name:item.reward,fulfilled:item.fulfilled,fulfilled_date:item.date,provider_type:item.provider_type || inferRewardProviderType(item.min,item.reward)});
    }
  }
  return out;
}
function allEarnedBirthRewards(){
  const out=[];
  for(const r of aggregateByUser(DATA.birthRecords)){
    const items = birthRewardItemsFor(r.name, r.total);
    for(const item of items){
      out.push({
        source_type:'birth',
        user_name:r.name,
        event_name:item.group || '生公',
        amount:r.total,
        reward_name:item.reward,
        fulfilled:item.fulfilled,
        fulfilled_date:item.date,
        reward_group:item.group || '生公',
        provider_type:item.provider_type || 'support_club'
      });
    }
  }
  return out;
}
function sourceTypeText(type){
  return {pk:'总选',birth:'生公',special:'特殊'}[type] || type || '其他';
}
function providerTypeText(type){
  return REWARD_PROVIDER_TYPES[type] || REWARD_PROVIDER_TYPES.support_club;
}
function inferRewardProviderType(threshold, rewardName=''){
  const n=num(threshold);
  const name=String(rewardName||'');
  if(n===322 || n===3.22 || /周童玥提供|小周提供/.test(name)) return 'zhou_tongyue';
  return 'support_club';
}
function statusesForProvider(providerType){
  return providerType==='zhou_tongyue' ? ZHOU_TONGYUE_PROGRESS_STATUSES : SUPPORT_CLUB_PROGRESS_STATUSES;
}
function rewardChoiceKey(sourceType,eventName,rewardName,userName=''){
  return [userName ? canon(userName) : '', sourceType || '', eventName || '', rewardName || ''].join('||');
}
function choiceOptionsArray(row){
  const raw=row?.choice_options;
  if(Array.isArray(raw)) return raw.map(x=>String(x||'').trim()).filter(Boolean);
  if(typeof raw === 'string'){
    try{
      const parsed=JSON.parse(raw);
      if(Array.isArray(parsed)) return parsed.map(x=>String(x||'').trim()).filter(Boolean);
    }catch(_err){}
  }
  return [];
}
function inferredChoiceOptionsFromRewardName(rewardName){
  const text=String(rewardName||'').trim();
  if(!text) return [];
  if(!/[\/｜|、，,；;]|\b或\b|或|二选一|多选一|任选其一/.test(text)) return [];
  const options=parseChoiceOptionsText(text);
  if(options.length<2) return [];
  return options.filter(x=>x!==text);
}
function choiceOptionFor(sourceType,eventName,rewardName){
  const rows=DATA.rewardChoiceOptions || [];
  return rows.find(r=>r.source_type===sourceType && (r.event_name||'')===(eventName||'') && r.reward_name===rewardName)
    || rows.find(r=>r.source_type===sourceType && !(r.event_name||'') && r.reward_name===rewardName)
    || (inferredChoiceOptionsFromRewardName(rewardName).length>=2
      ? {source_type:sourceType,event_name:eventName || '',reward_name:rewardName,choice_options:inferredChoiceOptionsFromRewardName(rewardName),is_choice_required:true,note:'自动识别'}
      : null)
    || null;
}
function choiceForUser(userName,sourceType,eventName,rewardName){
  const u=canon(userName);
  return (DATA.rewardChoices || []).find(r=>canon(r.user_name)===u && r.source_type===sourceType && (r.event_name||'')===(eventName||'') && r.reward_name===rewardName) || null;
}
function rewardChoiceInfo(userName,sourceType,eventName,rewardName){
  const option=choiceOptionFor(sourceType,eventName,rewardName);
  if(!option || option.is_choice_required === false) return null;
  const options=choiceOptionsArray(option);
  if(!options.length) return null;
  const choice=choiceForUser(userName,sourceType,eventName,rewardName);
  const selected=String(choice?.selected_choice || '').trim();
  return {
    option,
    options,
    choice,
    selected,
    status:selected ? 'selected' : 'pending'
  };
}
function renderRewardChoiceLine(userName,sourceType,eventName,rewardName){
  const info=rewardChoiceInfo(userName,sourceType,eventName,rewardName);
  if(!info) return renderRewardProgressLine(rewardName);
  if(!info.selected){
    return `<div class="small rewardProgressLine">选择状态：<span class="pill warn">待选择</span></div><div class="small rewardProgressLine">制作进度：<span class="pill warn">待选择</span></div>`;
  }
  const progress=progressForReward(info.selected);
  const progressLine=progress
    ? renderRewardProgressLine(info.selected)
    : `<div class="small rewardProgressLine">制作进度：<span class="pill warn">待编辑</span></div>`;
  return `<div class="small rewardProgressLine">已选择：<span class="pill good">${escapeHtml(info.selected)}</span></div>${progressLine}`;
}
function allChoiceRewardRows(){
  const rows=[...allEarnedRewards(), ...allEarnedBirthRewards()];
  return rows.map(r=>{
    const info=rewardChoiceInfo(r.user_name,r.source_type,r.event_name,r.reward_name);
    return {...r, choiceInfo:info};
  }).filter(r=>r.choiceInfo);
}
function progressForReward(rewardName){
  const name=String(rewardName||'').trim();
  if(!name) return null;
  return (DATA.rewardProgress || []).find(r=>r.reward_name===name) || null;
}
function choiceProgressState(row){
  const selected=row?.choiceInfo?.selected || '';
  if(!selected) return 'pending';
  return progressForReward(selected) ? 'ready' : 'needs_progress';
}
function choiceProgressPill(row){
  const state=choiceProgressState(row);
  if(state==='pending') return '<span class="pill warn">待选择</span>';
  if(state==='needs_progress') return '<span class="pill warn">待编辑</span>';
  const selected=row?.choiceInfo?.selected || '';
  const progress=progressForReward(selected);
  const providerType=progress?.provider_type || rewardOptionMap().get(selected)?.provider_type || inferRewardProviderType(null,selected);
  return `<span class="pill ${progressStatusClass(progress?.progress_status,providerType)}">${escapeHtml(progress?.progress_status || '已设置进度')}</span>`;
}
function progressStatusClass(status, providerType='support_club'){
  if(providerType==='zhou_tongyue') return status==='已兑现' ? 'good' : 'warn';
  return {
    '设计中':'progressDesign',
    '打样中':'progressSample',
    '生产中':'progressProduction',
    '待抽取':'progressPendingDraw',
    '已抽取':'progressDrawn',
    '待领取':'progressPickup',
    '已兑现':'good',
    '已完结':'good'
  }[status] || 'warn';
}
async function upsertRewardProgressPayload(payload){
  const res=await sb.from('reward_progress').upsert(payload,{onConflict:'reward_name'});
  if(res.error && /provider_type|column/i.test(res.error.message || '')){
    const {provider_type, ...fallback}=payload;
    return sb.from('reward_progress').upsert(fallback,{onConflict:'reward_name'});
  }
  return res;
}
function renderRewardProgressLine(rewardName){
  const progress=progressForReward(rewardName);
  const providerType=progress?.provider_type || rewardOptionMap().get(rewardName)?.provider_type || inferRewardProviderType(null,rewardName);
  const status=progress?.progress_status || '暂未更新';
  const note=progress?.progress_note ? `｜${escapeHtml(progress.progress_note)}` : '';
  const label=providerType==='zhou_tongyue' ? '兑现状态' : '制作进度';
  return `<div class="small rewardProgressLine">${label}：<span class="pill ${progressStatusClass(status, providerType)}">${escapeHtml(status)}</span>${note}</div>`;
}
function renderLedgerRewardProgressLine(row){
  const providerType=row.provider_type || inferRewardProviderType(null,row.display_reward_name || row.reward_name);
  const label=providerType==='zhou_tongyue' ? '兑现状态' : '制作进度';
  if(row.choice_required && row.choice_status==='pending'){
    return `<div class="small rewardProgressLine">选择状态：<span class="pill warn">待选择</span></div><div class="small rewardProgressLine">${label}：<span class="pill warn">待选择</span></div>`;
  }
  const lines=[];
  if(row.choice_required && row.selected_reward_name){
    lines.push(`<div class="small rewardProgressLine">已选择：<span class="pill good">${escapeHtml(row.selected_reward_name)}</span></div>`);
  }
  const status=row.progress_status || (row.choice_required ? '待编辑' : '暂未更新');
  const note=row.progress_note ? `｜${escapeHtml(row.progress_note)}` : '';
  lines.push(`<div class="small rewardProgressLine">${label}：<span class="pill ${progressStatusClass(status, providerType)}">${escapeHtml(status)}</span>${note}</div>`);
  return lines.join('');
}
function eventSortIndex(eventName){
  const event=DATA.events.find(e=>e.event_name===eventName);
  if(!event) return 9999;
  const order=num(event.sort_order);
  return Number.isFinite(order) && order ? order : DATA.events.indexOf(event)+1;
}
function choiceParentRewardNames(){
  const names=new Set();
  const addIfChoice=(sourceType,eventName,rewardName)=>{
    const option=choiceOptionFor(sourceType,eventName,rewardName);
    if(choiceOptionsArray(option).length>=2) names.add(String(rewardName||'').trim());
  };
  DATA.rewardRules.forEach(r=>addIfChoice('pk',r.event_name,r.reward_name));
  DATA.birthRewardRules.forEach(r=>addIfChoice('birth',r.reward_group || '生公',r.reward_name));
  DATA.specialRankRewards.forEach(r=>addIfChoice('special',r.event_name || '特殊',r.reward_name));
  DATA.rewardChoiceOptions.forEach(r=>names.add(String(r.reward_name||'').trim()));
  return names;
}
function rewardOptionMap(){
  const map=new Map();
  const choiceParents=choiceParentRewardNames();
  const add=(name,type,providerType='support_club',category='其他奖励',sortIndex=9999)=>{
    const reward_name=String(name||'').trim();
    if(!reward_name) return;
    const prev=map.get(reward_name);
    if(prev){
      const types=new Set(String(prev.reward_type||'').split(' / ').filter(Boolean));
      if(type) types.add(type);
      prev.reward_type=[...types].join(' / ');
      if(prev.provider_type!=='zhou_tongyue') prev.provider_type=providerType || prev.provider_type || 'support_club';
      if(sortIndex<prev.sort_index){
        prev.sort_index=sortIndex;
        prev.category=category;
      }
    }else{
      map.set(reward_name,{
        reward_name,
        reward_type:type || '其他',
        provider_type:providerType || inferRewardProviderType(null,reward_name),
        category,
        sort_index:sortIndex
      });
    }
  };
  DATA.rewardRules.forEach(r=>{
    const provider=r.provider_type || inferRewardProviderType(r.threshold,r.reward_name);
    const category=`总选奖励 / ${r.event_name}`;
    const sortIndex=eventSortIndex(r.event_name)*1000 + num(r.sort_order || r.threshold);
    const options=choiceOptionsArray(choiceOptionFor('pk',r.event_name,r.reward_name));
    if(options.length<2) add(r.reward_name,`总选奖励｜${r.event_name}`,provider,category,sortIndex);
    options.forEach(option=>{
      add(option,`总选具体选项｜${r.event_name}`,provider,category,sortIndex+0.1);
    });
  });
  DATA.birthRewardRules.forEach(r=>{
    const sortIndex=200000 + num(r.sort_order || r.threshold);
    const options=choiceOptionsArray(choiceOptionFor('birth',r.reward_group || '生公',r.reward_name));
    if(options.length<2) add(r.reward_name,'生公奖励',r.provider_type || 'support_club','生公奖励',sortIndex);
    options.forEach(option=>{
      add(option,'生公具体选项',r.provider_type || 'support_club','生公奖励',sortIndex+0.1);
    });
  });
  DATA.specialRankRewards.forEach((r,i)=>add(r.reward_name,'特殊排名奖励','support_club','特殊排名奖励',300000 + i));
  DATA.rewardChoiceOptions.forEach(r=>{
    const category=`${sourceTypeText(r.source_type)}可选奖励`;
    choiceOptionsArray(r).forEach(option=>add(option,`${sourceTypeText(r.source_type)}具体选项`,r.provider_type || 'support_club',category,400000));
  });
  DATA.rewardChoices.forEach(r=>{
    if(r.selected_choice){
      const category=`${sourceTypeText(r.source_type)}已选奖励`;
      add(r.selected_choice,`${sourceTypeText(r.source_type)}具体选项`,r.provider_type || 'support_club',category,500000);
    }
  });
  DATA.rewardProgress.forEach((r,i)=>{
    if(choiceParents.has(String(r.reward_name||'').trim())) return;
    add(r.reward_name,r.reward_type || '其他',r.provider_type || inferRewardProviderType(null,r.reward_name),r.reward_type || '其他奖励',600000 + i);
  });
  return map;
}
function rewardProgressCategoryOrder(category){
  if(/^总选奖励/.test(category)) return 1;
  if(category==='生公奖励') return 2;
  if(category==='特殊排名奖励') return 3;
  if(/可选奖励/.test(category)) return 4;
  if(/已选奖励/.test(category)) return 5;
  return 9;
}
function allRewardProgressOptions(){
  return [...rewardOptionMap().values()].sort((a,b)=>
    rewardProgressCategoryOrder(a.category)-rewardProgressCategoryOrder(b.category)
    || num(a.sort_index)-num(b.sort_index)
    || a.reward_name.localeCompare(b.reward_name,'zh-Hans-CN')
  );
}
function groupedRewardProgressOptions(options){
  const groups=new Map();
  options.forEach(item=>{
    const category=item.category || '其他奖励';
    if(!groups.has(category)) groups.set(category,[]);
    groups.get(category).push(item);
  });
  return [...groups.entries()].sort((a,b)=>
    rewardProgressCategoryOrder(a[0])-rewardProgressCategoryOrder(b[0])
    || num(a[1][0]?.sort_index)-num(b[1][0]?.sort_index)
    || a[0].localeCompare(b[0],'zh-Hans-CN')
  );
}
async function syncRewardProgressCompleted(rewardName,rewardType=''){
  if(!state.rewardProgressAvailable || !rewardName) return;
  const providerType=rewardOptionMap().get(rewardName)?.provider_type || inferRewardProviderType(null,rewardName);
  const payload={
    reward_name:rewardName,
    reward_type:rewardType || rewardOptionMap().get(rewardName)?.reward_type || '其他',
    provider_type:providerType,
    progress_status:providerType==='zhou_tongyue' ? '已兑现' : '已完结',
    progress_note:null,
    updated_at:new Date().toISOString()
  };
  const res=await upsertRewardProgressPayload(payload);
  if(res.error){
    state.rewardProgressAvailable=false;
    console.warn('sync reward_progress failed:', res.error);
  }
}

/* =========================
   奖励台账映射层
========================= */
const REWARD_LEDGER_VERSION = 'stage1-readonly';

function rewardLedgerKey(row){
  return [
    row.source_type || '',
    row.source_id || '',
    canon(row.user_name),
    row.event_name || '',
    row.reward_group || '',
    row.reward_name || ''
  ].join('||');
}

function rewardLedgerChoiceStatus(choiceInfo){
  if(!choiceInfo) return 'not_required';
  return choiceInfo.selected ? 'selected' : 'pending';
}

function rewardLedgerProgressFor(row, choiceInfo){
  const progressRewardName = choiceInfo?.selected || row.reward_name;
  return {
    progress_reward_name:progressRewardName,
    progress:progressForReward(progressRewardName)
  };
}

function rewardLedgerWorkflowStatus({fulfilled, choice_status, progress}){
  if(fulfilled) return 'completed';
  if(choice_status === 'pending') return 'pending_choice';
  if(choice_status === 'selected' && !progress) return 'needs_progress';
  return 'pending_fulfillment';
}

function normalizeRewardLedgerRow(row){
  const userName=canon(row.user_name);
  const providerType=row.provider_type || inferRewardProviderType(null,row.reward_name);
  const choiceInfo=rewardChoiceInfo(userName,row.source_type,row.event_name,row.reward_name);
  const choiceStatus=rewardLedgerChoiceStatus(choiceInfo);
  const {progress_reward_name, progress}=rewardLedgerProgressFor(row, choiceInfo);
  const fulfilled=!!row.fulfilled;
  return {
    ledger_key:rewardLedgerKey({...row,user_name:userName}),
    ledger_version:REWARD_LEDGER_VERSION,
    source_type:row.source_type || 'other',
    source_label:sourceTypeText(row.source_type),
    source_table:row.source_table || '',
    source_id:row.source_id || '',
    user_name:userName,
    event_name:row.event_name || '',
    reward_group:row.reward_group || '',
    reward_name:row.reward_name || '',
    display_reward_name:choiceInfo?.selected || row.reward_name || '',
    amount:num(row.amount),
    provider_type:providerType,
    provider_label:providerTypeText(providerType),
    fulfilled,
    fulfillment_status:fulfilled ? 'fulfilled' : 'unfulfilled',
    fulfilled_date:row.fulfilled_date || '',
    choice_required:!!choiceInfo,
    choice_status:choiceStatus,
    selected_reward_name:choiceInfo?.selected || '',
    progress_reward_name,
    progress_status:progress?.progress_status || '',
    progress_note:progress?.progress_note || '',
    workflow_status:rewardLedgerWorkflowStatus({fulfilled, choice_status:choiceStatus, progress}),
    special_status:row.special_status || '',
    note:row.note || ''
  };
}

function buildRewardLedgerRows(){
  const normalRows=[
    ...allEarnedRewards().map(row=>({
      ...row,
      source_table:'reward_status',
      reward_group:row.event_name
    })),
    ...allEarnedBirthRewards().map(row=>({
      ...row,
      source_table:'birth_reward_status'
    })),
    ...(DATA.specialRankRewards || []).map(row=>({
      source_type:'special',
      source_table:'special_rank_rewards',
      source_id:row.id,
      user_name:row.winner_name,
      event_name:row.event_name || '特殊排名奖励',
      reward_group:'特殊排名奖励',
      reward_name:row.reward_name,
      amount:0,
      provider_type:row.provider_type || 'support_club',
      fulfilled:!!row.fulfilled,
      fulfilled_date:row.fulfilled_date || '',
      special_status:row.status || '',
      note:row.note || ''
    }))
  ];
  return normalRows
    .map(normalizeRewardLedgerRow)
    .sort((a,b)=>
      Number(a.fulfilled)-Number(b.fulfilled)
      || String(a.source_label).localeCompare(String(b.source_label),'zh-Hans-CN')
      || String(a.event_name).localeCompare(String(b.event_name),'zh-Hans-CN')
      || String(a.reward_name).localeCompare(String(b.reward_name),'zh-Hans-CN')
      || String(a.user_name).localeCompare(String(b.user_name),'zh-Hans-CN')
    );
}

function rewardLedgerMetrics(rows=buildRewardLedgerRows()){
  return {
    total:rows.length,
    unfulfilled:rows.filter(r=>!r.fulfilled).length,
    pending_choice:rows.filter(r=>r.workflow_status==='pending_choice').length,
    needs_progress:rows.filter(r=>r.workflow_status==='needs_progress').length,
    completed:rows.filter(r=>r.workflow_status==='completed').length
  };
}

function rewardLedgerRowForAdmin(row){
  return {
    ...row,
    id:row.source_type==='special' ? row.source_id : row.id,
    amount:num(row.amount),
    fulfilled:!!row.fulfilled,
    fulfilled_date:row.fulfilled_date || '',
    provider_type:row.provider_type || inferRewardProviderType(null,row.display_reward_name || row.reward_name),
    reward_group:row.reward_group || row.event_name || '',
    display_reward_name:row.display_reward_name || row.selected_reward_name || row.reward_name,
    selected_reward_name:row.selected_reward_name || '',
    progress_status:row.progress_status || '',
    workflow_status:row.workflow_status || '',
    ledger_row:true
  };
}

function rewardLedgerRowsForAdmin(){
  const generatedRows=buildRewardLedgerRows();
  if(state.rewardLedgerAvailable && DATA.rewardLedger.length){
    const storedMap=new Map(DATA.rewardLedger.map(row=>[row.ledger_key,row]));
    return generatedRows.map(row=>{
      const stored=storedMap.get(row.ledger_key);
      return rewardLedgerRowForAdmin(stored ? {...stored,...row,ledger_row:true,stored_synced_at:stored.synced_at || ''} : {...row,ledger_row:false});
    });
  }
  return generatedRows.map(row=>rewardLedgerRowForAdmin({...row,ledger_row:false}));
}

const REWARD_LEDGER_COMPARE_FIELDS = [
  'source_type','source_label','source_table','source_id','user_name','event_name','reward_group',
  'reward_name','display_reward_name','amount','provider_type','provider_label','fulfilled',
  'fulfillment_status','fulfilled_date','choice_required','choice_status','selected_reward_name',
  'progress_reward_name','progress_status','progress_note','workflow_status','special_status','note'
];

function ledgerCompareValue(key, value){
  if(key==='amount') return String(num(value));
  if(typeof value === 'boolean') return value ? 'true' : 'false';
  return String(value ?? '');
}

function compareRewardLedgerRows(generatedRows=buildRewardLedgerRows(), storedRows=DATA.rewardLedger || []){
  const generatedMap=new Map(generatedRows.map(row=>[row.ledger_key,row]));
  const storedMap=new Map(storedRows.map(row=>[row.ledger_key,row]));
  let missing=0;
  let changed=0;
  let unchanged=0;
  generatedRows.forEach(row=>{
    const stored=storedMap.get(row.ledger_key);
    if(!stored){
      missing += 1;
      return;
    }
    const isChanged=REWARD_LEDGER_COMPARE_FIELDS.some(key=>ledgerCompareValue(key,row[key]) !== ledgerCompareValue(key,stored[key]));
    if(isChanged) changed += 1;
    else unchanged += 1;
  });
  const stale=storedRows.filter(row=>!generatedMap.has(row.ledger_key)).length;
  return {
    generated:generatedRows.length,
    stored:storedRows.length,
    missing,
    changed,
    unchanged,
    stale
  };
}

function rewardLedgerPayload(row){
  const payload={};
  [
    'ledger_key','ledger_version','source_type','source_label','source_table','source_id','user_name',
    'event_name','reward_group','reward_name','display_reward_name','amount','provider_type',
    'provider_label','fulfilled','fulfillment_status','fulfilled_date','choice_required',
    'choice_status','selected_reward_name','progress_reward_name','progress_status','progress_note',
    'workflow_status','special_status','note'
  ].forEach(key=>{ payload[key]=row[key] ?? null; });
  payload.synced_at=new Date().toISOString();
  payload.updated_at=payload.synced_at;
  return payload;
}

function renderRewardLedgerAdmin(){
  const box=document.getElementById('rewardLedgerMetrics');
  if(!box) return;
  const status=document.getElementById('rewardLedgerStatus');
  if(!state.rewardLedgerAvailable){
    box.innerHTML='<div class="small">奖励台账表暂不可用，请确认 SQL 已执行。</div>';
    if(status) status.textContent='奖励台账表不可用，当前后台仍使用旧奖励数据。';
    return;
  }
  const generatedRows=buildRewardLedgerRows();
  const metrics=rewardLedgerMetrics(generatedRows);
  const diff=compareRewardLedgerRows(generatedRows);
  const cards=[
    ['可生成台账', diff.generated, '由当前旧数据实时计算'],
    ['表内已有', diff.stored, '已同步进新台账的记录'],
    ['待新增', diff.missing, '新表缺少的台账记录'],
    ['待更新', diff.changed, '旧数据变化后需要刷新'],
    ['旧表多余', diff.stale, '不会自动删除，只提示检查'],
    ['未兑现', metrics.unfulfilled, '当前计算出的未兑现奖励']
  ];
  box.innerHTML=cards.map(([label,value,note])=>`
    <div class="adminTaskCard ledgerMetricCard">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
      <small>${escapeHtml(note)}</small>
    </div>
  `).join('');
  if(status){
    status.textContent = diff.missing || diff.changed
      ? `检测完成：有 ${diff.missing} 条待新增、${diff.changed} 条待更新。`
      : `检测完成：台账已同步。${diff.stale ? `另有 ${diff.stale} 条旧表多余记录，未自动删除。` : ''}`;
  }
}

async function syncRewardLedgerAdmin(){
  const status=document.getElementById('rewardLedgerStatus');
  if(!state.rewardLedgerAvailable){
    if(status) status.textContent='奖励台账表不可用，请确认 SQL 已执行。';
    return;
  }
  const rows=buildRewardLedgerRows();
  if(!rows.length){
    if(status) status.textContent='当前没有可同步的奖励台账记录。';
    return;
  }
  if(status) status.textContent=`正在同步 ${rows.length} 条奖励台账...`;
  const payloads=rows.map(rewardLedgerPayload);
  const errors=[];
  for(let i=0;i<payloads.length;i+=400){
    const chunk=payloads.slice(i,i+400);
    const res=await sb.from('reward_ledger').upsert(chunk,{onConflict:'ledger_key'});
    if(res.error) errors.push(res.error.message);
  }
  if(errors.length){
    if(status) status.textContent=`同步失败：${errors[0]}`;
    return;
  }
  await logOperation('sync_reward_ledger', `同步 ${rows.length} 条奖励台账`, {count:rows.length});
  if(status) status.textContent=`同步成功：${rows.length} 条奖励台账。`;
  await loadAll();
  renderRewardLedgerAdmin();
}

async function syncFulfillmentToRewardLedger(row,nextFulfilled,date){
  if(!state.rewardLedgerAvailable || !row) return;
  const ledgerRow = normalizeRewardLedgerRow({
    ...row,
    source_id:row.source_id || row.id || '',
    fulfilled:nextFulfilled,
    fulfilled_date:date || ''
  });
  if(nextFulfilled){
    ledgerRow.progress_status=ledgerRow.provider_type==='zhou_tongyue' ? '已兑现' : '已完结';
    ledgerRow.workflow_status='completed';
  }
  const res=await sb.from('reward_ledger').upsert(rewardLedgerPayload(ledgerRow),{onConflict:'ledger_key'});
  if(res.error){
    console.warn('sync fulfillment to reward_ledger failed:', res.error);
  }
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
function todayDateText(){
  const date=new Date();
  const year=date.getFullYear();
  const month=String(date.getMonth()+1).padStart(2,'0');
  const day=String(date.getDate()).padStart(2,'0');
  return `${year}-${month}-${day}`;
}
function visitViewLabel(view){
  return VISIT_VIEW_LABELS[view] || view || '页面访问';
}
function getVisitorId(){
  let id=localStorage.getItem(VISITOR_ID_STORAGE_KEY);
  if(!id){
    id=`v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2,10)}`;
    localStorage.setItem(VISITOR_ID_STORAGE_KEY,id);
  }
  return id;
}
function currentDeviceType(){
  return window.matchMedia('(max-width: 900px)').matches ? 'mobile' : 'desktop';
}
async function recordVisit(viewName){
  const view=viewName || state.view || 'overview';
  const dedupeKey=VISIT_LOG_DEDUPE_PREFIX + view;
  const now=Date.now();
  const last=Number(sessionStorage.getItem(dedupeKey) || 0);
  if(now - last < VISIT_LOG_DEDUPE_MS) return;
  sessionStorage.setItem(dedupeKey,String(now));
  try{
    const res=await sb.from('visit_logs').insert({
      visitor_id:getVisitorId(),
      view_name:view,
      device_type:currentDeviceType(),
      user_agent:navigator.userAgent,
      page_path:location.pathname || 'index.html'
    });
    if(res.error) state.visitLogsAvailable=false;
  }catch(e){
    state.visitLogsAvailable=false;
  }
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
function lotteryPoolEntries(value){
  if(Array.isArray(value)) return value;
  if(value && typeof value==='object'){
    return Array.isArray(value.entries) ? value.entries
      : (Array.isArray(value.pool) ? value.pool
      : (Array.isArray(value.items) ? value.items : []));
  }
  return [];
}
function positiveNumber(value){
  const n=Number(String(value ?? '').replace(/,/g,'').trim());
  return Number.isFinite(n) && n>0 ? n : null;
}
function lotteryMetaThreshold(record,pool){
  const winners=record.winners_json && typeof record.winners_json==='object' && !Array.isArray(record.winners_json) ? record.winners_json : {};
  const poolMeta=record.pool_json && typeof record.pool_json==='object' && !Array.isArray(record.pool_json) ? record.pool_json : {};
  const candidates=[
    record.threshold,
    record.lottery_threshold,
    record.rule_threshold,
    winners.threshold,
    winners.lottery_threshold,
    winners.meta?.threshold,
    poolMeta.threshold,
    poolMeta.lottery_threshold,
    poolMeta.meta?.threshold,
    pool[0]?.lottery_threshold,
    pool[0]?.threshold,
    pool[0]?.rule_threshold
  ];
  for(const value of candidates){
    const n=positiveNumber(value);
    if(n!==null) return n;
  }
  const rule=String(record.rule_text || '');
  const match=rule.match(/达到\s*([0-9]+(?:\.[0-9]+)?)/) || rule.match(/([0-9]+(?:\.[0-9]+)?)\s*元/);
  if(match){
    const n=positiveNumber(match[1]);
    if(n!==null) return n;
  }
  const amounts=pool.map(x=>positiveNumber(x.amount)).filter(x=>x!==null);
  return amounts.length ? Math.min(...amounts) : null;
}
function publicLotteryRule(record){
  const type=record.lottery_type;
  const pool=lotteryPoolEntries(record.pool_json);
  if(type==='monthly' || type==='single'){
    const threshold=lotteryMetaThreshold(record,pool);
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
  return `<div class="lotteryResult">
    ${drawTime?`<div class="lotteryDrawTime">抽奖时间：${escapeHtml(formatDateTime(drawTime))}</div>`:''}
    ${list.map(item=>{
      if(item && typeof item === 'object' && !Array.isArray(item)){
        const name=item.name || item.user_name || item.winner || item.winner_name || '';
        const prize=item.prize || item.prize_name || item.reward || item.reward_name || '未填写';
        return `<div class="lotteryWinner"><span>中奖人：<b>${escapeHtml(name || '-')}</b></span><span>奖品：<b>${escapeHtml(prize)}</b></span></div>`;
      }
      return `<div class="lotteryWinner"><span><b>${escapeHtml(winnerText(item) || '获奖结果')}</b></span></div>`;
    }).join('')}
  </div>`;
}
function renderLotteryPool(pool){
  const list=lotteryPoolEntries(pool);
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
    update_reward_progress:'更新制作进度',
    upsert_reward_choice_options:'保存奖励选项',
    update_reward_choice:'更新奖励选择',
    create_election_2026_reward_rule:'新增总选奖励规则',
    update_election_2026_reward_rule:'修改总选奖励规则',
    delete_election_2026_reward_rule:'删除总选奖励规则',
    create_election_2026_manual_reward:'新增总选单独奖励',
    update_election_2026_manual_reward:'修改总选单独奖励',
    delete_election_2026_manual_reward:'删除总选单独奖励',
    update_election_2026_reward_status:'更新总选奖励兑现',
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
        amount: row.amount,
        lottery_threshold: threshold,
        lottery_mode: mode
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
  const threshold=positiveNumber(document.getElementById('lotteryThreshold')?.value) || positiveNumber(entries[0]?.lottery_threshold);
  const mode=document.getElementById('lotteryBuildMode')?.value || document.getElementById('lotteryType')?.value || '';
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
  const result={
    drawn_at:new Date().toISOString(),
    winners,
    meta:{
      threshold:threshold || null,
      mode,
      event_name:entries[0]?.event_name || ''
    }
  };
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
  updateEventTotalText();
  sel.onchange=e=>{state.event=e.target.value; state.view='event'; setActive('event'); updateEventTotalText(); renderAll();};
  document.getElementById('nameOptions').innerHTML = allNames().map(n=>`<option value="${escapeHtml(n)}"></option>`).join('');
  const personalInput=document.getElementById('personalLookup');
  if(personalInput) personalInput.oninput=renderPersonalSearch;
  const clearPersonal=document.getElementById('clearPersonalLookup');
  if(clearPersonal) clearPersonal.onclick=()=>{document.getElementById('personalLookup').value='';renderPersonalSearch();};
  const specialEvent=document.getElementById('specialEventName');
  if(specialEvent) specialEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
  const pkExcelEvent=document.getElementById('pkExcelEvent');
  if(pkExcelEvent) pkExcelEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
  syncUnifiedImportUi();
  const pkExportEvent=document.getElementById('pkExportEvent');
  if(pkExportEvent) pkExportEvent.innerHTML = pkEvents().map(e=>`<option>${escapeHtml(e.event_name)}</option>`).join('');
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
}
function updateEventTotalText(){
  const totalEl=document.getElementById('eventTotalText');
  const netEl=document.getElementById('eventNetText');
  if(!totalEl && !netEl) return;
  const eventName=state.event || document.getElementById('eventSelect')?.value || pkEvents()[0]?.event_name || '';
  const total=DATA.records
    .filter(r=>r.event_name===eventName)
    .reduce((sum,row)=>sum+num(row.amount),0);
  const net=Math.round(total * 0.994 * 100) / 100;
  if(totalEl) totalEl.textContent=`单场总额 ${fmt(total)}`;
  if(netEl) netEl.textContent=`实际收入 ${fmt(net)}`;
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
    const labelMap={personal:'总数据排名',participant:'总选排名',event:'总选单场',birth:'生公排名'};
    pkSubTitle.textContent='🍊排名分类 · ' + (labelMap[v] || '总数据排名');
  }

  const eventBox=document.getElementById('eventFilterBox');
  if(eventBox) eventBox.classList.toggle('hidden', v!=='event');
  if(!IS_ADMIN_PAGE) recordVisit(v);
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
  if(mainTableCard){
    mainTableCard.classList.toggle('hidden', state.view==='rewards');
    mainTableCard.dataset.mobileView=state.view;
  }
  updateAnnouncementBadge();
  renderTable();
  renderLookup();
  renderPersonalSearch();
}

function election2026RankItem(row,index,mode){
  const rank=index+1;
  const rankClass = rank===1 ? 'top1' : (rank===2 ? 'top2' : (rank===3 ? 'top3' : 'normal'));
  const isDark=mode==='dark';
  const total=isDark ? row.totalDarkVotes : row.totalContribution;
  const breakdown=isDark
    ? `未翻明 ${fmtVotes(row.darkUnrevealedVotes)} ｜ 已翻明 ${fmtVotes(row.darkRevealedVotes)} ｜ 暗账折算 ${fmtVotes(row.darkLinkVotes)}`
    : `明票 ${fmtVotes(row.publicVotes)} ｜ 未翻明 ${fmtVotes(row.darkUnrevealedVotes)} ｜ PK折算 ${fmtVotes(row.pkVotes)}`;
  return `<div class="electionRankItem rank-${rank<=3 ? rank : 'normal'}">
    <div class="electionRankNo"><span class="pill rankPill ${rankClass}">#${rank}</span></div>
    <div class="electionRankName"><b>${escapeHtml(row.name)}</b><span>${escapeHtml(breakdown)}</span></div>
    <div class="electionRankValue"><b>${fmtVotes(total)}</b><span>票</span><button class="btn electionRewardBtn" data-election-reward-name="${escapeHtml(row.name)}" type="button">奖励</button></div>
  </div>`;
}
function ensureElection2026RewardModal(){
  let modal=document.getElementById('election2026RewardModal');
  if(modal) return modal;
  modal=document.createElement('div');
  modal.className='modal electionRewardModal';
  modal.id='election2026RewardModal';
  modal.innerHTML=`<div class="panel electionRewardDialog">
    <div class="adminModalHeader">
      <div>
        <h2 class="adminPanelTitle" id="election2026RewardDialogTitle">2026总选奖励</h2>
        <div class="small" id="election2026RewardDialogSub">按当前总贡献值实时计算。</div>
      </div>
      <button class="btn electionRewardDialogClose" type="button">关闭</button>
    </div>
    <div id="election2026RewardDialogBody" class="lookupResult"></div>
  </div>`;
  document.body.appendChild(modal);
  modal.querySelector('.electionRewardDialogClose').onclick=()=>modal.classList.remove('show');
  modal.onclick=e=>{
    if(e.target===modal) modal.classList.remove('show');
  };
  return modal;
}
function openElection2026RewardDialog(userName){
  const name=canon(userName);
  const modal=ensureElection2026RewardModal();
  const title=modal.querySelector('#election2026RewardDialogTitle');
  const sub=modal.querySelector('#election2026RewardDialogSub');
  const body=modal.querySelector('#election2026RewardDialogBody');
  const contribution=election2026ContributionRowForUser(name);
  const rewards=election2026RewardsForUser(name);
  if(title) title.textContent=`${name} · 2026总选奖励`;
  if(sub) sub.textContent=`总贡献值 ${fmtVotes(contribution.totalContribution)} 票`;
  if(!state.election2026RewardsAvailable){
    body.innerHTML=`<div class="emptyState"><b>总选奖励表暂不可用</b><div class="small">请先在 Supabase 执行 2026 总选奖励 SQL。</div></div>`;
    modal.classList.add('show');
    return;
  }
  const fulfilledCount=rewards.filter(row=>row.fulfilled).length;
  body.innerHTML=`
    <div class="lookupSummary rewardLookupSummary">
      <div class="lookupMini"><span class="small">总贡献值</span><b>${fmtVotes(contribution.totalContribution)} 票</b></div>
      <div class="lookupMini"><span class="small">奖励数量</span><b>${rewards.length}</b></div>
      <div class="lookupMini"><span class="small">待兑现</span><b>${rewards.length-fulfilledCount}</b></div>
    </div>
    <div class="rewardList electionRewardDialogList">
      ${rewards.map(row=>`<div class="rewardItem">
        <div>
          <b>${escapeHtml(row.reward_name)}</b>
          <div class="small">${escapeHtml(election2026RewardSourceText(row))}</div>
          ${row.note ? `<div class="small">备注：${escapeHtml(row.note)}</div>` : ''}
        </div>
        <div>${election2026RewardStatusPill(row)}</div>
      </div>`).join('') || '<div class="emptyState"><b>暂无总选奖励</b><div class="small">当前 ID 暂无达标或单独增加的 2026 总选奖励。</div></div>'}
    </div>`;
  modal.classList.add('show');
}
function renderElection2026LookupResult(){
  const input=document.getElementById('election2026Lookup');
  const out=document.getElementById('election2026LookupResult');
  if(!input || !out) return;
  const rows=election2026Rows();
  const kw=String(input.value||'').trim().toLowerCase();
  const kwKey=nameKey(kw);
  if(!kw){
    out.className='lookupResult small';
    out.innerHTML='输入完整或部分 ID 后，将显示 2026 总选贡献与暗票明细。';
    return;
  }
  const matches=rows
    .map(row=>row.name)
    .filter(name=>name.toLowerCase().includes(kw) || (kwKey && nameKey(name).includes(kwKey)))
    .sort((a,b)=>a.localeCompare(b,'zh-Hans-CN'));
  if(!matches.length){
    out.className='lookupResult small';
    out.innerHTML='未找到匹配 ID。';
    return;
  }
  const name=matches[0];
  const row=rows.find(item=>item.name===name) || emptyElection2026Row(name);
  const candidates=matches.length>1
    ? `<div class="small matchPillRow">匹配结果：${matches.map(n=>`<span class="pill personal-candidate-pill electionCandidatePill clickablePill" data-election-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`).join('')}</div>`
    : '';
  out.className='lookupResult';
  out.innerHTML=`${candidates}
    <div class="lookupSummary electionLookupSummary">
      <div class="lookupMini"><span>总贡献值</span><b>${fmtVotes(row.totalContribution)} 票</b></div>
      <div class="lookupMini"><span>总暗票</span><b>${fmtVotes(row.totalDarkVotes)} 票</b></div>
      <div class="lookupMini"><span>PK折算</span><b>${fmtVotes(row.pkVotes)} 票</b></div>
    </div>
    <div class="eventAmountList">
      <div class="eventAmountItem"><span>明票榜</span><b class="amt">${fmtVotes(row.publicVotes)} 票</b></div>
      <div class="eventAmountItem"><span>未翻明暗票</span><b class="amt">${fmtVotes(row.darkUnrevealedVotes)} 票</b></div>
      <div class="eventAmountItem"><span>已翻明暗票</span><b class="amt">${fmtVotes(row.darkRevealedVotes)} 票</b></div>
      <div class="eventAmountItem"><span>暗账链接金额</span><b class="amt">${fmt(row.darkLinkAmount)} / ${fmtVotes(row.darkLinkVotes)} 票</b></div>
      <div class="eventAmountItem"><span>PK金额</span><b class="amt">${fmt(row.pkAmount)} / ${fmtVotes(row.pkVotes)} 票</b></div>
    </div>`;
  out.querySelectorAll('.electionCandidatePill').forEach(pill=>{
    pill.onclick=()=>{
      input.value=pill.dataset.electionName || '';
      renderElection2026LookupResult();
    };
  });
}
function bindElection2026Controls(){
  document.querySelectorAll('.electionModeBtn').forEach(btn=>{
    btn.onclick=()=>{
      state.election2026Mode=btn.dataset.electionMode || 'contribution';
      renderTable();
    };
  });
  const input=document.getElementById('election2026Lookup');
  if(input) input.oninput=renderElection2026LookupResult;
  document.querySelectorAll('.electionRewardBtn').forEach(btn=>{
    btn.onclick=()=>openElection2026RewardDialog(btn.dataset.electionRewardName || '');
  });
  renderElection2026LookupResult();
}
function renderElection2026Page(){
  if(!state.election2026Available){
    return `<tr class="overviewHeroRow"><td colspan="3">
      <div class="overviewPanel electionPanel">
        <div class="emptyState">
          <b>2026 总选数据表暂不可用</b>
          <div class="small">请先在 Supabase 执行本次新增 SQL，之后就可以导入明票、暗票和暗账链接金额。</div>
        </div>
      </div>
    </td></tr>`;
  }
  const allRows=election2026Rows();
  const summary=election2026Summary(allRows);
  const mode=state.election2026Mode || 'contribution';
  const rankRows=sortedElection2026Rows(mode);
  const rankTitle=mode==='dark' ? '总暗票排名' : '总贡献值排名';
  return `<tr class="overviewHeroRow"><td colspan="3">
    <div class="overviewPanel electionPanel">
      <div class="overviewTitle">2026 总选数据总览</div>
      <div class="overviewDesc">总贡献值 = 明票榜 + 未翻明暗票 + PK金额折算；总暗票 = 未翻明暗票 + 已翻明暗票 + 暗账链接金额折算。</div>
      <div class="overviewGrid electionKpiGrid">
        <div class="overviewMini primary"><span>总贡献值</span><b>${fmtVotes(summary.totalContribution)} 票</b></div>
        <div class="overviewMini"><span>总暗票</span><b>${fmtVotes(summary.totalDarkVotes)} 票</b></div>
        <div class="overviewMini"><span>明票榜</span><b>${fmtVotes(summary.publicVotes)} 票</b></div>
        <div class="overviewMini"><span>未翻明暗票</span><b>${fmtVotes(summary.darkUnrevealedVotes)} 票</b></div>
        <div class="overviewMini"><span>PK折算</span><b>${fmtVotes(summary.pkVotes)} 票</b><small>PK金额 ${fmt(summary.pkAmount)}</small></div>
        <div class="overviewMini"><span>暗账折算</span><b>${fmtVotes(summary.darkLinkVotes)} 票</b><small>暗账金额 ${fmt(summary.darkLinkAmount)}</small></div>
      </div>
      <div class="electionToolbar">
        <div class="electionModeGroup" role="tablist" aria-label="2026 总选榜单">
          <button class="btn electionModeBtn ${mode==='contribution'?'active':''}" data-election-mode="contribution" type="button">总贡献值榜</button>
          <button class="btn electionModeBtn ${mode==='dark'?'active':''}" data-election-mode="dark" type="button">总暗票榜</button>
        </div>
        <div class="lookupBox electionLookupBox">
          <input id="election2026Lookup" list="nameOptions" type="search" placeholder="查询某个 ID 的 2026 总选数据" autocomplete="off">
        </div>
      </div>
      <div id="election2026LookupResult" class="lookupResult small"></div>
      <div class="electionRankCard">
        <div class="electionRankTitle">
          <b>${escapeHtml(rankTitle)}</b>
          <span>${mode==='dark' ? `${summary.darkUsers} 人有暗票记录` : `${summary.contributionUsers} 人有贡献记录`}</span>
        </div>
        <div class="electionRankHeader"><span>排名</span><span>名称</span><span>${mode==='dark'?'总暗票':'总贡献值'}</span></div>
        <div class="electionRankList">${rankRows.map((row,index)=>election2026RankItem(row,index,mode)).join('') || '<div class="small emptyState">暂无 2026 总选数据。</div>'}</div>
      </div>
    </div>
  </td></tr>`;
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
    title.textContent='🍊数据总览';
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
    const topList = (rows, type) => rows.slice(0,3).map((r,i)=>{
      const breakdown = type==='total' ? `<div class="small rankBreakdown mobileMeta">总选 ${fmt(r.pk)} ｜ 生公 ${fmt(r.birth)}</div>` : '';
      return `<div class="overviewRankItem mobileListRow rank-${i+1}">
        <div class="rankIdentity mobileMain">
          <span class="pill rankPill ${i===0?'top1':(i===1?'top2':'top3')}">#${i+1}</span>
          <b>${escapeHtml(r.name)}</b>
        </div>
        ${breakdown}
        <div class="rankAmount mobileValue"><strong>${fmt(r.total)}</strong></div>
      </div>`;
    }).join('') || '<div class="small">暂无数据</div>';
    tbody.innerHTML=`
      <tr class="overviewHeroRow">
        <td colspan="3">
          <div class="overviewPanel">
            <div class="overviewTitle">🍊数据总览</div>
            <div class="overviewDesc">数据分为总选🍊与生公🍊两部分；首页展示总数据、总选数据和生公数据的核心统计与排名摘要。</div>
            <div class="overviewGrid">
              <div class="overviewMini primary"><span>🍊总额</span><b>${fmt(totalContribution)}</b></div>
              <div class="overviewMini"><span>总选🍊</span><b>${fmt(pkTotal)}</b></div>
              <div class="overviewMini"><span>生公🍊</span><b>${fmt(birthTotal)}</b></div>
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
    title.textContent='总选排名';
    thead.innerHTML=`<tr class="noteRow"><td colspan="3" class="small">票数按 ${PK_VOTE_UNIT_AMOUNT} 元折算 1 票，仅用于总选相关榜单展示。</td></tr><tr><th>排名</th><th>名称</th><th>总选金额</th></tr>`;
    rows=aggregateByUser(DATA.records).map((p,i)=>({rank:i+1,name:p.name,value:p.total,votes:p.total/PK_VOTE_UNIT_AMOUNT,showVotes:true,search:p.name}));
  }else if(state.view==='event'){
    const event=state.event || pkEvents()[0]?.event_name;
    title.textContent=`${event} · 总选单场排名`;
    thead.innerHTML=`<tr class="noteRow"><td colspan="3" class="small">票数按 ${PK_VOTE_UNIT_AMOUNT} 元折算 1 票，仅用于总选相关榜单展示。</td></tr><tr><th>排名</th><th>名称</th><th>金额</th></tr>`;
    rows=aggregateByEventUser(DATA.records,event)
      .map((r,i)=>({rank:i+1,name:r.user_name,value:num(r.amount),votes:num(r.amount)/PK_VOTE_UNIT_AMOUNT,showVotes:true,search:`${r.user_name} ${r.event_name}`}));
  }else if(state.view==='birth'){
    title.textContent='生公排名';
    thead.innerHTML='<tr><th>排名</th><th>名称</th><th>生公金额</th></tr>';
    rows=birthByUser().map((p,i)=>({rank:i+1,name:p.name,value:p.total,search:p.name}));
  }else if(state.view==='election2026'){
    title.textContent='2026总选';
    thead.innerHTML='';
    tbody.innerHTML=renderElection2026Page();
    bindElection2026Controls();
    return;
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
      return `<tr class="mobileListRow lotteryRecordRow"><td class="mobileLabel"><span class="pill">${escapeHtml(lotteryTypeLabel(r.lottery_type))}</span></td><td class="mobileMain"><b>${escapeHtml(r.lottery_name||'抽奖结果')}</b>${rule?`<div class="small mobileMeta">${escapeHtml(rule)}</div>`:''}</td><td class="mobileValue">${renderLotteryResult(r)}</td></tr>`;
    }).join('') || '<tr class="mobileListRow lotteryRecordRow"><td class="mobileLabel"><span class="pill">抽奖</span></td><td class="mobileMain"><div class="emptyState"><b>暂无抽奖结果</b><div class="small">后台发布抽奖结果后，将在此处展示。</div></div></td><td class="mobileValue">待更新</td></tr>';
    return;
  }else if(state.view==='announcements'){
    title.textContent='公告通知';
    thead.innerHTML='<tr><th class="announcementTypeHead">类型</th><th class="announcementContentHead">说明</th></tr>';
    const items=visibleAnnouncements();
    tbody.innerHTML=items.map(a=>{
      return `<tr class="mobileListRow announcementRow"><td class="mobileLabel announcementTypeCell"><span class="pill ${a.is_pinned?'warn':''}">${a.is_pinned?'置顶':'公告'}</span></td><td class="mobileMain">${renderAnnouncementDetail(a)}</td></tr>`;
    }).join('') || '<tr class="mobileListRow announcementRow"><td class="mobileLabel announcementTypeCell"><span class="pill warn">公告</span></td><td class="mobileMain"><div class="announcementCard"><b>暂无新增公告</b><div class="small">后台发布公告后，可在此区域查看通知内容。</div></div></td></tr>';
    return;
  }else if(state.view==='questions'){
    title.textContent='匿名提问';
    thead.innerHTML='';
    tbody.innerHTML=`<tr class="questionRow"><td colspan="3">
      <div class="questionPanel mobileStack">
        <div class="questionIntro mobileCard">
          <b>匿名提问说明</b>
          <div class="small">提交问题后会生成查询码，请自行保存。管理员回复后，可在“查询回答”中输入查询码查看回复。</div>
        </div>
        <div class="questionBox mobileCard">
          <h3>提交匿名提问</h3>
          <textarea id="questionText" placeholder="请输入想提问的内容"></textarea>
          <button class="btn good" id="submitQuestionBtn" type="button">提交提问并生成查询码</button>
          <div class="status" id="questionSubmitStatus"></div>
        </div>
        <div class="questionBox mobileCard">
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
    const rowClass = `mobileListRow rankRow${r.rank<=3 ? ` rank-${r.rank}` : ''}`;
    return `<tr class="${rowClass}"><td class="mobileLabel"><span class="pill rankPill ${rankClass}">#${r.rank}</span></td><td class="mobileMain"><b class="${r.rank<=3?'topName':''}">${escapeHtml(r.name)}</b>${state.view==='personal'?`<div class="small mobileMeta">总选 ${fmt(r.pk)} ｜ 生公 ${fmt(r.b)}</div>`:''}</td><td class="mobileValue">${fmt(r.value)}${r.showVotes?`<div class="small mobileMeta">折合 ${fmtVotes(r.votes)} 票</div>`:''}</td></tr>`;
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
    ? `<div class="small matchPillRow">匹配结果：${matches.map(n=>`<span class="pill personal-candidate-pill clickablePill" data-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`).join('')}</div>`
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
    <div class="small lookupNote">🍊合计仅供个人查询参考；总选排名只计算总选金额，生公不计入总选排名。</div>
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
  document.getElementById('lookupTitle').textContent = state.view==='rewards' ? '奖励兑现查询' : '个人🍊查询';
  if(!kw){
    out.className='lookupResult small';
    out.innerHTML=state.view==='rewards' ? '输入名称查看奖励兑现情况。' : '输入完整或部分名称后，将显示该参与者信息。';
    return;
  }
  const matches=allNames().filter(n=>n.toLowerCase().includes(kw) || (kwKey && nameKey(n).includes(kwKey)));
  if(!matches.length){out.className='lookupResult small'; out.innerHTML='未找到匹配名称。'; return;}
  const name=matches[0];
  const candidates = matches.length>1 ? `<div class="small matchPillRow">匹配结果：${matches.map(n=>`<span class="pill candidate-pill clickablePill" data-name="${escapeHtml(n)}">${escapeHtml(n)}</span>`).join('')}</div>` : '';
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
    <div class="small lookupNote">个人🍊合计：${fmt(pkTotal+bTotal)}。该合计仅供个人查询参考，不参与总选排名。</div>
    <div class="eventAmountList">
      ${pkRows.map(r=>`<div class="eventAmountItem"><div><b>${escapeHtml(r.name)}</b><div class="small">${escapeHtml(r.date||'')}</div></div><div class="amt">${fmt(r.amount)}</div></div>`).join('')}
	      <div class="eventAmountItem"><div><b>生公专项</b><div class="small">独立统计，不计入总选</div></div><div class="amt">${fmt(bTotal)}</div></div>
	    </div>`;
}

function rewardLookupLedgerRowsForUser(name){
  const key=nameKey(canon(name));
  if(!key) return [];
  const sourceOrder={pk:1,birth:2,special:3};
  return rewardLedgerRowsForAdmin()
    .filter(row=>nameKey(row.user_name)===key)
    .sort((a,b)=>
      (sourceOrder[a.source_type] || 9) - (sourceOrder[b.source_type] || 9)
      || (a.source_type==='pk' ? eventSortIndex(a.event_name)-eventSortIndex(b.event_name) : 0)
      || String(a.event_name || a.reward_group || '').localeCompare(String(b.event_name || b.reward_group || ''),'zh-Hans-CN')
      || String(a.reward_name || '').localeCompare(String(b.reward_name || ''),'zh-Hans-CN')
    );
}
function rewardLedgerThreshold(row){
  if(row.source_type==='pk'){
    const rule=DATA.rewardRules.find(r=>r.event_name===row.event_name && r.reward_name===row.reward_name);
    return rule ? num(rule.threshold) : null;
  }
  if(row.source_type==='birth'){
    const rule=DATA.birthRewardRules.find(r=>(r.reward_group || '生公')===(row.reward_group || row.event_name || '生公') && r.reward_name===row.reward_name);
    return rule ? num(rule.threshold) : null;
  }
  return null;
}
function rewardLookupGroupKey(row){
  if(row.source_type==='pk') return `pk||${row.event_name || '总选奖励'}`;
  if(row.source_type==='birth') return `birth||${row.reward_group || row.event_name || '生公奖励'}`;
  return `special||特殊排名奖励`;
}
function rewardLookupGroupTitle(row){
  if(row.source_type==='pk') return row.event_name || '总选奖励';
  if(row.source_type==='birth') return `生公奖励 · ${row.reward_group || row.event_name || '生公'}`;
  return '特殊排名奖励';
}
function rewardLookupGroupNote(rows){
  const first=rows[0] || {};
  if(first.source_type==='pk') return `单场金额 ${fmt(first.amount)}`;
  if(first.source_type==='birth') return `生公合计 ${fmt(first.amount)}`;
  return `${rows.length} 项`;
}
function rewardLookupFulfillmentPill(row){
  return row.fulfilled
    ? `<span class="pill good">已兑现${row.fulfilled_date?' '+escapeHtml(row.fulfilled_date):''}</span>`
    : `<span class="pill warn">未兑现</span>`;
}
function renderLedgerRewardItem(row){
  const displayName=row.display_reward_name || row.selected_reward_name || row.reward_name;
  const threshold=rewardLedgerThreshold(row);
  const special=row.source_type==='special' ? DATA.specialRankRewards.find(r=>String(r.id)===String(row.source_id)) : null;
  const sourceLine = row.source_type==='special'
    ? `${escapeHtml(row.event_name || '未关联场次')}${special?.target_rank ? ` ｜ 原定第${escapeHtml(special.target_rank)}名` : ''}${special?.provider_name ? ` ｜ 提供者：${escapeHtml(special.provider_name)}` : ''}`
    : `${escapeHtml(sourceTypeText(row.source_type))}${row.event_name ? ` ｜ ${escapeHtml(row.event_name)}` : ''}`;
  const originalLine = row.choice_required && row.selected_reward_name && row.selected_reward_name!==row.reward_name
    ? `<div class="small">原奖励：${escapeHtml(row.reward_name)}</div>`
    : '';
  const thresholdLine = threshold!==null ? `<div class="small">达标金额：${fmt(threshold)}</div>` : '';
  const noteLine = row.note ? `<div class="small">备注：${escapeHtml(row.note)}</div>` : '';
  const statusLine = row.source_type==='special' && row.special_status ? specialStatusPill(row.special_status) : '';
  return `<div class="rewardItem">
    <div>
      <b>${escapeHtml(displayName)}</b>
      <div class="small">${sourceLine}</div>
      ${thresholdLine}
      ${originalLine}
      ${noteLine}
      ${renderLedgerRewardProgressLine(row)}
    </div>
    <div>${statusLine}${rewardLookupFulfillmentPill(row)}</div>
  </div>`;
}
function renderLedgerRewardGroups(rows,emptyHtml){
  if(!rows.length) return emptyHtml;
  const groups=new Map();
  rows.forEach(row=>{
    const key=rewardLookupGroupKey(row);
    if(!groups.has(key)) groups.set(key,[]);
    groups.get(key).push(row);
  });
  return [...groups.values()].map(groupRows=>{
    const first=groupRows[0] || {};
    return `<details class="rewardDetails">
      <summary><span>${escapeHtml(rewardLookupGroupTitle(first))}<span class="small rewardDetailHint">点击查看详情</span></span><span>${escapeHtml(rewardLookupGroupNote(groupRows))}</span></summary>
      <div class="rewardList">${groupRows.map(renderLedgerRewardItem).join('')}</div>
    </details>`;
  }).join('');
}
function renderLedgerRewardLookup(name,candidates,out,ledgerRows){
  const only=document.getElementById('onlyUnfulfilled').checked;
  const rows=only ? ledgerRows.filter(row=>!row.fulfilled) : ledgerRows;
  const pkRows=rows.filter(row=>row.source_type==='pk');
  const birthRows=rows.filter(row=>row.source_type==='birth');
  const specialRows=rows.filter(row=>row.source_type==='special');
  const rewardSection = (label, body, note='') => `<div class="rewardSection"><div class="rewardSectionTitle"><b>${escapeHtml(label)}</b>${note?`<span class="small">${escapeHtml(note)}</span>`:''}</div>${body}</div>`;
  out.className='lookupResult';
  out.innerHTML=candidates+`
    <div class="lookupSummary rewardLookupSummary">
      <div class="lookupMini"><span class="small">名称</span><b>${escapeHtml(name)}</b></div>
      <div class="lookupMini"><span class="small">总选奖励</span><b>${pkRows.length}</b></div>
      <div class="lookupMini"><span class="small">生公奖励</span><b>${birthRows.length}</b></div>
    </div>
    ${rewardSection('总选奖励', renderLedgerRewardGroups(pkRows,'<div class="emptyState"><b>暂无总选奖励</b><div class="small">当前名称暂无符合条件的总选金额门槛奖励。</div></div>'), only?'仅显示未兑现':'按单场总选金额计算')}
    ${rewardSection('生公奖励', renderLedgerRewardGroups(birthRows,'<div class="emptyState"><b>暂无生公奖励</b><div class="small">当前名称暂无符合条件的生公奖励。</div></div>'))}
    ${rewardSection('特殊排名奖励', renderLedgerRewardGroups(specialRows,'<div class="emptyState"><b>暂无特殊排名奖励</b><div class="small">后台记录后会显示在这里。</div></div>'), `${specialRows.length} 项`)}
    <div class="hint">总选奖励按单场总选金额判断；生公奖励按生公合计判断，其中生日留言册只显示最高达标档。特殊排名奖励由提供者独立提供，按后台记录显示。</div>`;
}
function renderRewardLookup(name,candidates,out){
  const ledgerRows=rewardLookupLedgerRowsForUser(name);
  if(ledgerRows.length || state.rewardLedgerAvailable){
    renderLedgerRewardLookup(name,candidates,out,ledgerRows);
    return;
  }
  renderLegacyRewardLookup(name,candidates,out);
}

function renderLegacyRewardLookup(name,candidates,out){
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
  const specialCount=DATA.specialRankRewards.filter(r=>canon(r.winner_name)===canon(name)).length;
  const rewardSection = (label, body, note='') => `<div class="rewardSection"><div class="rewardSectionTitle"><b>${escapeHtml(label)}</b>${note?`<span class="small">${escapeHtml(note)}</span>`:''}</div>${body}</div>`;
  out.className='lookupResult';
  out.innerHTML=candidates+`
    <div class="lookupSummary rewardLookupSummary">
      <div class="lookupMini"><span class="small">名称</span><b>${escapeHtml(name)}</b></div>
      <div class="lookupMini"><span class="small">总选奖励</span><b>${rows.reduce((s,r)=>s+r.rewards.length,0)}</b></div>
      <div class="lookupMini"><span class="small">生公奖励</span><b>${birthRewards.length}</b></div>
    </div>
    ${rewardSection('总选奖励', rows.map(r=>`<details class="rewardDetails">
      <summary><span>${escapeHtml(r.event)} <span class="small">${escapeHtml(r.date||'')}</span><span class="small rewardDetailHint">点击查看详情</span></span><span>${fmt(r.amount)}</span></summary>
      <div class="rewardList">
        ${r.rewards.map(x=>`<div class="rewardItem"><div><b>${escapeHtml(x.reward)}</b><div class="small">达标金额：${fmt(x.min)}</div>${renderRewardChoiceLine(name,'pk',r.event,x.reward)}</div><div>${x.fulfilled?`<span class="pill good">已兑现${x.date?' '+escapeHtml(x.date):''}</span>`:`<span class="pill warn">未兑现</span>`}</div></div>`).join('')}
      </div>
    </details>`).join('') || '<div class="emptyState"><b>暂无总选奖励</b><div class="small">当前名称暂无符合条件的总选金额门槛奖励。</div></div>', only?'仅显示未兑现':'按单场总选金额计算')}
    ${rewardSection('生公奖励', renderBirthRewardGroups(name,birthRewards,birthAmount), `生公合计 ${fmt(birthAmount)}`)}
    ${rewardSection('特殊排名奖励', renderSpecialRankRewardsForUser(name) || '<div class="emptyState"><b>暂无特殊排名奖励</b><div class="small">后台记录后会显示在这里。</div></div>', `${specialCount} 项`)}
    <div class="hint">总选奖励按单场总选金额判断；生公奖励按生公合计判断，其中生日留言册只显示最高达标档。特殊排名奖励由提供者独立提供，按后台记录显示。</div>`;
}

function renderBirthRewardGroups(name,items,birthAmount){
  const groups = [...new Set(items.map(x=>x.group))];
  if(!groups.length){
    return `<details class="rewardDetails">
      <summary><span>生公奖励 <span class="small">生公合计</span><span class="small rewardDetailHint">点击查看详情</span></span><span>${fmt(birthAmount)}</span></summary>
      <div class="rewardList"><div class="small">暂无符合条件的生公奖励。</div></div>
    </details>`;
  }
  return groups.map(group=>{
    const groupItems = items.filter(x=>x.group===group);
    const groupRuleHint = groupItems.some(x=>x.highestOnly) ? '仅显示最高达标档' : '各档兼得';
    return `<details class="rewardDetails">
      <summary><span>生公奖励 · ${escapeHtml(group)} <span class="small">生公合计 ｜ ${escapeHtml(groupRuleHint)}</span><span class="small rewardDetailHint">点击查看详情</span></span><span>${fmt(birthAmount)}</span></summary>
      <div class="rewardList">
        ${groupItems.map(x=>`<div class="rewardItem"><div><b>${escapeHtml(x.reward)}</b><div class="small">达标金额：${fmt(x.min)}${x.note?' ｜ '+escapeHtml(x.note):''}</div>${renderRewardChoiceLine(name,'birth',x.group || '生公',x.reward)}</div><div>${x.fulfilled?`<span class="pill good">已兑现${x.date?' '+escapeHtml(x.date):''}</span>`:`<span class="pill warn">未兑现</span>`}</div></div>`).join('')}
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
      <div class="rewardList specialRewardList">
        ${items.map(r=>`<div class="rewardItem">
          <div>
            <b>${escapeHtml(r.reward_name)}</b>
            <div class="small">
              ${escapeHtml(r.event_name || '未关联场次')} ｜ 原定第${escapeHtml(r.target_rank || '-')}名
              ${r.provider_name ? `｜ 提供者：${escapeHtml(r.provider_name)}` : ''}
            </div>
            ${r.note ? `<div class="small">备注：${escapeHtml(r.note)}</div>` : ''}
            ${renderRewardProgressLine(r.reward_name)}
          </div>
          <div>
            ${specialStatusPill(r.status)}
            ${r.fulfilled ? `<span class="pill good">已兑现${r.fulfilled_date?' '+escapeHtml(r.fulfilled_date):''}</span>` : `<span class="pill warn">未兑现</span>`}
          </div>
        </div>`).join('')}
      </div>`;
}


/* =========================
   管理后台
========================= */
let titlePressTimer=null;
const titleEl=document.getElementById('title');
const goAdminPage=()=>{ window.location.href='admin.html'; };
if(titleEl && !IS_ADMIN_PAGE){
  titleEl.ondblclick=goAdminPage;
  titleEl.addEventListener('touchstart',()=>{titlePressTimer=setTimeout(goAdminPage,5000)});
  titleEl.addEventListener('touchend',()=>clearTimeout(titlePressTimer));
}
const closeAdminBtn=document.getElementById('closeAdmin');
if(closeAdminBtn) closeAdminBtn.onclick=()=>document.getElementById('adminModal')?.classList.remove('show');

async function openAdmin(){
  document.getElementById('adminModal').classList.add('show');
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  updateAuthUI();
  if(user){ renderAdminOverview(); renderRewardTaskAdmin(); renderRewardLedgerAdmin(); renderAdminRewards(); renderRewardProgressAdmin(); renderRewardChoiceAdmin(); renderSpecialRankAdmin(); renderElection2026Admin(); renderElection2026RewardAdmin(); }
}
function updateAuthUI(){
  if(IS_ADMIN_PAGE) document.body.classList.toggle('adminLoggedIn', !!state.user);
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
  state.user=res.data.user; updateAuthUI(); renderAdminOverview(); renderRewardTaskAdmin(); renderRewardLedgerAdmin(); renderAdminRewards(); renderRewardProgressAdmin(); renderRewardChoiceAdmin(); renderSpecialRankAdmin(); renderAnnouncementAdmin(); renderLotteryAdmin(); renderElection2026Admin(); renderElection2026RewardAdmin();
};
document.getElementById('logoutBtn').onclick=async()=>{await sb.auth.signOut(); state.user=null; updateAuthUI();};

function renderAdminGroup(groupId){
  if(groupId==='adminOverview') renderAdminOverview();
  if(groupId==='dataAdmin'){
    setDataAdminPanel(state.dataAdminPanel || 'import', {skipScroll:true});
    renderPkEventAdminList();
    renderAliasAdmin();
    renderElection2026Admin();
  }
  if(groupId==='rewardCenter'){
    setRewardAdminPanel(state.rewardAdminPanel || 'ledger', {skipScroll:true});
    renderRewardTaskAdmin();
    renderRewardLedgerAdmin();
    renderAdminRewards();
    renderRewardProgressAdmin();
    renderRewardChoiceAdmin();
    renderSpecialRankAdmin();
  }
  if(groupId==='electionRewardCenter'){
    renderElection2026RewardAdmin();
  }
  if(groupId==='contentCenter'){
    renderAnnouncementAdmin();
    renderLotteryAdmin();
    renderQuestionAdmin();
  }
  if(groupId==='systemCenter'){
    renderVisitStatsAdmin();
    renderOperationLogs();
  }
}

function setDataAdminPanel(panel, options={}){
  state.dataAdminPanel=panel || 'import';
  document.querySelectorAll('.dataPanelBtn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.dataPanel===state.dataAdminPanel);
  });
  document.querySelectorAll('.adminSection[data-admin-group="dataAdmin"][data-data-panel]').forEach(section=>{
    section.classList.toggle('dataPanelActive', section.dataset.dataPanel===state.dataAdminPanel);
  });
  if(state.dataAdminPanel==='events') renderPkEventAdminList();
  if(state.dataAdminPanel==='aliases') renderAliasAdmin();
  if(state.dataAdminPanel==='election2026') renderElection2026Admin();
  if(!options.skipScroll){
    document.getElementById('dataHubAdmin')?.scrollIntoView({block:'start',behavior:'smooth'});
  }
}

function renderPkEventAdminList(){
  const body=document.getElementById('pkEventAdminBody');
  if(!body) return;
  const rows=pkEvents().map(event=>{
    const aggregated=aggregateByEventUser(DATA.records,event.event_name);
    const total=aggregated.reduce((sum,row)=>sum+num(row.amount),0);
    return {
      event_name:event.event_name,
      event_date:event.event_date || '-',
      sort_order:event.sort_order ?? 0,
      count:aggregated.length,
      total
    };
  }).sort((a,b)=>num(a.sort_order)-num(b.sort_order) || String(a.event_name).localeCompare(String(b.event_name),'zh-Hans-CN'));
  body.innerHTML=rows.map(row=>`
    <tr>
      <td><b>${escapeHtml(row.event_name)}</b></td>
      <td>${escapeHtml(row.event_date)}</td>
      <td>${escapeHtml(row.sort_order)}</td>
      <td>${row.count}</td>
      <td><b>${fmt(row.total)}</b></td>
    </tr>
  `).join('') || '<tr><td colspan="5" class="small">暂无总选 PK 场次</td></tr>';
}

function setRewardAdminPanel(panel, options={}){
  state.rewardAdminPanel=panel || 'ledger';
  document.querySelectorAll('.rewardPanelBtn').forEach(btn=>{
    btn.classList.toggle('active', btn.dataset.rewardPanel===state.rewardAdminPanel);
  });
  document.querySelectorAll('.adminSection[data-admin-group="rewardCenter"][data-reward-panel]').forEach(section=>{
    section.classList.toggle('rewardPanelActive', section.dataset.rewardPanel===state.rewardAdminPanel);
  });
  if(!options.skipScroll){
    document.getElementById('rewardHubAdmin')?.scrollIntoView({block:'start',behavior:'smooth'});
  }
}

function setAdminTab(tabId){
  const targetSection=document.getElementById(tabId);
  const groupId=targetSection?.dataset.adminGroup || tabId;
  const tab=document.querySelector(`.tab[data-admin-tab="${groupId}"]`);
  const sections=[...document.querySelectorAll(`.adminSection[data-admin-group="${groupId}"]`)];
  if(!tab || !sections.length) return;
  document.querySelectorAll('.tab').forEach(x=>x.classList.remove('active'));
  document.querySelectorAll('.adminSection').forEach(x=>x.classList.remove('active'));
  tab.classList.add('active');
  sections.forEach(section=>section.classList.add('active'));
  renderAdminGroup(groupId);
  if(groupId==='dataAdmin' && targetSection?.dataset.dataPanel){
    setDataAdminPanel(targetSection.dataset.dataPanel, {skipScroll:true});
  }
  if(groupId==='rewardCenter' && targetSection?.dataset.rewardPanel){
    setRewardAdminPanel(targetSection.dataset.rewardPanel, {skipScroll:true});
  }
  if(targetSection && targetSection.dataset.adminGroup){
    setTimeout(()=>targetSection.scrollIntoView({block:'start',behavior:'smooth'}),0);
  }
}
document.querySelectorAll('.tab').forEach(t=>t.onclick=()=>setAdminTab(t.dataset.adminTab));
document.querySelectorAll('.dataPanelBtn').forEach(btn=>{
  btn.onclick=()=>setDataAdminPanel(btn.dataset.dataPanel);
});
document.querySelectorAll('.rewardPanelBtn').forEach(btn=>{
  btn.onclick=()=>setRewardAdminPanel(btn.dataset.rewardPanel);
});

const reloadRewards=document.getElementById('reloadRewards');
if(reloadRewards) reloadRewards.onclick=()=>renderAdminRewards();
const checkRewardLedgerBtn=document.getElementById('checkRewardLedgerBtn');
if(checkRewardLedgerBtn) checkRewardLedgerBtn.onclick=renderRewardLedgerAdmin;
const syncRewardLedgerBtn=document.getElementById('syncRewardLedgerBtn');
if(syncRewardLedgerBtn) syncRewardLedgerBtn.onclick=syncRewardLedgerAdmin;
['rewardSearch','rewardFulfillmentFilter','rewardSourceFilter','rewardEventFilter','rewardNameFilter','rewardChoiceStateFilter'].forEach(id=>{
  const el=document.getElementById(id);
  if(!el) return;
  const eventName=el.tagName==='INPUT' ? 'input' : 'change';
  el.addEventListener(eventName, renderAdminRewards);
});
const quickFulfillSearchBtn=document.getElementById('quickFulfillSearchBtn');
if(quickFulfillSearchBtn) quickFulfillSearchBtn.onclick=renderQuickFulfillAdmin;
const quickFulfillName=document.getElementById('quickFulfillName');
if(quickFulfillName) quickFulfillName.onkeydown=e=>{
  if(e.key==='Enter'){
    e.preventDefault();
    renderQuickFulfillAdmin();
  }
};

async function renderAdminOverview(){
  const tasks=document.getElementById('adminTaskGrid');
  if(!tasks) return;
  const normalUnfulfilled=[...allEarnedRewards(), ...allEarnedBirthRewards()].filter(r=>!r.fulfilled).length;
  const specialUnfulfilled=(DATA.specialRankRewards || []).filter(r=>!r.fulfilled).length;
  const pendingChoices=allChoiceRewardRows().filter(r=>r.choiceInfo?.status==='pending').length;
  const activeProgress=(DATA.rewardProgress || []).filter(r=>r.progress_status && !['已兑现','已完结'].includes(r.progress_status)).length;
  let pendingQuestions='-';
  const questionRes=await sb.from('questions').select('answer_text').limit(1000);
  if(!questionRes.error){
    pendingQuestions=(questionRes.data || []).filter(q=>!q.answer_text).length;
  }
  const taskCards=[
    ['普通未兑现', normalUnfulfilled, '快速搜索 ID 或批量处理普通奖励', 'rewardFulfillmentAdmin'],
    ['特殊未兑现', specialUnfulfilled, '检查特殊排名奖励兑现状态', 'specialRankAdmin'],
    ['待选择奖励', pendingChoices, '为二选一或多选一奖励保存具体选择', 'rewardChoiceAdmin'],
    ['待回复提问', pendingQuestions, '查看匿名提问并回复用户', 'questionAdmin'],
    ['制作进度', activeProgress, '更新应援会奖励制作状态', 'rewardProgressAdmin']
  ];
  tasks.innerHTML=taskCards.map(([label,value,note,tabId])=>`
    <button class="adminTaskCard" type="button" data-admin-target="${escapeHtml(tabId)}">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
      <small>${escapeHtml(note)}</small>
    </button>
  `).join('');
  tasks.querySelectorAll('.adminTaskCard').forEach(btn=>btn.onclick=()=>setAdminTab(btn.dataset.adminTarget));
}

function rewardTaskMetrics(){
  const rows=allAdminRewardRows();
  const total=rows.length;
  const normalUnfulfilled=rows.filter(r=>['pk','birth'].includes(r.source_type) && !r.fulfilled).length;
  const specialUnfulfilled=rows.filter(r=>r.source_type==='special' && !r.fulfilled).length;
  const pendingChoices=rows.filter(r=>rewardChoiceFilterState(r)==='pending').length;
  const needsProgress=rows.filter(r=>rewardChoiceFilterState(r)==='needs_progress').length;
  const activeProgress=(DATA.rewardProgress || []).filter(r=>r.progress_status && !['已兑现','已完结'].includes(r.progress_status)).length;
  return {total,normalUnfulfilled,specialUnfulfilled,pendingChoices,needsProgress,activeProgress};
}

function setRewardGlobalStatus(text,type='info'){
  const el=document.getElementById('rewardActionStatus');
  if(!el) return;
  el.textContent=text || '等待操作';
  el.className=`rewardActionStatus ${type}`;
}

function renderRewardTaskAdmin(){
  const tasks=document.getElementById('rewardOpsSummaryGrid');
  if(!tasks) return;
  const metrics=rewardTaskMetrics();
  const cards=[
    ['待兑现', metrics.normalUnfulfilled + metrics.specialUnfulfilled, '按 ID 快速处理发放状态', 'rewardFulfillmentAdmin'],
    ['待选择', metrics.pendingChoices, '处理二选一或多选一奖励', 'rewardChoiceAdmin'],
    ['待编辑进度', metrics.needsProgress, '补全已选择奖励的制作状态', 'rewardProgressAdmin'],
    ['制作中', metrics.activeProgress, '查看仍在推进的奖品', 'rewardProgressAdmin'],
    ['台账总数', metrics.total, '筛选、导出和批量处理', 'rewardAdmin']
  ];
  tasks.innerHTML=cards.map(([label,value,note,tabId])=>`
    <button class="rewardOpsStat" type="button" data-admin-target="${escapeHtml(tabId)}">
      <span>${escapeHtml(label)}</span>
      <b>${escapeHtml(value)}</b>
      <small>${escapeHtml(note)}</small>
    </button>
  `).join('');
  tasks.querySelectorAll('.rewardOpsStat').forEach(btn=>btn.onclick=()=>setAdminTab(btn.dataset.adminTarget));
}

function allAdminRewardRows(){
  return rewardLedgerRowsForAdmin();
}

function rewardChoiceFilterState(row){
  if(row.choice_status){
    if(row.choice_status==='not_required') return 'no_choice';
    if(row.choice_status==='pending') return 'pending';
    if(row.workflow_status==='needs_progress') return 'needs_progress';
    return 'selected';
  }
  const info=rewardChoiceInfo(row.user_name,row.source_type,row.event_name,row.reward_name);
  if(!info) return 'no_choice';
  if(!info.selected) return 'pending';
  return progressForReward(info.selected) ? 'selected' : 'needs_progress';
}

function adminRewardSearchText(row){
  const choice=rewardChoiceInfo(row.user_name,row.source_type,row.event_name,row.reward_name);
  return [
    row.user_name,
    row.event_name,
    row.reward_name,
    row.display_reward_name || '',
    row.selected_reward_name || '',
    sourceTypeText(row.source_type),
    providerTypeText(row.provider_type),
    choice?.selected || '',
    rewardChoiceFilterState(row),
    row.progress_status || '',
    row.workflow_status || '',
    row.special_status ? specialStatusText(row.special_status) : '',
    row.note || ''
  ].join(' ').toLowerCase();
}

function rewardFilterOptions(rows, key){
  return [...new Set(rows.map(r=>String(r[key] || '').trim()).filter(Boolean))]
    .sort((a,b)=>a.localeCompare(b,'zh-Hans-CN'))
    .map(value=>({value,label:value}));
}

function setSelectOptions(id, allLabel, options){
  const select=document.getElementById(id);
  if(!select) return 'all';
  const current=select.value || 'all';
  select.innerHTML=[
    `<option value="all">${escapeHtml(allLabel)}</option>`,
    ...options.map(option=>`<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`)
  ].join('');
  select.value=options.some(option=>option.value===current) ? current : 'all';
  return select.value;
}

function refreshRewardFilterOptions(allRows){
  const source=document.getElementById('rewardSourceFilter')?.value || 'all';
  const sourceRows=source==='all' ? allRows : allRows.filter(r=>r.source_type===source);
  const event=setSelectOptions('rewardEventFilter','全部场次 / 分组', rewardFilterOptions(sourceRows,'event_name'));
  const eventRows=event==='all' ? sourceRows : sourceRows.filter(r=>r.event_name===event);
  setSelectOptions('rewardNameFilter','全部奖励', rewardFilterOptions(eventRows,'reward_name'));
}

function filterAdminRewardRows(rows){
  const kw=(document.getElementById('rewardSearch')?.value || '').toLowerCase().trim();
  const source=document.getElementById('rewardSourceFilter')?.value || 'all';
  const fulfillment=document.getElementById('rewardFulfillmentFilter')?.value || 'all';
  const eventName=document.getElementById('rewardEventFilter')?.value || 'all';
  const rewardName=document.getElementById('rewardNameFilter')?.value || 'all';
  const choiceState=document.getElementById('rewardChoiceStateFilter')?.value || 'all';
  return rows.filter(row=>{
    if(source!=='all' && row.source_type!==source) return false;
    if(fulfillment==='unfulfilled' && row.fulfilled) return false;
    if(fulfillment==='fulfilled' && !row.fulfilled) return false;
    if(eventName!=='all' && row.event_name!==eventName) return false;
    if(rewardName!=='all' && row.reward_name!==rewardName) return false;
    if(choiceState!=='all' && rewardChoiceFilterState(row)!==choiceState) return false;
    if(kw && !adminRewardSearchText(row).includes(kw)) return false;
    return true;
  });
}

function rewardChoiceSummaryText(row){
  if(row.choice_status){
    if(row.choice_status==='not_required') return '无需选择';
    if(row.choice_status==='pending') return '待选择';
    return `已选择：${row.selected_reward_name || row.display_reward_name || '-'}`;
  }
  const info=rewardChoiceInfo(row.user_name,row.source_type,row.event_name,row.reward_name);
  if(!info) return '无需选择';
  return info.selected ? `已选择：${info.selected}` : '待选择';
}

function rewardRowsToCsv(rows){
  const headers=['来源','用户','场次/分组','原奖励','具体奖励','金额','兑现状态','兑现日期','选择状态','制作进度','提供方','备注'];
  const esc = v => `"${String(v??'').replace(/"/g,'""')}"`;
  const body=rows.map(row=>[
    sourceTypeText(row.source_type),
    row.user_name,
    row.event_name,
    row.reward_name,
    row.display_reward_name || row.reward_name,
    row.amount ? fmt(row.amount) : '',
    row.fulfilled ? '已兑现' : '未兑现',
    row.fulfilled_date || '',
    rewardChoiceSummaryText(row),
    row.progress_status || '',
    providerTypeText(row.provider_type),
    row.note || ''
  ].map(esc).join(','));
  return [headers.join(','), ...body].join('\n');
}

function rewardRowsToText(rows){
  if(!rows.length) return '当前筛选条件下暂无未兑现奖励';
  return [
    `当前筛选未兑现奖励（${rows.length}条）`,
    ...rows.map((row,index)=>{
      const amount=row.amount ? `｜金额 ${fmt(row.amount)}` : '';
      const choice=rewardChoiceSummaryText(row);
      const display=row.display_reward_name && row.display_reward_name!==row.reward_name ? `｜具体奖励 ${row.display_reward_name}` : '';
      return `${index+1}. ${row.user_name}｜${sourceTypeText(row.source_type)}｜${row.event_name}｜${row.reward_name}${display}${amount}｜${choice}`;
    })
  ].join('\n');
}

function renderAdminRewards(){
  const quickDate=document.getElementById('quickFulfillDate');
  if(quickDate && !quickDate.value) quickDate.value=todayDateText();
  const body=document.getElementById('rewardAdminBody');
  if(!body) return;
  const allRows=allAdminRewardRows();
  refreshRewardFilterOptions(allRows);
  const rows=filterAdminRewardRows(allRows)
    .sort((a,b)=>Number(!!a.fulfilled)-Number(!!b.fulfilled)
      || String(sourceTypeText(a.source_type)).localeCompare(String(sourceTypeText(b.source_type)),'zh-Hans-CN')
      || String(a.event_name || '').localeCompare(String(b.event_name || ''),'zh-Hans-CN')
      || String(a.reward_name || '').localeCompare(String(b.reward_name || ''),'zh-Hans-CN')
      || String(a.user_name || '').localeCompare(String(b.user_name || ''),'zh-Hans-CN'));
  currentRewardAdminRows=rows;
  const countPill=document.getElementById('rewardListCountPill');
  if(countPill){
    const unfulfilled=rows.filter(r=>!r.fulfilled).length;
    countPill.textContent=`当前 ${rows.length} 条｜未兑现 ${unfulfilled} 条`;
    countPill.className=`pill ${unfulfilled ? 'warn' : 'good'}`;
  }
  const selectAll=document.getElementById('rewardSelectAll');
  if(selectAll) selectAll.checked=false;
  body.innerHTML=rows.map((r,i)=>{
    const amountText=r.amount ? ` ｜ 金额 ${fmt(r.amount)}` : '';
    const specialText=r.source_type==='special' && r.special_status ? ` ｜ ${specialStatusText(r.special_status)}` : '';
    const noteText=r.note ? ` ｜ 备注：${escapeHtml(r.note)}` : '';
    const displayReward=r.display_reward_name || r.reward_name || '-';
    const rewardText=displayReward!==r.reward_name
      ? `${escapeHtml(r.reward_name || '-')} ｜ 具体奖励：${escapeHtml(displayReward)}`
      : escapeHtml(r.reward_name || '-');
    const progressText=r.progress_status ? ` ｜ 进度：${escapeHtml(r.progress_status)}` : '';
    return `
    <tr>
      <td><input class="reward-row-check" type="checkbox" data-i="${i}" aria-label="选择 ${escapeHtml(r.user_name)} ${escapeHtml(r.reward_name)}"></td>
      <td>${r.fulfilled?`<span class="pill good">已兑现${r.fulfilled_date?' '+escapeHtml(r.fulfilled_date):''}</span>`:`<span class="pill warn">未兑现</span>`}</td>
      <td><b>${escapeHtml(r.user_name || '-')}</b><div class="small">${escapeHtml(sourceTypeText(r.source_type))} ｜ ${escapeHtml(r.event_name || '-')} ｜ ${rewardText}${amountText} ｜ ${escapeHtml(providerTypeText(r.provider_type))}${progressText}${specialText}${noteText}</div>${renderAdminChoiceSummary(r)}</td>
      <td><button class="btn ${r.fulfilled?'bad':'good'} reward-toggle" data-i="${i}">${r.fulfilled?'标为未兑现':'标为已兑现'}</button></td>
    </tr>`;
  }).join('') || '<tr><td colspan="4" class="small">当前筛选条件下暂无奖励数据</td></tr>';
  document.querySelectorAll('.reward-toggle').forEach(btn=>btn.onclick=()=>toggleReward(rows[+btn.dataset.i],btn));
}

function quickFulfillRowsForName(name){
  const target=canon(name);
  if(!target) return [];
  const rows=allAdminRewardRows()
    .map(r=>({...r,user_name:canon(r.user_name),row_key:r.ledger_key || `${r.source_type}|${canon(r.user_name)}|${r.event_name}|${r.reward_group || ''}|${r.reward_name}`}))
    .filter(r=>canon(r.user_name)===target)
    .sort((a,b)=>Number(!!a.fulfilled)-Number(!!b.fulfilled) || `${sourceTypeText(a.source_type)}${a.event_name}${a.reward_name}`.localeCompare(`${sourceTypeText(b.source_type)}${b.event_name}${b.reward_name}`,'zh-Hans-CN'));
  return rows;
}

function renderQuickFulfillAdmin(){
  const input=document.getElementById('quickFulfillName');
  const list=document.getElementById('quickFulfillList');
  const status=document.getElementById('quickFulfillStatus');
  const dateInput=document.getElementById('quickFulfillDate');
  if(!input || !list) return;
  if(dateInput && !dateInput.value) dateInput.value=todayDateText();
  const name=canon(input.value);
  if(!name){
    list.innerHTML='<div class="small">输入 ID 后，会显示该 ID 的奖励兑现状态，并优先排列未兑现奖励。</div>';
    if(status) status.textContent='';
    return;
  }
  const rows=quickFulfillRowsForName(name);
  const unfulfilledCount=rows.filter(r=>!r.fulfilled).length;
  if(status) status.textContent=rows.length ? `已找到 ${name} 的 ${unfulfilledCount} 条未兑现奖励` : `${name} 暂无奖励记录`;
  list.innerHTML=rows.map((r,i)=>`
    <div class="quickFulfillItem">
      <div>
        <b>${escapeHtml(r.display_reward_name || r.reward_name)} - ${escapeHtml(r.event_name || '-')}</b>
        <div class="small">
          <span class="pill ${r.fulfilled?'good':'warn'}">${r.fulfilled?`已兑现${r.fulfilled_date?' '+escapeHtml(r.fulfilled_date):''}`:'未兑现'}</span>
          ${escapeHtml(sourceTypeText(r.source_type))}${r.amount ? ` ｜ 金额 ${fmt(r.amount)}` : ''}${r.progress_status ? ` ｜ 进度：${escapeHtml(r.progress_status)}` : ''}${renderAdminChoiceSummary(r)}
        </div>
      </div>
      <button class="btn ${r.fulfilled?'bad':'good'} quick-fulfill-done" data-i="${i}" type="button">${r.fulfilled?'标为未兑现':'标记已兑现'}</button>
    </div>
  `).join('') || '<div class="small">该 ID 暂无奖励记录。</div>';
  list.querySelectorAll('.quick-fulfill-done').forEach(btn=>{
    btn.onclick=()=>toggleQuickFulfill(rows[+btn.dataset.i], btn);
  });
}

async function toggleQuickFulfill(row, button=null){
  const status=document.getElementById('quickFulfillStatus');
  if(!row){if(status) status.textContent='请选择需要兑现的奖励'; return;}
  const nextFulfilled=!row.fulfilled;
  if(button){
    button.disabled=true;
    button.textContent='保存中...';
  }
  if(status) status.textContent=`正在更新：${row.reward_name} - ${row.event_name}`;
  setRewardGlobalStatus(`正在更新兑现状态：${row.user_name}`,'info');
  const date=nextFulfilled ? ((document.getElementById('quickFulfillDate')?.value || '').trim() || todayDateText()) : null;
  try{
    const res=await saveFulfillmentRow(row,nextFulfilled,date,'quick');
    if(res?.error){
      if(status) status.textContent='保存失败：'+res.error.message;
      setRewardGlobalStatus('兑现状态保存失败：'+res.error.message,'error');
      if(button){
        button.disabled=false;
        button.textContent=row.fulfilled ? '标为未兑现' : '标记已兑现';
      }
      return;
    }
    if(!res){
      if(status) status.textContent='保存失败：未识别的奖励类型';
      setRewardGlobalStatus('兑现状态保存失败：未识别的奖励类型','error');
      if(button){
        button.disabled=false;
        button.textContent=row.fulfilled ? '标为未兑现' : '标记已兑现';
      }
      return;
    }
    if(status) status.textContent=`已更新：${row.reward_name} - ${row.event_name}`;
    setRewardGlobalStatus(`已保存兑现状态：${row.user_name}`,'success');
    await loadAll();
    renderQuickFulfillAdmin();
    renderAdminRewards();
    renderSpecialRankAdmin();
  }catch(err){
    if(status) status.textContent='保存失败：'+(err?.message || err);
    setRewardGlobalStatus('兑现状态保存失败：'+(err?.message || err),'error');
    if(button){
      button.disabled=false;
      button.textContent=row.fulfilled ? '标为未兑现' : '标记已兑现';
    }
  }
}

function renderAdminChoiceSummary(row){
  if(row.choice_status){
    if(row.choice_status==='not_required') return '';
    if(row.choice_status==='pending') return `<div class="small">奖励选择：<span class="pill warn">待选择</span></div>`;
    const selected=row.selected_reward_name || row.display_reward_name || '';
    const progress=row.progress_status || '';
    return `<div class="small">奖励选择：<span class="pill good">${escapeHtml(selected || '-')}</span> ${progress?`<span class="pill good">${escapeHtml(progress)}</span>`:'<span class="pill warn">待编辑</span>'}</div>`;
  }
  const info=rewardChoiceInfo(row.user_name,row.source_type,row.event_name,row.reward_name);
  if(!info) return '';
  if(!info.selected) return `<div class="small">奖励选择：<span class="pill warn">待选择</span></div>`;
  const progress=progressForReward(info.selected);
  return info.selected
    ? `<div class="small">奖励选择：<span class="pill good">${escapeHtml(info.selected)}</span> ${progress?'<span class="pill good">已设置进度</span>':'<span class="pill warn">待编辑</span>'}</div>`
    : '';
}

async function saveFulfillmentRow(row,nextFulfilled,date,mode='admin'){
  let res;
  if(row.source_type==='pk'){
    const payload={user_name:row.user_name,event_name:row.event_name,reward_name:row.reward_name,fulfilled:nextFulfilled,fulfilled_date:date};
    res=await sb.from('reward_status').upsert(payload,{onConflict:'user_name,event_name,reward_name'});
    if(!res.error && nextFulfilled){
      const choice=choiceForUser(row.user_name,row.source_type,row.event_name,row.reward_name);
      await syncRewardProgressCompleted(choice?.selected_choice || row.reward_name,'总选奖励');
    }
    if(!res.error) await logOperation(mode==='quick'?'quick_toggle_reward':'update_reward_status', `${row.user_name}｜${row.reward_name}｜${row.event_name}`, payload);
  }else if(row.source_type==='birth'){
    const payload={user_name:row.user_name,reward_group:row.reward_group || row.event_name || '生公',reward_name:row.reward_name,fulfilled:nextFulfilled,fulfilled_date:date};
    res=await sb.from('birth_reward_status').upsert(payload,{onConflict:'user_name,reward_group,reward_name'});
    if(!res.error && nextFulfilled){
      const choice=choiceForUser(row.user_name,row.source_type,row.event_name,row.reward_name);
      await syncRewardProgressCompleted(choice?.selected_choice || row.reward_name,'生公奖励');
    }
    if(!res.error) await logOperation(mode==='quick'?'quick_toggle_birth_reward':'update_birth_reward_status', `${row.user_name}｜${row.reward_name}｜${row.event_name}`, payload);
  }else if(row.source_type==='special'){
    const specialId=row.id || row.source_id;
    res=await sb.from('special_rank_rewards').update({fulfilled:nextFulfilled, fulfilled_date:date}).eq('id', specialId);
    if(!res.error && nextFulfilled) await syncRewardProgressCompleted(row.reward_name,'特殊排名奖励');
    if(!res.error) await logOperation(mode==='quick'?'quick_toggle_special_reward':'update_special_reward_status', `${row.user_name}｜${row.reward_name}｜${row.event_name}`, {id:specialId,fulfilled:nextFulfilled,fulfilled_date:date});
  }
  if(res && !res.error) await syncFulfillmentToRewardLedger(row,nextFulfilled,date);
  return res;
}

async function toggleReward(r,button=null){
  const newVal=!r.fulfilled;
  const date = newVal ? (document.getElementById('rewardDate').value.trim() || r.fulfilled_date || '') : null;
  if(button){
    button.disabled=true;
    button.textContent='保存中...';
  }
  setRewardLedgerActionStatus(`正在更新：${r.user_name}｜${r.reward_name}`);
  setRewardGlobalStatus(`正在更新奖励兑现状态：${r.user_name}`,'info');
  const res=await saveFulfillmentRow(r,newVal,date,'admin');
  if(res.error){
    if(button){
      button.disabled=false;
      button.textContent=r.fulfilled?'标为未兑现':'标为已兑现';
    }
    setRewardLedgerActionStatus('保存失败：'+res.error.message);
    setRewardGlobalStatus('保存失败：'+res.error.message,'error');
    return;
  }
  await loadAll();
  setRewardLedgerActionStatus(`已更新：${r.user_name}｜${r.reward_name}`);
  setRewardGlobalStatus(`已保存兑现状态：${r.user_name}`,'success');
  renderAdminRewards();
}

function selectedRewardAdminRows(){
  const checked=[...document.querySelectorAll('.reward-row-check:checked')];
  return checked.map(input=>currentRewardAdminRows[+input.dataset.i]).filter(Boolean);
}

function setRewardLedgerActionStatus(text){
  const status=document.getElementById('rewardBatchStatus');
  if(status) status.textContent=text || '';
  if(text) setRewardGlobalStatus(text,'info');
}

async function applyRewardBatch(){
  const status=document.getElementById('rewardBatchStatus') || document.getElementById('quickFulfillStatus');
  const filter=document.getElementById('rewardBatchFilter')?.value || 'visible';
  const action=document.getElementById('rewardBatchAction')?.value || 'fulfilled';
  const nextFulfilled=action==='fulfilled';
  let rows=selectedRewardAdminRows();
  if(!rows.length){
    rows=[...currentRewardAdminRows];
    if(filter==='unfulfilled') rows=rows.filter(r=>!r.fulfilled);
    if(filter==='fulfilled') rows=rows.filter(r=>r.fulfilled);
  }
  if(!rows.length){ if(status) status.textContent='没有可批量更新的奖励'; setRewardGlobalStatus('没有可批量更新的奖励','error'); return; }
  const date=nextFulfilled ? ((document.getElementById('rewardDate')?.value || '').trim() || todayDateText()) : null;
  if(status) status.textContent=`正在批量更新 ${rows.length} 条奖励...`;
  setRewardGlobalStatus(`正在批量更新 ${rows.length} 条奖励...`,'info');
  const errors=[];
  for(const row of rows){
    const res=await saveFulfillmentRow(row,nextFulfilled,date,'batch');
    if(res?.error) errors.push(res.error.message);
  }
  if(status) status.textContent=errors.length ? `批量更新完成，但有 ${errors.length} 条失败：${errors[0]}` : `批量更新完成：${rows.length} 条`;
  setRewardGlobalStatus(errors.length ? `批量更新完成，但有 ${errors.length} 条失败` : `批量更新完成：${rows.length} 条`, errors.length ? 'error' : 'success');
  await loadAll();
  renderAdminRewards();
}

function rewardProgressDone(status, providerType='support_club'){
  if(providerType==='zhou_tongyue') return status==='已兑现';
  return ['已抽取','已完结','已兑现'].includes(status);
}

function rewardProgressUiState(item){
  const progress=progressForReward(item.reward_name);
  const providerType=progress?.provider_type || item.provider_type || inferRewardProviderType(null,item.reward_name);
  const savedStatus=progress?.progress_status || '';
  const selectedStatus=savedStatus || statusesForProvider(providerType)[0];
  return {
    progress,
    providerType,
    savedStatus,
    selectedStatus,
    note:progress?.progress_note || '',
    done:rewardProgressDone(savedStatus,providerType)
  };
}

function rewardProgressStatusOptionsHtml(providerType,currentStatus=''){
  const statuses=statusesForProvider(providerType);
  const selected=statuses.includes(currentStatus) ? currentStatus : statuses[0];
  return statuses.map(status=>`<option value="${escapeHtml(status)}"${status===selected?' selected':''}>${escapeHtml(status)}</option>`).join('');
}

function filterRewardProgressItems(options){
  const kw=(document.getElementById('rewardProgressSearch')?.value || '').toLowerCase().trim();
  const providerFilter=document.getElementById('rewardProgressProviderFilter')?.value || 'all';
  const stateFilter=document.getElementById('rewardProgressStateFilter')?.value || 'all';
  return options.filter(item=>{
    const ui=rewardProgressUiState(item);
    const searchable=`${item.reward_name} ${item.reward_type || ''} ${item.category || ''}`.toLowerCase();
    if(kw && !searchable.includes(kw)) return false;
    if(providerFilter!=='all' && ui.providerType!==providerFilter) return false;
    if(stateFilter==='missing' && ui.savedStatus) return false;
    if(stateFilter==='active' && (!ui.savedStatus || ui.done)) return false;
    if(stateFilter==='done' && !ui.done) return false;
    return true;
  });
}

function renderRewardProgressAdmin(){
  const body=document.getElementById('rewardProgressBody');
  const status=document.getElementById('rewardProgressStatusText');
  if(!body) return;
  const allOptions=allRewardProgressOptions();
  const options=filterRewardProgressItems(allOptions);
  currentRewardProgressRows=options;
  if(status){
    status.textContent=state.rewardProgressAvailable
      ? `当前显示 ${options.length} 项奖励制作状态，可直接在每一行修改后保存。`
      : '请先在 Supabase 创建 reward_progress 表，创建后刷新页面即可使用。';
  }
  let lastCategory='';
  const rowsHtml=options.map((item,i)=>{
    const ui=rewardProgressUiState(item);
    const category=item.category || '其他奖励';
    const groupRow=category!==lastCategory
      ? `<tr class="rewardProgressGroup"><td colspan="6">${escapeHtml(category)}</td></tr>`
      : '';
    lastCategory=category;
    const displayStatus=ui.savedStatus || '暂未设置';
    const savedClass=state.lastSavedRewardProgress===item.reward_name ? ' rewardProgressSaved' : '';
    const feedback=state.lastSavedRewardProgress===item.reward_name
      ? '刚刚保存成功'
      : (ui.progress?.updated_at ? `上次更新 ${escapeHtml(formatDateTime(ui.progress.updated_at))}` : '等待保存');
    return `${groupRow}<tr class="rewardProgressRow${savedClass}" data-i="${i}">
      <td>
        <b>${escapeHtml(item.reward_name)}</b>
        <div class="small">${escapeHtml(item.reward_type || '其他')}</div>
      </td>
      <td>
        <select class="reward-progress-provider" data-i="${i}">
          ${Object.entries(REWARD_PROVIDER_TYPES).map(([value,label])=>`<option value="${escapeHtml(value)}"${value===ui.providerType?' selected':''}>${escapeHtml(label)}</option>`).join('')}
        </select>
      </td>
      <td>
        <select class="reward-progress-status" data-i="${i}">
          ${rewardProgressStatusOptionsHtml(ui.providerType,ui.selectedStatus)}
        </select>
        <div class="small"><span class="pill ${progressStatusClass(displayStatus,ui.providerType)}">${escapeHtml(displayStatus)}</span></div>
      </td>
      <td><input class="reward-progress-note" data-i="${i}" value="${escapeHtml(ui.note)}" placeholder="进度说明，可空"></td>
      <td><div class="rowInlineStatus" data-i="${i}">${feedback}</div></td>
      <td><button class="btn good reward-progress-save" data-i="${i}" type="button">保存</button></td>
    </tr>`;
  }).join('');
  body.innerHTML=rowsHtml || '<tr><td colspan="6" class="small">当前筛选条件下暂无奖励。</td></tr>';
  body.querySelectorAll('.reward-progress-provider').forEach(select=>{
    select.onchange=()=>{
      const i=select.dataset.i;
      const statusSelect=body.querySelector(`.reward-progress-status[data-i="${i}"]`);
      if(statusSelect) statusSelect.innerHTML=rewardProgressStatusOptionsHtml(select.value,statusSelect.value);
    };
  });
  body.querySelectorAll('.reward-progress-save').forEach(btn=>{
    btn.onclick=()=>saveRewardProgressRow(+btn.dataset.i,btn);
  });
}

async function saveRewardProgressRow(index,button=null){
  const item=currentRewardProgressRows[index];
  const status=document.getElementById('rewardProgressStatusText');
  if(!item){if(status) status.textContent='请选择需要保存的奖励'; return;}
  const row=document.querySelector(`.rewardProgressRow[data-i="${index}"]`);
  const provider_type=row?.querySelector('.reward-progress-provider')?.value || 'support_club';
  const progress_status=row?.querySelector('.reward-progress-status')?.value || '';
  const progress_note=row?.querySelector('.reward-progress-note')?.value.trim() || '';
  const inline=row?.querySelector('.rowInlineStatus');
  if(!statusesForProvider(provider_type).includes(progress_status)){
    if(status) status.textContent='请选择有效进度';
    if(inline) inline.textContent='状态无效';
    return;
  }
  const payload={
    reward_name:item.reward_name,
    reward_type:rewardOptionMap().get(item.reward_name)?.reward_type || item.reward_type || '其他',
    provider_type,
    progress_status,
    progress_note:progress_note || null,
    updated_at:new Date().toISOString()
  };
  if(button){
    button.disabled=true;
    button.textContent='保存中...';
  }
  if(inline) inline.textContent='正在保存...';
  if(status) status.textContent=`正在保存：${item.reward_name}`;
  setRewardGlobalStatus(`正在保存制作进度：${item.reward_name}`,'info');
  const res=await upsertRewardProgressPayload(payload);
  if(res.error){
    if(/relation|does not exist|schema|column/i.test(res.error.message || '')) state.rewardProgressAvailable=false;
    if(button){
      button.disabled=false;
      button.textContent='保存';
    }
    if(inline) inline.textContent='保存失败';
    if(status) status.textContent='保存失败：'+res.error.message;
    setRewardGlobalStatus('制作进度保存失败：'+res.error.message,'error');
    return;
  }
  state.lastSavedRewardProgress=item.reward_name;
  if(inline) inline.textContent='保存成功';
  if(status) status.textContent=`已保存：${item.reward_name}｜${progress_status}`;
  setRewardGlobalStatus(`已保存制作进度：${item.reward_name}`,'success');
  await logOperation('update_reward_progress', `${item.reward_name}｜${progress_status}`, payload);
  await loadAll();
  renderRewardProgressAdmin();
  if(status) status.textContent=`已保存：${item.reward_name}｜${progress_status}`;
  setTimeout(()=>{
    if(state.lastSavedRewardProgress===item.reward_name){
      state.lastSavedRewardProgress='';
      renderRewardProgressAdmin();
    }
  },1800);
}

function allRewardChoiceTargets(){
  const map=new Map();
  const add=(source_type,event_name,reward_name,detail='')=>{
    const reward=String(reward_name||'').trim();
    if(!reward) return;
    const event=String(event_name||'').trim();
    const key=rewardChoiceKey(source_type,event,reward);
    if(!map.has(key)){
      map.set(key,{source_type,event_name:event,reward_name:reward,detail});
    }
  };
  DATA.rewardRules.forEach(r=>add('pk',r.event_name,r.reward_name,r.event_name));
  DATA.birthRewardRules.forEach(r=>add('birth',r.reward_group || '生公',r.reward_name,r.reward_group || '生公'));
  DATA.specialRankRewards.forEach(r=>add('special',r.event_name || '特殊',r.reward_name,r.event_name || '特殊排名'));
  DATA.rewardChoiceOptions.forEach(r=>add(r.source_type,r.event_name,r.reward_name,r.note || '已配置'));
  return [...map.values()].sort((a,b)=>`${a.reward_name}${a.event_name}`.localeCompare(`${b.reward_name}${b.event_name}`,'zh-Hans-CN'));
}
function targetOptionLabel(t){
  const event=t.event_name ? `｜${t.event_name}` : '';
  return `${t.reward_name}｜${sourceTypeText(t.source_type)}${event}`;
}
function parseChoiceTargetKey(key){
  const parts=String(key||'').split('||');
  return {source_type:parts[1] || '', event_name:parts[2] || '', reward_name:parts[3] || ''};
}
function renderRewardChoiceAdmin(){
  const select=document.getElementById('choiceOptionReward');
  const text=document.getElementById('choiceOptionText');
  const note=document.getElementById('choiceOptionNote');
  const body=document.getElementById('rewardChoiceBody');
  const status=document.getElementById('rewardChoiceStatus');
  if(!select || !body) return;
  const targets=allRewardChoiceTargets();
  const current=select.value;
  select.innerHTML=targets.map(t=>`<option value="${escapeHtml(rewardChoiceKey(t.source_type,t.event_name,t.reward_name))}">${escapeHtml(targetOptionLabel(t))}</option>`).join('');
  if(current && [...select.options].some(o=>o.value===current)) select.value=current;
  const selectedTarget=parseChoiceTargetKey(select.value);
  const option=choiceOptionFor(selectedTarget.source_type,selectedTarget.event_name,selectedTarget.reward_name);
  if(text) text.value=choiceOptionsArray(option).join('\n');
  if(note) note.value=option?.note || '';
  if(status) status.textContent=state.rewardChoicesAvailable ? '' : '请先在 Supabase 执行 database/reward_choices.sql，创建后刷新页面即可使用。';

  const filter=document.getElementById('rewardChoiceFilter')?.value || 'pending';
  const kw=(document.getElementById('rewardChoiceSearch')?.value || '').toLowerCase().trim();
  let rows=allChoiceRewardRows();
  if(filter==='pending') rows=rows.filter(r=>r.choiceInfo?.status==='pending');
  if(filter==='needs_progress') rows=rows.filter(r=>choiceProgressState(r)==='needs_progress');
  if(filter==='selected') rows=rows.filter(r=>r.choiceInfo?.status==='selected');
  rows=rows.filter(r=>!kw || `${r.user_name} ${r.event_name} ${r.reward_name} ${r.choiceInfo?.selected || ''}`.toLowerCase().includes(kw));
  body.innerHTML=rows.map((r,i)=>{
    const options=r.choiceInfo.options;
    const selected=r.choiceInfo.selected;
    const selectOptions=['',...options.filter(x=>x!==selected)];
    if(selected) selectOptions.unshift(selected);
    return `<tr>
      <td>${choiceProgressPill(r)}<div class="small">${escapeHtml(sourceTypeText(r.source_type))}</div></td>
      <td><b>${escapeHtml(r.user_name)}</b><div class="small">${escapeHtml(r.event_name || '-')} ｜ ${escapeHtml(r.reward_name)}</div>${selected?`<div class="small">已选择：${escapeHtml(selected)} ｜ 当前状态：${choiceProgressPill(r)}</div>`:''}</td>
      <td>
        <div class="choiceControl">
          <select class="reward-choice-select" data-i="${i}">
            ${selectOptions.map(x=>`<option value="${escapeHtml(x)}"${x===selected?' selected':''}>${x?escapeHtml(x):'待选择'}</option>`).join('')}
          </select>
          <button class="btn good reward-choice-save" data-i="${i}" type="button">保存选择</button>
        </div>
      </td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="small">暂无需要处理的奖励选择</td></tr>';
  document.querySelectorAll('.reward-choice-save').forEach(btn=>btn.onclick=()=>{
    const i=+btn.dataset.i;
    const selected=document.querySelector(`.reward-choice-select[data-i="${i}"]`)?.value || '';
    saveRewardChoice(rows[i], selected);
  });
}
async function saveRewardChoiceOptions(){
  const status=document.getElementById('rewardChoiceStatus');
  const target=parseChoiceTargetKey(document.getElementById('choiceOptionReward')?.value || '');
  const options=String(document.getElementById('choiceOptionText')?.value || '').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  const note=String(document.getElementById('choiceOptionNote')?.value || '').trim();
  if(!target.reward_name){if(status) status.textContent='请选择奖励'; return;}
  if(!options.length){if(status) status.textContent='请至少填写一个可选项'; return;}
  const payload={
    source_type:target.source_type,
    event_name:target.event_name,
    reward_name:target.reward_name,
    choice_options:options,
    is_choice_required:true,
    note:note || null,
    updated_at:new Date().toISOString()
  };
  const res=await sb.from('reward_choice_options').upsert(payload,{onConflict:'source_type,event_name,reward_name'});
  if(res.error){if(status) status.textContent='保存失败：'+res.error.message; setRewardGlobalStatus('奖励选项保存失败：'+res.error.message,'error'); return;}
  setRewardGlobalStatus(`已保存奖励选项：${target.reward_name}`,'success');
  await logOperation('upsert_reward_choice_options', `${target.reward_name}｜${sourceTypeText(target.source_type)}`, payload);
  await loadAll();
  renderRewardChoiceAdmin();
  if(status) status.textContent='奖励选项已保存';
}
async function saveRewardChoice(row, selected=''){
  const status=document.getElementById('rewardChoiceStatus');
  if(!row){if(status) status.textContent='请选择需要保存的奖励'; return;}
  const payload={
    user_name:row.user_name,
    source_type:row.source_type,
    event_name:row.event_name || '',
    reward_name:row.reward_name,
    selected_choice:selected || null,
    choice_status:selected ? 'selected' : 'pending',
    updated_at:new Date().toISOString()
  };
  const res=await sb.from('reward_choices').upsert(payload,{onConflict:'user_name,source_type,event_name,reward_name'});
  if(res.error){if(status) status.textContent='保存失败：'+res.error.message; setRewardGlobalStatus('奖励选择保存失败：'+res.error.message,'error'); return;}
  if(selected && row.fulfilled) await syncRewardProgressCompleted(selected,`${sourceTypeText(row.source_type)}具体选项`);
  setRewardGlobalStatus(selected ? `已保存 ${row.user_name} 的奖励选择` : `已标记 ${row.user_name} 为待选择`,'success');
  await logOperation('update_reward_choice', `${row.user_name}｜${row.reward_name}｜${selected || '待选择'}`, payload);
  await loadAll();
  renderRewardChoiceAdmin();
  renderAdminRewards();
  renderRewardProgressAdmin();
  if(status) status.textContent=selected ? `已保存选择：${selected}，请到奖励制作进度中维护该具体奖励状态` : '已标记为待选择';
}

function aliasPairKey(a,b){
  return [nameKey(a),nameKey(b)].sort().join('||');
}
function aliasExistingPairKeys(){
  const set=new Set();
  (DATA.aliases || []).forEach(row=>{
    const alias=cleanName(row.alias_name);
    const canonical=cleanName(row.canonical_name);
    if(alias && canonical) set.add(aliasPairKey(alias,canonical));
  });
  return set;
}
function aliasNameStats(){
  const map=new Map();
  (DATA.rawNameEntries || []).forEach(entry=>{
    const raw=String(entry.raw || '').trim();
    const cleaned=cleanName(raw);
    const key=nameKey(cleaned);
    if(!key) return;
    const current=map.get(raw) || {name:raw,cleaned,key,count:0,amount:0,sources:new Set()};
    current.count += 1;
    current.amount += num(entry.amount);
    if(entry.source) current.sources.add(entry.source);
    map.set(raw,current);
  });
  return [...map.values()].map(row=>({...row,sources:[...row.sources]}));
}
function boundedEditDistance(a,b,limit=1){
  if(Math.abs(a.length-b.length)>limit) return limit+1;
  const prev=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){
    const curr=[i];
    let rowMin=curr[0];
    for(let j=1;j<=b.length;j++){
      const cost=a[i-1]===b[j-1] ? 0 : 1;
      curr[j]=Math.min(prev[j]+1,curr[j-1]+1,prev[j-1]+cost);
      rowMin=Math.min(rowMin,curr[j]);
    }
    if(rowMin>limit) return limit+1;
    prev.splice(0,prev.length,...curr);
  }
  return prev[b.length];
}
function aliasSuggestionRows(){
  const stats=aliasNameStats();
  const existing=aliasExistingPairKeys();
  const suggestions=[];
  const seen=new Set();
  const addSuggestion=(alias,canonical,reason,priority)=>{
    const pair=aliasPairKey(alias,canonical);
    if(!alias || !canonical || (nameKey(alias)===nameKey(canonical) && cleanName(alias)===cleanName(canonical))) return;
    if(existing.has(pair) || seen.has(pair)) return;
    seen.add(pair);
    const aliasStats=stats.find(row=>row.name===alias);
    const canonicalStats=stats.find(row=>row.name===canonical);
    suggestions.push({
      alias,
      canonical,
      reason,
      priority,
      count:(aliasStats?.count || 0) + (canonicalStats?.count || 0),
      amount:(aliasStats?.amount || 0) + (canonicalStats?.amount || 0),
      sources:[...(aliasStats?.sources || []), ...(canonicalStats?.sources || [])].filter((v,i,a)=>a.indexOf(v)===i)
    });
  };
  const byKey=new Map();
  stats.forEach(row=>{
    if(!byKey.has(row.key)) byKey.set(row.key,[]);
    byKey.get(row.key).push(row);
  });
  byKey.forEach(group=>{
    const unique=group.filter((row,index,arr)=>arr.findIndex(x=>x.name===row.name)===index);
    if(unique.length<2) return;
    const canonical=unique.reduce((best,row)=>pickDisplayName(best,row.cleaned),unique[0].cleaned);
    unique.forEach(row=>{
      if(cleanName(row.name)!==canonical) addSuggestion(row.name,canonical,'去空格/标点/大小写后相同',1);
    });
  });
  const keyGroups=[...byKey.values()].map(group=>{
    const representative=group.reduce((best,row)=>pickDisplayName(best,row.cleaned),group[0].cleaned);
    return {key:group[0].key,representative};
  }).filter(row=>row.key.length>=4);
  for(let i=0;i<keyGroups.length;i++){
    for(let j=i+1;j<keyGroups.length;j++){
      const a=keyGroups[i];
      const b=keyGroups[j];
      const minLen=Math.min(a.key.length,b.key.length);
      const maxLen=Math.max(a.key.length,b.key.length);
      let reason='';
      let priority=3;
      if(boundedEditDistance(a.key,b.key,1)<=1){
        reason='名称仅差 1 个字符';
        priority=2;
      }else if(minLen>=4 && maxLen-minLen<=2 && (a.key.includes(b.key) || b.key.includes(a.key))){
        reason='疑似多/少字符';
        priority=3;
      }
      if(!reason) continue;
      const canonical=pickDisplayName(a.representative,b.representative);
      const alias=canonical===a.representative ? b.representative : a.representative;
      addSuggestion(alias,canonical,reason,priority);
    }
  }
  return suggestions
    .sort((a,b)=>a.priority-b.priority || b.amount-a.amount || b.count-a.count || String(a.alias).localeCompare(String(b.alias),'zh-Hans-CN'))
    .slice(0,80);
}

async function renderAliasAdmin(){
  const rulesBody=document.getElementById('aliasRulesBody');
  const historyBody=document.getElementById('aliasHistoryBody');
  const suggestionBody=document.getElementById('aliasSuggestionBody');
  const suggestionStatus=document.getElementById('aliasSuggestionStatus');
  const historyStatus=document.getElementById('aliasHistoryStatus');
  if(!rulesBody && !historyBody && !suggestionBody) return;
  const aliases=[...(DATA.aliases || [])].sort((a,b)=>
    String(a.canonical_name || '').localeCompare(String(b.canonical_name || ''),'zh-Hans-CN') ||
    String(a.alias_name || '').localeCompare(String(b.alias_name || ''),'zh-Hans-CN')
  );
  if(suggestionBody){
    const suggestions=aliasSuggestionRows();
    if(suggestionStatus) suggestionStatus.textContent=suggestions.length ? `发现 ${suggestions.length} 条疑似同一人候选，请核对后再保存。` : '暂未发现需要核对的疑似同一人。';
    suggestionBody.innerHTML=suggestions.map(row=>`
      <tr>
        <td><b>${escapeHtml(row.alias)}</b></td>
        <td><span class="pill good">${escapeHtml(row.canonical)}</span></td>
        <td><div>${escapeHtml(row.reason)}</div><div class="small">${escapeHtml(row.sources.join(' / ') || '来源未知')} ｜ 出现 ${row.count} 次${row.amount?` ｜ 金额合计 ${fmt(row.amount)}`:''}</div></td>
        <td><button class="btn alias-suggestion-btn" data-alias="${escapeHtml(row.alias)}" data-canonical="${escapeHtml(row.canonical)}" type="button">填入合并</button></td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="small">暂无疑似同一人候选</td></tr>';
    suggestionBody.querySelectorAll('.alias-suggestion-btn').forEach(btn=>{
      btn.onclick=()=>{
        const aliasInput=document.getElementById('aliasName');
        const canonicalInput=document.getElementById('canonicalName');
        if(aliasInput) aliasInput.value=btn.dataset.alias || '';
        if(canonicalInput) canonicalInput.value=btn.dataset.canonical || '';
        const status=document.getElementById('aliasStatus');
        if(status) status.textContent='已填入疑似候选，请核对无误后保存';
      };
    });
  }
  if(rulesBody){
    rulesBody.innerHTML=aliases.map(row=>`
      <tr>
        <td><b>${escapeHtml(row.alias_name || '-')}</b></td>
        <td><span class="pill good">${escapeHtml(row.canonical_name || '-')}</span></td>
        <td>${escapeHtml(formatDateTime(row.created_at))}</td>
        <td><button class="btn alias-edit-btn" data-alias="${escapeHtml(row.alias_name || '')}" data-canonical="${escapeHtml(row.canonical_name || '')}" type="button">填入编辑</button></td>
      </tr>
    `).join('') || '<tr><td colspan="4" class="small">暂无名称合并规则</td></tr>';
    document.querySelectorAll('.alias-edit-btn').forEach(btn=>{
      btn.onclick=()=>{
        const aliasInput=document.getElementById('aliasName');
        const canonicalInput=document.getElementById('canonicalName');
        if(aliasInput) aliasInput.value=btn.dataset.alias || '';
        if(canonicalInput) canonicalInput.value=btn.dataset.canonical || '';
        const status=document.getElementById('aliasStatus');
        if(status) status.textContent='已填入，可修改后重新保存';
      };
    });
  }
  const aliasStatus=document.getElementById('aliasStatus');
  if(aliasStatus && !aliasStatus.textContent) aliasStatus.textContent=`当前生效规则：${aliases.length} 条`;
  if(!historyBody) return;
  if(historyStatus) historyStatus.textContent='正在读取历史保存记录...';
  const res=await sb.from('operation_logs')
    .select('created_at,admin_email,detail,metadata')
    .eq('action','upsert_name_alias')
    .order('created_at',{ascending:false});
  if(res.error){
    if(historyStatus) historyStatus.textContent='历史保存记录读取失败：'+res.error.message;
    historyBody.innerHTML='<tr><td colspan="3" class="small">暂无可显示历史记录</td></tr>';
    return;
  }
  const rows=res.data || [];
  if(historyStatus) historyStatus.textContent=`历史保存记录：${rows.length} 条`;
  historyBody.innerHTML=rows.map(row=>{
    const alias=row.metadata?.alias_name || '';
    const canonical=row.metadata?.canonical_name || '';
    const detail=alias || canonical ? `${alias} → ${canonical}` : row.detail || '-';
    return `<tr>
      <td>${escapeHtml(formatDateTime(row.created_at))}</td>
      <td><b>${escapeHtml(detail)}</b></td>
      <td>${escapeHtml(row.admin_email || '-')}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="3" class="small">暂无历史保存记录</td></tr>';
}

document.getElementById('addEventBtn').onclick=async()=>{
  const event_name=document.getElementById('newEventName').value.trim();
  const event_date=document.getElementById('newEventDate').value.trim();
  const sort_order=+(document.getElementById('newEventOrder').value||0);
  if(!event_name){document.getElementById('eventAdminStatus').textContent='请填写场次名称';return;}
  const res=await sb.from('pk_events').insert({event_name,event_date,sort_order,is_general_election:true});
  document.getElementById('eventAdminStatus').textContent=res.error?'新增失败：'+res.error.message:'新增成功';
  if(!res.error){await logOperation('create_pk_event', event_name, {event_name,event_date,sort_order}); await loadAll(); renderPkEventAdminList();}
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
  return !/(已取消|取消订单|订单取消|交易关闭|订单关闭|已关闭)/.test(text);
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
  // 提取未取消订单，并按识别出的收货人与实付金额生成待确认数据。
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
function mergeElection2026Rows(rows){
  const map=new Map();
  rows.forEach(r=>{
    const user_name=canon(r.user_name);
    const value=num(r.value);
    if(!user_name || value<=0) return;
    const key=nameKey(user_name);
    const prev=map.get(key) || {user_name,value:0};
    prev.user_name=pickDisplayName(prev.user_name,user_name);
    prev.value+=value;
    map.set(key,prev);
  });
  return [...map.values()].sort((a,b)=>num(b.value)-num(a.value) || byNameAsc(a,b));
}
function looksLikeElection2026Name(value){
  const text=cleanName(value);
  if(!text) return false;
  if(/^(序号|排名|名称|姓名|昵称|金额|票数|总额|合计|小计)$/i.test(text)) return false;
  if(/(PK数据|数据总表|总选数据|明票|暗票|暗账)/.test(text)) return false;
  return !/^-?\d+(?:\.\d+)?$/.test(text.replace(/,/g,''));
}
function addElection2026Candidate(out,name,value){
  const user_name=canon(name);
  const parsed=parseAmountCell(value);
  if(!user_name || !Number.isFinite(parsed) || parsed<=0) return false;
  out.push({user_name,value:parsed});
  return true;
}
function extractElection2026Rows(rows){
  const out=[];
  rows.forEach(row=>{
    let added=false;
    for(let col=0; col<row.length-2; col++){
      const rankText=String(row[col] ?? '').trim();
      if(/^\d+$/.test(rankText) && looksLikeElection2026Name(row[col+1])){
        if(addElection2026Candidate(out,row[col+1],row[col+2])){
          added=true;
          col+=2;
        }
      }
    }
    if(added) return;
    for(let col=0; col<row.length-1; col++){
      if(looksLikeElection2026Name(row[col]) && addElection2026Candidate(out,row[col],row[col+1])){
        col+=1;
      }
    }
  });
  return mergeElection2026Rows(out);
}
async function readExcelRows(file){
  // 读取全部工作表后合并同名订单，给后台预览确认后再写入数据库。
  if(!window.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:'array'});
  return mergeImportRows(extractNameAmountRows(rowsFromWorkbook(workbook)));
}
async function readElection2026FileRows(file){
  if(!file) return [];
  if(/\.csv$/i.test(file.name)){
    return extractElection2026Rows(parseCsv(await file.text()));
  }
  if(!window.XLSX) throw new Error('Excel 解析库未加载，请刷新页面后重试');
  const buffer=await file.arrayBuffer();
  const workbook=XLSX.read(buffer,{type:'array'});
  return extractElection2026Rows(rowsFromWorkbook(workbook));
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
function renderElection2026Preview(rows){
  const el=document.getElementById('election2026Preview');
  if(!el) return;
  el.classList.remove('hidden');
  const sourceType=document.getElementById('election2026Source')?.value || 'public_vote';
  const label=election2026ValueLabel(sourceType);
  const total=rows.reduce((s,r)=>s+num(r.value),0);
  el.innerHTML=`<div class="small">当前来源：${escapeHtml(election2026SourceLabel(sourceType))}。识别到 ${rows.length} 个名称，合计 ${sourceType==='dark_link_amount'?fmt(total):fmtVotes(total)}${sourceType==='dark_link_amount'?'':' 票'}。确认导入会作为新记录追加；如需重导，请先清空当前来源。</div>
    <div class="list"><table class="table"><thead><tr><th>名称</th><th>${escapeHtml(label)}</th><th>操作</th></tr></thead><tbody>
      ${rows.map(r=>`<tr><td><input class="electionNameInput" value="${escapeHtml(r.user_name)}"></td><td><input class="electionValueInput" type="number" step="0.1" value="${num(r.value)}"></td><td><button class="btn bad electionRemoveRow" type="button">剔除</button></td></tr>`).join('')}
    </tbody></table></div>`;
  el.querySelectorAll('.electionRemoveRow').forEach(btn=>{
    btn.onclick=()=>{
      btn.closest('tr')?.remove();
      const adjusted=readElection2026PreviewRows();
      pendingElection2026Rows=buildElection2026Payload(adjusted);
      renderElection2026Preview(adjusted);
      document.getElementById('election2026Status').textContent='已剔除一行，请确认后导入';
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
function readElection2026PreviewRows(){
  const el=document.getElementById('election2026Preview');
  if(!el) return [];
  return mergeElection2026Rows([...el.querySelectorAll('tbody tr')].map(tr=>({
    user_name:tr.querySelector('.electionNameInput')?.value,
    value:parseAmountCell(tr.querySelector('.electionValueInput')?.value)
  })));
}
function buildElection2026Payload(rows){
  const source_type=document.getElementById('election2026Source')?.value || 'public_vote';
  const batch_name=cleanName(document.getElementById('election2026Batch')?.value || '');
  return rows.map(r=>({
    source_type,
    user_name:canon(r.user_name),
    value:num(r.value),
    batch_name:batch_name || null
  }));
}
function resetElection2026Preview(){
  pendingElection2026Rows=[];
  const preview=document.getElementById('election2026Preview');
  if(preview){
    preview.classList.add('hidden');
    preview.innerHTML='';
  }
  document.getElementById('applyElection2026EditBtn')?.classList.add('hidden');
  document.getElementById('confirmElection2026Btn')?.classList.add('hidden');
  const sourceType=document.getElementById('election2026Source')?.value || 'public_vote';
  const valueInput=document.getElementById('manualElection2026Value');
  if(valueInput){
    valueInput.step=sourceType==='dark_link_amount' ? '0.01' : '0.1';
    valueInput.placeholder=sourceType==='dark_link_amount' ? '金额' : '票数';
  }
  const csv=document.getElementById('election2026Csv');
  if(csv) csv.placeholder=`名称,${election2026ValueLabel(sourceType)}\n波克布林,36`;
  syncElection2026SingleInput();
}
function activeImportKind(kind){
  const selected=document.getElementById('unifiedImportKind')?.value;
  return kind || selected || 'pk';
}
function importUiConfig(kind){
  const current=activeImportKind(kind);
  const unified=!!document.getElementById('unifiedImportKind');
  if(unified){
    return {
      kind:current,
      isPk:current==='pk',
      fileId:'unifiedExcelFile',
      previewId:'unifiedExcelPreview',
      nameId:'manualUnifiedName',
      amountId:'manualUnifiedAmount',
      statusId:'unifiedImportStatus',
      applyBtnId:'applyUnifiedExcelEditBtn',
      confirmBtnId:'confirmUnifiedExcelBtn',
      csvId:'unifiedCsv'
    };
  }
  const isPk=current==='pk';
  return {
    kind:current,
    isPk,
    fileId:isPk?'pkExcelFile':'birthExcelFile',
    previewId:isPk?'pkExcelPreview':'birthExcelPreview',
    nameId:isPk?'manualPkName':'manualBirthName',
    amountId:isPk?'manualPkAmount':'manualBirthAmount',
    statusId:isPk?'pkImportStatus':'birthImportStatus',
    applyBtnId:isPk?'applyPkExcelEditBtn':'applyBirthExcelEditBtn',
    confirmBtnId:isPk?'confirmPkExcelBtn':'confirmBirthExcelBtn',
    csvId:isPk?'pkCsv':'birthCsv'
  };
}
function resetUnifiedImportPreview(){
  pendingPkExcelRows=[];
  pendingBirthExcelRows=[];
  const preview=document.getElementById('unifiedExcelPreview');
  if(preview){
    preview.classList.add('hidden');
    preview.innerHTML='';
  }
  document.getElementById('applyUnifiedExcelEditBtn')?.classList.add('hidden');
  document.getElementById('confirmUnifiedExcelBtn')?.classList.add('hidden');
  const status=document.getElementById('unifiedImportStatus');
  if(status) status.textContent='';
}
function syncUnifiedImportUi(options={}){
  const kind=activeImportKind();
  const isPk=kind==='pk';
  document.querySelectorAll('.unifiedPkTarget').forEach(el=>el.classList.toggle('hidden', !isPk));
  document.querySelectorAll('.unifiedBirthTarget').forEach(el=>el.classList.toggle('hidden', isPk));
  const csv=document.getElementById('unifiedCsv');
  if(csv){
    csv.placeholder=isPk
      ? 'user_name,amount\n波克布林,334.8'
      : 'user_name,amount\n徐乐迪,50';
  }
  const confirmBtn=document.getElementById('confirmUnifiedExcelBtn');
  if(confirmBtn) confirmBtn.textContent=isPk?'确认导入总选 PK 数据':'确认导入生公数据';
  if(options.reset) resetUnifiedImportPreview();
}
function applyExcelPreviewEdits(kind){
  const cfg=importUiConfig(kind);
  const isPk=cfg.isPk;
  const rows=readAdjustedPreview(cfg.previewId);
  const status=document.getElementById(cfg.statusId);
  if(!rows.length){status.textContent='调整后的预览表没有有效名称和金额';return;}
  if(isPk){
    const eventName=document.getElementById('pkExcelEvent').value;
    pendingPkExcelRows=rows.map(r=>({event_name:eventName,user_name:r.user_name,amount:r.amount}));
    renderImportPreview(cfg.previewId, rows);
  }else{
    const batchName=document.getElementById('birthExcelBatch').value.trim();
    pendingBirthExcelRows=rows.map(r=>({user_name:r.user_name,amount:r.amount,batch_name:batchName}));
    renderImportPreview(cfg.previewId, rows);
  }
  status.textContent='手动调整已应用，请确认导入';
}
function addManualImportRow(kind){
  const cfg=importUiConfig(kind);
  const isPk=cfg.isPk;
  const nameInput=document.getElementById(cfg.nameId);
  const amountInput=document.getElementById(cfg.amountId);
  const status=document.getElementById(cfg.statusId);
  const previewId=cfg.previewId;
  const applyBtn=document.getElementById(cfg.applyBtnId);
  const confirmBtn=document.getElementById(cfg.confirmBtnId);
  const name=canon(nameInput?.value);
  const amount=num(amountInput?.value);
  if(!name || !amount){ if(status) status.textContent='请填写有效名称和金额'; return; }
  const rows=[...readAdjustedPreview(previewId), {user_name:name,amount}];
  const merged=mergeImportRows(rows);
  if(isPk){
    const eventName=document.getElementById('pkExcelEvent').value;
    pendingPkExcelRows=merged.map(r=>({event_name:eventName,user_name:r.user_name,amount:r.amount}));
  }else{
    const batchName=document.getElementById('birthExcelBatch').value.trim();
    pendingBirthExcelRows=merged.map(r=>({user_name:r.user_name,amount:r.amount,batch_name:batchName}));
  }
  renderImportPreview(previewId, merged);
  applyBtn?.classList.remove('hidden');
  confirmBtn?.classList.remove('hidden');
  if(nameInput) nameInput.value='';
  if(amountInput) amountInput.value='';
  if(status) status.textContent='已加入预览表，请确认后导入';
}
async function previewOrderExcel(kind){
  const cfg=importUiConfig(kind);
  const isPk=cfg.isPk;
  const file=document.getElementById(cfg.fileId).files?.[0];
  const status=document.getElementById(cfg.statusId);
  const confirmBtn=document.getElementById(cfg.confirmBtnId);
  const applyBtn=document.getElementById(cfg.applyBtnId);
  if(!file){status.textContent='请先选择微店订单 Excel 文件';return;}
  try{
    const rows=await readExcelRows(file);
    if(!rows.length){status.textContent='没有识别到可导入订单，请检查表头是否包含名称/买家/收货人、实付/金额和订单状态字段，且订单不全是已取消状态';return;}
    if(isPk){
      const eventName=document.getElementById('pkExcelEvent').value;
      pendingPkExcelRows=rows.map(r=>({event_name:eventName,user_name:r.user_name,amount:r.amount}));
      renderImportPreview(cfg.previewId, rows);
    }else{
      const batchName=document.getElementById('birthExcelBatch').value.trim();
      pendingBirthExcelRows=rows.map(r=>({user_name:r.user_name,amount:r.amount,batch_name:batchName}));
      renderImportPreview(cfg.previewId, rows);
    }
    applyBtn.classList.remove('hidden');
    confirmBtn.classList.remove('hidden');
    status.textContent='识别完成，请核对预览表';
  }catch(e){
    status.textContent='识别失败：'+e.message;
  }
}
async function confirmExcelImport(kind){
  const cfg=importUiConfig(kind);
  const isPk=cfg.isPk;
  const adjusted=readAdjustedPreview(cfg.previewId);
  if(adjusted.length) applyExcelPreviewEdits(cfg.kind);
  const data=isPk ? pendingPkExcelRows : pendingBirthExcelRows;
  const status=document.getElementById(cfg.statusId);
  if(!data.length){status.textContent='没有可导入的识别数据';return;}
  const res=await sb.from(isPk?'pk_records':'birth_fund_records').insert(data);
  status.textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error){
    await logOperation(isPk?'import_pk_excel_records':'import_birth_excel_records', `导入 ${data.length} 条`, {count:data.length});
    if(isPk) pendingPkExcelRows=[]; else pendingBirthExcelRows=[];
    await loadAll();
  }
}
function safeFileName(text){
  return String(text||'')
    .trim()
    .replace(/[\\/:*?"<>|]/g,'_')
    .replace(/\s+/g,'_')
    .slice(0,80) || 'pk';
}
function applyPkExportSheetStyle(sheet,totalRows){
  const border={style:'thin',color:{rgb:'000000'}};
  const center={horizontal:'center',vertical:'center'};
  const range=XLSX.utils.decode_range(sheet['!ref']);
  for(let row=range.s.r; row<=range.e.r; row++){
    for(let col=range.s.c; col<=range.e.c; col++){
      const ref=XLSX.utils.encode_cell({r:row,c:col});
      if(!sheet[ref]) sheet[ref]={t:'s',v:''};
      sheet[ref].s={
        alignment:center,
        border:{top:border,bottom:border,left:border,right:border},
        font:{name:'Arial',sz:12}
      };
      if(row===0){
        sheet[ref].s.font={name:'Arial',sz:20,bold:true};
      }
      if(row===1){
        sheet[ref].s.font={name:'Arial',sz:12,bold:true};
      }
      if(row>=2 && row<totalRows-1 && (col===0 || col===3)){
        sheet[ref].s.fill={fgColor:{rgb:'FFFF00'}};
      }
    }
  }
}
function exportRankedTwoColumnExcel({title,rows,fileName,sheetName='数据',statusEl}){
  const splitAt=rows.length<=40 ? Math.min(20,rows.length) : Math.ceil(rows.length/2);
  const leftRows=rows.slice(0,splitAt);
  const rightRows=rows.slice(splitAt);
  const bodyRows=Math.max(leftRows.length,rightRows.length,20);
  const total=rows.reduce((sum,row)=>sum+num(row.amount),0);
  const table=[
    [title,'','','','',''],
    ['序号','名称','金额','序号','名称','金额']
  ];
  for(let i=0;i<bodyRows;i++){
    const left=leftRows[i];
    const right=rightRows[i];
    table.push([
      left?.rank || '',
      left?.name || '',
      left ? num(left.amount) : '',
      right?.rank || '',
      right?.name || '',
      right ? num(right.amount) : ''
    ]);
  }
  table.push(['总额',num(total),'','','','']);
  const sheet=XLSX.utils.aoa_to_sheet(table);
  const totalRowIndex=table.length-1;
  sheet['!merges']=[
    {s:{r:0,c:0},e:{r:0,c:5}},
    {s:{r:totalRowIndex,c:1},e:{r:totalRowIndex,c:5}}
  ];
  sheet['!cols']=[
    {wch:6},{wch:22},{wch:12},{wch:6},{wch:22},{wch:12}
  ];
  sheet['!rows']=[{hpt:32},{hpt:24}];
  applyPkExportSheetStyle(sheet,table.length);
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,sheet,sheetName);
  XLSX.writeFile(workbook,`${safeFileName(fileName)}.xlsx`);
  if(statusEl) statusEl.textContent=`已导出 ${title}：${rows.length} 个 ID`;
}
function exportPkEventExcel(){
  const status=document.getElementById('dataExportStatus') || document.getElementById('pkImportStatus');
  const eventName=document.getElementById('pkExportEvent')?.value || '';
  if(!eventName){if(status) status.textContent='请先选择要导出的 PK 场次'; return;}
  if(!window.XLSX){if(status) status.textContent='Excel 导出库未加载，请刷新页面后重试'; return;}
  const rows=aggregateByEventUser(DATA.records,eventName)
    .filter(r=>r.event_name===eventName && num(r.amount)>0)
    .sort((a,b)=>num(b.amount)-num(a.amount) || byNameAsc({name:a.user_name},{name:b.user_name}))
    .map((r,index)=>({rank:index+1,name:r.user_name,amount:num(r.amount)}));
  if(!rows.length){if(status) status.textContent='该场次暂无可导出的 PK 数据'; return;}
  exportRankedTwoColumnExcel({
    title:`${eventName}PK数据`,
    rows,
    fileName:`${eventName}_PK数据`,
    sheetName:'PK数据',
    statusEl:status
  });
  if(status) status.textContent=`已导出 ${eventName}：${rows.length} 个 ID`;
}
function exportBirthDataExcel(){
  const status=document.getElementById('dataExportStatus') || document.getElementById('birthImportStatus');
  if(!window.XLSX){if(status) status.textContent='Excel 导出库未加载，请刷新页面后重试'; return;}
  const rows=birthByUser()
    .filter(r=>num(r.total)>0)
    .sort((a,b)=>num(b.total)-num(a.total) || byNameAsc(a,b))
    .map((r,index)=>({rank:index+1,name:r.name,amount:num(r.total)}));
  if(!rows.length){if(status) status.textContent='暂无可导出的生公数据'; return;}
  exportRankedTwoColumnExcel({
    title:'生公数据',
    rows,
    fileName:'生公数据',
    sheetName:'生公数据',
    statusEl:status
  });
}
async function importCsvByKind(kind){
  const cfg=importUiConfig(kind);
  const isPk=cfg.isPk;
  const status=document.getElementById(cfg.statusId);
  const rows=parseCsv(document.getElementById(cfg.csvId)?.value || '');
  if(isPk){
    const eventName=document.getElementById('pkExcelEvent')?.value || '';
    if(!eventName){status.textContent='请先选择总选 PK 场次';return;}
    const data=mergePkImportRows(rows
      .filter(r=>r.length>=2 && !/^(event|user|name|名称)/i.test(String(r[0]||'')))
      .map(r=>{
        const oldFormat=r.length>=3 && num(r[2])>0 && num(r[1])===0;
        return oldFormat
          ? {event_name:r[0],user_name:r[1],amount:num(r[2])}
          : {event_name:eventName,user_name:r[0],amount:num(r[1])};
      }));
    if(!data.length){status.textContent='没有识别到有效数据';return;}
    const res=await sb.from('pk_records').insert(data);
    status.textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
    if(!res.error){await logOperation('import_pk_records', `导入 ${data.length} 条`, {count:data.length}); await loadAll();}
    return;
  }
  const batchName=document.getElementById('birthExcelBatch')?.value.trim() || '';
  const data=mergeBirthImportRows(rows
    .filter(r=>r.length>=2 && !/^(user|name|名称)/i.test(String(r[0]||'')))
    .map(r=>({user_name:r[0],amount:num(r[1]),batch_name:r[2]||batchName})));
  if(!data.length){status.textContent='没有识别到有效数据';return;}
  const res=await sb.from('birth_fund_records').insert(data);
  status.textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error){await logOperation('import_birth_fund_records', `导入 ${data.length} 条`, {count:data.length}); await loadAll();}
}
async function previewElection2026File(){
  const status=document.getElementById('election2026Status');
  if(!state.election2026Available){
    if(status) status.textContent='2026 总选数据表不可用，请先执行新增 SQL。';
    return;
  }
  const file=document.getElementById('election2026File')?.files?.[0];
  if(!file){if(status) status.textContent='请先选择 Excel 或 CSV 文件'; return;}
  try{
    const rows=await readElection2026FileRows(file);
    if(!rows.length){if(status) status.textContent='没有识别到有效名称和数值，请检查文件中是否有名称、票数或金额列'; return;}
    pendingElection2026Rows=buildElection2026Payload(rows);
    renderElection2026Preview(rows);
    document.getElementById('applyElection2026EditBtn')?.classList.remove('hidden');
    document.getElementById('confirmElection2026Btn')?.classList.remove('hidden');
    if(status) status.textContent='识别完成，请核对预览表';
  }catch(e){
    if(status) status.textContent='识别失败：'+e.message;
  }
}
function applyElection2026PreviewEdits(){
  const status=document.getElementById('election2026Status');
  const rows=readElection2026PreviewRows();
  if(!rows.length){if(status) status.textContent='调整后的预览表没有有效名称和数值'; return;}
  pendingElection2026Rows=buildElection2026Payload(rows);
  renderElection2026Preview(rows);
  if(status) status.textContent='手动调整已应用，请确认导入';
}
function addManualElection2026Row(){
  const nameInput=document.getElementById('manualElection2026Name');
  const valueInput=document.getElementById('manualElection2026Value');
  const status=document.getElementById('election2026Status');
  const name=canon(nameInput?.value);
  const value=parseAmountCell(valueInput?.value);
  if(!name || !Number.isFinite(value) || value<=0){
    if(status) status.textContent='请填写有效名称和数值';
    return;
  }
  const rows=mergeElection2026Rows([...readElection2026PreviewRows(), {user_name:name,value}]);
  pendingElection2026Rows=buildElection2026Payload(rows);
  renderElection2026Preview(rows);
  document.getElementById('applyElection2026EditBtn')?.classList.remove('hidden');
  document.getElementById('confirmElection2026Btn')?.classList.remove('hidden');
  if(nameInput) nameInput.value='';
  if(valueInput) valueInput.value='';
  if(status) status.textContent='已加入预览表，请确认后导入';
}
async function confirmElection2026Import(){
  const status=document.getElementById('election2026Status');
  if(!state.election2026Available){
    if(status) status.textContent='2026 总选数据表不可用，请先执行新增 SQL。';
    return;
  }
  const adjusted=readElection2026PreviewRows();
  if(adjusted.length) pendingElection2026Rows=buildElection2026Payload(adjusted);
  const data=pendingElection2026Rows.filter(row=>row.user_name && num(row.value)>0);
  if(!data.length){if(status) status.textContent='没有可导入的数据'; return;}
  const sourceType=data[0]?.source_type || document.getElementById('election2026Source')?.value || 'public_vote';
  const res=await sb.from('election_2026_vote_records').insert(data);
  if(res.error){
    if(status) status.textContent='导入失败：'+res.error.message;
    return;
  }
  await logOperation('import_election_2026_records', `${election2026SourceLabel(sourceType)} ${data.length} 条`, {source_type:sourceType,count:data.length});
  pendingElection2026Rows=[];
  resetElection2026Preview();
  if(status) status.textContent=`导入成功：${election2026SourceLabel(sourceType)} ${data.length} 条`;
  await loadAll();
  renderElection2026Admin();
}
async function importElection2026Csv(){
  const status=document.getElementById('election2026Status');
  if(!state.election2026Available){
    if(status) status.textContent='2026 总选数据表不可用，请先执行新增 SQL。';
    return;
  }
  const rows=mergeElection2026Rows(parseCsv(document.getElementById('election2026Csv')?.value || '')
    .filter(Boolean)
    .flatMap(row=>extractElection2026Rows([row])));
  if(!rows.length){if(status) status.textContent='没有识别到有效 CSV 数据'; return;}
  const data=buildElection2026Payload(rows);
  const sourceType=data[0]?.source_type || 'public_vote';
  const res=await sb.from('election_2026_vote_records').insert(data);
  if(res.error){
    if(status) status.textContent='导入失败：'+res.error.message;
    return;
  }
  await logOperation('import_election_2026_csv', `${election2026SourceLabel(sourceType)} ${data.length} 条`, {source_type:sourceType,count:data.length});
  document.getElementById('election2026Csv').value='';
  if(status) status.textContent=`CSV 导入成功：${data.length} 条`;
  await loadAll();
  renderElection2026Admin();
}
async function clearElection2026Source(){
  const status=document.getElementById('election2026Status');
  if(!state.election2026Available){
    if(status) status.textContent='2026 总选数据表不可用，请先执行新增 SQL。';
    return;
  }
  const sourceType=document.getElementById('election2026Source')?.value || 'public_vote';
  const label=election2026SourceLabel(sourceType);
  if(!confirm(`确认清空「${label}」的所有已导入记录吗？此操作不会影响 PK 数据。`)) return;
  const res=await sb.from('election_2026_vote_records').delete().eq('source_type',sourceType);
  if(res.error){
    if(status) status.textContent='清空失败：'+res.error.message;
    return;
  }
  await logOperation('clear_election_2026_source', label, {source_type:sourceType});
  if(status) status.textContent=`已清空：${label}`;
  await loadAll();
  renderElection2026Admin();
}
function exportElection2026Csv(){
  const status=document.getElementById('election2026Status');
  const rows=sortedElection2026Rows('contribution');
  if(!rows.length){if(status) status.textContent='暂无可导出的 2026 总选数据'; return;}
  const header=['排名','名称','总贡献值','总暗票','明票榜','未翻明暗票','已翻明暗票','PK金额','PK折算票','暗账链接金额','暗账折算票'];
  const lines=rows.map((row,index)=>[
    index+1,
    row.name,
    fmtVotes(row.totalContribution),
    fmtVotes(row.totalDarkVotes),
    fmtVotes(row.publicVotes),
    fmtVotes(row.darkUnrevealedVotes),
    fmtVotes(row.darkRevealedVotes),
    fmt(row.pkAmount),
    fmtVotes(row.pkVotes),
    fmt(row.darkLinkAmount),
    fmtVotes(row.darkLinkVotes)
  ]);
  const csv='\ufeff'+[header,...lines].map(line=>line.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',')).join('\n');
  downloadText('2026总选数据总览.csv', csv, 'text/csv;charset=utf-8');
  if(status) status.textContent=`已导出 2026 总选数据：${rows.length} 个 ID`;
}
function syncElection2026SingleInput(){
  const sourceType=document.getElementById('election2026SingleSource')?.value || 'public_vote';
  const valueInput=document.getElementById('election2026SingleValue');
  if(valueInput){
    valueInput.step=sourceType==='dark_link_amount' ? '0.01' : '0.1';
    valueInput.placeholder=sourceType==='dark_link_amount' ? '金额' : '票数';
  }
}
function clearElection2026SingleForm(message=''){
  const fields=['election2026EditId','election2026SingleName','election2026SingleValue','election2026SingleBatch','election2026SingleNote'];
  fields.forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
  const source=document.getElementById('election2026SingleSource');
  if(source) source.value='public_vote';
  syncElection2026SingleInput();
  const saveBtn=document.getElementById('saveElection2026SingleBtn');
  if(saveBtn) saveBtn.textContent='保存条目';
  document.getElementById('cancelElection2026EditBtn')?.classList.add('hidden');
  const status=document.getElementById('election2026Status');
  if(status && message) status.textContent=message;
}
function fillElection2026SingleForm(recordId){
  const row=(DATA.election2026Records || []).find(item=>String(item.id)===String(recordId));
  const status=document.getElementById('election2026Status');
  if(!row){
    if(status) status.textContent='没有找到这条记录，请刷新列表后重试';
    return;
  }
  const idInput=document.getElementById('election2026EditId');
  const source=document.getElementById('election2026SingleSource');
  const name=document.getElementById('election2026SingleName');
  const value=document.getElementById('election2026SingleValue');
  const batch=document.getElementById('election2026SingleBatch');
  const note=document.getElementById('election2026SingleNote');
  if(idInput) idInput.value=row.id;
  if(source) source.value=row.source_type || 'public_vote';
  if(name) name.value=row.user_name || '';
  if(value) value.value=num(row.value);
  if(batch) batch.value=row.batch_name || '';
  if(note) note.value=row.note || '';
  syncElection2026SingleInput();
  const saveBtn=document.getElementById('saveElection2026SingleBtn');
  if(saveBtn) saveBtn.textContent='保存修改';
  document.getElementById('cancelElection2026EditBtn')?.classList.remove('hidden');
  if(status) status.textContent=`正在编辑：${row.user_name}｜${election2026SourceLabel(row.source_type)}`;
}
async function saveElection2026Single(){
  const status=document.getElementById('election2026Status');
  if(!state.election2026Available){
    if(status) status.textContent='2026 总选数据表不可用，请先执行新增 SQL。';
    return;
  }
  const editId=document.getElementById('election2026EditId')?.value || '';
  const sourceType=document.getElementById('election2026SingleSource')?.value || 'public_vote';
  const userName=canon(document.getElementById('election2026SingleName')?.value);
  const value=parseAmountCell(document.getElementById('election2026SingleValue')?.value);
  const batchName=cleanName(document.getElementById('election2026SingleBatch')?.value || '');
  const note=String(document.getElementById('election2026SingleNote')?.value || '').trim();
  if(!userName || !Number.isFinite(value) || value<=0){
    if(status) status.textContent='请填写有效名称和数值';
    return;
  }
  const payload={
    source_type:sourceType,
    user_name:userName,
    value:num(value),
    batch_name:batchName || null,
    note:note || null
  };
  const query=editId
    ? sb.from('election_2026_vote_records').update(payload).eq('id',editId)
    : sb.from('election_2026_vote_records').insert(payload);
  const res=await query;
  if(res.error){
    if(status) status.textContent=(editId ? '修改失败：' : '新增失败：')+res.error.message;
    return;
  }
  await logOperation(editId ? 'update_election_2026_record' : 'create_election_2026_record', `${election2026SourceLabel(sourceType)}｜${userName}`, {...payload,id:editId || null});
  clearElection2026SingleForm(editId ? `已保存修改：${userName}` : `已新增条目：${userName}`);
  await loadAll();
  renderElection2026Admin();
}
async function deleteElection2026Record(recordId){
  const status=document.getElementById('election2026Status');
  if(!state.election2026Available){
    if(status) status.textContent='2026 总选数据表不可用，请先执行新增 SQL。';
    return;
  }
  const row=(DATA.election2026Records || []).find(item=>String(item.id)===String(recordId));
  if(!row){
    if(status) status.textContent='没有找到这条记录，请刷新列表后重试';
    return;
  }
  if(!confirm(`确认删除「${row.user_name}｜${election2026SourceLabel(row.source_type)}」这条记录吗？`)) return;
  const res=await sb.from('election_2026_vote_records').delete().eq('id',recordId);
  if(res.error){
    if(status) status.textContent='删除失败：'+res.error.message;
    return;
  }
  await logOperation('delete_election_2026_record', `${election2026SourceLabel(row.source_type)}｜${row.user_name}`, row);
  clearElection2026SingleForm(`已删除条目：${row.user_name}`);
  await loadAll();
  renderElection2026Admin();
}
function renderElection2026Admin(){
  const metricsBox=document.getElementById('election2026AdminMetrics');
  const body=document.getElementById('election2026AdminBody');
  const status=document.getElementById('election2026Status');
  if(!metricsBox || !body) return;
  resetElection2026Preview();
  if(!state.election2026Available){
    metricsBox.innerHTML='<div class="adminOverviewCard"><span>数据表状态</span><b>不可用</b><small>请先执行 2026 总选 SQL</small></div>';
    body.innerHTML='<tr><td colspan="7" class="small">2026 总选数据表暂不可用。</td></tr>';
    if(status && !status.textContent) status.textContent='请先执行新增 SQL。';
    return;
  }
  const rows=DATA.election2026Records || [];
  const summary=election2026Summary();
  const sourceCards=ELECTION_2026_SOURCE_ORDER.map(sourceType=>{
    const sourceRows=rows.filter(row=>row.source_type===sourceType);
    const total=sourceRows.reduce((sum,row)=>sum+num(row.value),0);
    const valueText=sourceType==='dark_link_amount' ? fmt(total) : `${fmtVotes(total)} 票`;
    return `<div class="adminOverviewCard">
      <span>${escapeHtml(election2026SourceLabel(sourceType))}</span>
      <b>${escapeHtml(valueText)}</b>
      <small>${sourceRows.length} 条记录</small>
    </div>`;
  }).join('');
  metricsBox.innerHTML=`
    <div class="adminOverviewCard"><span>总贡献值</span><b>${fmtVotes(summary.totalContribution)} 票</b><small>${summary.contributionUsers} 人有贡献记录</small></div>
    <div class="adminOverviewCard"><span>总暗票</span><b>${fmtVotes(summary.totalDarkVotes)} 票</b><small>${summary.darkUsers} 人有暗票记录</small></div>
    <div class="adminOverviewCard"><span>PK折算</span><b>${fmtVotes(summary.pkVotes)} 票</b><small>PK金额 ${fmt(summary.pkAmount)}</small></div>
    <div class="adminOverviewCard"><span>票类记录</span><b>${rows.length}</b><small>明票、暗票和暗账链接</small></div>
    ${sourceCards}`;
  const sorted=[...rows].sort((a,b)=>
    ELECTION_2026_SOURCE_ORDER.indexOf(a.source_type)-ELECTION_2026_SOURCE_ORDER.indexOf(b.source_type) ||
    byNameAsc(a,b) ||
    String(b.created_at||'').localeCompare(String(a.created_at||''))
  );
  body.innerHTML=sorted.slice(0,300).map(row=>`
    <tr>
      <td><span class="pill">${escapeHtml(election2026SourceLabel(row.source_type))}</span></td>
      <td><b>${escapeHtml(row.user_name)}</b></td>
      <td>${row.source_type==='dark_link_amount' ? fmt(row.value) : `${fmtVotes(row.value)} 票`}</td>
      <td>${escapeHtml(row.batch_name || '-')}</td>
      <td>${escapeHtml(row.note || '-')}</td>
      <td>${escapeHtml(formatDateTime(row.created_at))}</td>
      <td>
        <div class="adminRowActions electionRecordActions">
          <button class="btn election-record-edit" data-id="${escapeHtml(row.id)}" type="button">编辑</button>
          <button class="btn bad election-record-delete" data-id="${escapeHtml(row.id)}" type="button">删除</button>
        </div>
      </td>
    </tr>
  `).join('') || '<tr><td colspan="7" class="small">暂无票类数据。PK 折算会由总选单场数据实时计算。</td></tr>';
  body.querySelectorAll('.election-record-edit').forEach(btn=>{
    btn.onclick=()=>fillElection2026SingleForm(btn.dataset.id);
  });
  body.querySelectorAll('.election-record-delete').forEach(btn=>{
    btn.onclick=()=>deleteElection2026Record(btn.dataset.id);
  });
  if(rows.length>300){
    body.insertAdjacentHTML('beforeend', `<tr><td colspan="7" class="small">仅显示前 300 条，完整数据请导出 CSV 查看。</td></tr>`);
  }
  if(status && !status.textContent) status.textContent='2026 总选数据已加载。';
}
function clearElection2026RewardRuleForm(message=''){
  ['electionRewardRuleId','electionRewardRuleThreshold','electionRewardRuleName','electionRewardRuleNote','electionRewardRuleSort'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
  const btn=document.getElementById('saveElectionRewardRuleBtn');
  if(btn) btn.textContent='保存规则';
  document.getElementById('cancelElectionRewardRuleEditBtn')?.classList.add('hidden');
  const status=document.getElementById('electionRewardStatus');
  if(status && message) status.textContent=message;
}
function clearElection2026ManualRewardForm(message=''){
  ['electionManualRewardId','electionManualRewardUser','electionManualRewardName','electionManualRewardNote','electionManualRewardDate'].forEach(id=>{
    const el=document.getElementById(id);
    if(el) el.value='';
  });
  const fulfilled=document.getElementById('electionManualRewardFulfilled');
  if(fulfilled) fulfilled.value='false';
  const btn=document.getElementById('saveElectionManualRewardBtn');
  if(btn) btn.textContent='保存单独奖励';
  document.getElementById('cancelElectionManualRewardEditBtn')?.classList.add('hidden');
  const status=document.getElementById('electionRewardStatus');
  if(status && message) status.textContent=message;
}
function fillElection2026RewardRule(ruleId){
  const rule=(DATA.election2026RewardRules || []).find(row=>String(row.id)===String(ruleId));
  const status=document.getElementById('electionRewardStatus');
  if(!rule){if(status) status.textContent='没有找到这条规则，请刷新后重试'; return;}
  document.getElementById('electionRewardRuleId').value=rule.id;
  document.getElementById('electionRewardRuleThreshold').value=num(rule.threshold_votes);
  document.getElementById('electionRewardRuleName').value=rule.reward_name || '';
  document.getElementById('electionRewardRuleNote').value=rule.note || '';
  document.getElementById('electionRewardRuleSort').value=rule.sort_order || '';
  const btn=document.getElementById('saveElectionRewardRuleBtn');
  if(btn) btn.textContent='保存修改';
  document.getElementById('cancelElectionRewardRuleEditBtn')?.classList.remove('hidden');
  if(status) status.textContent=`正在编辑规则：${rule.reward_name}`;
}
function fillElection2026ManualReward(rowId){
  const row=(DATA.election2026ManualRewards || []).find(item=>String(item.id)===String(rowId));
  const status=document.getElementById('electionRewardStatus');
  if(!row){if(status) status.textContent='没有找到这条单独奖励，请刷新后重试'; return;}
  document.getElementById('electionManualRewardId').value=row.id;
  document.getElementById('electionManualRewardUser').value=row.user_name || '';
  document.getElementById('electionManualRewardName').value=row.reward_name || '';
  document.getElementById('electionManualRewardNote').value=row.note || '';
  document.getElementById('electionManualRewardFulfilled').value=row.fulfilled ? 'true' : 'false';
  document.getElementById('electionManualRewardDate').value=row.fulfilled_date || '';
  const btn=document.getElementById('saveElectionManualRewardBtn');
  if(btn) btn.textContent='保存修改';
  document.getElementById('cancelElectionManualRewardEditBtn')?.classList.remove('hidden');
  if(status) status.textContent=`正在编辑单独奖励：${row.user_name}｜${row.reward_name}`;
}
async function saveElection2026RewardRule(){
  const status=document.getElementById('electionRewardStatus');
  if(!state.election2026RewardsAvailable){if(status) status.textContent='总选奖励数据表不可用，请先执行新增 SQL。'; return;}
  const id=document.getElementById('electionRewardRuleId')?.value || '';
  const threshold=parseAmountCell(document.getElementById('electionRewardRuleThreshold')?.value);
  const rewardName=cleanName(document.getElementById('electionRewardRuleName')?.value || '');
  const note=String(document.getElementById('electionRewardRuleNote')?.value || '').trim();
  const sortValue=document.getElementById('electionRewardRuleSort')?.value;
  if(!rewardName || !Number.isFinite(threshold) || threshold<=0){
    if(status) status.textContent='请填写有效门槛和奖励名称';
    return;
  }
  const payload={
    threshold_votes:num(threshold),
    reward_name:rewardName,
    note:note || null,
    sort_order:sortValue==='' ? 0 : Math.trunc(num(sortValue))
  };
  const res=id
    ? await sb.from('election_2026_reward_rules').update(payload).eq('id',id)
    : await sb.from('election_2026_reward_rules').insert(payload);
  if(res.error){if(status) status.textContent=(id?'规则修改失败：':'规则新增失败：')+res.error.message; return;}
  await logOperation(id ? 'update_election_2026_reward_rule' : 'create_election_2026_reward_rule', `${fmtVotes(threshold)}票｜${rewardName}`, {...payload,id:id || null});
  clearElection2026RewardRuleForm(id ? `已保存规则：${rewardName}` : `已新增规则：${rewardName}`);
  await loadAll();
  renderElection2026RewardAdmin();
}
async function deleteElection2026RewardRule(ruleId){
  const status=document.getElementById('electionRewardStatus');
  const rule=(DATA.election2026RewardRules || []).find(row=>String(row.id)===String(ruleId));
  if(!rule){if(status) status.textContent='没有找到这条规则，请刷新后重试'; return;}
  if(!confirm(`确认删除这条总选奖励规则吗？\n\n${fmtVotes(rule.threshold_votes)}票｜${rule.reward_name}`)) return;
  const res=await sb.from('election_2026_reward_rules').delete().eq('id',ruleId);
  if(res.error){if(status) status.textContent='规则删除失败：'+res.error.message; return;}
  await sb.from('election_2026_reward_status').delete().eq('reward_key',election2026RewardRuleKey(rule));
  await logOperation('delete_election_2026_reward_rule', `${fmtVotes(rule.threshold_votes)}票｜${rule.reward_name}`, rule);
  clearElection2026RewardRuleForm(`已删除规则：${rule.reward_name}`);
  await loadAll();
  renderElection2026RewardAdmin();
}
async function saveElection2026ManualReward(){
  const status=document.getElementById('electionRewardStatus');
  if(!state.election2026RewardsAvailable){if(status) status.textContent='总选奖励数据表不可用，请先执行新增 SQL。'; return;}
  const id=document.getElementById('electionManualRewardId')?.value || '';
  const userName=canon(document.getElementById('electionManualRewardUser')?.value);
  const rewardName=cleanName(document.getElementById('electionManualRewardName')?.value || '');
  const note=String(document.getElementById('electionManualRewardNote')?.value || '').trim();
  const fulfilled=document.getElementById('electionManualRewardFulfilled')?.value === 'true';
  const dateInput=String(document.getElementById('electionManualRewardDate')?.value || '').trim();
  if(!userName || !rewardName){
    if(status) status.textContent='请填写 ID 和奖励名称';
    return;
  }
  const payload={
    user_name:userName,
    reward_name:rewardName,
    note:note || null,
    fulfilled,
    fulfilled_date:fulfilled ? (dateInput || new Date().toISOString().slice(0,10)) : null
  };
  const res=id
    ? await sb.from('election_2026_manual_rewards').update(payload).eq('id',id)
    : await sb.from('election_2026_manual_rewards').insert(payload);
  if(res.error){if(status) status.textContent=(id?'单独奖励修改失败：':'单独奖励新增失败：')+res.error.message; return;}
  await logOperation(id ? 'update_election_2026_manual_reward' : 'create_election_2026_manual_reward', `${userName}｜${rewardName}`, {...payload,id:id || null});
  clearElection2026ManualRewardForm(id ? `已保存单独奖励：${userName}` : `已新增单独奖励：${userName}`);
  await loadAll();
  renderElection2026RewardAdmin();
}
async function deleteElection2026ManualReward(rowId){
  const status=document.getElementById('electionRewardStatus');
  const row=(DATA.election2026ManualRewards || []).find(item=>String(item.id)===String(rowId));
  if(!row){if(status) status.textContent='没有找到这条单独奖励，请刷新后重试'; return;}
  if(!confirm(`确认删除这条单独奖励吗？\n\n${row.user_name}｜${row.reward_name}`)) return;
  const res=await sb.from('election_2026_manual_rewards').delete().eq('id',rowId);
  if(res.error){if(status) status.textContent='单独奖励删除失败：'+res.error.message; return;}
  await logOperation('delete_election_2026_manual_reward', `${row.user_name}｜${row.reward_name}`, row);
  clearElection2026ManualRewardForm(`已删除单独奖励：${row.user_name}`);
  await loadAll();
  renderElection2026RewardAdmin();
}
async function updateElection2026RewardFulfilled(userName,rewardKey,sourceType,sourceId,nextFulfilled){
  const status=document.getElementById('electionRewardStatus');
  if(!state.election2026RewardsAvailable){if(status) status.textContent='总选奖励数据表不可用，请先执行新增 SQL。'; return;}
  const date=nextFulfilled ? new Date().toISOString().slice(0,10) : null;
  let res;
  if(sourceType==='manual'){
    res=await sb.from('election_2026_manual_rewards').update({fulfilled:nextFulfilled,fulfilled_date:date}).eq('id',sourceId);
  }else{
    res=await sb.from('election_2026_reward_status').upsert({
      user_name:canon(userName),
      reward_key:rewardKey,
      fulfilled:nextFulfilled,
      fulfilled_date:date,
      updated_at:new Date().toISOString()
    },{onConflict:'user_name,reward_key'});
  }
  if(res.error){if(status) status.textContent='兑现状态保存失败：'+res.error.message; return;}
  await logOperation('update_election_2026_reward_status', `${userName}｜${nextFulfilled?'已兑现':'待兑现'}`, {user_name:userName,reward_key:rewardKey,source_type:sourceType,source_id:sourceId,fulfilled:nextFulfilled});
  if(status) status.textContent=`已更新 ${userName} 的总选奖励状态`;
  await loadAll();
  renderElection2026RewardAdmin();
}
function renderElection2026RewardAdmin(){
  const metrics=document.getElementById('electionRewardMetrics');
  const ruleBody=document.getElementById('electionRewardRuleBody');
  const manualBody=document.getElementById('electionManualRewardBody');
  const ledgerBody=document.getElementById('electionRewardLedgerBody');
  const status=document.getElementById('electionRewardStatus');
  if(!metrics || !ruleBody || !manualBody || !ledgerBody) return;
  if(!state.election2026RewardsAvailable){
    metrics.innerHTML='<div class="adminOverviewCard"><span>数据表状态</span><b>不可用</b><small>请先执行 2026 总选奖励 SQL</small></div>';
    ruleBody.innerHTML='<tr><td colspan="4" class="small">总选奖励规则表暂不可用。</td></tr>';
    manualBody.innerHTML='<tr><td colspan="4" class="small">总选单独奖励表暂不可用。</td></tr>';
    ledgerBody.innerHTML='<tr><td colspan="4" class="small">总选奖励状态表暂不可用。</td></tr>';
    if(status && !status.textContent) status.textContent='请先执行新增 SQL。';
    return;
  }
  const ledgerRows=allElection2026RewardRows();
  const pending=ledgerRows.filter(row=>!row.fulfilled).length;
  const fulfilled=ledgerRows.length-pending;
  metrics.innerHTML=`
    <div class="adminOverviewCard"><span>达标规则</span><b>${DATA.election2026RewardRules.length}</b><small>按总贡献值自动触发</small></div>
    <div class="adminOverviewCard"><span>单独奖励</span><b>${DATA.election2026ManualRewards.length}</b><small>人工绑定到具体 ID</small></div>
    <div class="adminOverviewCard"><span>待兑现</span><b>${pending}</b><small>当前需要处理</small></div>
    <div class="adminOverviewCard"><span>已兑现</span><b>${fulfilled}</b><small>仅统计总选奖励</small></div>`;
  ruleBody.innerHTML=[...(DATA.election2026RewardRules || [])].sort((a,b)=>num(a.sort_order)-num(b.sort_order) || num(a.threshold_votes)-num(b.threshold_votes)).map(rule=>`
    <tr>
      <td><b>${fmtVotes(rule.threshold_votes)} 票</b></td>
      <td>${escapeHtml(rule.reward_name || '-')}</td>
      <td>${escapeHtml(rule.note || '-')}</td>
      <td><div class="adminRowActions electionRecordActions"><button class="btn election-rule-edit" data-id="${escapeHtml(rule.id)}" type="button">编辑</button><button class="btn bad election-rule-delete" data-id="${escapeHtml(rule.id)}" type="button">删除</button></div></td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="small">暂无达标奖励规则。</td></tr>';
  manualBody.innerHTML=[...(DATA.election2026ManualRewards || [])].map(row=>`
    <tr>
      <td><b>${escapeHtml(row.user_name || '-')}</b></td>
      <td>${escapeHtml(row.reward_name || '-')}<div class="small">${escapeHtml(row.note || '')}</div></td>
      <td>${election2026RewardStatusPill(row)}</td>
      <td><div class="adminRowActions electionRecordActions"><button class="btn election-manual-edit" data-id="${escapeHtml(row.id)}" type="button">编辑</button><button class="btn bad election-manual-delete" data-id="${escapeHtml(row.id)}" type="button">删除</button></div></td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="small">暂无单独奖励。</td></tr>';
  const kw=String(document.getElementById('electionRewardSearch')?.value || '').trim().toLowerCase();
  const filter=document.getElementById('electionRewardFilter')?.value || 'pending';
  const filtered=ledgerRows.filter(row=>{
    if(filter==='pending' && row.fulfilled) return false;
    if(filter==='fulfilled' && !row.fulfilled) return false;
    if(!kw) return true;
    const text=[row.user_name,row.reward_name,row.note,election2026RewardSourceText(row)].join(' ').toLowerCase();
    return text.includes(kw);
  });
  ledgerBody.innerHTML=filtered.map(row=>`
    <tr>
      <td>${election2026RewardStatusPill(row)}</td>
      <td><b>${escapeHtml(row.user_name)}</b><div>${escapeHtml(row.reward_name)}</div>${row.note?`<div class="small">备注：${escapeHtml(row.note)}</div>`:''}</td>
      <td>${escapeHtml(election2026RewardSourceText(row))}</td>
      <td><button class="btn ${row.fulfilled?'':'good'} election-reward-toggle" data-user="${escapeHtml(row.user_name)}" data-key="${escapeHtml(row.reward_key)}" data-source="${escapeHtml(row.source_type)}" data-id="${escapeHtml(row.source_id)}" data-next="${row.fulfilled?'false':'true'}" type="button">${row.fulfilled?'改回待兑现':'标记已兑现'}</button></td>
    </tr>
  `).join('') || '<tr><td colspan="4" class="small">当前筛选条件下暂无总选奖励。</td></tr>';
  ruleBody.querySelectorAll('.election-rule-edit').forEach(btn=>btn.onclick=()=>fillElection2026RewardRule(btn.dataset.id));
  ruleBody.querySelectorAll('.election-rule-delete').forEach(btn=>btn.onclick=()=>deleteElection2026RewardRule(btn.dataset.id));
  manualBody.querySelectorAll('.election-manual-edit').forEach(btn=>btn.onclick=()=>fillElection2026ManualReward(btn.dataset.id));
  manualBody.querySelectorAll('.election-manual-delete').forEach(btn=>btn.onclick=()=>deleteElection2026ManualReward(btn.dataset.id));
  ledgerBody.querySelectorAll('.election-reward-toggle').forEach(btn=>{
    btn.onclick=()=>updateElection2026RewardFulfilled(btn.dataset.user,btn.dataset.key,btn.dataset.source,btn.dataset.id,btn.dataset.next==='true');
  });
  if(status && !status.textContent) status.textContent=`总选奖励已加载：${ledgerRows.length} 条资格`;
}
const importPkBtn=document.getElementById('importPkBtn');
if(importPkBtn) importPkBtn.onclick=async()=>{
  const rows=parseCsv(document.getElementById('pkCsv').value);
  const data=mergePkImportRows(rows.filter(r=>r.length>=3 && !/event/i.test(r[0])).map(r=>({event_name:r[0],user_name:r[1],amount:num(r[2])})));
  if(!data.length){document.getElementById('pkImportStatus').textContent='没有识别到有效数据';return;}
  const res=await sb.from('pk_records').insert(data);
  document.getElementById('pkImportStatus').textContent=res.error?'导入失败：'+res.error.message:`导入成功：${data.length} 条`;
  if(!res.error){await logOperation('import_pk_records', `导入 ${data.length} 条`, {count:data.length}); await loadAll();}
};
const importBirthBtn=document.getElementById('importBirthBtn');
if(importBirthBtn) importBirthBtn.onclick=async()=>{
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
  const provider=row.provider_type || inferRewardProviderType(row.threshold,row.reward_name);
  const choiceOption=choiceOptionFor('pk', row.event_name || document.getElementById('ruleEventSelect')?.value || '', row.reward_name);
  const choiceText=choiceOptionsArray(choiceOption).join(' / ');
  return `<tr data-rule-id="${escapeHtml(row.id || '')}">
    <td><input class="ruleThresholdInput" type="number" step="0.01" min="0" value="${row.threshold!==undefined?escapeHtml(row.threshold):''}" placeholder="例如 128"></td>
    <td><input class="ruleRewardInput" value="${escapeHtml(row.reward_name || '')}" placeholder="例如 拼豆挂件"></td>
    <td><textarea class="ruleChoiceInput" placeholder="可空；例如 A款 / B款，或一行一个">${escapeHtml(choiceText)}</textarea></td>
    <td><select class="ruleProviderInput">
      <option value="support_club" ${provider==='support_club'?'selected':''}>应援会提供</option>
      <option value="zhou_tongyue" ${provider==='zhou_tongyue'?'selected':''}>周童玥提供</option>
    </select></td>
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
  document.querySelectorAll('#ruleRowsBox tbody tr').forEach(tr=>{
    const threshold=tr.querySelector('.ruleThresholdInput');
    const reward=tr.querySelector('.ruleRewardInput');
    const provider=tr.querySelector('.ruleProviderInput');
    const syncProvider=()=>{
      if(provider && !provider.dataset.manual){
        provider.value=inferRewardProviderType(threshold?.value,reward?.value);
      }
    };
    if(provider) provider.onchange=()=>{ provider.dataset.manual='1'; };
    if(threshold) threshold.oninput=syncProvider;
    if(reward) reward.oninput=syncProvider;
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
          <thead><tr><th>金额门槛</th><th>对应奖励</th><th>可选奖励</th><th>提供方</th><th>排序</th><th>操作</th></tr></thead>
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
    choice_options:parseChoiceOptionsText(tr.querySelector('.ruleChoiceInput')?.value || ''),
    provider_type:tr.querySelector('.ruleProviderInput')?.value || inferRewardProviderType(tr.querySelector('.ruleThresholdInput')?.value, tr.querySelector('.ruleRewardInput')?.value),
    sort_order:num(tr.querySelector('.ruleOrderInput')?.value) || i+1
  })).filter(r=>r.event_name && r.reward_name && Number.isFinite(num(r.threshold)) && num(r.threshold)>0);
}
function parseChoiceOptionsText(text){
  const normalized=String(text||'')
    .replace(/[｜|]/g,'/')
    .replace(/或/g,'/')
    .replace(/任选其一/g,'/')
    .replace(/二选一/g,'/')
    .replace(/多选一/g,'/');
  const options=normalized
    .split(/[\n\r/、，,；;]+/)
    .map(x=>x.trim())
    .filter(Boolean);
  return [...new Set(options)];
}
async function syncRuleChoiceOptions(data){
  const errors=[];
  for(const row of data){
    const options=row.choice_options || [];
    if(options.length>=2){
      const payload={
        source_type:'pk',
        event_name:row.event_name,
        reward_name:row.reward_name,
        choice_options:options,
        is_choice_required:true,
        note:'由奖励规则导入自动生成',
        updated_at:new Date().toISOString()
      };
      const res=await sb.from('reward_choice_options').upsert(payload,{onConflict:'source_type,event_name,reward_name'});
      if(res.error) errors.push(res.error.message);
    }else{
      const res=await sb.from('reward_choice_options')
        .delete()
        .eq('source_type','pk')
        .eq('event_name',row.event_name)
        .eq('reward_name',row.reward_name);
      if(res.error) errors.push(res.error.message);
    }
  }
  return errors;
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
    payload:{event_name:r.event_name,threshold:r.threshold,reward_name:r.reward_name,provider_type:r.provider_type,sort_order:r.sort_order}
  }));
  const inserts=data.filter(r=>!r.id).map(({id,choice_options,...r})=>r);

  const errors=[];
  for(const id of deleteIds){
    const res=await sb.from('reward_rules').delete().eq('id', id);
    if(res.error) errors.push(res.error.message);
  }
  for(const item of updates){
    let res=await sb.from('reward_rules').update(item.payload).eq('id', item.id);
    if(res.error && /provider_type|column/i.test(res.error.message || '')){
      const {provider_type, ...fallback}=item.payload;
      res=await sb.from('reward_rules').update(fallback).eq('id', item.id);
    }
    if(res.error) errors.push(res.error.message);
  }
  if(inserts.length){
    let res=await sb.from('reward_rules').insert(inserts);
    if(res.error && /provider_type|column/i.test(res.error.message || '')){
      res=await sb.from('reward_rules').insert(inserts.map(({provider_type,...row})=>row));
    }
    if(res.error) errors.push(res.error.message);
  }
  if(!errors.length){
    errors.push(...await syncRuleChoiceOptions(data));
  }
  document.getElementById('ruleImportStatus').textContent=errors.length?`提交失败：${errors[0]}`:`提交成功：${data.length} 档奖励规则`;
  if(!errors.length){await logOperation('import_reward_rules', `提交 ${data.length} 档`, {count:data.length,event_name:eventName}); await loadAll();}
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
      <td><div class="adminRowActions"><button class="btn announcement-edit" data-id="${a.id}" type="button">编辑</button><button class="btn bad announcement-delete" data-id="${a.id}" type="button">删除</button></div></td>
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
  document.getElementById('cancelAnnouncementEditBtn').classList.add('hidden');
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
  document.getElementById('cancelAnnouncementEditBtn').classList.remove('hidden');
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
      <td><div class="adminRowActions"><button class="btn lottery-edit" data-id="${r.id}" type="button">编辑</button><button class="btn bad lottery-delete" data-id="${r.id}" type="button">删除</button></div></td>
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
  document.getElementById('cancelLotteryEditBtn').classList.add('hidden');
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
  document.getElementById('cancelLotteryEditBtn').classList.remove('hidden');
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

async function renderVisitStatsAdmin(){
  const cards=document.getElementById('visitStatsCards');
  const moduleBody=document.getElementById('visitStatsModuleBody');
  const logBody=document.getElementById('visitLogBody');
  const status=document.getElementById('visitStatsStatus');
  if(!cards || !moduleBody || !logBody || !status) return;
  status.textContent='正在读取访问统计...';
  const res=await sb.from('visit_logs').select('*').order('created_at',{ascending:false}).limit(1000);
  if(res.error){
    status.textContent='读取失败：请确认已在 Supabase 执行 database/visit_logs.sql，并使用管理员账号登录。';
    cards.innerHTML='';
    moduleBody.innerHTML='<tr><td colspan="3" class="small">暂无可显示数据</td></tr>';
    logBody.innerHTML='<tr><td colspan="3" class="small">暂无可显示数据</td></tr>';
    return;
  }
  const rows=res.data || [];
  const todayStart=new Date();
  todayStart.setHours(0,0,0,0);
  const todayRows=rows.filter(row=>new Date(row.created_at) >= todayStart);
  const uniqueVisitors=items=>new Set(items.map(row=>row.visitor_id).filter(Boolean)).size;
  const latest=rows[0]?.created_at ? formatDateTime(rows[0].created_at) : '-';
  status.textContent=`已读取最近 ${rows.length} 条访问记录`;
  cards.innerHTML=[
    {label:'今日访问',value:todayRows.length,meta:'按打开模块计数'},
    {label:'今日访客',value:uniqueVisitors(todayRows),meta:'匿名去重'},
    {label:'累计访问',value:rows.length,meta:'最近 1000 条'},
    {label:'最近访问',value:latest,meta:'前台页面'}
  ].map(item=>`
    <div class="adminOverviewCard">
      <span>${escapeHtml(item.label)}</span>
      <b>${escapeHtml(String(item.value))}</b>
      <small>${escapeHtml(item.meta)}</small>
    </div>
  `).join('');
  const moduleMap=new Map();
  rows.forEach(row=>{
    const key=row.view_name || 'unknown';
    if(!moduleMap.has(key)) moduleMap.set(key,{view:key,count:0,visitors:new Set()});
    const item=moduleMap.get(key);
    item.count += 1;
    if(row.visitor_id) item.visitors.add(row.visitor_id);
  });
  moduleBody.innerHTML=[...moduleMap.values()]
    .sort((a,b)=>b.count-a.count)
    .map(item=>`
      <tr>
        <td><b>${escapeHtml(visitViewLabel(item.view))}</b><div class="small">${escapeHtml(item.view)}</div></td>
        <td>${item.count}</td>
        <td>${item.visitors.size}</td>
      </tr>
    `).join('') || '<tr><td colspan="3" class="small">暂无模块访问数据</td></tr>';
  logBody.innerHTML=rows.slice(0,30).map(row=>`
    <tr>
      <td>${escapeHtml(formatDateTime(row.created_at))}</td>
      <td><b>${escapeHtml(visitViewLabel(row.view_name))}</b><div class="small">${escapeHtml(row.page_path || '-')}</div></td>
      <td>${escapeHtml(row.device_type || '-') }<div class="small">${escapeHtml(String(row.visitor_id || '-').slice(0,18))}</div></td>
    </tr>
  `).join('') || '<tr><td colspan="3" class="small">暂无最近访问数据</td></tr>';
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
        <div class="adminRowActions">
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
  if(cancel) cancel.classList.add('hidden');
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
  if(cancel) cancel.classList.remove('hidden');
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
  if(newVal) await syncRewardProgressCompleted(item.reward_name,'特殊排名奖励');
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



['rewardProgressSearch','rewardProgressProviderFilter','rewardProgressStateFilter'].forEach(id=>{
  const el=document.getElementById(id);
  if(!el) return;
  const eventName=el.tagName==='INPUT' ? 'input' : 'change';
  el.addEventListener(eventName, renderRewardProgressAdmin);
});
const reloadRewardProgressBtn=document.getElementById('reloadRewardProgressBtn');
if(reloadRewardProgressBtn) reloadRewardProgressBtn.onclick=async()=>{await loadAll(); renderRewardProgressAdmin();};
const choiceOptionReward=document.getElementById('choiceOptionReward');
if(choiceOptionReward) choiceOptionReward.onchange=renderRewardChoiceAdmin;
const saveChoiceOptionBtn=document.getElementById('saveChoiceOptionBtn');
if(saveChoiceOptionBtn) saveChoiceOptionBtn.onclick=saveRewardChoiceOptions;
const reloadChoiceAdminBtn=document.getElementById('reloadChoiceAdminBtn');
if(reloadChoiceAdminBtn) reloadChoiceAdminBtn.onclick=async()=>{await loadAll(); renderRewardChoiceAdmin();};
const rewardChoiceSearch=document.getElementById('rewardChoiceSearch');
if(rewardChoiceSearch) rewardChoiceSearch.oninput=renderRewardChoiceAdmin;
const rewardChoiceFilter=document.getElementById('rewardChoiceFilter');
if(rewardChoiceFilter) rewardChoiceFilter.onchange=renderRewardChoiceAdmin;

const unifiedImportKind=document.getElementById('unifiedImportKind');
if(unifiedImportKind) unifiedImportKind.onchange=()=>syncUnifiedImportUi({reset:true});
const previewUnifiedExcelBtn=document.getElementById('previewUnifiedExcelBtn');
if(previewUnifiedExcelBtn) previewUnifiedExcelBtn.onclick=()=>previewOrderExcel(activeImportKind());
const applyUnifiedExcelEditBtn=document.getElementById('applyUnifiedExcelEditBtn');
if(applyUnifiedExcelEditBtn) applyUnifiedExcelEditBtn.onclick=()=>applyExcelPreviewEdits(activeImportKind());
const confirmUnifiedExcelBtn=document.getElementById('confirmUnifiedExcelBtn');
if(confirmUnifiedExcelBtn) confirmUnifiedExcelBtn.onclick=()=>confirmExcelImport(activeImportKind());
const addManualUnifiedRowBtn=document.getElementById('addManualUnifiedRowBtn');
if(addManualUnifiedRowBtn) addManualUnifiedRowBtn.onclick=()=>addManualImportRow(activeImportKind());
const importUnifiedCsvBtn=document.getElementById('importUnifiedCsvBtn');
if(importUnifiedCsvBtn) importUnifiedCsvBtn.onclick=()=>importCsvByKind(activeImportKind());

const election2026Source=document.getElementById('election2026Source');
if(election2026Source) election2026Source.onchange=()=>{
  resetElection2026Preview();
  const status=document.getElementById('election2026Status');
  if(status) status.textContent=`当前来源：${election2026SourceLabel(election2026Source.value)}`;
};
const previewElection2026Btn=document.getElementById('previewElection2026Btn');
if(previewElection2026Btn) previewElection2026Btn.onclick=previewElection2026File;
const applyElection2026EditBtn=document.getElementById('applyElection2026EditBtn');
if(applyElection2026EditBtn) applyElection2026EditBtn.onclick=applyElection2026PreviewEdits;
const confirmElection2026Btn=document.getElementById('confirmElection2026Btn');
if(confirmElection2026Btn) confirmElection2026Btn.onclick=confirmElection2026Import;
const addManualElection2026Btn=document.getElementById('addManualElection2026Btn');
if(addManualElection2026Btn) addManualElection2026Btn.onclick=addManualElection2026Row;
const importElection2026CsvBtn=document.getElementById('importElection2026CsvBtn');
if(importElection2026CsvBtn) importElection2026CsvBtn.onclick=importElection2026Csv;
const clearElection2026SourceBtn=document.getElementById('clearElection2026SourceBtn');
if(clearElection2026SourceBtn) clearElection2026SourceBtn.onclick=clearElection2026Source;
const exportElection2026Btn=document.getElementById('exportElection2026Btn');
if(exportElection2026Btn) exportElection2026Btn.onclick=exportElection2026Csv;
const election2026SingleSource=document.getElementById('election2026SingleSource');
if(election2026SingleSource) election2026SingleSource.onchange=syncElection2026SingleInput;
const saveElection2026SingleBtn=document.getElementById('saveElection2026SingleBtn');
if(saveElection2026SingleBtn) saveElection2026SingleBtn.onclick=saveElection2026Single;
const cancelElection2026EditBtn=document.getElementById('cancelElection2026EditBtn');
if(cancelElection2026EditBtn) cancelElection2026EditBtn.onclick=()=>clearElection2026SingleForm('已取消编辑');
const saveElectionRewardRuleBtn=document.getElementById('saveElectionRewardRuleBtn');
if(saveElectionRewardRuleBtn) saveElectionRewardRuleBtn.onclick=saveElection2026RewardRule;
const cancelElectionRewardRuleEditBtn=document.getElementById('cancelElectionRewardRuleEditBtn');
if(cancelElectionRewardRuleEditBtn) cancelElectionRewardRuleEditBtn.onclick=()=>clearElection2026RewardRuleForm('已取消规则编辑');
const saveElectionManualRewardBtn=document.getElementById('saveElectionManualRewardBtn');
if(saveElectionManualRewardBtn) saveElectionManualRewardBtn.onclick=saveElection2026ManualReward;
const cancelElectionManualRewardEditBtn=document.getElementById('cancelElectionManualRewardEditBtn');
if(cancelElectionManualRewardEditBtn) cancelElectionManualRewardEditBtn.onclick=()=>clearElection2026ManualRewardForm('已取消单独奖励编辑');
const reloadElectionRewardsBtn=document.getElementById('reloadElectionRewardsBtn');
if(reloadElectionRewardsBtn) reloadElectionRewardsBtn.onclick=async()=>{await loadAll(); renderElection2026RewardAdmin();};
['electionRewardSearch','electionRewardFilter'].forEach(id=>{
  const el=document.getElementById(id);
  if(!el) return;
  const eventName=el.tagName==='INPUT' ? 'input' : 'change';
  el.addEventListener(eventName, renderElection2026RewardAdmin);
});

const previewPkExcelBtn=document.getElementById('previewPkExcelBtn');
if(previewPkExcelBtn) previewPkExcelBtn.onclick=()=>previewOrderExcel('pk');
const applyPkExcelEditBtn=document.getElementById('applyPkExcelEditBtn');
if(applyPkExcelEditBtn) applyPkExcelEditBtn.onclick=()=>applyExcelPreviewEdits('pk');
const confirmPkExcelBtn=document.getElementById('confirmPkExcelBtn');
if(confirmPkExcelBtn) confirmPkExcelBtn.onclick=()=>confirmExcelImport('pk');
const addManualPkRowBtn=document.getElementById('addManualPkRowBtn');
if(addManualPkRowBtn) addManualPkRowBtn.onclick=()=>addManualImportRow('pk');
const exportPkEventBtn=document.getElementById('exportPkEventBtn');
if(exportPkEventBtn) exportPkEventBtn.onclick=exportPkEventExcel;
const previewBirthExcelBtn=document.getElementById('previewBirthExcelBtn');
if(previewBirthExcelBtn) previewBirthExcelBtn.onclick=()=>previewOrderExcel('birth');
const applyBirthExcelEditBtn=document.getElementById('applyBirthExcelEditBtn');
if(applyBirthExcelEditBtn) applyBirthExcelEditBtn.onclick=()=>applyExcelPreviewEdits('birth');
const confirmBirthExcelBtn=document.getElementById('confirmBirthExcelBtn');
if(confirmBirthExcelBtn) confirmBirthExcelBtn.onclick=()=>confirmExcelImport('birth');
const exportBirthDataBtn=document.getElementById('exportBirthDataBtn');
if(exportBirthDataBtn) exportBirthDataBtn.onclick=exportBirthDataExcel;
const addManualBirthRowBtn=document.getElementById('addManualBirthRowBtn');
if(addManualBirthRowBtn) addManualBirthRowBtn.onclick=()=>addManualImportRow('birth');

const rewardSelectAll=document.getElementById('rewardSelectAll');
if(rewardSelectAll) rewardSelectAll.onchange=()=>{
  document.querySelectorAll('.reward-row-check').forEach(input=>{input.checked=rewardSelectAll.checked;});
};
const applyRewardBatchBtn=document.getElementById('applyRewardBatchBtn');
if(applyRewardBatchBtn) applyRewardBatchBtn.onclick=applyRewardBatch;

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
          <thead><tr><th>金额门槛</th><th>对应奖励</th><th>可选奖励</th><th>提供方</th><th>排序</th><th>操作</th></tr></thead>
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
  const rows=currentRewardAdminRows.filter(r=>!r.fulfilled);
  const text=rewardRowsToText(rows);
  try{
    await navigator.clipboard.writeText(text);
    setRewardLedgerActionStatus(`已复制 ${rows.length} 条当前未兑现清单`);
  }catch(e){
    setRewardLedgerActionStatus('复制失败，请改用导出CSV');
  }
};

const downloadUnfulfilledBtn=document.getElementById('downloadUnfulfilledBtn');
if(downloadUnfulfilledBtn) downloadUnfulfilledBtn.onclick=()=>{
  const rows=currentRewardAdminRows.filter(r=>!r.fulfilled);
  const csv='\ufeff'+rewardRowsToCsv(rows);
  downloadText('当前筛选未兑现奖励.csv', csv, 'text/csv;charset=utf-8');
  setRewardLedgerActionStatus(`已导出 ${rows.length} 条当前未兑现清单`);
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
const reloadVisitStatsBtn=document.getElementById('reloadVisitStatsBtn');
if(reloadVisitStatsBtn) reloadVisitStatsBtn.onclick=renderVisitStatsAdmin;
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
  if(!res.error){await logOperation('upsert_name_alias', `${alias_name} => ${canonical_name}`, {alias_name,canonical_name}); await loadAll(); await renderAliasAdmin();}
};

(async function(){
  const {data:{user}}=await sb.auth.getUser();
  state.user=user;
  if(IS_ADMIN_PAGE) updateAuthUI();
  await loadAll();
})();
