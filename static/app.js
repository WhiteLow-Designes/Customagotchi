/* Customagotchi frontend – framework-free, accessible and PWA-ready. */
'use strict';

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const esc = (value = '') => String(value).replace(/[&<>'"]/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[ch]));
const fmtDate = value => new Intl.DateTimeFormat('de-DE', {day:'2-digit', month:'short', year:'numeric'}).format(new Date(value));
const fmtTime = value => new Intl.RelativeTimeFormat('de', {numeric:'auto'}).format(-Math.max(0, Math.round((Date.now() - new Date(value)) / 3600000)), 'hour');
const avatarIcons = {spark:'✦', leaf:'♧', moon:'☾', comet:'☄'};
const membershipNames = {free:'Free', plus:'Plus', premium:'Premium', elite:'Elite', legend:'Legend'};
const stageNames = {egg:'Ei', baby:'Baby', child:'Kind', teen:'Jugendlich', adult:'Erwachsen', senior:'Senior', ascended:'Weiterentwickelt'};
const categoryNames = {food:'Futter', drink:'Getränke', medicine:'Medizin', hygiene:'Hygiene', toy:'Spielzeug', clothing:'Kleidung', decoration:'Dekoration', training:'Training', seasonal:'Saisonal'};
const speciesNames = {hamster:'Hamster', cat:'Katze', dog:'Hund', dino:'Dino', alien:'Alien'};

const state = {
  user: null, pet: null, csrf: null, species: {}, tournaments: [], leaders: [],
  achievements: [], notifications: [], events: [], items: [], activeFilter: 'all', busy: false,
};

function initialTheme() {
  const saved = localStorage.getItem('customagotchi-theme');
  return saved === 'light' || saved === 'dark' ? saved : 'dark';
}

function applyTheme(theme, persist = true) {
  const safe = theme === 'light' ? 'light' : 'dark';
  document.documentElement.dataset.theme = safe;
  document.querySelector('meta[name="theme-color"]').content = safe === 'dark' ? '#090c18' : '#f4f7fb';
  const toggle = $('#theme-toggle');
  if (toggle) {
    toggle.setAttribute('aria-pressed', String(safe === 'light'));
    toggle.setAttribute('aria-label', safe === 'dark' ? 'Zum White-Mode wechseln' : 'Zum Dark-Mode wechseln');
    toggle.title = safe === 'dark' ? 'White-Mode' : 'Dark-Mode';
  }
  if (persist) localStorage.setItem('customagotchi-theme', safe);
}

applyTheme(initialTheme(), false);

async function api(path, options = {}) {
  const headers = {'Accept':'application/json', ...(options.headers || {})};
  if (options.body && typeof options.body !== 'string') {
    headers['Content-Type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  if (options.method && options.method !== 'GET' && state.csrf) headers['X-CSRF-Token'] = state.csrf;
  const response = await fetch(path, {...options, headers, credentials:'same-origin'});
  let data;
  try { data = await response.json(); } catch { data = {}; }
  if (!response.ok) {
    const error = new Error(data.error?.message || 'Die Anfrage ist fehlgeschlagen.');
    error.code = data.error?.code; error.details = data.error?.details;
    if (response.status === 401 && !path.includes('/auth/')) resetSession();
    throw error;
  }
  return data;
}

function resetSession() {
  state.user = state.pet = state.csrf = null;
  document.body.classList.remove('authenticated');
  updateHeader();
}

function toast(message, type = 'success') {
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<i aria-hidden="true">${type === 'error' ? '!' : '✓'}</i><p>${esc(message)}</p>`;
  $('#toast-region').append(el);
  setTimeout(() => el.remove(), 4300);
}

function showError(error) {
  const text = error.details?.length ? `${error.message} ${error.details.join(' · ')}` : error.message;
  toast(text || 'Das hat leider nicht funktioniert.', 'error');
}

function setBusy(value) {
  state.busy = value;
  $$('button[data-action], button[type="submit"]').forEach(button => button.disabled = value);
}

function updateHeader() {
  const loggedIn = Boolean(state.user);
  $('#login-button').classList.toggle('is-hidden', loggedIn);
  $('#register-button').classList.toggle('is-hidden', loggedIn);
  $('#profile-button').classList.toggle('is-hidden', !loggedIn);
  $('#notification-button').classList.toggle('is-hidden', !loggedIn);
  $('#mobile-dock').classList.toggle('is-hidden', !loggedIn);
  document.body.classList.toggle('authenticated', loggedIn);
  if (loggedIn) {
    $('#header-username').textContent = state.user.username;
    $('#header-membership').textContent = membershipNames[state.user.membership];
    $('#header-avatar').textContent = avatarIcons[state.user.avatar] || '✦';
    const unread = state.notifications.some(n => !n.read_at);
    $('#notification-dot').classList.toggle('is-hidden', !unread);
  }
}

function route() { return (location.hash || '#home').slice(1).split('?')[0]; }
function setActiveNav(current) {
  $$('[data-route-link]').forEach(link => link.classList.toggle('active', link.dataset.routeLink === current));
}

async function bootstrap() {
  try {
    const data = await api('/api/bootstrap');
    Object.assign(state, data);
    if (state.user) {
      document.body.classList.add('authenticated');
      applyTheme(state.user.theme);
      try {
        const me = await api('/api/me');
        Object.assign(state, me);
      } catch (error) { console.warn(error); }
    }
    updateHeader();
    $('#loading-view').classList.add('is-hidden');
    await renderRoute();
  } catch (error) {
    $('#loading-view').innerHTML = `<div class="empty-state"><i>☁</i><h2>Die Welt ist gerade nicht erreichbar</h2><p>${esc(error.message)}</p><button class="button button-primary" data-action="reload">Erneut versuchen</button></div>`;
  }
}

async function renderRoute() {
  const current = route();
  setActiveNav(current);
  $('#primary-nav').classList.remove('open');
  $('#menu-button').setAttribute('aria-expanded', 'false');
  const renderers = {
    home: renderHome, game: renderGame, care: renderCare, inventory: renderInventory,
    shop: renderShop, minigames: renderMinigames, tournaments: renderTournaments,
    leaderboard: renderLeaderboard, achievements: renderAchievements, memberships: renderMemberships,
    rules: renderRules, profile: renderProfile, admin: renderAdmin, privacy: renderPrivacy,
  };
  const renderer = renderers[current] || renderNotFound;
  $('#view').classList.remove('view'); void $('#view').offsetWidth; $('#view').classList.add('view');
  try { await renderer(); } catch (error) { showError(error); renderError(error); }
  window.scrollTo({top:0, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth'});
}

function petSvg(species = 'hamster', color = 'coral', eyes = '#7ee7ff', pattern = 'stardust', extraClass = '') {
  const colors = {coral:['#ff8f87','#da596f'], mint:['#76efc2','#2dba93'], violet:['#b09aff','#7459dc'], gold:['#ffd46f','#d99a32'], sky:['#78d9ff','#448cd8']};
  const [body, shade] = colors[color] || colors.coral;
  const dots = pattern === 'plain' ? '' : `<g fill="rgba(255,255,255,.34)"><circle cx="118" cy="95" r="8"/><circle cx="215" cy="138" r="6"/><circle cx="154" cy="202" r="5"/></g>`;
  const face = `<ellipse cx="135" cy="139" rx="13" ry="17" fill="#10162b"/><ellipse cx="205" cy="139" rx="13" ry="17" fill="#10162b"/><circle cx="139" cy="134" r="4" fill="${esc(eyes)}"/><circle cx="209" cy="134" r="4" fill="${esc(eyes)}"/><path d="M155 172q15 13 30 0" fill="none" stroke="#10162b" stroke-width="7" stroke-linecap="round"/>`;
  const base = `class="pet-illustration ${extraClass}" viewBox="0 0 340 340" role="img" aria-label="${speciesNames[species] || 'Customagotchi'} Illustration"`;
  if (species === 'cat') return `<svg ${base}><defs><linearGradient id="catBody" x2="1" y2="1"><stop stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></linearGradient></defs><path d="M72 111 85 40l65 48q22-7 42 0l64-48 12 72q28 36 19 95-10 71-116 86-103-15-115-85-9-57 16-97Z" fill="url(#catBody)"/><path d="m87 58 10 46 30-18Z" fill="${shade}"/><path d="m250 58-9 46-30-18Z" fill="${shade}"/>${dots}${face}<path d="M118 180 54 169m68 31-67 9m166-29 65-11m-68 31 67 9" stroke="#10162b" stroke-width="5" stroke-linecap="round" opacity=".6"/><path d="M153 159q17-12 34 0l-17 13Z" fill="#ffcfda"/></svg>`;
  if (species === 'dog') return `<svg ${base}><defs><linearGradient id="dogBody" x2="1" y2="1"><stop stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></linearGradient></defs><path d="M88 100q-57-43-63 31 8 73 69 55m158-86q57-43 63 31-8 73-69 55" fill="${shade}" stroke="#10162b" stroke-opacity=".12" stroke-width="5"/><path d="M73 120Q89 61 170 61t97 59q28 58-1 116-30 56-96 58-66-2-96-58-28-58-1-116Z" fill="url(#dogBody)"/>${dots}${face}<ellipse cx="170" cy="170" rx="21" ry="14" fill="#10162b"/><path d="M169 184v20m0 0q-20 21-37 0m37 0q20 21 38 0" fill="none" stroke="#10162b" stroke-width="7" stroke-linecap="round"/><path d="M142 232q27 17 55 0" fill="none" stroke="#ff9aa9" stroke-width="10" stroke-linecap="round"/></svg>`;
  if (species === 'dino') return `<svg ${base}><defs><linearGradient id="dinoBody" x2="1" y2="1"><stop stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></linearGradient></defs><path d="M100 85 85 31l48 36 15-57 34 54 33-48 8 64" fill="${shade}"/><path d="M78 115q32-60 113-49 64 7 87 66 18 47-4 99-25 58-101 65-75-8-100-67-22-54 5-114Z" fill="url(#dinoBody)"/>${dots}${face}<path d="M144 184q26 13 51-1" fill="none" stroke="#10162b" stroke-width="7" stroke-linecap="round"/><path d="M253 207q69 14 50 65-31-23-65-10" fill="${shade}"/><path d="M102 282 86 315m151-31 17 31" stroke="#10162b" stroke-opacity=".3" stroke-width="18" stroke-linecap="round"/></svg>`;
  if (species === 'alien') return `<svg ${base}><defs><linearGradient id="alienBody" x2="1" y2="1"><stop stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></linearGradient></defs><path d="M119 77Q102 9 72 24" fill="none" stroke="${body}" stroke-width="9" stroke-linecap="round"/><circle cx="69" cy="25" r="12" fill="${eyes}"/><path d="M221 77Q239 9 268 24" fill="none" stroke="${body}" stroke-width="9" stroke-linecap="round"/><circle cx="271" cy="25" r="12" fill="${eyes}"/><path d="M66 131Q76 61 170 59t105 72q13 84-29 137-31 38-76 38t-76-38Q53 214 66 131Z" fill="url(#alienBody)"/>${dots}<ellipse cx="127" cy="145" rx="25" ry="35" fill="#10162b"/><ellipse cx="213" cy="145" rx="25" ry="35" fill="#10162b"/><circle cx="134" cy="137" r="8" fill="${esc(eyes)}"/><circle cx="220" cy="137" r="8" fill="${esc(eyes)}"/><path d="M147 207q23 20 46 0" fill="none" stroke="#10162b" stroke-width="8" stroke-linecap="round"/><circle cx="170" cy="97" r="6" fill="${eyes}" opacity=".8"/></svg>`;
  return `<svg ${base}><defs><linearGradient id="hamBody" x2="1" y2="1"><stop stop-color="${body}"/><stop offset="1" stop-color="${shade}"/></linearGradient></defs><circle cx="88" cy="93" r="48" fill="${shade}"/><circle cx="252" cy="93" r="48" fill="${shade}"/><circle cx="88" cy="93" r="28" fill="#ffc5bd"/><circle cx="252" cy="93" r="28" fill="#ffc5bd"/><path d="M59 156Q70 66 170 65t111 91q17 90-35 132-31 25-76 25t-76-25Q42 246 59 156Z" fill="url(#hamBody)"/>${dots}${face}<ellipse cx="170" cy="171" rx="15" ry="11" fill="#ffccd2"/><path d="M170 183v13m0 0q-16 17-30 1m30-1q16 17 31 1" fill="none" stroke="#10162b" stroke-width="6" stroke-linecap="round"/><ellipse cx="104" cy="185" rx="19" ry="12" fill="#ffb5b8" opacity=".5"/><ellipse cx="236" cy="185" rx="19" ry="12" fill="#ffb5b8" opacity=".5"/></svg>`;
}

function renderHome() {
  const speciesCards = Object.entries(state.species).map(([key, s]) => {
    const level = Math.ceil(s.range[1] / 10);
    return `<article class="species-card" data-action="species-info" data-species="${key}" tabindex="0">
      <span class="tag">Level ${s.range[0]}–${s.range[1]}</span>${petSvg(key, ['coral','mint','sky','gold','violet'][level - 1])}
      <h3>${esc(s.name)}</h3><p>${esc(s.mode)}-Mode</p><div class="difficulty-dots">${[1,2,3,4,5].map(i => `<i class="${i <= level ? 'on' : ''}"></i>`).join('')}</div>
    </article>`;
  }).join('');
  $('#view').innerHTML = `
    <section class="hero">
      <div class="hero-copy"><p class="eyebrow">Dein virtuelles Wesen</p><h1>Ein kleines Leben.<span>Ganz nach dir.</span></h1>
        <p>Pflege, trainiere und begleite ein einzigartiges Customagotchi. Jede Entscheidung formt seinen Charakter, seine Entwicklung und eure gemeinsame Geschichte.</p>
        <div class="hero-actions"><button class="button button-primary" data-action="hero-start">${state.user ? 'Zu meinem Gotchi' : 'Kostenlos entdecken'} <span>→</span></button><a class="button button-ghost" href="#rules">So funktioniert’s</a></div>
        <div class="hero-trust"><span>Fair & nachvollziehbar</span><span>Lebt auch offline weiter</span><span>Ohne Pay-to-Win</span></div>
      </div>
      <div class="hero-stage" aria-label="Ein schimmerndes Customagotchi-Ei"><div class="hero-orbit"></div><div class="egg-shell"><div class="egg-face"><i class="egg-speck s1"></i><i class="egg-speck s2"></i><i class="egg-speck s3"></i><span class="egg-smile"></span></div></div><div class="floating-note note-one"><i>♡</i>Bindung wächst</div><div class="floating-note note-two"><i>✦</i>5 eigene Arten</div><div class="floating-note note-three"><i>◌</i>Lebendige Welt</div></div>
    </section>
    <section class="stats-band"><div class="stats-band-inner"><article><strong>5</strong><span>einzigartige Arten</span></article><article><strong>20+</strong><span>lebendige Bedürfnisse</span></article><article><strong>8</strong><span>Entwicklungsphasen</span></article><article><strong>∞</strong><span>eigene Geschichten</span></article></div></section>
    <section class="page-shell"><div class="section-head"><div><p class="eyebrow">Wähle deinen Weg</p><h2>Fünf Wesen. Fünf Herausforderungen.</h2></div><p>Vom einsteigerfreundlichen Hamster bis zum kompromisslos fairen Turnier-Alien.</p></div><div class="species-grid">${speciesCards}</div>
      <div class="section-head section-spacing"><div><p class="eyebrow">Mehr als nur füttern</p><h2>Eine Welt, die sich erinnert.</h2></div></div>
      <div class="feature-grid"><article class="card feature-card"><i class="feature-icon">◷</i><h3>Lebt auch offline</h3><p>Zeit wird beim Wiederkommen genau einmal und nachvollziehbar nachberechnet.</p></article><article class="card feature-card"><i class="feature-icon">⌁</i><h3>Deine Entscheidungen zählen</h3><p>Pflege, Training und Persönlichkeit öffnen unterschiedliche Entwicklungswege.</p></article><article class="card feature-card"><i class="feature-icon">♜</i><h3>Faire Turniere</h3><p>Serverseitige Prüfungen schützen Ranglisten, Ergebnisse und Belohnungen.</p></article><article class="card feature-card"><i class="feature-icon">◇</i><h3>Sammeln & gestalten</h3><p>Kleidung, Dekoration und seltene Gegenstände machen euer Zuhause einzigartig.</p></article><article class="card feature-card"><i class="feature-icon">☄</i><h3>Saisons & Erfolge</h3><p>Neue Herausforderungen, saisonale Belohnungen und bleibende Erinnerungen.</p></article><article class="card feature-card"><i class="feature-icon">◎</i><h3>Überall zuhause</h3><p>Responsiv, installierbar und gut bedienbar auf Smartphone, Tablet und Desktop.</p></article></div>
      <article class="card cta-panel section-spacing"><p class="eyebrow">Bereit zum Schlüpfen?</p><h2>Deine gemeinsame Geschichte beginnt jetzt.</h2><p>Entdecke die Vorschau kostenlos. Ein eigenes Customagotchi ist ab Plus verfügbar.</p><button class="button button-primary" data-action="hero-start">${state.user ? 'Weiter zur Welt' : 'Kostenloses Konto erstellen'}</button></article>
    </section>`;
}

function requireLoginView(title = 'Dein Customagotchi wartet') {
  $('#view').innerHTML = `<section class="page-shell narrow-shell"><div class="card empty-state"><i>🥚</i><h2>${esc(title)}</h2><p>Melde dich an oder erstelle ein kostenloses Konto, um deine persönliche Welt zu öffnen.</p><button class="button button-primary" data-action="open-login">Anmelden</button> <button class="button button-ghost" data-action="open-register">Konto erstellen</button></div></section>`;
}

function renderGame() {
  if (!state.user) return requireLoginView();
  if (!state.pet) {
    if (state.user.membership === 'free') return renderUpgradeGate();
    return renderCreator();
  }
  const p = state.pet, s = p.stats;
  const vitals = [
    ['hunger','Sättigung','🍓',s.hunger], ['thirst','Flüssigkeit','💧',s.thirst], ['health','Gesundheit','♡',s.health], ['hygiene','Hygiene','✦',s.hygiene], ['energy','Energie','⚡',s.energy], ['mood','Stimmung','☻',s.mood]
  ];
  const low = vitals.filter(v => v[3] < 32).sort((a,b) => a[3]-b[3])[0];
  const speech = s.is_sleeping ? 'Pssst … ich träume gerade von Sternen.' : low ? `${low[1]} braucht bald deine Aufmerksamkeit.` : `Schön, dass du da bist! Was machen wir heute?`;
  $('#view').innerHTML = `<section class="page-shell"><div class="dashboard-head"><div><p class="eyebrow">${stageNames[p.stage]} · Tag ${Math.floor(s.age_days) + 1}</p><h1>Willkommen zurück, ${esc(state.user.username)}.</h1><p>${esc(p.name)} hat dich schon erwartet.</p></div><div class="wallet"><i>◈</i><span>${state.user.coins.toLocaleString('de-DE')}</span> Lunaris</div></div>
    <div class="game-layout"><article class="room-card ${s.light_on ? '' : 'lights-off'}"><div class="room-stars"></div><div class="room-window"></div><div class="room-shelf"></div><div class="room-rug"></div><div class="pet-speech">${esc(speech)}</div><div class="pet-stage ${s.is_sleeping ? 'sleeping' : ''}">${petSvg(p.species,p.color,p.eye_color,p.pattern)}</div><div class="room-toolbar"><div class="room-toolbar-group"><button class="icon-button" data-action="care" data-care="light" title="Licht umschalten">☼</button><button class="icon-button" data-action="open-decor" title="Zimmer gestalten">◇</button></div><div class="room-toolbar-group"><a class="button button-small button-ghost" href="#care">Alle Aktionen</a><a class="button button-small button-primary" href="#minigames">Spielen</a></div></div></article>
      <aside class="pet-sidebar"><section class="card pet-summary"><div class="pet-summary-head"><h2>${esc(p.name)}<small>${speciesNames[p.species]} · ${stageNames[p.stage]} · Level ${Math.floor(s.experience / 25) + 1}</small></h2><div class="level-ring" style="--progress:${s.experience % 25 / 25 * 100}%"><span>${Math.floor(s.experience / 25)+1}</span></div></div><div class="vitals">${vitals.map(vitalRow).join('')}</div><div class="quick-actions"><button class="action-button" data-action="care" data-care="feed"><i>🍓</i>Füttern</button><button class="action-button" data-action="care" data-care="water"><i>💧</i>Trinken</button><button class="action-button" data-action="care" data-care="${s.is_sleeping ? 'wake':'sleep'}"><i>${s.is_sleeping ? '☀':'☾'}</i>${s.is_sleeping ? 'Wecken':'Schlafen'}</button><button class="action-button" data-action="care" data-care="pet"><i>♡</i>Streicheln</button></div></section>
      ${low ? `<section class="card need-alert"><i>${low[2]}</i><div><strong>${low[1]} ist niedrig</strong><p>Ein Wert von ${Math.round(low[3])}% sollte bald versorgt werden.</p></div></section>` : `<section class="card need-alert"><i>🌿</i><div><strong>Alles im grünen Bereich</strong><p>${esc(p.name)} fühlt sich gerade gut versorgt.</p></div></section>`}
      <section class="card card-pad"><div class="section-head"><div><h2 class="section-title">Letzte Momente</h2></div><button class="text-button" data-action="load-events">Aktualisieren</button></div><div class="activity-list" id="activity-list">${state.events.length ? activityMarkup() : '<p class="muted">Noch keine Momente aufgezeichnet.</p>'}</div></section></aside></div></section>`;
  if (!state.events.length) loadEvents();
}

function vitalRow([key,label,icon,value]) {
  const danger = value < 25, warn = value < 50;
  return `<div class="vital-row"><span aria-hidden="true">${icon}</span><label>${label}</label><output>${Math.round(value)}%</output><div class="meter" role="meter" aria-label="${label}" aria-valuenow="${Math.round(value)}" aria-valuemin="0" aria-valuemax="100"><span style="--value:${value}%;--bar:${danger?'var(--danger)':warn?'var(--warning)':'var(--primary)'}"></span></div></div>`;
}

function activityMarkup() { return state.events.slice(0,5).map(e => `<div class="activity-item"><i>${e.kind === 'care' ? '♡' : e.kind === 'item' ? '◇' : '◷'}</i><div><p>${esc(e.summary)}</p><time datetime="${esc(e.created_at)}">${fmtTime(e.created_at)}</time></div></div>`).join(''); }
async function loadEvents() { try { const data=await api('/api/events'); state.events=data.events; const list=$('#activity-list'); if(list) list.innerHTML=activityMarkup(); } catch(e){showError(e);} }

function renderUpgradeGate() {
  $('#view').innerHTML = `<section class="page-shell narrow-shell"><div class="card empty-state"><i>✦</i><span class="tag tag-purple">Plus erforderlich</span><h2>Bereit für dein eigenes Customagotchi?</h2><p>Als Free-Mitglied kannst du Arten, Regeln und Turniere entdecken. Ab Plus zieht dein eigenes Wesen ein – inklusive vollständiger Pflege, Inventar und Minispiele.</p><a class="button button-primary" href="#memberships">Mitgliedschaften vergleichen</a> <a class="button button-ghost" href="#home">Vorschau ansehen</a></div></section>`;
}

function renderCreator() {
  $('#view').innerHTML = `<section class="page-shell"><div class="section-head"><div><p class="eyebrow">Ein neues Leben</p><h2>Gestalte dein Customagotchi.</h2><p>Art und Schwierigkeit sind nach dem Schlüpfen dauerhaft. Alle anderen Details gehören dir.</p></div></div><form id="creator-form" class="creator-layout"><div class="card card-pad"><div class="field-row"><label class="field">Art<select name="species" id="creator-species">${Object.entries(state.species).map(([k,v])=>`<option value="${k}">${v.name} · ${v.mode}</option>`).join('')}</select></label><label class="field">Name<input name="name" minlength="2" maxlength="20" required placeholder="z. B. Lumi"></label></div><div class="field-row"><label class="field">Identität<select name="gender"><option value="neutral">Geschlechtsneutral</option><option value="female">Weiblich</option><option value="male">Männlich</option></select></label><label class="field">Persönlichkeit<select name="personality"><option value="curious">Neugierig</option><option value="brave">Mutig</option><option value="gentle">Sanft</option><option value="playful">Verspielt</option><option value="clever">Clever</option></select></label></div><label class="field">Farbwelt<div class="swatches">${[['coral','#ff8f87'],['mint','#76efc2'],['violet','#b09aff'],['gold','#ffd46f'],['sky','#78d9ff']].map(([k,c],i)=>`<button type="button" class="swatch ${i?'':'selected'}" style="--swatch:${c}" data-action="select-color" data-color="${k}" aria-label="${k}"></button>`).join('')}</div><input type="hidden" name="color" value="coral"></label><div class="field-row"><label class="field">Muster<select name="pattern" id="creator-pattern"><option value="stardust">Sternenstaub</option><option value="spots">Tupfen</option><option value="stripes">Streifen</option><option value="plain">Einfarbig</option><option value="nebula">Nebula</option></select></label><label class="field">Augenfarbe<select name="eyeColor" id="creator-eyes"><option value="#7ee7ff">Polarblau</option><option value="#b8ff72">Limonengrün</option><option value="#ffcf70">Sonnengold</option><option value="#d8a4ff">Kosmosviolett</option><option value="#ff8e9e">Korallenrot</option></select></label></div><div class="field-row"><label class="field">Lieblingsfutter<input name="favoriteFood" maxlength="40" value="Beeren-Bowl"></label><label class="field">Schwierigkeit<input name="difficulty" id="creator-difficulty" type="range" min="0" max="10" value="5"><span class="field-hint" id="difficulty-label">Level 5 · Beginner</span></label></div><label class="check-row"><input type="checkbox" required> Ich weiß, dass die Art nach dem Schlüpfen nicht beliebig gewechselt werden kann.</label><button class="button button-primary button-wide" type="submit">Customagotchi erschaffen</button></div><div class="creator-preview"><div id="creator-pet">${petSvg('hamster')}</div></div></form></section>`;
}

function renderCare() {
  if (!state.user || !state.pet) return renderGame();
  const actions = [
    ['feed','🍓','Füttern','Sättigung & Stimmung'],['water','💧','Trinken geben','Flüssigkeit & Gesundheit'],[state.pet.stats.is_sleeping?'wake':'sleep',state.pet.stats.is_sleeping?'☀':'☾',state.pet.stats.is_sleeping?'Wecken':'Schlafen legen','Energie & Schlaf'],['bathe','🫧','Baden','Hygiene & Gesundheit'],['clean','🧹','Zimmer reinigen','Hygiene & Zufriedenheit'],['toilet','✨','Toilette säubern','Hygiene & Gesundheit'],['medicine','🧪','Medizin geben','Nur bei Symptomen'],['doctor','⚕','Arzt besuchen','Diagnose · 35 Lunaris'],['play','🎲','Spielen','Stimmung & Bindung'],['train','⚡','Trainieren','Fitness & Disziplin'],['pet','♡','Streicheln','Zuneigung & Ruhe'],['praise','✦','Loben','Zuneigung & Disziplin'],['scold','!','Ermahnen','Disziplin, etwas Stress'],['occupy','🔮','Beschäftigen','Intelligenz & Stimmung'],['walk','♧','Spazieren','Fitness & Sozialverhalten'],['light','☼','Licht umschalten','Raum & Schlafrhythmus']
  ];
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Pflegezentrum</p><h1 class="page-title">Was braucht <span class="gradient">${esc(state.pet.name)}</span>?</h1><p class="page-intro">Jede Aktion verändert echte Spielwerte. Beobachte die Signale und pflege mit Maß – zu viel ist nicht immer besser.</p><div class="care-grid">${actions.map(a=>`<button class="care-card" data-action="care" data-care="${a[0]}"><i>${a[1]}</i><strong>${a[2]}</strong><small>${a[3]}</small></button>`).join('')}</div><section class="card card-pad section-spacing"><div class="section-head"><div><h2>Alle Werte</h2><p>Positivwerte sollten hoch, Belastungen wie Langeweile, Stress und Krankheit niedrig sein.</p></div></div>${fullStatsMarkup(state.pet.stats)}</section></section>`;
}

function fullStatsMarkup(stats){
  const labels={hunger:'Sättigung',thirst:'Flüssigkeit',health:'Gesundheit',hygiene:'Hygiene',energy:'Energie',sleep:'Schlaf',happiness:'Zufriedenheit',mood:'Stimmung',boredom:'Langeweile',affection:'Zuneigung',stress:'Stress',illness:'Krankheit',fitness:'Fitness',discipline:'Disziplin',intelligence:'Intelligenz',social:'Sozialverhalten'};
  return `<div class="care-grid">${Object.entries(labels).map(([k,l])=>{const inverted=['boredom','stress','illness'].includes(k);const v=stats[k];const good=inverted?100-v:v;return `<div class="card card-pad"><strong>${l}</strong><div class="meter" style="margin-top:12px"><span style="--value:${v}%;--bar:${good<35?'var(--danger)':good<60?'var(--warning)':'var(--primary)'}"></span></div><small class="muted">${Math.round(v)} / 100</small></div>`}).join('')}</div>`;
}

async function loadItems(){const data=await api('/api/shop');state.items=data.items;if(state.user)state.user.coins=data.coins;updateHeader();}
async function renderInventory(){
  if(!state.user)return requireLoginView('Dein Inventar ist persönlich');
  if(!state.items.length) await loadItems();
  const owned=state.items.filter(i=>i.quantity>0 && (state.activeFilter==='all'||i.category===state.activeFilter));
  $('#view').innerHTML=`<section class="page-shell"><div class="dashboard-head"><div><p class="eyebrow">Deine Sammlung</p><h1 class="page-title">Inventar</h1><p class="page-intro">Verwende Verbrauchsgegenstände oder statte Kleidung und Dekoration aus.</p></div><div class="wallet"><i>◈</i>${state.user.coins.toLocaleString('de-DE')} Lunaris</div></div>${itemFilters()}<div class="item-grid">${owned.length?owned.map(i=>itemCard(i,'use')).join(''):`<div class="card empty-state"><i>◇</i><h2>Hier ist noch Platz</h2><p>Im Shop findest du Futter, Spielzeug und viele weitere Dinge.</p><a href="#shop" class="button button-primary">Zum Shop</a></div>`}</div></section>`;
}
async function renderShop(){
  if(!state.user)return requireLoginView('Der Shop ist für Mitglieder geöffnet');
  if(!state.items.length)await loadItems();
  const items=state.items.filter(i=>state.activeFilter==='all'||i.category===state.activeFilter);
  $('#view').innerHTML=`<section class="page-shell"><div class="dashboard-head"><div><p class="eyebrow">Versorgen & gestalten</p><h1 class="page-title">Lunaris-Shop</h1><p class="page-intro">Alles ist mit erspielbarer Währung erhältlich. Turniere bleiben fair und frei von Pay-to-Win.</p></div><div class="wallet"><i>◈</i>${state.user.coins.toLocaleString('de-DE')} Lunaris</div></div>${itemFilters()}<div class="item-grid">${items.map(i=>itemCard(i,'buy')).join('')}</div></section>`;
}
function itemFilters(){return `<div class="filter-bar"><button class="filter-button ${state.activeFilter==='all'?'active':''}" data-action="filter-items" data-filter="all">Alle</button>${Object.entries(categoryNames).map(([k,v])=>`<button class="filter-button ${state.activeFilter===k?'active':''}" data-action="filter-items" data-filter="${k}">${v}</button>`).join('')}</div>`;}
function itemCard(i,mode){const locked=state.user&&membershipRank(state.user.membership)<membershipRank(i.min_membership);return `<article class="card item-card rarity-${i.rarity}">${i.quantity?`<span class="quantity">${i.quantity}</span>`:''}<div class="item-emoji">${i.emoji}</div><span class="tag">${categoryNames[i.category]||i.category} · ${i.rarity}</span><h3>${esc(i.name)}</h3><p>${esc(i.description)}</p><div class="item-meta"><span class="price">${i.price} ◈</span><button class="button button-small ${locked?'button-ghost':'button-primary'}" data-action="${mode}-item" data-item="${i.id}" ${locked?'disabled':''}>${locked?i.min_membership.toUpperCase():mode==='buy'?'Kaufen':i.equipped?'Ausgerüstet':'Verwenden'}</button></div></article>`;}
function membershipRank(m){return {free:0,plus:1,premium:2,elite:3,legend:4}[m]||0;}

function renderTournaments(){
  const tournaments=state.tournaments; const first=tournaments[0];
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Faire Wettkämpfe</p><h1 class="page-title">Zeig, was in euch <span class="gradient">steckt.</span></h1><p class="page-intro">Pflege, Können und Strategie entscheiden. Jede Teilnahme wird serverseitig geprüft und transparent ausgewertet.</p>${first?`<article class="card tournament-feature"><div><span class="tag tag-success">Anmeldung offen</span><h2>${esc(first.name)}</h2><p>${esc(first.description)}</p><button class="button button-primary" data-action="register-tournament" data-tournament="${first.id}">Teilnahme prüfen & anmelden</button></div><div class="tournament-date"><strong>${new Date(first.starts_at).getDate()}</strong><span>${fmtDate(first.starts_at)}</span></div></article>`:''}<div class="section-head section-spacing"><div><h2>Kommende Turniere</h2><p>Jede Disziplin bewertet passende Werte und nachgewiesene Spielleistungen.</p></div></div><div class="tournament-list">${tournaments.map(t=>`<article class="card tournament-card"><span class="tag">${esc(t.type)}</span><h3>${esc(t.name)}</h3><p>${esc(t.description)}</p><div class="tournament-info"><div><small>Start</small><strong>${fmtDate(t.starts_at)}</strong></div><div><small>Anmeldung bis</small><strong>${fmtDate(t.registration_deadline)}</strong></div><div><small>Stufe</small><strong>Ab ${stageNames[t.min_stage]}</strong></div><div><small>Arten</small><strong>${t.allowed_species.length===5?'Alle':t.allowed_species.map(s=>speciesNames[s]).join(', ')}</strong></div></div><button class="button button-ghost button-wide" data-action="register-tournament" data-tournament="${t.id}">Teilnahme prüfen</button></article>`).join('')}</div><div class="notice section-spacing"><i>♜</i><div><strong>Teilnahmebedingungen</strong><p>Das Konto muss mindestens sieben Tage alt sein oder Premium, Elite bzw. Legend besitzen. Zusätzlich werden Accountstatus, Entwicklungsstufe, Gesundheit, Art und Manipulationssignale geprüft.</p></div></div></section>`;
}

function renderMinigames(){
  if(!state.user||!state.pet)return renderGame();
  const games=[['burrow','🕳️','Tunnel-Taktik','hamster','Merke dir schnelle Lichtsignale.'],['pounce','🧶','Samtpfoten-Sprung','cat','Triff die wandernden Wollfunken.'],['fetch','🦴','Sternen-Apport','dog','Sammle möglichst viele Kometen.'],['meteor','☄️','Meteor-Marsch','dino','Reagiere schnell auf sichere Pfade.'],['orbit','🪐','Orbital-Code','alien','Fange Signale aus fremden Umlaufbahnen.']];
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Training mit Spaß</p><h1 class="page-title">Minispiele</h1><p class="page-intro">Jede Art hat ihre Spezialdisziplin. Punkte, Dauer und Spielrunde werden serverseitig auf Plausibilität geprüft.</p><div class="game-grid">${games.map(g=>`<article class="card minigame-card"><div class="minigame-art">${g[1]}</div><span class="tag ${g[3]===state.pet.species?'tag-success':''}">${speciesNames[g[3]]} exklusiv</span><h3>${g[2]}</h3><p>${g[4]}</p><button class="button ${g[3]===state.pet.species?'button-primary':'button-ghost'} button-wide" data-action="start-game" data-game="${g[0]}" ${g[3]===state.pet.species?'': 'disabled'}>${g[3]===state.pet.species?'Spielen':'Andere Art'}</button></article>`).join('')}</div></section>`;
}

function renderLeaderboard(){
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Ranglisten</p><h1 class="page-title">Gemeinsam <span class="gradient">wachsen.</span></h1><p class="page-intro">Öffentliche Ranglisten zeigen nur Anzeigenamen und Spielwerte – niemals private Kontodaten.</p><div class="table-wrap"><table><thead><tr><th>Rang</th><th>Spieler</th><th>Customagotchi</th><th>Art</th><th>Stufe</th><th>Zufriedenheit</th><th>Fitness</th></tr></thead><tbody>${state.leaders.map((l,i)=>`<tr><td><strong>${i+1}</strong></td><td>${esc(l.username)}</td><td>${esc(l.name)}</td><td>${speciesNames[l.species]}</td><td>${stageNames[l.stage]}</td><td>${Math.round(l.happiness)}%</td><td>${Math.round(l.fitness)}%</td></tr>`).join('')}</tbody></table></div></section>`;
}

function renderAchievements(){
  if(!state.user)return requireLoginView('Erfolge gehören zu deinem Konto');
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Deine Meilensteine</p><h1 class="page-title">Erfolge</h1><p class="page-intro">Erinnerungen an besondere gemeinsame Momente – mit kleinen Lunaris-Belohnungen.</p><div class="feature-grid">${state.achievements.map(a=>`<article class="card feature-card" style="opacity:${a.unlocked_at?1:.55}"><i class="feature-icon">${a.icon}</i><span class="tag ${a.unlocked_at?'tag-success':''}">${a.unlocked_at?'Freigeschaltet':`+${a.reward} ◈`}</span><h3>${esc(a.name)}</h3><p>${esc(a.description)}</p>${a.unlocked_at?`<small class="muted">${fmtDate(a.unlocked_at)}</small>`:''}</article>`).join('')}</div></section>`;
}

function renderMemberships(){
  const plans=[['free','Free','0 €','Vorschau & Artenkunde','Regelwerk und Turnierinfos','Öffentliche Ranglisten'],['plus','Plus','4,90 €','Eigenes Customagotchi','Alle Pflegefunktionen','Inventar, Shop & Minispiele'],['premium','Premium','8,90 €','Alles aus Plus','Frühe Turnierteilnahme','Exklusive Kosmetik'],['legend','Legend','Lifetime','Alles aus Premium','Saisonale Sammlerstücke','Legend-Profil & Sonderturniere']];
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Mitgliedschaften</p><h1 class="page-title">Wähle, wie eure <span class="gradient">Reise</span> beginnt.</h1><p class="page-intro">Monatlich, jährlich oder Lifetime. Vorteile sparen Zeit und erweitern Kosmetik – Turnierergebnisse bleiben leistungsgerecht.</p><div class="plan-grid">${plans.map(p=>`<article class="card plan-card ${p[0]==='plus'?'featured':''}"><span class="tag ${p[0]==='plus'?'tag-success':''}">${p[0]==='plus'?'Beliebt':'Mitgliedschaft'}</span><h3>${p[1]}</h3><div class="plan-price">${p[2]} <small>${p[2].includes('€')&&p[0]!=='free'?'/ Monat':''}</small></div><ul>${p.slice(3).map(x=>`<li>${x}</li>`).join('')}</ul><button class="button ${p[0]==='plus'?'button-primary':'button-ghost'} button-wide" data-action="select-plan" data-plan="${p[0]}">${state.user?.membership===p[0]?'Aktueller Tarif':p[0]==='free'?'Kostenlos starten':'Tarif wählen'}</button></article>`).join('')}</div><div class="notice section-spacing"><i>✓</i><div><strong>Faire Spielbalance</strong><p>Kaufvorteile können Komfort und Kosmetik bieten, aber niemals manipulierte Werte oder garantierte Turniersiege.</p></div></div></section>`;
}

function renderRules(){
  const sections=[
    ['grundlagen','1. Grundlagen','Pflege dein Customagotchi regelmäßig und achte auf seine sichtbaren Bedürfnisse. Zeit läuft auch weiter, wenn die App geschlossen ist. Beim nächsten Öffnen wird die Abwesenheit exakt einmal nachberechnet.'],
    ['pflege','2. Pflege & Fairness','Füttern, Trinken, Schlaf, Hygiene, Bewegung und Zuneigung beeinflussen die Entwicklung. Negative Ereignisse entstehen nur aus klar definierten Zuständen und werden im Ereignisprotokoll erklärt.'],
    ['entwicklung','3. Entwicklung','Ei, Geburt, Baby, Kind, Jugend, Erwachsener, Senior und besondere Weiterentwicklung sind von Alter, Erfahrung, Pflege, Gesundheit, Bindung und Entscheidungen abhängig.'],
    ['turniere','4. Turniere','Turniere finden vollständig online statt. Die Anmeldung endet vor dem Start. Bewertet werden die angekündigten Pflege-, Fitness-, Intelligenz- oder Minispielwerte. Ergebnisse werden serverseitig ermittelt.'],
    ['teilnahme','5. Teilnahmebedingungen','Teilnehmen darf, wer mindestens sieben Tage registriert ist oder Premium, Elite beziehungsweise Legend besitzt. Erforderlich sind ein aktives Konto, ein gesundes zugelassenes Customagotchi, die Mindeststufe und kein Turnierausschluss.'],
    ['schutz','6. Manipulationsschutz','Highscores benötigen eine einmalige, kurz gültige Spielrunden-ID. Unplausible Dauer-Punkte-Verhältnisse, wiederverwendete Spielrunden und manipulierte Kontodaten werden abgelehnt und protokolliert.'],
    ['tod','7. Krankheit & Tod','Krankheiten haben erkennbare Ursachen und Schweregrade. Ein Tod tritt nie grundlos ein: Gesundheit muss auf null sinken und eine artspezifische Zahl dokumentierter Pflegefehler erreicht sein.'],
    ['belohnung','8. Saisons & Belohnungen','Saisonale Ranglisten enden zu einem festen Datum. Pokale, Titel, Kleidung, Dekoration und Lunaris werden serverseitig vergeben und bleiben in der Historie nachvollziehbar.'],
  ];
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Transparent & fair</p><h1 class="page-title">Regelwerk</h1><p class="page-intro">Verständliche Regeln für Pflege, Entwicklung und faire Wettbewerbe.</p><div class="rule-layout"><nav class="card rule-toc" aria-label="Inhaltsverzeichnis">${sections.map(s=>`<a href="#rules-${s[0]}">${s[1]}</a>`).join('')}</nav><div class="rule-content">${sections.map((s,i)=>`<section id="rules-${s[0]}" class="card rule-section"><h2>${s[1]}</h2><p>${s[2]}</p>${i===3?'<div class="rule-callout">Ankündigungen enthalten Turniername, Laufzeit, Anmeldefrist, zugelassene Arten, Bewertung, Regeln und Belohnungen.</div>':''}</section>`).join('')}</div></div></section>`;
}

function renderProfile(){
  if(!state.user)return requireLoginView('Dein Profil ist geschützt'); const u=state.user;
  $('#view').innerHTML=`<section class="page-shell"><div class="profile-layout"><aside class="card profile-aside"><div class="profile-avatar">${avatarIcons[u.avatar]||'✦'}</div><h2>${esc(u.username)}</h2><p>${esc(u.email)}</p><span class="tag tag-success">${membershipNames[u.membership]}</span><nav class="profile-nav"><a class="active" href="#profile">Einstellungen</a><a href="#achievements">Erfolge</a><a href="#inventory">Inventar</a>${u.role==='admin'?'<a href="#admin">Administration</a>':''}</nav></aside><div><p class="eyebrow">Benutzerkonto</p><h1 class="section-title">Persönliche Einstellungen</h1><div class="settings-stack section-spacing" style="margin-top:25px"><article class="card setting-row"><div><h3>White-Mode verwenden</h3><p>Gilt nach der Anmeldung auf der gesamten Webseite und wird in deinem Konto gespeichert.</p></div><label class="switch"><input id="profile-theme" type="checkbox" ${u.theme==='light'?'checked':''}><span></span></label></article><article class="card setting-row"><div><h3>Turnier-Newsletter</h3><p>Erhalte Startdatum, Anmeldefrist, Bedingungen und Belohnungen per E-Mail.</p></div><label class="switch"><input id="profile-newsletter" type="checkbox" ${u.newsletter?'checked':''}><span></span></label></article><article class="card setting-row"><div><h3>Profilbild</h3><p>Wähle ein Symbol für dein öffentliches Profil.</p></div><select id="profile-avatar-select"><option value="spark" ${u.avatar==='spark'?'selected':''}>Stern</option><option value="leaf" ${u.avatar==='leaf'?'selected':''}>Blatt</option><option value="moon" ${u.avatar==='moon'?'selected':''}>Mond</option><option value="comet" ${u.avatar==='comet'?'selected':''}>Komet</option></select></article><article class="card setting-row"><div><h3>Sitzung beenden</h3><p>Melde dieses Gerät sicher ab.</p></div><button class="button button-ghost" data-action="logout">Abmelden</button></article><article class="card setting-row"><div><h3 class="danger">Konto löschen</h3><p>Löscht Profil, Customagotchi und Spielhistorie dauerhaft.</p></div><button class="button button-danger" data-action="delete-account">Konto löschen</button></article></div></div></div></section>`;
}

async function renderAdmin(){
  if(!state.user||state.user.role!=='admin'){ $('#view').innerHTML='<section class="page-shell narrow-shell"><div class="card empty-state"><i>⛔</i><h2>Zugriff verweigert</h2><p>Dieser Bereich ist ausschließlich für Administratoren freigegeben.</p><a class="button button-primary" href="#home">Zur Startseite</a></div></section>';return; }
  const data=await api('/api/admin/overview');
  $('#view').innerHTML=`<section class="page-shell"><p class="eyebrow">Geschützter Bereich</p><h1 class="page-title">Administration</h1><p class="page-intro">Nutzer, Spielzustände, Turniere und sicherheitsrelevante Ereignisse zentral verwalten.</p><div class="admin-counters">${Object.entries(data.counts).map(([k,v])=>`<article class="card counter-card"><strong>${v}</strong><span>${k}</span></article>`).join('')}</div><div class="admin-grid"><section class="card admin-panel"><h2>Benutzerkonten</h2><div class="table-wrap"><table><thead><tr><th>Name</th><th>E-Mail</th><th>Mitgliedschaft</th><th>Theme</th><th>Aktion</th></tr></thead><tbody>${data.users.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.email)}</td><td>${membershipNames[u.membership]}</td><td>${u.theme==='light'?'White':'Dark'}</td><td><button class="button button-small button-ghost" data-action="admin-membership" data-user="${u.id}" data-membership="${u.membership}">Ändern</button></td></tr>`).join('')}</tbody></table></div></section><aside class="card admin-panel"><h2>Audit-Protokoll</h2><div class="activity-list">${data.logs.length?data.logs.map(l=>`<div class="activity-item"><i>⌁</i><div><p>${esc(l.action)} · ${esc(l.target_type)}</p><time>${fmtTime(l.created_at)}</time></div></div>`).join(''):'<p class="muted">Noch keine Aktionen.</p>'}</div></aside></div></section>`;
}

function renderPrivacy(){ $('#view').innerHTML=`<section class="page-shell narrow-shell"><p class="eyebrow">Datenschutz</p><h1 class="page-title">Deine Daten gehören dir.</h1><div class="rule-content section-spacing"><section class="card rule-section"><h2>Datensparsamkeit</h2><p>Gespeichert werden Kontodaten, sichere Passwort-Hashes, Spielstände, Einwilligungen und für die Sicherheit notwendige Protokolle. Passwörter werden nie im Klartext abgelegt.</p></section><section class="card rule-section"><h2>Theme & Einstellungen</h2><p>Für Gäste wird die Farbauswahl lokal auf dem Gerät gespeichert. Bei registrierten Nutzern wird sie zusätzlich im Konto gespeichert, damit die gesamte Webseite nach jeder Anmeldung konsistent erscheint.</p></section><section class="card rule-section"><h2>Newsletter</h2><p>Der Newsletter ist freiwillig. Einwilligung und Widerruf werden nachvollziehbar gespeichert und können jederzeit im Profil geändert werden.</p></section><section class="card rule-section"><h2>Löschung</h2><p>Das Konto kann im Profil nach erneuter Passwortbestätigung vollständig gelöscht werden.</p></section></div></section>`; }
function renderNotFound(){ $('#view').innerHTML='<section class="page-shell narrow-shell"><div class="card empty-state"><i>🪐</i><h2>Diese Umlaufbahn gibt es nicht</h2><p>Die gesuchte Seite ist verschwunden oder wurde verschoben.</p><a class="button button-primary" href="#home">Zur Startseite</a></div></section>'; }
function renderError(error){ $('#view').innerHTML=`<section class="page-shell narrow-shell"><div class="card empty-state"><i>☁</i><h2>Etwas ist schiefgelaufen</h2><p>${esc(error.message)}</p><button class="button button-primary" data-action="reload">Erneut versuchen</button></div></section>`; }

function openModal(content, wide=false){$('#modal-content').innerHTML=content;$('#modal').classList.toggle('modal-wide',wide);$('#modal-backdrop').classList.remove('is-hidden');document.body.style.overflow='hidden';setTimeout(()=>$('#modal input, #modal button:not(.modal-close)')?.focus(),30);}
function closeModal(){ $('#modal-backdrop').classList.add('is-hidden');document.body.style.overflow='';$('#modal-content').innerHTML=''; }
function authModal(mode='login'){
  if(mode==='forgot') return openModal(`<div class="auth-heading"><span class="brand-mark"><span></span></span><h2>Passwort zurücksetzen</h2><p>Im lokalen Entwicklungsmodus landet der Link im Test-Postausgang.</p></div><form id="forgot-form" class="form"><label class="field">E-Mail-Adresse<input type="email" name="email" autocomplete="email" required></label><button class="button button-primary button-wide" type="submit">Link anfordern</button><div class="form-footer"><button type="button" class="text-button" data-action="open-login">Zurück zur Anmeldung</button></div></form>`);
  const login=mode==='login';
  openModal(`<div class="auth-heading"><span class="brand-mark"><span></span></span><h2>${login?'Willkommen zurück':'Deine Reise beginnt'}</h2><p>${login?'Öffne deine persönliche Customagotchi-Welt.':'Erstelle dein kostenloses Konto.'}</p></div><form id="auth-form" class="form" data-mode="${mode}"><div id="auth-error"></div>${login?'':`<label class="field">Anzeigename<input name="username" minlength="2" maxlength="28" autocomplete="nickname" required></label>`}<label class="field">E-Mail-Adresse<input type="email" name="email" autocomplete="email" required></label><label class="field">Passwort<input type="password" name="password" minlength="10" autocomplete="${login?'current-password':'new-password'}" required><span class="field-hint">${login?'':'Mindestens 10 Zeichen, Groß-/Kleinbuchstabe und Zahl.'}</span></label>${login?'<button type="button" class="text-button" data-action="open-forgot">Passwort vergessen?</button>':`<label class="check-row"><input type="checkbox" name="newsletter"> Ich möchte Turnierankündigungen per E-Mail erhalten (jederzeit widerrufbar).</label>`}<button class="button button-primary button-wide" type="submit">${login?'Anmelden':'Konto erstellen'}</button><div class="form-footer">${login?'Noch kein Konto? <button type="button" class="text-button" data-action="open-register">Jetzt registrieren</button>':'Schon registriert? <button type="button" class="text-button" data-action="open-login">Anmelden</button>'}</div>${login?'<div class="notice"><i>i</i><div><strong>Demo-Zugang</strong><p>plus@customagotchi.local · Demo123!</p></div></div>':''}</form>`);
}

function speciesInfo(key){const s=state.species[key];openModal(`<div class="auth-heading">${petSvg(key,['coral','mint','sky','gold','violet'][Math.max(0,Object.keys(state.species).indexOf(key))])}<h2>${s.name}</h2><p>${s.mode}-Mode · Schwierigkeit ${s.range[0]}–${s.range[1]}</p></div><div class="notice"><i>✦</i><div><strong>${s.special}</strong><p>Eigene Animationen, Bedürfnisse, Krankheiten, Entwicklungspfade und ein exklusives Minispiel.</p></div></div><button class="button button-primary button-wide" style="margin-top:18px" data-action="hero-start">${state.user?'Wesen wählen':'Konto erstellen'}</button>`,false);}

async function handleAuthSubmit(form){
  const data=Object.fromEntries(new FormData(form));data.newsletter=Boolean(data.newsletter);const mode=form.dataset.mode;setBusy(true);
  try{const result=await api(`/api/auth/${mode}`,{method:'POST',body:data});Object.assign(state,result);state.notifications=[];state.achievements=[];applyTheme(state.user.theme);closeModal();const me=await api('/api/me');Object.assign(state,me);updateHeader();toast(mode==='login'?'Willkommen zurück!':'Dein Konto wurde erstellt.');location.hash=state.pet?'#game':state.user.membership==='free'?'#memberships':'#game';await renderRoute();}catch(e){const box=$('#auth-error');if(box)box.innerHTML=`<div class="error-box">${esc(e.message)}</div>`;else showError(e);}finally{setBusy(false);}
}

async function care(action){if(state.busy)return;setBusy(true);try{const data=await api('/api/pet/action',{method:'POST',body:{action}});state.pet=data.pet;state.user=data.user;toast(data.message);renderRoute();softSound(action==='praise'||action==='pet'?'good':'tap');}catch(e){showError(e);}finally{setBusy(false);}}
async function buyItem(id){setBusy(true);try{const d=await api('/api/shop/buy',{method:'POST',body:{itemId:id,quantity:1}});state.user.coins=d.coins;state.items=[];toast(d.message);await renderShop();}catch(e){showError(e);}finally{setBusy(false);}}
async function useItem(id){setBusy(true);try{const d=await api('/api/inventory/use',{method:'POST',body:{itemId:id}});state.pet=d.pet;state.items=[];toast(d.message);await renderInventory();}catch(e){showError(e);}finally{setBusy(false);}}
async function registerTournament(id){if(!state.user)return authModal('login');setBusy(true);try{const d=await api('/api/tournaments/register',{method:'POST',body:{tournamentId:id}});toast(d.message);softSound('good');}catch(e){showError(e);}finally{setBusy(false);}}

async function startMinigame(game){
  try{
    const round=await api(`/api/minigames/start?game=${encodeURIComponent(game)}`);
    let score=0, seconds=20, started=Date.now(), timer;
    openModal(`<div class="game-hud"><strong>Punkte <span id="game-score">0</span></strong><strong>Zeit <span id="game-time">20</span>s</strong></div><div class="game-stage" id="game-stage" aria-label="Spielfeld"><button class="game-target" id="game-target" aria-label="Ziel treffen">✦</button></div><p class="muted">Triff den Lichtfunken so oft du kannst. Jede Position wird neu gewählt.</p>`,true);
    const target=$('#game-target'), stage=$('#game-stage');
    const move=()=>{
      const maxX=Math.max(1,stage.clientWidth-65), maxY=Math.max(1,stage.clientHeight-65);
      target.style.left=`${Math.random()*maxX}px`; target.style.top=`${Math.random()*maxY}px`;
    };
    move();
    target.addEventListener('click',()=>{score+=5;$('#game-score').textContent=score;move();softSound('tap');});
    timer=setInterval(async()=>{
      seconds--;
      const timeEl=$('#game-time'); if(timeEl) timeEl.textContent=seconds;
      if(seconds<=0){
        clearInterval(timer);
        const duration=Date.now()-started;
        target.disabled=true;
        try{
          const d=await api('/api/minigames/score',{method:'POST',body:{game,nonce:round.nonce,score,durationMs:duration}});
          state.user=d.user; state.pet=d.pet;
          $('#modal-content').innerHTML=`<div class="auth-heading"><span style="font-size:58px">🏆</span><h2>${score} Punkte</h2><p>Ergebnis verifiziert · +${d.reward} Lunaris</p></div><button class="button button-primary button-wide" data-action="close-modal">Weiter</button>`;
          softSound('good');
        }catch(e){ closeModal(); showError(e); }
      }
    },1000);
  }catch(e){ showError(e); }
}

function softSound(kind='tap'){try{const Audio=window.AudioContext||window.webkitAudioContext;if(!Audio)return;const ctx=new Audio(),osc=ctx.createOscillator(),gain=ctx.createGain();osc.type='sine';osc.frequency.setValueAtTime(kind==='good'?520:310,ctx.currentTime);osc.frequency.exponentialRampToValueAtTime(kind==='good'?760:390,ctx.currentTime+.12);gain.gain.setValueAtTime(.035,ctx.currentTime);gain.gain.exponentialRampToValueAtTime(.001,ctx.currentTime+.14);osc.connect(gain);gain.connect(ctx.destination);osc.start();osc.stop(ctx.currentTime+.15);}catch{} }

async function saveProfile(patch){const previous={...state.user};Object.assign(state.user,patch);if(patch.theme)applyTheme(patch.theme);try{const d=await api('/api/profile',{method:'PATCH',body:patch});state.user=d.user;updateHeader();toast('Einstellung gespeichert.');}catch(e){state.user=previous;if(patch.theme)applyTheme(previous.theme);showError(e);}}

function openNotifications(){const items=state.notifications;$('#drawer-content').innerHTML=items.length?items.map(n=>`<article class="notification-card"><strong>${esc(n.title)}</strong><p>${esc(n.message)}</p><time>${fmtTime(n.created_at)}</time></article>`).join(''):'<div class="empty-state"><i>✦</i><h2>Alles ruhig</h2><p>Keine neuen Benachrichtigungen.</p></div>';$('#drawer').classList.remove('is-hidden');if(items.some(n=>!n.read_at))api('/api/notifications/read',{method:'POST',body:{}}).then(()=>{state.notifications.forEach(n=>n.read_at=new Date().toISOString());updateHeader();}).catch(()=>{});}

document.addEventListener('click', async event => {
  const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  if(action==='open-login')authModal('login');
  else if(action==='open-register')authModal('register');
  else if(action==='open-forgot')authModal('forgot');
  else if(action==='close-modal')closeModal();
  else if(action==='reload')location.reload();
  else if(action==='hero-start'){closeModal();if(!state.user)authModal('register');else location.hash='#game';}
  else if(action==='species-info')speciesInfo(button.dataset.species);
  else if(action==='care')await care(button.dataset.care);
  else if(action==='load-events')await loadEvents();
  else if(action==='filter-items'){state.activeFilter=button.dataset.filter;await (route()==='shop'?renderShop():renderInventory());}
  else if(action==='buy-item')await buyItem(button.dataset.item);
  else if(action==='use-item')await useItem(button.dataset.item);
  else if(action==='register-tournament')await registerTournament(button.dataset.tournament);
  else if(action==='start-game')await startMinigame(button.dataset.game);
  else if(action==='select-color'){const input=$('#creator-form [name="color"]');if(input){input.value=button.dataset.color;$$('.swatch').forEach(x=>x.classList.toggle('selected',x===button));updateCreatorPreview();}}
  else if(action==='select-plan'){if(!state.user)authModal('register');else if(button.dataset.plan===state.user.membership)toast('Das ist bereits dein aktueller Tarif.');else openModal(`<div class="auth-heading"><span style="font-size:54px">✦</span><h2>${membershipNames[button.dataset.plan]}</h2><p>Die Zahlungsanbindung ist in dieser lokalen Ausgabe absichtlich im Testmodus. Mitgliedschaften können im Adminbereich für Tests gesetzt werden.</p></div><button class="button button-primary button-wide" data-action="close-modal">Verstanden</button>`);}
  else if(action==='logout'){try{await api('/api/auth/logout',{method:'POST',body:{}});resetSession();state.items=[];applyTheme(initialTheme());toast('Du wurdest sicher abgemeldet.');location.hash='#home';renderRoute();}catch(e){showError(e);}}
  else if(action==='delete-account'){openModal(`<div class="auth-heading"><span style="font-size:50px">⚠</span><h2>Konto endgültig löschen?</h2><p>Alle Spielstände, Gegenstände und Erfolge werden unwiderruflich entfernt.</p></div><form id="delete-form" class="form"><label class="field">Zur Bestätigung Passwort eingeben<input type="password" name="password" required autocomplete="current-password"></label><button class="button button-danger button-wide" type="submit">Endgültig löschen</button></form>`);}
  else if(action==='open-decor'){location.hash='#inventory';toast('Dekorationen kannst du im Inventar ausrüsten.');}
  else if(action==='admin-membership'){const options=['free','plus','premium','elite','legend'];const next=options[(options.indexOf(button.dataset.membership)+1)%options.length];try{await api('/api/admin/users',{method:'PATCH',body:{userId:button.dataset.user,membership:next,billingCycle:next==='free'?'none':'monthly'}});toast(`Mitgliedschaft auf ${membershipNames[next]} gesetzt.`);renderAdmin();}catch(e){showError(e);}}
});

document.addEventListener('submit',async event=>{
  event.preventDefault();const form=event.target;
  if(form.id==='auth-form')return handleAuthSubmit(form);
  if(form.id==='forgot-form'){try{const d=await api('/api/auth/password-reset',{method:'POST',body:Object.fromEntries(new FormData(form))});toast(d.message);closeModal();}catch(e){showError(e);}return;}
  if(form.id==='creator-form'){setBusy(true);try{const values=Object.fromEntries(new FormData(form));values.difficulty=Number(values.difficulty);const d=await api('/api/pets',{method:'POST',body:values});state.pet=d.pet;closeModal();toast(`${state.pet.name} ist bereit zu schlüpfen!`);softSound('good');renderGame();}catch(e){showError(e);}finally{setBusy(false);}return;}
  if(form.id==='delete-form'){try{await api('/api/account',{method:'DELETE',body:Object.fromEntries(new FormData(form))});closeModal();resetSession();toast('Das Konto wurde gelöscht.');location.hash='#home';renderRoute();}catch(e){showError(e);}}
});

function updateCreatorPreview(){const form=$('#creator-form');if(!form)return;const species=form.species.value,color=form.color.value,eyes=form.eyeColor.value,pattern=form.pattern.value;$('#creator-pet').innerHTML=petSvg(species,color,eyes,pattern);const spec=state.species[species];form.difficulty.min=spec.range[0];form.difficulty.max=spec.range[1];if(+form.difficulty.value<spec.range[0]||+form.difficulty.value>spec.range[1])form.difficulty.value=Math.round((spec.range[0]+spec.range[1])/2);$('#difficulty-label').textContent=`Level ${form.difficulty.value} · ${spec.mode}`;}
document.addEventListener('input',event=>{if(['creator-species','creator-pattern','creator-eyes','creator-difficulty'].includes(event.target.id))updateCreatorPreview();});
document.addEventListener('change',event=>{if(event.target.id==='profile-theme')saveProfile({theme:event.target.checked?'light':'dark'});if(event.target.id==='profile-newsletter')saveProfile({newsletter:event.target.checked});if(event.target.id==='profile-avatar-select')saveProfile({avatar:event.target.value});});

$('#theme-toggle').addEventListener('click',()=>{const next=document.documentElement.dataset.theme==='dark'?'light':'dark';if(state.user)saveProfile({theme:next});else{applyTheme(next);toast(next==='light'?'White-Mode aktiviert.':'Dark-Mode aktiviert.');}});
$('#login-button').addEventListener('click',()=>authModal('login'));
$('#register-button').addEventListener('click',()=>authModal('register'));
$('#profile-button').addEventListener('click',()=>location.hash='#profile');
$('#menu-button').addEventListener('click',()=>{const open=$('#primary-nav').classList.toggle('open');$('#menu-button').setAttribute('aria-expanded',String(open));});
$('#notification-button').addEventListener('click',openNotifications);
$('#drawer-close').addEventListener('click',()=>$('#drawer').classList.add('is-hidden'));
$('#modal-close').addEventListener('click',closeModal);
$('#modal-backdrop').addEventListener('click',event=>{if(event.target===$('#modal-backdrop'))closeModal();});
document.addEventListener('keydown',event=>{if(event.key==='Escape'){closeModal();$('#drawer').classList.add('is-hidden');}});
window.addEventListener('hashchange',renderRoute);
window.addEventListener('scroll',()=>$('#site-header').classList.toggle('scrolled',scrollY>10),{passive:true});

if('serviceWorker' in navigator && document.querySelector('link[rel="manifest"]')) window.addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}));
bootstrap();
