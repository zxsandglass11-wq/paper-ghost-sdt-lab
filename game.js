/* 页面与试次流程。数学、刺激和存储各自独立；普通脚本可直接在 file:// 下运行。 */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SDT = window.PaperSDT;
  const Store = window.PaperStore;
  const Charts = window.PaperCharts;
  const canvas = $('paper-canvas');
  const MODE_NAMES = {standard: '日常观察', survey: '线索普查', confirm: '证据确认'};
  const OUTCOMES = {H: '命中', M: '漏报', FA: '虚报', CR: '正确拒绝'};
  const loaded = Store.load();
  let sessions = loaded.sessions;
  let persistent = loaded.persistent;
  let selected = new Set(sessions.slice(0, 2).map(s => s.id));
  let lastSession = sessions[0] || null;
  let view = 'home';
  let round = null;
  let challenge = null;
  let clock = 0;
  let phaseStart = 0;
  let toastTimer = 0;
  let modalCancel = null;
  const pct = n => n === null || !Number.isFinite(n) ? '—' : `${(n * 100).toFixed(1)}%`;
  const dec = n => n === null || !Number.isFinite(n) ? '—' : n.toFixed(2);
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const newSeed = () => { const a = new Uint32Array(1); if (window.crypto?.getRandomValues) window.crypto.getRandomValues(a); else a[0] = Math.random() * 4294967296; return a[0]; };
  const dateText = iso => new Intl.DateTimeFormat('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}).format(new Date(iso));

  function toast(message) {
    clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').hidden = false;
    toastTimer = setTimeout(() => { $('toast').hidden = true; }, 4500);
  }
  function dialog({title, kicker = '', body, actions, onCancel}) {
    if ($('modal').open) $('modal').close();
    $('modal-title').textContent = title;
    $('modal-kicker').textContent = kicker;
    $('modal-body').innerHTML = body;
    $('modal-actions').replaceChildren();
    modalCancel = onCancel || null;
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = `button ${action.primary ? 'button-primary' : 'button-secondary'}`;
      btn.textContent = action.text;
      btn.addEventListener('click', () => { modalCancel = null; $('modal').close(); action.run?.(); });
      $('modal-actions').append(btn);
    }
    $('modal').showModal();
  }
  $('modal').addEventListener('cancel', event => {
    event.preventDefault();
    $('modal').close();
    const cancel = modalCancel;
    modalCancel = null;
    cancel?.();
  });
  function setView(next) {
    if (next !== 'play' && document.fullscreenElement) document.exitFullscreen?.().catch(()=>{});
    view = next;
    document.querySelectorAll('.screen').forEach(s => { s.hidden = s.id !== next; });
    document.querySelectorAll('.nav-button').forEach(b => {
      if (b.dataset.view === next) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    document.body.dataset.view = next;
    if (next === 'home') {
      $('home-canvas-slot').append(canvas);
      window.PaperStimulus.draw(canvas, {seed: 701, signal: true, dPrime: 12, phase: 'preview'});
      canvas.setAttribute('aria-label', '示例纸页，中间可见月牙形水印');
    }
    if (next === 'lab') renderLab();
    if (next === 'history') renderHistory();
    if (next === 'results' && lastSession) renderResults(lastSession);
    window.scrollTo({top:0, behavior:'instant'});
  }
  function navigate(next) {
    if (round?.active && next !== 'play') {
      pauseRound(false);
      dialog({title:'结束这次观察？', body:'<p>本次还没有完成，不会写入正式记录。</p>', onCancel: resumeRound,
        actions:[{text:'继续观察',primary:true,run:resumeRound},{text:'结束并离开',run:()=>{round=null;challenge=null;setView(next);}}]});
    } else setView(next);
  }
  document.querySelectorAll('[data-view]').forEach(b => b.addEventListener('click', e => { e.preventDefault(); navigate(b.dataset.view); }));

  function configFromForm() {
    return {count:Number($('trial-count').value), prior:Number($('prior').value), dPrime:Number($('difficulty').value), mode:$('mission').value, exposureMs:1000};
  }
  function syncSettings() {
    const c = configFromForm();
    $('home-count').textContent = c.count;
    const notes = {
      standard:'每次只判断“有”或“无”。拿不准时，也请选更接近你印象的答案。漏报与虚报各记 1 个代价点。',
      survey:'这次尽量别漏掉线索：漏报记 4 个代价点，虚报记 1 个。正确判断不记代价。',
      confirm:'这次谨慎确认：虚报记 4 个代价点，漏报记 1 个。正确判断不记代价。'
    };
    $('mission-note').textContent = notes[c.mode];
  }
  $('settings-form').addEventListener('change', syncSettings);
  $('settings-form').addEventListener('submit', e => e.preventDefault());
  $('start-btn').addEventListener('click', () => { challenge=null; startPractice(configFromForm()); });
  $('direct-start').addEventListener('click', () => { challenge=null; briefRound(configFromForm()); });
  $('challenge-start').addEventListener('click', () => {
    const modes = newSeed() % 2 ? ['survey','confirm'] : ['confirm','survey'];
    challenge = {id:`pair-${Date.now()}-${newSeed().toString(16)}`, config:configFromForm(), modes, index:0, sessionIds:[]};
    dialog({title:'换一个要求，再看一批纸。', kicker:'两局对照',
      body:`<p>两局使用相同难度、数量与水印比例。一次尽量别漏线索，一次谨慎确认。</p><p>这次先做“${MODE_NAMES[modes[0]]}”。每局开始前会说明漏报和虚报的代价。</p><p class="small-note">两局使用新的噪声纸样。结果未必沿预期方向变化，按你的真实印象回答就好。</p>`,
      actions:[{text:'先做 6 次练习',primary:true,run:()=>startPractice({...challenge.config,mode:modes[0]})},{text:'已熟悉，直接开始',run:()=>briefRound({...challenge.config,mode:modes[0]})}],
      onCancel:()=>{challenge=null;}});
  });

  function briefRound(config) {
    const costs = config.mode === 'survey' ? '漏报 4 点，虚报 1 点' : config.mode === 'confirm' ? '漏报 1 点，虚报 4 点' : '漏报、虚报各 1 点';
    dialog({title:MODE_NAMES[config.mode], kicker:challenge ? `两局对照 · 第 ${challenge.index+1} 局` : '正式观察',
      body:`<p>这一批有 ${config.count} 张纸，其中 ${Math.round(config.prior*100)}% 有水印。每张只显示 1 秒，消失后再回答。</p><div class="brief-cost"><strong>${costs}</strong><span>正确判断不记代价，越少越好。</span></div><p>只看中央有没有较深的月牙轮廓，不用找位置。浅色轮廓不算目标。开始后参数保持不变。</p>`,
      actions:[{text:'开灯，开始观察',primary:true,run:()=>startRound(config,false)},{text:'返回',run:()=>{challenge=null;setView('home');}}],
      onCancel:()=>{challenge=null;setView('home');}});
  }
  function startPractice(config) { startRound(config, true); }
  function startRound(config, practice) {
    const seed = newSeed();
    const rng = SDT.createRng(seed);
    const plan = practice ? [true,false,true,false,true,false].map((signal,i)=>({signal,seed:Math.floor(rng()*4294967296), dPrime:i<2?12:8})) : SDT.makeTrials(config.count,config.prior,seed);
    round={config:{...config},practice,seed,plan,index:0,trials:[],active:true,phase:'fixation',paused:false,interrupted:0, interruptedCurrent:false};
    setView('play');
    $('play-canvas-slot').append(canvas);
    $('batch-label').textContent = practice ? '练习 · 6 张纸页' : challenge ? `两局对照 · 第 ${challenge.index+1} 局` : '正式观察';
    $('play-title').textContent = practice ? '先认一认这枚月牙。' : MODE_NAMES[config.mode];
    $('task-label').textContent = practice ? '练习会告诉你答案，不计入正式记录' : `生成 d′ ${config.dPrime} · 有水印 ${Math.round(config.prior*100)}%`;
    $('exposure-label').textContent = '呈现 1,000 毫秒';
    beginTrial();
  }
  function setPhase(phase) {
    round.phase=phase;
    phaseStart=clock;
    const enabled = phase === 'response' && !round.paused;
    $('answer-no').disabled=!enabled;
    $('answer-yes').disabled=!enabled;
    $('practice-feedback').hidden=phase!=='feedback';
    const t=round.plan[round.index];
    const drawPhase=phase==='sample'?'sample':phase==='fixation'?'fixation':'mask';
    window.PaperStimulus.draw(canvas,{seed:t.seed,signal:t.signal,dPrime:t.dPrime||round.config.dPrime,phase:drawPhase,practice:round.practice});
    canvas.setAttribute('aria-label',phase==='sample'?'正在呈现待判断纸页':phase==='fixation'?'注视纸页中央':'纸页已遮住，请根据刚才的印象回答');
    const labels={fixation:['准备','请看纸页中央。'],sample:['透光观察','认较深的月牙轮廓，浅色轮廓不算目标。'],response:['纸页已遮住','刚才，有没有月牙水印？'],cooldown:['已记录','下一张。'],feedback:['练习反馈',''],paused:['已暂停','准备好后继续。']};
    const [label,message]=labels[phase]||['',''];
    $('phase-label').textContent=label;
    $('stage-message').textContent=message;
  }
  function beginTrial() {
    if (!round?.active) return;
    $('trial-counter').textContent=`${round.index+1} / ${round.plan.length}`;
    $('progress-fill').style.width=`${round.index/round.plan.length*100}%`;
    const progress=document.querySelector('.progress-track');
    progress.setAttribute('aria-valuemax',round.plan.length);
    progress.setAttribute('aria-valuenow',round.index);
    round.interruptedCurrent=false;
    setPhase('fixation');
  }
  function answer(response) {
    if (!round?.active||round.paused||round.phase!=='response'||$('modal').open) return;
    const t=round.plan[round.index];
    const outcome=t.signal?(response?'H':'M'):(response?'FA':'CR');
    round.trials.push({signal:t.signal,response,responseMs:Math.max(0,Math.round(clock-phaseStart)),seed:t.seed});
    if (round.practice) {
      setPhase('feedback');
      const explanation={H:'这张有水印，你也看到了。',M:'这张有水印，但你没有认出来。',FA:'这张没有水印，噪声让它看起来像有。',CR:'这张没有水印，你正确排除了。'};
      $('feedback-text').textContent=`${OUTCOMES[outcome]}。${explanation[outcome]}`;
      $('practice-next').textContent=round.index===5?'练习结束，准备正式观察':'下一张';
      $('practice-next').focus({preventScroll:true});
    } else setPhase('cooldown');
  }
  function nextTrial() {
    round.index++;
    if (round.index>=round.plan.length) finishRound(); else beginTrial();
  }
  $('answer-no').addEventListener('click',()=>answer(false));
  $('answer-yes').addEventListener('click',()=>answer(true));
  $('practice-next').addEventListener('click',()=>{if(round?.phase==='feedback'&&!round.paused)nextTrial();});
  function finishRound() {
    round.active=false;
    $('progress-fill').style.width='100%';
    document.querySelector('.progress-track').setAttribute('aria-valuenow',round.plan.length);
    if (round.practice) {const config={...round.config}; round=null; briefRound(config); return;}
    const session={id:`pg-${Date.now()}-${newSeed().toString(16)}`,createdAt:new Date().toISOString(),config:{...round.config},trials:round.trials,seed:round.seed,practice:false,device:{width:window.innerWidth,height:window.innerHeight,dpr:window.devicePixelRatio||1}};
    if(challenge){session.challengeId=challenge.id;challenge.sessionIds.push(session.id);}
    sessions=[session,...sessions].slice(0,Store.MAX_SESSIONS);
    persistent=Store.save(sessions).persistent;
    lastSession=session;
    selected=new Set(challenge?challenge.sessionIds:sessions.slice(0,2).map(s=>s.id));
    round=null;
    updateCount();
    setView('results');
  }
  function pauseRound(show=true) {
    if(!round?.active||round.paused)return;
    round.resumePhase=round.phase;
    round.paused=true;
    if(['sample','fixation','response'].includes(round.phase)){
      round.interrupted++;
      round.interruptedCurrent=true;
      // 保留本次真实类别配额，但换一张新噪声纸页，避免重复观看同一刺激。
      round.plan[round.index]={...round.plan[round.index],seed:newSeed()};
    }
    $('answer-no').disabled=true;$('answer-yes').disabled=true;
    window.PaperStimulus.draw(canvas,{seed:1,signal:false,dPrime:0,phase:'mask'});
    canvas.setAttribute('aria-label','观察已暂停');
    if(show)dialog({title:'灯先关一会儿。',body:'<p>已记录的回答会保留。被打断的纸页不计入成绩，继续时会换一张。</p>',onCancel:resumeRound,actions:[{text:'继续观察',primary:true,run:resumeRound},{text:'结束本次',run:()=>{round=null;challenge=null;setView('home');}}]});
  }
  function resumeRound() {
    if(!round?.active)return;
    round.paused=false;
    if(round.interruptedCurrent)beginTrial();
    else if(round.resumePhase==='feedback')setPhase('feedback');
    else if(round.resumePhase==='cooldown')setPhase('cooldown');
    else beginTrial();
  }
  $('pause-btn').addEventListener('click',()=>pauseRound());
  $('exit-btn').addEventListener('click',()=>navigate('home'));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pauseRound();});
  window.addEventListener('blur',()=>pauseRound());

  function update(dt) {
    clock+=dt;
    if(!round?.active||round.paused)return;
    const elapsed=clock-phaseStart;
    if(round.phase==='fixation'&&elapsed>=350)setPhase('sample');
    else if(round.phase==='sample'&&elapsed>=round.config.exposureMs)setPhase('response');
    else if(round.phase==='cooldown'&&elapsed>=350)nextTrial();
  }
  let previous=performance.now();
  function frame(now){const dt=Math.max(0,now-previous);previous=now;update(dt);requestAnimationFrame(frame);}
  requestAnimationFrame(frame);
  window.advanceTime=ms=>{for(let left=Math.min(Math.max(0,ms),60000);left>0;left-=16)update(Math.min(left,16));};
  window.render_game_to_text=()=>JSON.stringify({view,coordinateSystem:'canvas 600×420; origin top-left; x right, y down',phase:round?.phase||null,paused:round?.paused||false,practice:round?.practice||false,trial:round?round.index+1:null,total:round?.plan.length||null,answered:round?.trials.length||0,interrupted:round?.interrupted||0,config:round?.config||null,historyCount:sessions.length,lastResult:lastSession?SDT.summarize(lastSession.trials,lastSession.config.mode):null,controls:'回答阶段 ← 无水印 / → 有水印；P 暂停；F 全屏'});
  document.addEventListener('keydown',e=>{
    if(e.repeat||e.ctrlKey||e.metaKey||e.altKey)return;
    if(/INPUT|SELECT|TEXTAREA/.test(e.target.tagName))return;
    if($('modal').open)return;
    if(round?.active){
      if(e.key==='ArrowLeft'){e.preventDefault();answer(false);}
      if(e.key==='ArrowRight'){e.preventDefault();answer(true);}
      if(e.key.toLowerCase()==='p'){e.preventDefault();pauseRound();}
      if(e.key.toLowerCase()==='f'){e.preventDefault();if(document.fullscreenElement)document.exitFullscreen?.().catch(()=>{});else document.documentElement.requestFullscreen?.().catch(()=>toast('当前浏览器不支持全屏，仍可正常观察。'));}
    }
  });

  function metric(label,value,note=''){return `<div class="metric"><span class="metric-label">${label}</span><strong class="metric-value">${value}</strong>${note?`<small>${note}</small>`:''}</div>`;}
  function renderResults(session) {
    const r=SDT.summarize(session.trials,session.config.mode);
    $('result-condition').textContent=`${MODE_NAMES[session.config.mode]} · ${r.n} 张 · 生成 d′ ${session.config.dPrime} · 有水印 ${session.config.prior*100}% · ${dateText(session.createdAt)}`;
    $('result-summary').innerHTML=metric('敏感性 d′',dec(r.dPrime),'由本次回答估计')+metric('判断标准 c',dec(r.criterion),'负值偏宽松，正值偏谨慎')+metric('准确率',pct(r.accuracy),`${r.counts.H+r.counts.CR} / ${r.n} 次正确`)+metric('命中率',pct(r.hitRate),`${r.counts.H} / ${r.ns} 张有水印`)+metric('虚报率',pct(r.falseAlarmRate),`${r.counts.FA} / ${r.nn} 张无水印`);
    let tendency=r.criterion<-.2?'这次偏向报告“有水印”。':r.criterion>.2?'这次更谨慎，倾向于报告“没有”。':'这次没有明显偏向某一种回答。';
    if(r.hitRate<r.falseAlarmRate)tendency+=' 本次命中率低于虚报率，可以再练习一下目标形状。';
    else if(r.dPrime<0)tendency+=' 修正后的 d′ 为负；两类样本数量不同时，修正也可能带来这种结果。';
    $('result-interpretation').textContent=`${tendency} 错判代价共 ${r.cost} 点。一次观察的样本有限，换一批纸页，结果可能会变化。`;
    $('confusion').innerHTML=`<table class="data-table confusion-table"><caption class="sr-only">真实情况与回答的四格表</caption><thead><tr><th scope="col">真实情况</th><th scope="col">回答有</th><th scope="col">回答无</th></tr></thead><tbody><tr><th scope="row">有水印</th><td class="outcome-h"><b>${r.counts.H}</b><span>命中 H</span></td><td class="outcome-m"><b>${r.counts.M}</b><span>漏报 M</span></td></tr><tr><th scope="row">无水印</th><td class="outcome-fa"><b>${r.counts.FA}</b><span>虚报 FA</span></td><td class="outcome-cr"><b>${r.counts.CR}</b><span>正确拒绝 CR</span></td></tr></tbody></table>`;
    Charts.roc($('result-roc'),{dPrime:session.config.dPrime,criterion:0,points:[{label:'本次实测',hitRate:r.hitRate,falseAlarmRate:r.falseAlarmRate}]});
    $('calculation-details').innerHTML=`<p>命中率 = H / (H + M) = ${r.counts.H} / ${r.ns}；虚报率 = FA / (FA + CR) = ${r.counts.FA} / ${r.nn}。</p><p>计算 d′ 和 c 时，各格统一加 0.5：修正命中率 = (${r.counts.H} + 0.5) / (${r.ns} + 1) = ${dec(r.correctedHitRate)}；修正虚报率 = (${r.counts.FA} + 0.5) / (${r.nn} + 1) = ${dec(r.correctedFalseAlarmRate)}。</p><p>d′ = Φ⁻¹(修正命中率) − Φ⁻¹(修正虚报率)<br>c = −[Φ⁻¹(修正命中率) + Φ⁻¹(修正虚报率)] / 2</p><p>修正避免 0% 或 100% 时出现无穷值。上方命中率、虚报率和准确率仍显示原始比例。生成 d′ 是刺激模型的参数，不是你的实际敏感性。</p><p>平均作答用时 ${r.meanResponseMs===null?'—':Math.round(r.meanResponseMs)+' 毫秒'}，从遮罩出现后开始计时，不含前面的观察时间。</p><p class="small-note">方法依据：<a href="https://doi.org/10.3758/BF03203619" target="_blank" rel="noreferrer">Hautus, 1995</a>；<a href="https://doi.org/10.3758/BF03207704" target="_blank" rel="noreferrer">Stanislaw & Todorov, 1999</a>。</p>`;
    $('trial-details').innerHTML=`<table class="data-table"><thead><tr><th>纸页</th><th>真实情况</th><th>你的回答</th><th>结果</th><th>作答用时</th></tr></thead><tbody>${session.trials.map((t,i)=>`<tr><td>${i+1}</td><td>${t.signal?'有水印':'无水印'}</td><td>${t.response?'有':'无'}</td><td>${OUTCOMES[t.signal?(t.response?'H':'M'):(t.response?'FA':'CR')]}</td><td>${Math.round(t.responseMs)} ms</td></tr>`).join('')}</tbody></table>`;
    $('result-storage-note').textContent=persistent?'本次记录已保存在这个浏览器中。更换设备前，可以导出备份。':'浏览器未允许长期保存。本次页面内仍可比较多局；关闭前请导出记录。';
    const pending=challenge&&challenge.index===0&&session.challengeId===challenge.id;
    $('result-next-challenge').hidden=!pending;
    $('result-again').hidden=!!pending;
    $('result-compare').textContent=challenge?.index===1?'查看两局对照':'对比观察记录';
  }
  $('result-next-challenge').addEventListener('click',()=>{if(challenge){challenge.index=1;briefRound({...challenge.config,mode:challenge.modes[1]});}});
  $('result-again').addEventListener('click',()=>{challenge=null;if(lastSession)briefRound({...lastSession.config});});
  $('result-compare').addEventListener('click',()=>setView('history'));
  function updateCount(){$('history-count').textContent=sessions.length;}

  function renderLab(){
    const d=Number($('lab-d').value),c=Number($('lab-c').value),p=Number($('lab-prior').value);
    $('lab-d-value').textContent=d.toFixed(1);$('lab-c-value').textContent=c.toFixed(1);$('lab-prior-value').textContent=`${Math.round(p*100)}%`;
    const options={dPrime:d,criterion:c,prior:p};
    Charts.distribution($('distribution-chart'),options);
    const points=lastSession?[{label:'当前记录实测',...pickRates(lastSession)}]:[];
    Charts.roc($('roc-chart'),{...options,points});Charts.outcomes($('outcomes-chart'),options);
    const pred=SDT.prediction(d,c,p);
    $('lab-metrics').innerHTML=`<div><span>理论命中率</span><b>${pct(pred.hitRate)}</b></div><div><span>理论虚报率</span><b>${pct(pred.falseAlarmRate)}</b></div><div><span>预期准确率</span><b>${pct(pred.accuracy)}</b></div>`;
  }
  function pickRates(s){const r=SDT.summarize(s.trials,s.config.mode);return {hitRate:r.hitRate,falseAlarmRate:r.falseAlarmRate};}
  ['lab-d','lab-c','lab-prior'].forEach(id=>$(id).addEventListener('input',renderLab));
  $('lab-reset').addEventListener('click',()=>{$('lab-d').value=2;$('lab-c').value=0;$('lab-prior').value=.5;renderLab();});

  function renderHistory(){
    $('history-storage-note').textContent=persistent?'最近 30 次完整观察保存在本机。选中记录后，下方显示对比。':'当前使用页面内记录。关闭页面前，请保存 JSON 备份。';
    selected=new Set([...selected].filter(id=>sessions.some(s=>s.id===id)));
    ['export-json','export-csv','clear-history'].forEach(id=>{$(id).disabled=!sessions.length;});
    if(!sessions.length){$('session-list').innerHTML='<div class="empty-state"><span class="empty-moon" aria-hidden="true">☾</span><h2>还没有观察记录。</h2><p>完成一批纸页后，结果会留在这里。</p><button class="button button-primary" id="empty-start">去工作台</button></div>';$('empty-start').addEventListener('click',()=>setView('home'));}
    else {$('session-list').innerHTML=sessions.map(s=>{const r=SDT.summarize(s.trials,s.config.mode);return `<article class="session-row"><label class="session-check"><input type="checkbox" data-session="${escape(s.id)}" ${selected.has(s.id)?'checked':''} aria-label="选择 ${escape(dateText(s.createdAt))} ${MODE_NAMES[s.config.mode]}"><span><strong>${MODE_NAMES[s.config.mode]}${s.challengeId?' <span class="pill">对照局</span>':''}</strong><small>${dateText(s.createdAt)} · ${s.config.count} 张 · 生成 d′ ${s.config.dPrime} · P(S) ${s.config.prior*100}%</small></span></label><div class="session-meta"><span>d′ <b>${dec(r.dPrime)}</b></span><span>c <b>${dec(r.criterion)}</b></span><span>正确 <b>${pct(r.accuracy)}</b></span></div><button class="text-button" data-detail="${escape(s.id)}">查看记录</button></article>`;}).join('');
      $('session-list').querySelectorAll('[data-session]').forEach(input=>input.addEventListener('change',()=>{if(input.checked&&selected.size>=3){input.checked=false;toast('一次最多比较三局。');return;}if(input.checked)selected.add(input.dataset.session);else selected.delete(input.dataset.session);renderComparison();}));
      $('session-list').querySelectorAll('[data-detail]').forEach(btn=>btn.addEventListener('click',()=>{lastSession=sessions.find(s=>s.id===btn.dataset.detail);setView('results');}));
    }
    renderComparison();
  }
  function renderComparison(){
    const chosen=sessions.filter(s=>selected.has(s.id));
    $('comparison-section').hidden=chosen.length<2;
    if(chosen.length<2)return;
    $('selection-count').textContent=`已选 ${chosen.length} 局`;
    const different=['count','prior','dPrime','exposureMs'].filter(k=>chosen.some(s=>s.config[k]!==chosen[0].config[k]));
    const names={count:'纸页数量',prior:'有水印比例',dPrime:'生成难度',exposureMs:'呈现时间'};
    const deviceDiff=chosen.some(s=>JSON.stringify(s.device)!==JSON.stringify(chosen[0].device));
    $('comparison-note').textContent=different.length?`这些记录的${different.map(k=>names[k]).join('、')}不同。差异可能来自条件变化，不能直接当作能力提高。`:deviceDiff?'主要参数相同，但设备或窗口尺寸不同，显示条件可能影响结果。':'主要参数相同。可以观察不同任务下的 c、命中和虚报怎样变化；小样本仍会波动。';
    Charts.comparison($('comparison-chart'),chosen);
    const rows=chosen.map(s=>({s,r:SDT.summarize(s.trials,s.config.mode)}));
    $('comparison-table').innerHTML=`<table class="data-table"><caption>所选记录的原始数值</caption><thead><tr><th>任务</th><th>H</th><th>M</th><th>FA</th><th>CR</th><th>d′</th><th>c</th><th>命中率</th><th>虚报率</th><th>准确率</th><th>代价</th></tr></thead><tbody>${rows.map(({s,r})=>`<tr><th scope="row">${MODE_NAMES[s.config.mode]}<small>${dateText(s.createdAt)}</small></th><td>${r.counts.H}</td><td>${r.counts.M}</td><td>${r.counts.FA}</td><td>${r.counts.CR}</td><td>${dec(r.dPrime)}</td><td>${dec(r.criterion)}</td><td>${pct(r.hitRate)}</td><td>${pct(r.falseAlarmRate)}</td><td>${pct(r.accuracy)}</td><td>${r.cost}</td></tr>`).join('')}</tbody></table><p class="small-note">不同任务的代价规则不同，不按代价点数跨任务排名。</p>`;
  }
  function download(name,content,type){const url=URL.createObjectURL(new Blob([content],{type}));const a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),5000);}
  $('result-csv').addEventListener('click',()=>{if(lastSession)download('纸上幽灵-本次观察.csv',Store.csv([lastSession]),'text/csv;charset=utf-8');});
  $('export-json').addEventListener('click',()=>download('纸上幽灵-观察记录.json',Store.serialize(sessions),'application/json;charset=utf-8'));
  $('export-csv').addEventListener('click',()=>download('纸上幽灵-全部观察.csv',Store.csv(sessions),'text/csv;charset=utf-8'));
  $('import-json').addEventListener('click',()=>$('import-file').click());
  $('import-file').addEventListener('change',async event=>{
    const file=event.target.files[0];if(!file)return;
    try{
      if(file.size>2*1024*1024)throw new Error('文件超过 2 MB，请选择本实验导出的记录。');
      const incoming=Store.parseImport(await file.text());
      const ids=new Set(sessions.map(s=>s.id));
      const added=incoming.filter(s=>!ids.has(s.id));
      sessions=[...added,...sessions].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt)).slice(0,Store.MAX_SESSIONS);
      persistent=Store.save(sessions).persistent;
      selected=new Set(sessions.slice(0,2).map(s=>s.id));lastSession=sessions[0]||null;updateCount();renderHistory();toast(`已导入 ${added.length} 条新记录，重复记录已跳过。`);
    }catch(error){toast(`未导入：${error.message}`);}finally{event.target.value='';}
  });
  $('clear-history').addEventListener('click',()=>dialog({title:'清空本机观察记录？',body:'<p>清空后无法在这里恢复。需要留存的话，请先保存 JSON 备份。</p>',actions:[{text:'保留记录',primary:true},{text:'清空记录',run:()=>{sessions=[];selected.clear();lastSession=null;challenge=null;persistent=Store.save([]).persistent;updateCount();renderHistory();toast('本机记录已清空。');}}]}));
  $('about-btn').addEventListener('click',()=>{
    const wasActive=round?.active;if(wasActive)pauseRound(false);
    dialog({title:'关于这次观察',kicker:'信号检测论',body:'<p>我们判断固定位置有没有月牙水印。纸张噪声可能形成相似轮廓，微弱水印也可能被掩盖。</p><p>有水印并报有是命中；有水印却报无是漏报；无水印却报有是虚报；无水印并报无是正确拒绝。</p><p>正式局按比例安排两类纸页，再打乱顺序。生成 d′ 控制模型的信号与噪声分离；作答后的 d′ 与 c 则是根据本次回答估计。</p><p class="small-note">这是合成刺激的课堂实验，不用于真实文物鉴定。观察内容可以离线运行，记录不上传服务器。</p>',actions:[{text:wasActive?'继续观察':'知道了',primary:true,run:()=>{if(wasActive)resumeRound();}}],onCancel:()=>{if(wasActive)resumeRound();}});
  });
  let resizeTimer;
  window.addEventListener('beforeunload',event=>{if(round?.active){event.preventDefault();event.returnValue='';}});
  window.addEventListener('resize',()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(view==='lab')renderLab();if(view==='history')renderComparison();if(view==='results'&&lastSession)renderResults(lastSession);},120);});
  syncSettings();updateCount();setView('home');
})();
