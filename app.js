(() => {
  'use strict';

  const STORAGE_KEY = 'customagotchi.save.v1';
  const TICK_MS = 5000;
  const GAME_HOUR_MS = 60000;
  const MAX_OFFLINE_MS = 2 * 60 * 60 * 1000;
  const PLAN_RANK = { plus: 1, pro: 2, elite: 3, legend: 4 };
  const NEED_META = {
    hunger: { label: 'Sättigung', icon: '♨', color: '#ef8d55' },
    happiness: { label: 'Freude', icon: '♥', color: '#ff6e7a' },
    energy: { label: 'Energie', icon: 'ϟ', color: '#f2bd4d' },
    cleanliness: { label: 'Sauberkeit', icon: '✦', color: '#50b9d2' },
    health: { label: 'Gesundheit', icon: '✚', color: '#48c9a7' },
    discipline: { label: 'Disziplin', icon: '▲', color: '#8b82dc' }
  };
  const SPECIES = {
    hamster: {
      name: 'Hamster', min: 0, max: 10, mode: 'Beginner-Mode', color: '#dfa16e', tolerance: 5,
      tagline: 'Sanft. Neugierig. Geduldig.',
      description: 'Verzeiht Pflegefehler vollständig. Ideal, um alle Abläufe stressfrei zu lernen.',
      penalty: 0, decay: .78, favorite: 'Snack', quirk: 'Fehler werden protokolliert, haben aber keine negativen Auswirkungen.'
    },
    cat: {
      name: 'Katze', min: 10, max: 20, mode: 'Lehrling-Mode', color: '#ba9bd4', tolerance: 4,
      tagline: 'Eigenwillig. Elegant. Nachsichtig.',
      description: 'Warnt früh und verzeiht einzelne Patzer. Zeigt dir, wie du sie künftig verhinderst.',
      penalty: .25, decay: .92, favorite: 'Spiel', quirk: 'Einzelne Fehler kosten etwas Freude, wiederholte Nachlässigkeit Gesundheit.'
    },
    dog: {
      name: 'Hund', min: 20, max: 30, mode: 'Meister-Mode', color: '#cb8c58', tolerance: 3,
      tagline: 'Loyal. Aktiv. Aufmerksam.',
      description: 'Erwartet verlässliche Routinen. Fehler wirken sich bedingt auf Werte und Entwicklung aus.',
      penalty: .5, decay: 1.05, favorite: 'Training', quirk: 'Fehler senken Disziplin und Gesundheit, sind mit guter Pflege aber ausgleichbar.'
    },
    dino: {
      name: 'Dino', min: 30, max: 40, mode: 'Semi-Turnier-Mode', color: '#62bd99', tolerance: 2,
      tagline: 'Ursprünglich. Stark. Fordernd.',
      description: 'Kleinste Fehler beeinflussen Gesundheit, Evolution und das weitere Leben direkt.',
      penalty: 1, decay: 1.2, favorite: 'Mahlzeit', quirk: 'Jeder Fehler kostet Gesundheit und dauerhaft Evolutionsqualität.'
    },
    alien: {
      name: 'Alien', min: 40, max: 50, mode: 'Turnier-Mode', color: '#7396e0', tolerance: 0,
      tagline: 'Fremdartig. Brillant. Kompromisslos.',
      description: 'Null Toleranz: Schon ein bestätigter Pflegefehler beendet das Leben deines Gotchis.',
      penalty: 99, decay: 1.35, favorite: 'Präzision', quirk: 'Ein falscher Pflegegriff oder ein vollständig leerer Grundwert führt zum Tod.'
    }
  };
  const QUESTS = [
    { id: 'feed', label: 'Gut gefüttert', detail: 'Eine vollwertige Mahlzeit', xp: 20 },
    { id: 'play', label: 'Gemeinsame Zeit', detail: 'Ein Spiel abschließen', xp: 25 },
    { id: 'clean', label: 'Sauberes Zuhause', detail: 'Zimmer und Gotchi pflegen', xp: 20 },
    { id: 'sleep', label: 'Guter Rhythmus', detail: 'Schlaf einleiten', xp: 15 }
  ];

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const clamp = value => Math.max(0, Math.min(100, Number.isFinite(value) ? value : 0));
  const now = () => Date.now();
  const dateKey = (date = new Date()) => date.toISOString().slice(0, 10);
  const formatDate = timestamp => new Intl.DateTimeFormat('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(timestamp));
  const escapeHtml = value => String(value).replace(/[&<>'"]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' })[char]);
  const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

  function defaultState() {
    return {
      version: 1,
      profile: null,
      pet: null,
      sound: true,
      seasonPoints: 0,
      joinedEvents: [],
      mail: [],
      lastSaved: now()
    };
  }

  function normalizePet(pet) {
    if (!pet || !SPECIES[pet.species]) return null;
    const normalized = { ...pet };
    ['hunger', 'happiness', 'energy', 'cleanliness', 'health', 'discipline', 'stress'].forEach(key => normalized[key] = clamp(Number(normalized[key])));
    normalized.weight = Math.max(1, Number(normalized.weight) || 5);
    normalized.gameHours = Math.max(0, Number(normalized.gameHours) || 0);
    normalized.poop = Math.max(0, Math.min(5, Math.floor(Number(normalized.poop) || 0)));
    normalized.xp = Math.max(0, Math.floor(Number(normalized.xp) || 0));
    normalized.careMistakes = Math.max(0, Math.floor(Number(normalized.careMistakes) || 0));
    normalized.evolutionScore = clamp(Number(normalized.evolutionScore ?? 100));
    normalized.history = Array.isArray(normalized.history) ? normalized.history.slice(0, 40) : [];
    normalized.questDone = normalized.questDone && typeof normalized.questDone === 'object' ? normalized.questDone : {};
    normalized.criticalNoted = normalized.criticalNoted && typeof normalized.criticalNoted === 'object' ? normalized.criticalNoted : {};
    normalized.alive = normalized.alive !== false;
    normalized.asleep = Boolean(normalized.asleep);
    normalized.lightOn = normalized.lightOn !== false;
    normalized.sick = Boolean(normalized.sick);
    normalized.lastUpdated = Number(normalized.lastUpdated) || now();
    normalized.nextPoopAt = Number(normalized.nextPoopAt) || normalized.gameHours + 6;
    normalized.stage = getStage(normalized.gameHours);
    return normalized;
  }

  function loadState() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (!parsed || typeof parsed !== 'object') return defaultState();
      return {
        ...defaultState(),
        ...parsed,
        profile: parsed.profile && typeof parsed.profile === 'object' ? parsed.profile : null,
        pet: normalizePet(parsed.pet),
        joinedEvents: Array.isArray(parsed.joinedEvents) ? parsed.joinedEvents : [],
        mail: Array.isArray(parsed.mail) ? parsed.mail.slice(0, 30) : []
      };
    } catch (error) {
      console.warn('Spielstand war beschädigt und wurde sicher zurückgesetzt.', error);
      return defaultState();
    }
  }

  let state = loadState();
  let messageTimer = 0;
  let currentView = 'home';
  let activeRule = 'basics';
  let currentSeason = seasonInfo();
  const events = buildEvents();

  function saveState() {
    state.lastSaved = now();
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
    catch (error) { toast('Speichern ist in diesem Browser nicht möglich.', 'bad'); }
  }

  function seasonInfo(date = new Date()) {
    const month = date.getMonth();
    if (month <= 1 || month === 11) return { name: 'Frost-Saison', icon: '❄' };
    if (month <= 4) return { name: 'Blüten-Saison', icon: '✿' };
    if (month <= 7) return { name: 'Solar-Saison', icon: '☀' };
    return { name: 'Prisma-Saison', icon: '◆' };
  }

  function buildEvents() {
    const definitions = [
      { offset: 12, title: 'Solar-Pokal', location: 'Online · Customa Arena', format: 'Pflege-Sprint', points: 80 },
      { offset: 34, title: 'Nordlicht-Cup', location: 'Hamburg · Arena Nord', format: 'Hybrid-Finale', points: 120 },
      { offset: 61, title: 'Prisma Masters', location: 'Berlin · Customa Hall', format: 'Präsenz-Turnier', points: 180 }
    ];
    return definitions.map((item, index) => {
      const date = new Date(); date.setHours(12, 0, 0, 0); date.setDate(date.getDate() + item.offset);
      return { ...item, id: `event-${index}-${dateKey(date)}`, date: date.getTime() };
    });
  }

  function getStage(gameHours) {
    if (gameHours < 6) return 'Baby';
    if (gameHours < 24) return 'Kind';
    if (gameHours < 72) return 'Teen';
    return 'Erwachsen';
  }

  function stageClass(stage) {
    return ({ Baby: 'baby', Kind: 'child', Teen: 'teen', Erwachsen: 'adult' })[stage] || 'baby';
  }

  function accountAgeDays() {
    if (!state.profile) return 0;
    return Math.floor((now() - Number(state.profile.registeredAt)) / 86400000);
  }

  function isOwnerEligible() {
    return Boolean(state.profile && PLAN_RANK[state.profile.plan] >= PLAN_RANK.plus);
  }

  function tournamentEligibility() {
    if (!state.profile) return { ok: false, reason: 'Registrierung erforderlich' };
    const topRank = PLAN_RANK[state.profile.plan] >= PLAN_RANK.pro;
    if (!topRank && accountAgeDays() < 7) return { ok: false, reason: `Noch ${7 - accountAgeDays()} Tag(e) Mitgliedschaft nötig` };
    if (!state.pet || !state.pet.alive) return { ok: false, reason: 'Lebendes Gotchi erforderlich' };
    if (state.pet.stage !== 'Erwachsen') return { ok: false, reason: 'Gotchi muss erwachsen sein' };
    if (state.pet.health < 70) return { ok: false, reason: 'Mindestens 70 % Gesundheit' };
    return { ok: true, reason: 'Teilnahme möglich' };
  }

  function logActivity(text) {
    if (!state.pet) return;
    state.pet.history.unshift({ at: now(), text: String(text) });
    state.pet.history = state.pet.history.slice(0, 40);
  }

  function markQuest(id) {
    const pet = state.pet;
    if (!pet) return;
    const today = dateKey();
    if (!pet.questDone[today]) pet.questDone = { [today]: {} };
    if (pet.questDone[today][id]) return;
    const quest = QUESTS.find(item => item.id === id);
    if (!quest) return;
    pet.questDone[today][id] = true;
    pet.xp += quest.xp;
    state.seasonPoints += 2;
    if (Object.keys(pet.questDone[today]).length === QUESTS.length && pet.lastStreakDate !== today) {
      const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
      pet.streak = pet.lastStreakDate === dateKey(yesterday) ? (pet.streak || 0) + 1 : 1;
      pet.lastStreakDate = today;
      pet.xp += 30;
      state.seasonPoints += 5;
      toast(`Tagesrhythmus komplett · ${pet.streak} Tag(e) Serie · +30 XP`, 'good');
    }
    toast(`Tagesziel: ${quest.label} · +${quest.xp} XP`, 'good');
  }

  function showMessage(text, tone = 'good') {
    const node = $('#roomMessage');
    if (!node) return;
    node.textContent = text;
    node.classList.add('show');
    clearTimeout(messageTimer);
    messageTimer = setTimeout(() => node.classList.remove('show'), 2300);
    if (tone === 'bad') petReaction('!');
  }

  function petReaction(symbol) {
    const bubble = $('#petBubble');
    if (!bubble) return;
    bubble.textContent = symbol;
    setTimeout(() => { if (bubble) bubble.textContent = state.pet?.sick ? '+' : '♥'; }, 1800);
  }

  function toast(message, type = '') {
    const node = document.createElement('div');
    node.className = `toast ${type}`;
    node.textContent = message;
    $('#toastRegion').appendChild(node);
    setTimeout(() => node.remove(), 3600);
  }

  function beep(frequency = 440, duration = .07) {
    if (!state.sound) return;
    try {
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      const context = new Context();
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(.001, context.currentTime + duration);
      oscillator.connect(gain); gain.connect(context.destination);
      oscillator.start(); oscillator.stop(context.currentTime + duration);
      oscillator.onended = () => context.close();
    } catch (_) { /* Ton ist nur ein Komfortmerkmal. */ }
  }

  function applyValue(key, amount) {
    if (!state.pet) return;
    state.pet[key] = clamp(Number(state.pet[key]) + amount);
    if (state.pet[key] > 5) delete state.pet.criticalNoted[key];
  }

  function registerMistake(reason) {
    const pet = state.pet;
    if (!pet || !pet.alive) return;
    const species = SPECIES[pet.species];
    pet.careMistakes += 1;
    logActivity(`Pflegefehler: ${reason}`);
    if (pet.species === 'hamster') {
      toast(`Lernhinweis: ${reason} – im Beginner-Mode ohne Auswirkung.`, 'warn');
      return;
    }
    if (pet.species === 'alien') {
      pet.health = 0;
      killPet(`Null-Toleranz-Regel: ${reason}`);
      return;
    }
    const damage = Math.round(8 * species.penalty + pet.difficulty / 12);
    applyValue('health', -damage);
    applyValue('happiness', -Math.round(6 * species.penalty));
    applyValue('discipline', -Math.round(5 * species.penalty));
    pet.evolutionScore = clamp(pet.evolutionScore - Math.round(7 * species.penalty));
    toast(`${species.mode}: ${reason} · −${damage} Gesundheit`, 'bad');
    if (pet.health <= 0) killPet(`Die Folgen von „${reason}“ waren zu schwer.`);
  }

  function killPet(reason) {
    const pet = state.pet;
    if (!pet || !pet.alive) return;
    pet.alive = false;
    pet.asleep = false;
    pet.health = 0;
    pet.diedAt = now();
    pet.deathReason = reason;
    logActivity(`Lebensende: ${reason}`);
    saveState();
    renderGame();
    beep(150, .35);
    setTimeout(openDeathModal, 350);
  }

  function advanceSimulation(elapsedMs, isOffline = false) {
    const pet = state.pet;
    if (!pet || !pet.alive || elapsedMs <= 0) return;
    const safeElapsed = isOffline ? Math.min(elapsedMs, MAX_OFFLINE_MS) : Math.min(elapsedMs, 30000);
    const hours = safeElapsed / GAME_HOUR_MS;
    if (hours <= 0) return;
    const species = SPECIES[pet.species];
    const difficultyFactor = species.decay * (1 + (pet.difficulty - species.min) / 100);
    pet.gameHours += hours;
    const oldStage = pet.stage;
    pet.stage = getStage(pet.gameHours);
    if (oldStage !== pet.stage) {
      logActivity(`Entwicklung zur Stufe „${pet.stage}“`);
      pet.xp += 50;
      if (!isOffline) toast(`${pet.name} ist jetzt ${pet.stage}!`, 'good');
    }

    applyValue('hunger', -(pet.asleep ? 2.3 : 4.4) * difficultyFactor * hours);
    applyValue('happiness', -(pet.asleep ? .45 : 1.5) * difficultyFactor * hours);
    applyValue('cleanliness', -(1.2 + pet.poop * .8) * difficultyFactor * hours);
    applyValue('discipline', -.32 * difficultyFactor * hours);
    applyValue('stress', (pet.asleep ? -6 : .55) * hours);
    if (pet.asleep) applyValue('energy', 9 * hours);
    else applyValue('energy', -3.4 * difficultyFactor * hours);

    while (pet.gameHours >= pet.nextPoopAt && pet.poop < 5) {
      pet.poop += 1;
      pet.nextPoopAt += 5.5 + (pet.difficulty % 3) * .5;
      if (!isOffline) toast(`${pet.name} braucht Pflege.`, 'warn');
    }

    const unhealthy = pet.hunger < 15 || pet.energy < 10 || pet.cleanliness < 15 || pet.stress > 85;
    if (unhealthy) applyValue('health', -2.4 * difficultyFactor * hours);
    else if (!pet.sick && pet.hunger > 55 && pet.cleanliness > 55) applyValue('health', 1.2 * hours);
    if (pet.sick) applyValue('health', -3.1 * difficultyFactor * hours);

    if (!pet.sick && pet.cleanliness < 12 && pet.gameHours - (pet.lastSicknessCheck || 0) > 1) {
      pet.sick = true;
      pet.lastSicknessCheck = pet.gameHours;
      logActivity('Durch mangelnde Sauberkeit erkrankt');
      if (!isOffline) toast(`${pet.name} ist krank geworden.`, 'bad');
    }

    ['hunger', 'energy', 'cleanliness'].forEach(key => {
      if (pet[key] <= 0 && !pet.criticalNoted[key]) {
        pet.criticalNoted[key] = true;
        registerMistake(`${NEED_META[key].label} vollständig vernachlässigt`);
      }
    });
    if (pet.health <= 0 && pet.alive) killPet('Die Gesundheit ist auf null gefallen.');
    pet.lastUpdated = now();
  }

  function performAction(action) {
    const pet = state.pet;
    if (!pet || !pet.alive) return;
    if (action !== 'light' && action !== 'sleep' && pet.asleep) {
      registerMistake(`${pet.name} im Schlaf mit „${actionLabel(action)}“ gestört`);
      showMessage('Psst – ich schlafe!', 'bad');
      renderGame(); saveState(); return;
    }
    if ((action === 'play' || action === 'train') && pet.sick) {
      registerMistake(`trotz Krankheit ${action === 'play' ? 'gespielt' : 'trainiert'}`);
      showMessage('Ich bin noch krank.', 'bad');
      renderGame(); saveState(); return;
    }
    switch (action) {
      case 'feed':
        if (pet.hunger > 92) registerMistake('überfüttert');
        else {
          applyValue('hunger', 34); applyValue('health', 4); applyValue('energy', 3);
          pet.weight += 0.25; pet.xp += 4; markQuest('feed');
          logActivity('Eine ausgewogene Mahlzeit gefüttert'); showMessage('Mmmh, genau richtig!'); petReaction('♨'); beep(520);
        }
        break;
      case 'snack':
        if (pet.hunger > 84) registerMistake('zu viele Snacks gegeben');
        else {
          applyValue('hunger', 14); applyValue('happiness', 12); applyValue('health', -1);
          pet.weight += .18; pet.xp += 2; logActivity('Einen Snack gegeben'); showMessage('Süß! Noch einen?'); petReaction('●'); beep(610);
        }
        break;
      case 'play': openPlayModal(); return;
      case 'train':
        if (pet.energy < 22) registerMistake('mit zu wenig Energie trainiert');
        else {
          applyValue('energy', -17); applyValue('hunger', -8); applyValue('discipline', 16); applyValue('happiness', 4); applyValue('stress', -5);
          pet.weight = Math.max(1, pet.weight - .12); pet.xp += 13; logActivity('Konzentriert trainiert'); showMessage('Ich werde immer besser!'); petReaction('▲'); beep(480);
        }
        break;
      case 'clean':
        if (pet.cleanliness > 95 && pet.poop === 0) registerMistake('unnötig und zu häufig gepflegt');
        else {
          pet.poop = 0; applyValue('cleanliness', 52); applyValue('happiness', 4); applyValue('stress', -5); pet.xp += 7; markQuest('clean');
          logActivity('Zimmer gereinigt und Gotchi gepflegt'); showMessage('Alles funkelt!'); petReaction('✦'); beep(690);
        }
        break;
      case 'medicine':
        if (!pet.sick) registerMistake('Medizin ohne Krankheit verabreicht');
        else {
          pet.sick = false; applyValue('health', 28); applyValue('happiness', -3); pet.xp += 10;
          logActivity('Krankheit erfolgreich behandelt'); showMessage('Schon viel besser!'); petReaction('+'); beep(740);
        }
        break;
      case 'sleep':
        if (pet.energy > 88 && !pet.asleep) registerMistake('mit voller Energie zum Schlaf gezwungen');
        else {
          pet.asleep = !pet.asleep;
          if (pet.asleep) { pet.lightOn = false; markQuest('sleep'); logActivity('Schlafenszeit begonnen'); showMessage('Gute Nacht …'); }
          else { pet.lightOn = true; logActivity('Aufgeweckt'); showMessage('Guten Morgen!'); }
          beep(pet.asleep ? 330 : 580);
        }
        break;
      case 'light':
        pet.lightOn = !pet.lightOn;
        if (pet.asleep && pet.lightOn) registerMistake('Licht während des Schlafs eingeschaltet');
        else { logActivity(`Licht ${pet.lightOn ? 'eingeschaltet' : 'ausgeschaltet'}`); showMessage(pet.lightOn ? 'Schön hell!' : 'Ganz gemütlich.'); beep(430); }
        break;
      default: return;
    }
    renderGame(); saveState();
  }

  function actionLabel(action) {
    return ({ feed: 'Füttern', snack: 'Snack', play: 'Spielen', train: 'Training', clean: 'Pflegen', medicine: 'Medizin' })[action] || action;
  }

  function openPlayModal() {
    openModal(`
      <span class="micro-label">MINISPIEL · STERNFÄNGER</span>
      <h2 id="modalTitle">Wo landet der Stern?</h2>
      <p class="modal-lead">Wähle eine Seite. Ein Treffer bringt besonders viel Freude, aber auch ein Fehlversuch zählt als gemeinsame Spielzeit.</p>
      <div class="game-choice"><button data-game-choice="left">← LINKS</button><button data-game-choice="right">RECHTS →</button></div>
      <p class="fine-print">Spielen kostet 12 Energie und 5 Sättigung.</p>`);
    $$('[data-game-choice]').forEach(button => button.addEventListener('click', () => resolveGame(button.dataset.gameChoice)));
  }

  function resolveGame(choice) {
    const pet = state.pet;
    if (!pet || !pet.alive) return closeModal();
    if (pet.energy < 12) {
      closeModal(); registerMistake('ohne genügend Energie gespielt'); renderGame(); saveState(); return;
    }
    const target = Math.random() < .5 ? 'left' : 'right';
    const won = choice === target;
    applyValue('energy', -12); applyValue('hunger', -5); applyValue('happiness', won ? 24 : 12); applyValue('stress', -12);
    pet.xp += won ? 18 : 9; markQuest('play'); logActivity(won ? 'Sternfänger gewonnen' : 'Sternfänger gespielt');
    closeModal(); showMessage(won ? 'Gefangen! Was für ein Team!' : 'Knapp daneben – nochmal!'); petReaction(won ? '★' : '◆'); beep(won ? 820 : 460, .12); renderGame(); saveState();
  }

  function renderAll() {
    renderAccount(); renderSpecies(); renderRules(); renderEvents(); renderHomeState();
    if (state.pet) renderGame();
  }

  function renderAccount() {
    $('#accountLabel').textContent = state.profile ? `${state.profile.name} · ${state.profile.plan.toUpperCase()}` : 'Gast';
    $('#soundToggle').classList.toggle('off', !state.sound);
    $('#soundToggle span').textContent = state.sound ? '♪' : '×';
    const toggle = $('#newsletterToggle');
    toggle.checked = Boolean(state.profile?.newsletter);
    $('#newsletterState').textContent = state.profile?.newsletter ? 'Newsletter an' : 'Newsletter aus';
    $('#mailCount').textContent = String(state.mail.filter(mail => !mail.read).length);
  }

  function renderHomeState() {
    const hasPet = Boolean(state.pet);
    $('#gameShell').classList.toggle('hidden', !hasPet);
    $('.hero').classList.toggle('hidden', hasPet);
    $('#featureStrip').classList.toggle('hidden', hasPet);
  }

  function renderSpecies() {
    const grid = $('#speciesGrid');
    grid.innerHTML = '';
    Object.entries(SPECIES).forEach(([key, species]) => {
      const fragment = $('#petCardTemplate').content.cloneNode(true);
      const card = $('.species-card', fragment);
      card.dataset.species = key;
      $('.difficulty-chip', card).textContent = `LEVEL ${species.min}–${species.max}`;
      $('.species-title h2', card).textContent = species.name;
      $('.level-label', card).textContent = `${species.min}—${species.max}`;
      $('.species-tagline', card).textContent = species.tagline;
      $('.mode-name', card).textContent = species.mode;
      $('.species-description', card).textContent = species.description;
      const dots = $('.tolerance-dots', card);
      for (let i = 0; i < 5; i += 1) dots.insertAdjacentHTML('beforeend', `<i class="${i < species.tolerance ? 'on' : ''}"></i>`);
      $('.choose-species', card).addEventListener('click', () => requestPetCreation(key));
      grid.appendChild(fragment);
    });
  }

  function renderGame() {
    const pet = state.pet;
    if (!pet) return;
    const species = SPECIES[pet.species];
    $('#petNameHeading').textContent = pet.name;
    $('#petSpeciesLabel').textContent = species.name;
    $('#petStageLabel').textContent = pet.stage;
    $('#petAgeLabel').textContent = `Tag ${Math.floor(pet.gameHours / 24) + 1}`;
    $('#aliveBadge').textContent = pet.alive ? (pet.sick ? '● KRANK' : pet.asleep ? '● SCHLÄFT' : '● MUNTER') : '● VERSTORBEN';
    $('#aliveBadge').classList.toggle('danger', !pet.alive || pet.sick);
    $('#streakDays').textContent = String(pet.streak || 1);
    $('#xpBadge').textContent = `${pet.xp} XP`;
    const playedMinutes = Math.floor(pet.gameHours * 60) % 1440;
    const hours = Math.floor(playedMinutes / 60);
    const minutes = playedMinutes % 60;
    $('#gameClock').textContent = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
    $('#gamePeriod').textContent = hours < 6 ? 'NACHT' : hours < 12 ? 'MORGEN' : hours < 18 ? 'TAG' : 'ABEND';
    currentSeason = seasonInfo();
    $('#seasonLabel').textContent = currentSeason.name.toUpperCase();

    const needs = $('#needsList'); needs.innerHTML = '';
    Object.entries(NEED_META).forEach(([key, meta]) => {
      const value = Math.round(pet[key]);
      const tone = value <= 15 ? 'critical' : value <= 35 ? 'warning' : '';
      needs.insertAdjacentHTML('beforeend', `<div class="need-row ${tone}"><span class="need-icon">${meta.icon}</span><div class="need-info"><span>${meta.label}</span><div class="need-bar"><i style="width:${value}%;background:${meta.color}"></i></div></div><span class="need-value">${value}</span></div>`);
    });

    const attention = attentionStatus(pet);
    $('#attentionCard').className = `attention-card ${attention.tone}`;
    $('#attentionTitle').textContent = attention.title;
    $('#attentionText').textContent = attention.text;

    const character = $('#petCharacter');
    character.className = `pet-character ${pet.species} ${stageClass(pet.stage)}${pet.sick ? ' sick' : ''}${pet.asleep ? ' sleeping' : ''}${!pet.alive ? ' dead' : ''}`;
    character.setAttribute('aria-label', `${pet.name}, ${species.name}, ${pet.stage}${pet.sick ? ', krank' : ''}`);
    $('#petBubble').textContent = pet.alive ? (pet.sick ? '+' : pet.asleep ? 'z' : '♥') : '×';
    $('#petRoom').classList.toggle('night', !pet.lightOn);
    $('#sleepCloud').classList.toggle('hidden', !pet.asleep);
    $('#poopArea').innerHTML = Array.from({ length: pet.poop }, () => '<span class="poop"></span>').join('');
    $$('.care-action').forEach(button => button.disabled = !pet.alive);

    const done = pet.questDone[dateKey()] || {};
    $('#questList').innerHTML = QUESTS.map(quest => `<div class="quest-item ${done[quest.id] ? 'done' : ''}"><span class="check">${done[quest.id] ? '✓' : ''}</span><div><b>${quest.label}</b><small>${quest.detail}</small></div><span>+${quest.xp}</span></div>`).join('');
    $('#dailyProgress').textContent = `${Object.keys(done).length}/4`;
    $('#nextEventTitle').textContent = events[0].title;
    $('#nextEventDate').textContent = `In ${Math.max(0, Math.ceil((events[0].date - now()) / 86400000))} Tagen`;
    renderEvents();
  }

  function attentionStatus(pet) {
    if (!pet.alive) return { tone: 'danger', title: 'Lebenszyklus beendet', text: pet.deathReason || 'Dein Gotchi lebt nicht mehr.' };
    if (pet.sick) return { tone: 'danger', title: 'Medizin benötigt', text: 'Krankheit senkt laufend die Gesundheit.' };
    if (pet.poop > 0 || pet.cleanliness < 30) return { tone: 'warning', title: 'Pflege benötigt', text: 'Reinige das Zimmer, bevor Krankheit entsteht.' };
    const lowest = Object.keys(NEED_META).sort((a, b) => pet[a] - pet[b])[0];
    if (pet[lowest] < 25) return { tone: 'danger', title: `${NEED_META[lowest].label} kritisch`, text: 'Handle jetzt, bevor ein Pflegefehler entsteht.' };
    if (pet[lowest] < 45) return { tone: 'warning', title: `${NEED_META[lowest].label} beachten`, text: 'Noch ist genug Zeit für die richtige Pflege.' };
    return { tone: '', title: 'Alles bestens', text: 'Dein Gotchi ist rundum versorgt.' };
  }

  function renderEvents() {
    const eligibility = tournamentEligibility();
    $('#eventList').innerHTML = events.map(event => {
      const date = new Date(event.date);
      const joined = state.joinedEvents.includes(event.id);
      const label = joined ? 'Angemeldet ✓' : eligibility.ok ? 'Teilnehmen' : 'Gesperrt';
      return `<article class="event-card"><div class="event-date"><b>${String(date.getDate()).padStart(2, '0')}</b><small>${date.toLocaleDateString('de-DE', { month: 'short' }).replace('.', '').toUpperCase()}</small></div><div class="event-main"><span class="event-meta">${event.format} · ${event.points} Punkte</span><h3>${event.title}</h3><p>${event.location}</p></div><button class="secondary-button ${joined || eligibility.ok ? 'eligible' : 'locked'}" data-event="${event.id}" ${joined ? 'disabled' : ''} title="${escapeHtml(joined ? 'Bereits angemeldet' : eligibility.reason)}">${label}</button></article>`;
    }).join('');
    $$('[data-event]').forEach(button => button.addEventListener('click', () => joinTournament(button.dataset.event)));
    $('#seasonCardTitle').textContent = `${currentSeason.name} ${new Date().getFullYear()}`;
    $('#seasonPoints').textContent = String(state.seasonPoints);
    $('#seasonRank').textContent = state.seasonPoints >= 500 ? 'Solar' : state.seasonPoints >= 250 ? 'Prisma' : state.seasonPoints >= 100 ? 'Pionier' : '—';
  }

  const RULE_CONTENT = {
    basics: `<span class="micro-label">KAPITEL 01</span><h2>Grundlagen</h2><p>Customagotchi ist ein fortlaufendes virtuelles Haustierspiel. Jedes Profil darf genau ein aktives Wesen besitzen. Besitz und Pflege sind registrierten Mitgliedern ab dem Rang <strong>Plus</strong> vorbehalten.</p><div class="rule-highlight"><strong>Speicherung:</strong> Der Spielstand wird automatisch auf diesem Gerät im Browser gespeichert. Ein Löschen der Browserdaten entfernt auch den lokalen Spielstand.</div><h3>Mitgliedschaften</h3><table class="rule-table"><thead><tr><th>RANG</th><th>GOTCHI-BESITZ</th><th>TURNIERZUGANG</th></tr></thead><tbody><tr><td>Gast</td><td>Nein</td><td>Nein</td></tr><tr><td>Plus</td><td>Ja</td><td>Nach 7 Tagen</td></tr><tr><td>Pro</td><td>Ja</td><td>Sofort</td></tr><tr><td>Elite</td><td>Ja</td><td>Sofort</td></tr><tr><td>Legend</td><td>Ja</td><td>Sofort</td></tr></tbody></table><p>Alle vier Ränge können monatlich, jährlich oder einmalig als Lifetime-Mitgliedschaft gewählt werden.</p>`,
    care: `<span class="micro-label">KAPITEL 02</span><h2>Pflege &amp; Leben</h2><p>Die Grundwerte Sättigung, Freude, Energie, Sauberkeit, Gesundheit und Disziplin verändern sich in Echtzeit. Schlaf regeneriert Energie; Krankheit und Vernachlässigung senken Gesundheit.</p><ul><li><strong>Mahlzeit:</strong> sättigt stark und unterstützt Gesundheit, erhöht aber das Gewicht.</li><li><strong>Snack:</strong> bringt schnell Freude, ist bei Überfütterung jedoch ein Pflegefehler.</li><li><strong>Spiel:</strong> das Sternfänger-Minispiel steigert Freude und senkt Stress.</li><li><strong>Training:</strong> verbessert Disziplin, verbraucht Energie und unterstützt ein gesundes Gewicht.</li><li><strong>Pflege:</strong> entfernt Ausscheidungen und stellt Sauberkeit her.</li><li><strong>Medizin:</strong> heilt Krankheit; ohne Krankheit verabreicht gilt sie als Fehler.</li><li><strong>Schlaf &amp; Licht:</strong> Schlaf füllt Energie. Licht während des Schlafs stört das Wesen.</li></ul><h3>Entwicklung</h3><p>Das Wesen durchläuft Baby, Kind, Teen und Erwachsen. Pflegefehler, Disziplin und Gesundheit beeinflussen den unsichtbaren Entwicklungswert und damit die Turnierqualität.</p>`,
    difficulty: `<span class="micro-label">KAPITEL 03</span><h2>Schwierigkeitsgrade</h2><p>Innerhalb der Artenspanne kann die genaue Stufe gewählt werden. Höhere Stufen lassen Bedürfnisse etwas schneller sinken.</p><table class="rule-table"><thead><tr><th>ART</th><th>LEVEL</th><th>FEHLERFOLGE</th></tr></thead><tbody>${Object.values(SPECIES).map(s => `<tr><td>${s.name}</td><td>${s.min}–${s.max}</td><td>${s.quirk}</td></tr>`).join('')}</tbody></table><div class="rule-highlight"><strong>Wichtig:</strong> Ein Fehler entsteht nur durch eine falsche Pflegehandlung oder wenn Sättigung, Energie oder Sauberkeit vollständig auf null fallen. Warnungen erscheinen vorher deutlich im Spiel.</div>`,
    tournament: `<span class="micro-label">KAPITEL 04</span><h2>Ablauf eines Turniers</h2><ol><li><strong>Ankündigung:</strong> Termin, Ort, Format und Anmeldefenster werden im Turnier-Newsletter und im Ingame-Postfach bekanntgegeben.</li><li><strong>Anmeldung:</strong> Berechtigte Mitglieder melden ein lebendes, erwachsenes Gotchi mit mindestens 70 % Gesundheit an.</li><li><strong>Check-in:</strong> 30 Minuten vor Start werden Spielstand, Art, Level und Integrität geprüft.</li><li><strong>Pflege-Sprint:</strong> In mehreren zeitlich begrenzten Runden müssen Bedürfnisse präzise erkannt und korrekt behandelt werden.</li><li><strong>Kür:</strong> Disziplin, Gesundheit, Entwicklungsqualität und Fehlerfreiheit fließen in die Wertung ein.</li><li><strong>Finale:</strong> Bei Gleichstand entscheidet zuerst die geringere Fehlerzahl, danach die Reaktionszeit.</li></ol><h3>Austragungsorte</h3><p>Online-Turniere laufen in der <strong>Customa Arena</strong>. Hybrid- und Präsenzfinals finden saisonal in angekündigten Partner-Arenen statt, beispielsweise in Berlin, Hamburg oder München. Der verbindliche Ort steht immer in der jeweiligen Turnierankündigung.</p>`,
    eligibility: `<span class="micro-label">KAPITEL 05</span><h2>Teilnahmebedingungen</h2><p>Die Teilnahme ist möglich, wenn mindestens eine der folgenden Kontobedingungen erfüllt ist:</p><ul><li>Das registrierte Profil besteht seit mindestens sieben vollen Tagen und besitzt mindestens Plus.</li><li>Oder das Profil besitzt einen der drei höchsten Ränge: <strong>Pro, Elite oder Legend</strong>. Diese Ränge erhalten sofortigen Turnierzugang.</li></ul><p>Zusätzlich muss das gemeldete Customagotchi leben, die Entwicklungsstufe „Erwachsen“ erreicht haben und zum Anmeldezeitpunkt mindestens 70 % Gesundheit besitzen.</p><div class="rule-highlight">Mitgliedschaften sind monatlich, jährlich oder als Lifetime-Kauf verfügbar. Die Laufzeit ändert nichts an der sportlichen Wertung.</div><h3>Fair Play</h3><p>Manipulierte Spielstände, Mehrfachanmeldungen desselben Wesens, absichtliche Zeitveränderungen oder technische Eingriffe führen zum Ausschluss. Bei Verbindungsabbruch gilt die in der Turnierankündigung genannte Wiederholungsregel.</p>`,
    rewards: `<span class="micro-label">KAPITEL 06</span><h2>Saison &amp; Belohnungen</h2><p>Turnierpunkte werden über eine gesamte Saison gesammelt. Nach Saisonende wird die Rangliste geprüft, ausgewertet und anschließend im Newsletter sowie im Turnierbereich bekanntgegeben.</p><table class="rule-table"><thead><tr><th>SCHWELLE</th><th>BELOHNUNG</th><th>ART</th></tr></thead><tbody><tr><td>100 Punkte</td><td>Pflege-Pionier</td><td>Saisonabzeichen</td></tr><tr><td>250 Punkte</td><td>Prisma-Rahmen</td><td>Profilkosmetik</td></tr><tr><td>500 Punkte</td><td>Solar-Krone</td><td>Legendärer Titel</td></tr></tbody></table><h3>Preisgabe</h3><p>Die vorläufigen Punkte sind live sichtbar. Endgültige Gewinner und Sonderpreise werden erst nach der saisonalen Integritätsprüfung preisgegeben. Belohnungen sind spielbezogen und haben keinen Geldwert.</p>`
  };

  function renderRules() {
    $('#ruleContent').innerHTML = RULE_CONTENT[activeRule];
    $$('.rule-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.rule === activeRule));
  }

  function requestPetCreation(preselected = 'hamster') {
    if (!isOwnerEligible()) { openMembershipModal(); return; }
    if (state.pet?.alive) { toast('Pro Profil ist nur ein aktives Customagotchi möglich.', 'warn'); switchView('home'); return; }
    openCreatePetModal(preselected);
  }

  function openMembershipModal() {
    openModal(`
      <span class="micro-label">MITGLIEDSCHAFT</span><h2 id="modalTitle">Dein Customagotchi wartet.</h2>
      <p class="modal-lead">Registriere dein lokales Profil und wähle mindestens Plus. Es findet keine echte Zahlung statt; diese vollständig offline lauffähige Ausgabe simuliert die Mitgliedschaft.</p>
      <form id="membershipForm">
        <div class="form-grid"><div class="field"><label for="memberName">Anzeigename</label><input id="memberName" name="name" required minlength="2" maxlength="20" autocomplete="nickname" placeholder="z. B. Alex"></div><div class="field"><label for="memberEmail">E-Mail</label><input id="memberEmail" name="email" required type="email" autocomplete="email" placeholder="name@beispiel.de"></div></div>
        <div class="plan-grid">${['plus','pro','elite','legend'].map((plan, index) => `<label class="plan-choice"><input type="radio" name="plan" value="${plan}" ${index === 0 ? 'checked' : ''}><span><b>${plan.toUpperCase()}</b><small>${plan === 'plus' ? 'ab 7 Tagen' : 'Turnier sofort'}</small></span></label>`).join('')}</div>
        <div class="field"><label for="billing">Laufzeit</label><select id="billing" name="billing"><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option><option value="lifetime">Lifetime · einmalig</option></select></div>
        <label class="consent"><input type="checkbox" required> <span>Ich akzeptiere das Regelwerk und weiß, dass mein Spielstand lokal in diesem Browser gespeichert wird.</span></label>
        <div class="modal-actions"><button type="button" class="secondary-button" data-modal-close>Abbrechen</button><button class="primary-button" type="submit">Profil registrieren <span>→</span></button></div>
      </form>`);
    $('[data-modal-close]').addEventListener('click', closeModal);
    $('#membershipForm').addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const name = String(form.get('name') || '').trim();
      const email = String(form.get('email') || '').trim();
      if (name.length < 2 || !email.includes('@')) return;
      state.profile = { name, email, plan: String(form.get('plan')), billing: String(form.get('billing')), registeredAt: now(), newsletter: true };
      seedMail(); saveState(); closeModal(); renderAll(); toast(`Willkommen, ${name}!`, 'good'); setTimeout(() => openCreatePetModal('hamster'), 250);
    });
  }

  function openCreatePetModal(preselected = 'hamster') {
    const initial = SPECIES[preselected] ? preselected : 'hamster';
    openModal(`
      <span class="micro-label">NEUES LEBEN</span><h2 id="modalTitle">Wähle dein Wesen.</h2>
      <p class="modal-lead">Die Art kann nach dem Schlüpfen nicht geändert werden. Beginne im Zweifel mit dem fehlerfreundlichen Hamster.</p>
      <form id="createPetForm">
        <div class="species-select-list">${Object.entries(SPECIES).map(([key, s]) => `<label class="species-radio"><input type="radio" name="species" value="${key}" ${key === initial ? 'checked' : ''}><span><i style="--species-color:${s.color}"></i><b>${s.name}</b></span></label>`).join('')}</div>
        <div class="form-grid"><div class="field"><label for="petName">Name</label><input id="petName" name="petName" required minlength="2" maxlength="16" value="Mochi" autocomplete="off"></div><div class="field"><label for="difficultyValue">Difficulty-Level</label><input id="difficultyValue" value="${SPECIES[initial].min}" readonly></div></div>
        <div class="difficulty-control"><input type="range" id="difficultySlider" name="difficulty" aria-label="Schwierigkeitsgrad" min="${SPECIES[initial].min}" max="${SPECIES[initial].max}" value="${SPECIES[initial].min}"><div class="difficulty-labels"><span id="difficultyMin">${SPECIES[initial].min}</span><span id="difficultyMax">${SPECIES[initial].max}</span></div></div>
        <div class="mode-preview" id="modePreview"><strong>${SPECIES[initial].mode}</strong><br>${SPECIES[initial].quirk}</div>
        <div class="modal-actions"><button type="button" class="secondary-button" data-modal-close>Abbrechen</button><button class="primary-button" type="submit">Ei schlüpfen lassen <span>→</span></button></div>
      </form>`);
    const updateDifficulty = () => {
      const key = $('input[name="species"]:checked', $('#createPetForm')).value;
      const s = SPECIES[key]; const slider = $('#difficultySlider');
      slider.min = s.min; slider.max = s.max; slider.value = s.min;
      $('#difficultyValue').value = s.min; $('#difficultyMin').textContent = s.min; $('#difficultyMax').textContent = s.max;
      $('#modePreview').innerHTML = `<strong>${s.mode}</strong><br>${s.quirk}`;
    };
    $$('input[name="species"]', $('#createPetForm')).forEach(input => input.addEventListener('change', updateDifficulty));
    $('#difficultySlider').addEventListener('input', event => $('#difficultyValue').value = event.target.value);
    $('[data-modal-close]').addEventListener('click', closeModal);
    $('#createPetForm').addEventListener('submit', event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      createPet(String(form.get('petName') || '').trim(), String(form.get('species')), Number(form.get('difficulty')));
    });
  }

  function createPet(name, speciesKey, difficulty) {
    const species = SPECIES[speciesKey];
    if (!species || !isOwnerEligible()) return;
    const safeName = name.slice(0, 16);
    if (safeName.length < 2) return;
    const level = Math.max(species.min, Math.min(species.max, Math.round(difficulty)));
    state.pet = {
      id: uid(), name: safeName, species: speciesKey, difficulty: level, bornAt: now(), lastUpdated: now(),
      gameHours: 0, stage: 'Baby', hunger: 82, happiness: 85, energy: 78, cleanliness: 100, health: 100, discipline: 55, stress: 10,
      weight: speciesKey === 'dino' ? 9 : speciesKey === 'alien' ? 4 : 5, poop: 0, nextPoopAt: 5.5, sick: false,
      asleep: false, lightOn: true, alive: true, xp: 0, streak: 1, careMistakes: 0, evolutionScore: 100,
      history: [{ at: now(), text: `Als ${species.name} auf Level ${level} geschlüpft` }], questDone: {}, criticalNoted: {}
    };
    saveState(); closeModal(); switchView('home'); renderAll(); showMessage(`Hallo! Ich bin ${safeName}.`); toast(`${safeName} ist geschlüpft!`, 'good'); beep(760, .18);
  }

  function openAccountModal() {
    if (!state.profile) return openMembershipModal();
    const billing = { monthly: 'Monatlich', yearly: 'Jährlich', lifetime: 'Lifetime' }[state.profile.billing] || state.profile.billing;
    const petButton = state.pet?.alive
      ? `<button class="secondary-button full" id="accountStats">Gotchi-Werte öffnen</button>`
      : `<button class="primary-button full" id="accountCreate">${state.pet ? 'Neues Leben beginnen' : 'Gotchi auswählen'} <span>→</span></button>`;
    openModal(`<span class="micro-label">DEIN PROFIL</span><h2 id="modalTitle">Hallo, ${escapeHtml(state.profile.name)}.</h2><p class="modal-lead">Mitglied seit ${formatDate(state.profile.registeredAt)}. Der Spielstand liegt ausschließlich auf diesem Gerät.</p><div class="account-overview"><div class="account-stat"><small>RANG</small><b>${state.profile.plan.toUpperCase()}</b></div><div class="account-stat"><small>LAUFZEIT</small><b>${billing}</b></div><div class="account-stat"><small>MITGLIEDSDAUER</small><b>${accountAgeDays()} Tag(e)</b></div><div class="account-stat"><small>TURNIER</small><b>${tournamentEligibility().reason}</b></div></div>${petButton}<div class="modal-actions"><button class="secondary-button" data-modal-close>Schließen</button></div>`);
    $('[data-modal-close]').addEventListener('click', closeModal);
    $('#accountStats')?.addEventListener('click', () => { closeModal(); openStatsModal(); });
    $('#accountCreate')?.addEventListener('click', () => { if (state.pet && !state.pet.alive) state.pet = null; closeModal(); saveState(); requestPetCreation(); });
  }

  function openStatsModal() {
    const pet = state.pet; if (!pet) return;
    const stats = [
      ['Art / Level', `${SPECIES[pet.species].name} · ${pet.difficulty}`], ['Alter', `Tag ${Math.floor(pet.gameHours / 24) + 1}`], ['Gewicht', `${pet.weight.toFixed(1)} kg`],
      ['Pflegefehler', pet.careMistakes], ['Entwicklung', `${Math.round(pet.evolutionScore)} %`], ['Saisonpunkte', state.seasonPoints]
    ];
    openModal(`<span class="micro-label">STATUS &amp; VERLAUF</span><h2 id="modalTitle">${escapeHtml(pet.name)}</h2><p class="modal-lead">${SPECIES[pet.species].mode} · ${pet.stage} · ${pet.alive ? 'lebendig' : 'verstorben'}</p><div class="stat-modal-grid">${stats.map(([label,value]) => `<div class="stat-tile"><small>${label}</small><b>${value}</b></div>`).join('')}</div><h3>Letzte Ereignisse</h3><div class="history-list">${pet.history.length ? pet.history.map(item => `<div class="history-item"><time>${new Date(item.at).toLocaleString('de-DE')}</time>${escapeHtml(item.text)}</div>`).join('') : '<div class="history-item">Noch keine Ereignisse.</div>'}</div><div class="modal-actions"><button class="secondary-button" data-modal-close>Schließen</button></div>`);
    $('[data-modal-close]').addEventListener('click', closeModal);
  }

  function openDeathModal() {
    const pet = state.pet; if (!pet || pet.alive) return;
    openModal(`<div class="death-panel"><div class="death-icon">◇</div><span class="micro-label">DER KREIS SCHLIESST SICH</span><h2 id="modalTitle">Leb wohl, ${escapeHtml(pet.name)}.</h2><p class="modal-lead">${escapeHtml(pet.deathReason || 'Der Lebenszyklus ist beendet.')}<br><br>${pet.name} erreichte ${pet.stage}, sammelte ${pet.xp} XP und erlebte ${pet.careMistakes} Pflegefehler.</p><button class="primary-button" id="newLife">Ein neues Leben beginnen <span>→</span></button></div>`);
    $('#newLife').addEventListener('click', () => { state.pet = null; saveState(); closeModal(); renderAll(); requestPetCreation(); });
  }

  function seedMail() {
    if (state.mail.length) return;
    state.mail = events.slice(0, 2).map((event, index) => ({ id: uid(), at: now() - index * 60000, read: false, subject: `Turnierankündigung: ${event.title}`, body: `Am ${formatDate(event.date)} findet „${event.title}“ statt. Austragungsort: ${event.location}. Prüfe deine Teilnahmeberechtigung im Turnierbereich.` }));
  }

  function openInboxModal() {
    if (!state.profile) return openMembershipModal();
    seedMail();
    openModal(`<span class="micro-label">E-MAIL-NEWSLETTER · LOKALES POSTFACH</span><h2 id="modalTitle">Turnier-Postfach</h2><p class="modal-lead">Diese Offline-Ausgabe bildet die Newsletter-Zustellung im Spiel ab. Für echten E-Mail-Versand ist nach der Veröffentlichung ein Mailserver erforderlich.</p><div class="mail-list">${state.mail.map(mail => `<article class="mail-item ${mail.read ? '' : 'unread'}"><time>${new Date(mail.at).toLocaleString('de-DE')}</time><h3>${escapeHtml(mail.subject)}</h3><p>${escapeHtml(mail.body)}</p></article>`).join('')}</div><div class="modal-actions"><button class="secondary-button" data-modal-close>Schließen</button></div>`);
    state.mail.forEach(mail => mail.read = true); saveState(); renderAccount();
    $('[data-modal-close]').addEventListener('click', closeModal);
  }

  function joinTournament(eventId) {
    const eligibility = tournamentEligibility();
    if (!eligibility.ok) { toast(eligibility.reason, 'warn'); return; }
    if (!events.some(event => event.id === eventId) || state.joinedEvents.includes(eventId)) return;
    state.joinedEvents.push(eventId); state.seasonPoints += 5;
    const event = events.find(item => item.id === eventId);
    state.mail.unshift({ id: uid(), at: now(), read: false, subject: `Anmeldung bestätigt: ${event.title}`, body: `${state.pet.name} ist angemeldet. Check-in ist 30 Minuten vor Beginn am Ort „${event.location}“.` });
    saveState(); renderAll(); toast(`Anmeldung für ${event.title} bestätigt.`, 'good'); beep(800, .12);
  }

  function openModal(html) {
    $('#modalContent').innerHTML = html;
    $('#modalBackdrop').classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    setTimeout(() => $('#modal input, #modal button, #modal select')?.focus(), 20);
  }

  function closeModal() {
    $('#modalBackdrop').classList.add('hidden');
    $('#modalContent').innerHTML = '';
    document.body.style.overflow = '';
  }

  function switchView(view) {
    if (!$('#view-' + view)) return;
    currentView = view;
    $$('.view').forEach(node => node.classList.toggle('active', node.id === `view-${view}`));
    $$('.nav-link').forEach(node => node.classList.toggle('active', node.dataset.view === view));
    window.scrollTo({ top: 0, behavior: 'smooth' });
    if (view === 'tournaments') renderEvents();
  }

  function resetGame() {
    openModal(`<span class="micro-label">SPIELSTAND ZURÜCKSETZEN</span><h2 id="modalTitle">Wirklich alles löschen?</h2><p class="modal-lead">Profil, Gotchi, Turnieranmeldungen, Postfach und Fortschritt werden unwiderruflich von diesem Gerät entfernt.</p><div class="modal-actions"><button class="secondary-button" data-modal-close>Abbrechen</button><button class="danger-button" id="confirmReset">Alles löschen</button></div>`);
    $('[data-modal-close]').addEventListener('click', closeModal);
    $('#confirmReset').addEventListener('click', () => { localStorage.removeItem(STORAGE_KEY); state = defaultState(); closeModal(); renderAll(); switchView('home'); toast('Lokaler Spielstand wurde gelöscht.', 'good'); });
  }

  function bindEvents() {
    $$('.nav-link').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
    $$('[data-view-target]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.viewTarget)));
    $$('[data-open="membership"]').forEach(button => button.addEventListener('click', openMembershipModal));
    $$('.care-action').forEach(button => button.addEventListener('click', () => performAction(button.dataset.action)));
    $$('.rule-tab').forEach(button => button.addEventListener('click', () => { activeRule = button.dataset.rule; renderRules(); }));
    $('#accountButton').addEventListener('click', openAccountModal);
    $('#createPetBanner').addEventListener('click', () => requestPetCreation());
    $('#openStats').addEventListener('click', openStatsModal);
    $('#openInbox').addEventListener('click', openInboxModal);
    $('#modalClose').addEventListener('click', closeModal);
    $('#modalBackdrop').addEventListener('click', event => { if (event.target === $('#modalBackdrop')) closeModal(); });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !$('#modalBackdrop').classList.contains('hidden')) closeModal(); });
    $('#soundToggle').addEventListener('click', () => { state.sound = !state.sound; saveState(); renderAccount(); if (state.sound) beep(600); });
    $('#newsletterToggle').addEventListener('change', event => {
      if (!state.profile) { event.target.checked = false; openMembershipModal(); return; }
      state.profile.newsletter = event.target.checked;
      if (event.target.checked) seedMail();
      saveState(); renderAccount(); toast(event.target.checked ? 'Turnier-Newsletter aktiviert.' : 'Turnier-Newsletter pausiert.', 'good');
    });
    $('#resetData').addEventListener('click', resetGame);
  }

  function boot() {
    bindEvents();
    if (state.pet?.alive) {
      const elapsed = Math.max(0, now() - state.pet.lastUpdated);
      advanceSimulation(elapsed, true);
      if (elapsed > MAX_OFFLINE_MS) state.mail.unshift({ id: uid(), at: now(), read: false, subject: 'Willkommen zurück', body: 'Die Offline-Simulation wurde zum Schutz deines Gotchis auf zwei Stunden begrenzt.' });
    }
    renderAll(); saveState();
    if (state.pet && !state.pet.alive) setTimeout(openDeathModal, 350);
    setInterval(() => {
      if (state.pet?.alive) advanceSimulation(now() - state.pet.lastUpdated, false);
      renderGame(); saveState();
    }, TICK_MS);
    if ('serviceWorker' in navigator && location.protocol.startsWith('http')) navigator.serviceWorker.register('./sw.js').catch(() => {});
  }

  boot();
})();
