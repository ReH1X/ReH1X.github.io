/* SKVERNA OS Mini App — verified Telegram identity is sent only to our own API. */
(() => {
  'use strict';
  const app = document.querySelector('#app');
  const nav = document.querySelector('#nav');
  const toastNode = document.querySelector('#toast');
  const connection = document.querySelector('#connection-status');
  const tg = window.Telegram?.WebApp;
  const demo = new URLSearchParams(location.search).has('demo');
  // The public frontend may live on Pages while the API remains on the bot's device.
  // Configure this only in the published HTML; never put a bot token in the page.
  const configuredApi = document.querySelector('meta[name="skverna-api-base"]')?.content.trim();
  const base = configuredApi ? new URL(configuredApi) : new URL('./', location.href);
  if (configuredApi && base.protocol !== 'https:') throw new Error('Mini App API requires HTTPS');
  const modes = {classic:['Классика',4,'◈'],tdm:['TDM 4×4',8,'⌖'],wow4:['WOW 4×4',8,'⚔'],wow3:['WOW 3×3',6,'✧']};
  let page = 'today';
  let data = null;
  let farmView = 'farm:home';
  let previousWeek = false;
  let requestSeq = 0;
  let busy = false;
  let toastTimer;
  let retryTimer;
  let retryAttempt = 0;
  let offline = false;

  function esc(value) {return String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  function fmt(iso) {if(!iso)return '—';const date=new Date(iso);return Number.isNaN(date.getTime())?'—':new Intl.DateTimeFormat('ru-RU',{day:'2-digit',month:'short',hour:'2-digit',minute:'2-digit'}).format(date);}
  function notify(message) {toastNode.textContent=message;toastNode.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>toastNode.classList.remove('show'),2800);}
  function buzz() {try {tg?.HapticFeedback?.impactOccurred('light');} catch (_) {}}
  function setConnection(label, offline=false) {connection.querySelector('span').textContent=label;connection.classList.toggle('offline',offline);}
  function gate(title, text, disconnected=false, retry=false) {nav.hidden=true;setConnection(disconnected?'НЕТ СВЯЗИ':'ТОЛЬКО ДЛЯ СВОИХ',disconnected);app.innerHTML=`<div class="gate"><img src="./art/biobot.svg" alt="" class="gate-sticker"><h1>${esc(title)}</h1><p>${esc(text)}</p>${retry?'<button class="primary" type="button" data-action="reconnect">↻ Повторить попытку</button>':''}</div>`;}
  function scheduleRetry() {
    if(document.visibilityState==='hidden')return;
    const delay=Math.min(30000,3000*2**Math.min(retryAttempt++,4));
    retryTimer=setTimeout(()=>{retryTimer=null;load();},delay);
  }
  function celebrate(message, sticker='./art/harvest.svg') {
    document.querySelector('.reward-pop')?.remove();
    const pop=document.createElement('div');pop.className='reward-pop';pop.setAttribute('aria-hidden','true');
    pop.innerHTML=`<img src="${sticker}" alt=""><strong>${esc(message)}</strong>`;
    document.querySelector('.shell').append(pop);
    setTimeout(()=>pop.remove(),1600);
    try{tg?.HapticFeedback?.notificationOccurred('success');}catch(_){}
  }
  function mock(current) {
    const now=Date.now();
    return {page:current,user:{name:'Игрок SKVERNA'},snapshot:{member:true,quest:{title:'Задание клана',level:2,status:'active',deadline:new Date(now+24*3600000).toISOString(),proof_status:null},mode_counts:{classic:2,tdm:3,wow4:5,wow3:1},own_mode:null,own_expires_at:null,subscribed_modes:['wow4'],events:[{id:1,title:'WOW 4×4 · Вечерний сбор',starts_at:new Date(now+6*3600000).toISOString(),registration_closes_at:new Date(now+5*3600000).toISOString(),yes_count:5,maybe_count:2,own_rsvp:null}],season_rank:7,season_points:340,season_wins:4,farm_sc:2480,pubg_status:'verified'},roster:{classic:['Игрок 1','Игрок 2'],tdm:['Игрок 1','Игрок 2','Игрок 3'],wow4:['Игрок 1','Игрок 2','Игрок 3','Игрок 4','Игрок 5'],wow3:['Игрок 1']}};
  }
  function mockFarm(view) {
    return {view,text:'☣ BIOFARM\n\nТвоя ферма готова к сбору. Развивай уровень, нанимай персонал и исследуй новые культуры.\n\nЭто демонстрация интерфейса: данные не сохраняются.',level:12,stars:1,sc:2480,visual:{stage:3,total_stage:13,stage_name:'Зелёный сектор',crop:'🌱 Культура',ready:3,capacity:5,next_ready_at:null},buttons:[
      {text:'🌾 СОБРАТЬ',action:'farm:collect',kind:'action'},
      {text:'🌿 Моя ферма',action:'farm:menu:myfarm',kind:'view'},
      {text:'🏗 Развитие',action:'farm:menu:progress',kind:'view'},
      {text:'💰 Экономика',action:'farm:menu:economy',kind:'view'},
      {text:'👥 Клан',action:'farm:menu:clan',kind:'view'},
      {text:'🏠 BIOFARM',action:'farm:home',kind:'view'},
    ]};
  }
  function mockWeek() {
    return {week_key:'2026-10-26',ends_on:'2026-11-02',total:68,personal:11,breakdown:{quests:3,contracts:4,harvests:4},board:[['Игрок 1',26],['Игрок 2',17]],claimed:[],claimable:!previousWeek,stages:[{stage:1,clan:40,personal:8,base_sc:150},{stage:2,clan:120,personal:20,base_sc:450},{stage:3,clan:250,personal:35,base_sc:1000}]};
  }
  async function api(path, body) {
    const controller=body?null:new AbortController();
    const timeout=controller?setTimeout(()=>controller.abort(),12000):null;
    let response;
    try {
      response=await fetch(new URL(path,base),{method:body?'POST':'GET',headers:{Authorization:`tma ${tg.initData}`,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store',signal:controller?.signal});
    } finally {if(timeout)clearTimeout(timeout);}
    if(!response.ok){const error=new Error((await response.text()).slice(0,160) || `Ошибка ${response.status}`);error.status=response.status;throw error;}
    return response.json();
  }
  async function load(next=page) {
    page=next;
    const seq=++requestSeq;
    if(retryTimer){clearTimeout(retryTimer);retryTimer=null;}
    nav.querySelectorAll('[data-tab]').forEach(button=>{button.classList.toggle('active',button.dataset.tab===page);button.setAttribute('aria-current',button.dataset.tab===page?'page':'false');});
    if(demo){data=page==='farm'?mockFarm(farmView):page==='clan'?mockWeek():mock(page);setConnection('ДЕМО');render();return;}
    if(offline){setConnection('ПОДКЛЮЧАЕМСЯ',true);const button=app.querySelector('[data-action="reconnect"]');if(button){button.disabled=true;button.textContent='Подключаюсь…';}}
    try {
      const path=next==='farm'?`api/farm?view=${encodeURIComponent(farmView)}`:next==='clan'?`api/weekly?previous=${previousWeek}`:`api/state?page=${next}`;
      const loaded=await api(path);
      if(seq!==requestSeq)return;
      data=loaded;
      offline=false;retryAttempt=0;
      setConnection('В СЕТИ');
      render();
    } catch(error){
      if(seq!==requestSeq)return;
      if(error.status===401){offline=false;gate('Сессия истекла','Закрой Mini App и снова открой его из меню бота.');return;}
      if(error.status===403){offline=false;gate('Доступ ограничен',error.message);return;}
      if(error.status && error.status<500 && error.status!==429){offline=false;gate('Не получилось загрузить данные',error.message);return;}
      offline=true;
      gate('Связь с ботом прервалась','Проверю подключение автоматически. Можно попробовать ещё раз прямо сейчас.',true,true);
      scheduleRetry();
    }
  }
  function title(eyebrow,main,accent,subtitle) {return `<div class="eyebrow">${eyebrow}</div><h1 class="heading">${main} <span>${accent}</span></h1><p class="subheading">${subtitle}</p>`;}
  function section(name,side='') {return `<div class="section-title"><h2>${name}</h2><small>${side}</small></div>`;}
  function questCard(q) {return `<div class="card"><div class="card-head"><strong>🎯 Задание клана</strong><span class="stamp">${q?'РАНГ '+esc(q.level):'ОЖИДАНИЕ'}</span></div><p>${q?esc(q.title):'Новое задание появится здесь, когда его выдадут.'}</p>${q?`<p class="note">${q.status==='active'?'До '+fmt(q.deadline):'Идёт проверка'} · ${q.proof_status==='pending'?'видео на проверке':q.proof_status==='rejected'?'видео отклонено':'доказательство через бота'}</p>`:''}</div>`;}
  function today(s) {
    const total=Object.values(s.mode_counts||{}).reduce((a,b)=>a+b,0);
    const event=s.events?.[0];
    const next=s.quest?.status==='active'&&s.quest?.proof_status!=='pending'?'Запиши результат задания и отправь доказательство боту.':s.own_mode?'Ты в поиске команды. Следи за составом в разделе «Игра».':total?'Игроки уже собираются. Выбери режим и займи место.':'Начни сбор на ближайший матч.';
    return `${title('ЛИЧНЫЙ ХАБ · SKVERNA OS','Привет,',esc(data.user.name)+'!','Здесь всё, что происходит в твоём клане прямо сейчас.')}
      <div class="hero"><span class="tag">✦ БИОБОТ / ТВОЙ ХОД</span><h2>${esc(next)}</h2><p>Твоя команда всегда в одном касании.</p><button class="primary" data-tab="play">Найти игру <span aria-hidden="true">↗</span></button><img src="./art/biobot.svg" alt="Биобот приветствует участников SKVERNA"></div>
      ${section('На радаре','СЕГОДНЯ')}<div class="grid-2"><div class="metric"><div class="icon">⌁</div><b>${total}</b><small>ищут команду</small></div><div class="metric"><div class="icon">◈</div><b>${s.season_rank?'#'+s.season_rank:'—'}</b><small>место в сезоне</small></div></div>
      ${section('Твоё задание','01 / КВЕСТ')}${questCard(s.quest)}
      ${section('Ближайшая игра','02 / СОБЫТИЯ')}${event?`<div class="card"><div class="card-head"><strong>${esc(event.title)}</strong><span class="stamp">${event.yes_count} ИГРОКОВ</span></div><p>📅 ${fmt(event.starts_at)} · ${event.own_rsvp==='yes'?'ты записан':'запись открыта'}</p><div class="actions"><button class="secondary" data-tab="events">К событию ↗</button></div></div>`:'<div class="empty">Ближайших событий пока нет. Можно собрать команду самому.</div>'}`;
  }
  function play(s) {
    const cards=Object.entries(modes).map(([key,[label,size,icon]])=>{const count=s.mode_counts?.[key]||0;const joined=s.own_mode===key;const roster=data.roster?.[key]||[];return `<div class="mode"><div class="mode-top"><div class="mode-icon">${icon}</div><div><div class="mode-name">${label}</div><div class="mode-meta">${count>=size?'Состав готов':'Нужно ещё '+(size-count)+' игроков'}</div></div><div class="mode-count"><span>${count}</span>/${size}</div></div><div class="track"><i style="width:${Math.min(100,100*count/size)}%"></i></div><div class="mode-bottom"><small>${joined?'Твоя заявка до '+fmt(s.own_expires_at):'Заявка действует 90 минут'}</small><button class="${joined?'secondary':'primary'}" data-action="join" data-mode="${key}">${joined?'Продлить':'Играю →'}</button></div>${roster.length?`<div class="roster">👥 ${roster.map(esc).join(' · ')}</div>`:''}</div>`;}).join('');
    const switches=Object.entries(modes).map(([key,[label]])=>{const on=s.subscribed_modes?.includes(key);return `<div class="invite-row"><span>${label}</span><button class="chip ${on?'selected':''}" data-action="subscription" data-mode="${key}">${on?'🔔 Включены':'🔕 Включить'}</button></div>`;}).join('');
    return `${title('НАШИ РЕЖИМЫ','Найди','своих.','Выбирай режим — твоя заявка сразу появится у всей команды.')}${cards}${s.own_mode?'<button class="secondary" data-action="leave" style="width:100%;margin:3px 0 12px">Снять заявку</button>':''}${section('Приглашения','ПО РЕЖИМАМ')}<div class="card">${switches}</div>`;
  }
  function events(s) {
    const cards=s.events?.map(event=>{const closed=new Date(event.registration_closes_at)<=new Date();return `<div class="card"><div class="date-line">▦ ${fmt(event.starts_at)}</div><div class="card-head"><strong>${esc(event.title)}</strong><span class="stamp">#${event.id}</span></div><p>Будут: ${event.yes_count} · возможно: ${event.maybe_count}</p><p class="note">${closed?'Регистрация закрыта':'Запись до '+fmt(event.registration_closes_at)}</p>${closed?'':`<div class="rsvp"><button class="chip ${event.own_rsvp==='yes'?'selected':''}" data-action="rsvp" data-event="${event.id}" data-status="yes">✓ Буду</button><button class="chip ${event.own_rsvp==='maybe'?'selected':''}" data-action="rsvp" data-event="${event.id}" data-status="maybe">? Возможно</button><button class="chip ${event.own_rsvp==='no'?'selected':''}" data-action="rsvp" data-event="${event.id}" data-status="no">✕ Не буду</button></div>`}</div>`;}).join('') || '<div class="empty">Игр в расписании пока нет. Зови своих в разделе «Игра».</div>';
    return `${title('КАЛЕНДАРЬ КЛАНА','Игры и','события.','Выбирай время и отмечайся в составе.')}${cards}`;
  }
  function progress(s) {const pubg={verified:'UID подтверждён',pending_review:'Профиль на проверке',awaiting_proof:'Нужно доказательство',rejected:'Проверка отклонена'}[s.pubg_status]||'Профиль не привязан';return `${title('ТВОЯ ИСТОРИЯ','Расти вместе','с нами.','Каждая игра и каждая победа идут в твою историю.')}
    <div class="progress-block"><div class="mini-label">ТВОЙ СЕЗОННЫЙ РАНГ</div><div class="value">${s.season_rank?'#'+s.season_rank:'—'}</div><p>${s.season_points} очков · ${s.season_wins} побед</p></div>
    ${section('Твои системы','SKVERNA OS')}<div class="grid-2"><div class="metric"><div class="icon">☣</div><b>${s.farm_sc===null?'—':Number(s.farm_sc).toLocaleString('ru-RU')}</b><small>монет BIOFARM</small></div><div class="metric"><div class="icon">🎮</div><b style="font-size:15px;margin-top:16px;letter-spacing:0">PUBG</b><small>${esc(pubg)}</small></div></div>
    ${section('Задание','ПРОГРЕСС')}${questCard(s.quest)}<div class="card"><div class="card-head"><strong>Твои следующие шаги</strong><span class="stamp">В ПРИЛОЖЕНИИ</span></div><p>Открой BIOFARM, получи награды недели и собери команду для игры.</p><div class="actions"><button class="secondary" data-tab="farm">В ферму</button><button class="secondary" data-tab="clan">Цели клана</button></div></div>`;}
  function farm(screen) {
    const visual=screen.visual||{};
    const level=Math.max(1,Number(screen.level)||1);
    const stage=Math.max(1,Math.min(10,Math.floor(Number(visual.stage)||Math.min(10,Math.ceil(level/5)))));
    const ready=Math.max(0,Math.floor(Number(visual.ready)||0));
    const capacity=Math.max(1,Math.floor(Number(visual.capacity)||2));
    const fill=Math.max(0,Math.min(100,Math.round(ready/capacity*100)));
    const isHome=screen.view==='farm:home';
    const crop=visual.crop||'Твоя культура';
    const stageName=visual.stage_name||`Сектор ${stage}`;
    const next=visual.next_ready_at?`Следующий сбор: ${fmt(visual.next_ready_at)}`:'Урожай растёт на твоей ферме';
    const buttons=(screen.buttons||[]).map(button=>`<button type="button" class="${button.action==='farm:collect'?'primary':'secondary'}" data-farm-${button.kind==='view'?'view':'action'}="${esc(button.action)}">${esc(button.text)}</button>`).join('');
    const lines=String(screen.text||'').split(/\n+/).map(value=>value.trim()).filter(Boolean);
    const report=lines.map((value,index)=>`<p class="farm-line ${index===0?'farm-line-title':''}">${esc(value)}</p>`).join('');
    return `<div class="farm-intro"><div class="eyebrow">BIOFARM · ТВОЙ СЕКТОР</div><h1 class="heading">Ферма <span>жива.</span></h1><p class="subheading">Расти, собирай урожай и открывай новые стадии.</p></div>
      <div class="farm-scene"><img class="farm-scene-art" src="./art/stages/stage_${stage}.jpg" alt="Ферма SKVERNA, стадия ${stage}" loading="eager" decoding="async">
        <div class="farm-scene-caption"><div class="farm-scene-top"><span class="farm-scene-tag">✦ СТАДИЯ ${esc(visual.total_stage||stage)}</span><span class="farm-scene-level">УРОВЕНЬ ${esc(level)}</span></div>
        <div class="farm-scene-bottom"><span>ТВОЙ БИОСЕКТОР</span><strong>${esc(stageName)}</strong></div></div></div>
      <div class="farm-dashboard"><div class="farm-stat"><small>БАЛАНС</small><strong>${Number(screen.sc||0).toLocaleString('ru-RU')}</strong><span>SC · монеты</span></div><div class="farm-stat"><small>ПЕРЕРОЖДЕНИЯ</small><strong>✦ ${esc(screen.stars||0)}</strong><span>постоянный буст</span></div></div>
      <div class="farm-storage"><div class="farm-storage-head"><div><small>🌿 ${esc(crop)}</small><strong>${ready?`Готово ${ready} из ${capacity}`:'Урожай растёт'}</strong></div><img src="./art/harvest.svg" alt="" loading="lazy"></div><div class="farm-storage-track"><i style="width:${fill}%"></i></div><p>${esc(next)}</p></div>
      ${isHome?`<div class="farm-actions">${buttons}</div><details class="farm-report"><summary>Подробности фермы <span>⌄</span></summary><div class="farm-report-body">${report}</div></details>`:
      `<div class="farm-report farm-report-open"><div class="farm-report-body">${report}</div></div><div class="farm-actions">${buttons}</div>`}`;
  }
  function clan(week) {
    const stages=(week.stages||[]).map(item=>{
      const claimed=week.claimed?.includes(item.stage);
      const ready=week.claimable&&!claimed&&week.total>=item.clan&&week.personal>=item.personal;
      const percent=Math.max(0,Math.min(100,100*week.total/item.clan));
      return `<div class="weekly-stage ${claimed?'complete':''}"><div class="stage-head"><strong>${claimed?'✅':ready?'🎁':'🔒'} Этап ${esc(item.stage)}</strong><small>от ${esc(item.base_sc)} SC</small></div><div class="track"><i style="width:${percent}%"></i></div><small>Клан ${esc(week.total)}/${esc(item.clan)} · ты ${esc(week.personal)}/${esc(item.personal)}</small>${ready?`<button class="primary" data-weekly-claim="${esc(item.stage)}">Забрать награду</button>`:''}</div>`;
    }).join('');
    const sources={quests:'Победы',contracts:'Контракты',harvests:'Урожай',complex:'Комплекс',events:'События'};
    const contributions=Object.entries(sources).map(([key,name])=>`<li><span>${name}</span><b>${esc(week.breakdown?.[key]||0)}</b></li>`).join('');
    const leaders=(week.board||[]).map(([name,score],index)=>`<li><span>${index+1}. ${esc(name)}</span><b>${esc(score)}</b></li>`).join('')||'<li>Первые участники скоро появятся.</li>';
    return `${title('ОБЩАЯ ЦЕЛЬ','Клан —','вместе.','Играй, собирай урожай и получай SC за общий прогресс.')}
      <div class="progress-block"><div class="mini-label">НЕДЕЛЯ С ${esc(week.week_key)} · ДО ${esc(week.ends_on)}</div><div class="value">${esc(week.total)} <small>/ ${esc(week.stages?.at(-1)?.clan||250)}</small></div><p>Твой вклад: ${esc(week.personal)} очк.</p></div>
      <button class="secondary week-switch" data-weekly-toggle="1">${previousWeek?'← Текущая неделя':'Посмотреть прошлую неделю →'}</button>
      ${section('Награды','ЭТАПЫ')}${stages}
      ${section('Твой вклад','ИСТОЧНИКИ')}<div class="card"><ul class="weekly-list">${contributions}</ul></div>
      ${section('Лидеры','ЭТА НЕДЕЛЯ')}<div class="card"><ul class="weekly-list">${leaders}</ul></div>`;
  }
  function render() {
    if(page==='farm'||page==='clan'){
      nav.hidden=false;
      app.classList.remove('screen-enter');void app.offsetWidth;app.classList.add('screen-enter');
      app.innerHTML=(demo?'<span class="demo-badge">ДЕМО · без записи данных</span>':'')+(page==='farm'?farm(data):clan(data))+`<div style="text-align:center;padding:12px 0"><button class="refresh" data-action="refresh">↻ Обновить данные</button></div>`;
      app.querySelector('.farm-scene-art')?.addEventListener('error',event=>{
        event.currentTarget.src='./art/farm-sector.svg';
      },{once:true});
      return;
    }
    const s=data?.snapshot;
    if(!s?.member){gate('Вход для участников','Живые составы, события и прогресс открываются после вступления в основной чат SKVERNA. Напиши администрации клана.');return;}
    nav.hidden=false;
    const content={today,play,events,progress}[page](s);
    app.classList.remove('screen-enter');void app.offsetWidth;app.classList.add('screen-enter');
    app.innerHTML=(demo?'<span class="demo-badge">ДЕМО · без записи данных</span>':'')+content+`<div style="text-align:center;padding:12px 0"><button class="refresh" data-action="refresh">↻ Обновить данные</button></div>`;
  }
  async function action(button) {
    if(busy)return;
    if(demo){notify('Это демонстрация. Запись работает в Telegram.');return;}
    busy=true;button.disabled=true;buzz();
    try {
      const type=button.dataset.action;
      if(type==='join')await api('api/play/join',{mode:button.dataset.mode});
      if(type==='leave')await api('api/play/leave',{});
      if(type==='subscription')await api('api/play/subscription',{mode:button.dataset.mode});
      if(type==='rsvp')await api(`api/events/${Number(button.dataset.event)}/rsvp`,{status:button.dataset.status});
      await load();
      if(type!=='refresh')notify('Готово, данные обновлены');
    } catch(error){notify(error.message);button.disabled=false;}
    finally {busy=false;}
  }
  async function farmAction(button) {
    if(busy)return;
    if(demo){notify('Это демонстрация. Запись работает в Telegram.');return;}
    const value=button.dataset.farmAction;
    if(value.startsWith('farm:prestige:confirm:')&&!window.confirm('Перерождение сбросит уровень, SC и большинство улучшений. Продолжить?'))return;
    if(value.startsWith('farm:workerfire:')&&!window.confirm('Уволить сотрудника?'))return;
    busy=true;button.disabled=true;buzz();
    try {
      const result=await api('api/farm/action',{view:farmView,action:value});
      farmView=result.view;
      await load('farm');
      notify(result.message);
      if(result.ok&&value==='farm:collect')celebrate('УРОЖАЙ СОБРАН');
    }catch(error){notify(error.message);button.disabled=false;}
    finally{busy=false;}
  }
  async function weeklyClaim(button) {
    if(busy)return;
    if(demo){notify('Это демонстрация. Запись работает в Telegram.');return;}
    busy=true;button.disabled=true;buzz();
    try {
      const result=await api('api/weekly/claim',{week_key:data.week_key,stage:Number(button.dataset.weeklyClaim)});
      await load('clan');
      notify(result.message);
      if(result.ok)celebrate('НАГРАДА ТВОЯ','./art/quest.svg');
    }catch(error){notify(error.message);button.disabled=false;}
    finally{busy=false;}
  }
  document.addEventListener('click',event=>{
    const tab=event.target.closest('[data-tab]');
    if(tab){if(tab.dataset.tab!==page){buzz();window.scrollTo({top:0,behavior:'smooth'});}load(tab.dataset.tab);return;}
    const view=event.target.closest('[data-farm-view]');
    if(view){farmView=view.dataset.farmView;load('farm');return;}
    const farmButton=event.target.closest('[data-farm-action]');
    if(farmButton){farmAction(farmButton);return;}
    const weekButton=event.target.closest('[data-weekly-claim]');
    if(weekButton){weeklyClaim(weekButton);return;}
    const weekToggle=event.target.closest('[data-weekly-toggle]');
    if(weekToggle){previousWeek=!previousWeek;load('clan');return;}
    const button=event.target.closest('[data-action]');
    if(button?.dataset.action==='reconnect'){retryAttempt=0;load();return;}
    if(button)action(button);
  });
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&offline)load();});
  if(!demo&&!tg?.initData){gate('SKVERNA OS','Открой Mini App из меню нашего Telegram-бота, чтобы войти в свой профиль.');return;}
  try{tg?.ready();tg?.expand();tg?.setHeaderColor('#080b0a');tg?.setBackgroundColor('#080b0a');}catch(_){}
  load();
})();
