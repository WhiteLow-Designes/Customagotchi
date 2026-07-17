(() => {
  'use strict';

  const SAVE_KEY = 'customagotchi.save.v1';
  const ACCOUNTS_KEY = 'customagotchi.accounts.v1';
  const ACTIVE_KEY = 'customagotchi.active-account.v1';
  const MUSIC_KEY = 'customagotchi.music.v1';
  const HASH_ITERATIONS = 120000;

  const originalGetItem = Storage.prototype.getItem;
  const originalSetItem = Storage.prototype.setItem;
  const originalRemoveItem = Storage.prototype.removeItem;

  const readJson = (storage, key, fallback) => {
    try {
      const value = originalGetItem.call(storage, key);
      return value ? JSON.parse(value) : fallback;
    } catch (_) {
      return fallback;
    }
  };

  const writeJson = (storage, key, value) => {
    originalSetItem.call(storage, key, JSON.stringify(value));
  };

  const normalizeEmail = value => String(value || '').trim().toLowerCase();
  const now = () => Date.now();
  const escapeHtml = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  })[char]);

  function accountStore() {
    const store = readJson(localStorage, ACCOUNTS_KEY, null);
    if (!store || typeof store !== 'object' || !store.accounts || typeof store.accounts !== 'object') {
      return { version: 1, accounts: {} };
    }
    return store;
  }

  function saveAccountStore(store) {
    writeJson(localStorage, ACCOUNTS_KEY, store);
  }

  function activeAccountKey() {
    return normalizeEmail(originalGetItem.call(localStorage, ACTIVE_KEY));
  }

  function profileFromAccount(account) {
    return {
      name: account.name,
      email: account.email,
      plan: account.plan,
      billing: account.billing,
      registeredAt: account.registeredAt,
      newsletter: account.newsletter !== false
    };
  }

  function emptySave(profile = null) {
    return {
      version: 1,
      profile,
      pet: null,
      sound: true,
      seasonPoints: 0,
      joinedEvents: [],
      mail: [],
      lastSaved: now()
    };
  }

  function currentAccount() {
    const key = activeAccountKey();
    const store = accountStore();
    return key && store.accounts[key] ? { key, account: store.accounts[key], store } : null;
  }

  function migrateLegacyProfile() {
    const store = accountStore();
    if (Object.keys(store.accounts).length) return;

    const legacySave = readJson(localStorage, SAVE_KEY, null);
    const profile = legacySave && legacySave.profile;
    const emailKey = normalizeEmail(profile && profile.email);
    if (!profile || !emailKey) return;

    store.accounts[emailKey] = {
      id: `legacy-${now().toString(36)}`,
      name: String(profile.name || 'Mitglied'),
      email: String(profile.email),
      plan: String(profile.plan || 'plus'),
      billing: String(profile.billing || 'monthly'),
      registeredAt: Number(profile.registeredAt) || now(),
      newsletter: profile.newsletter !== false,
      passwordHash: '',
      salt: '',
      iterations: HASH_ITERATIONS,
      needsPassword: true,
      save: legacySave
    };
    saveAccountStore(store);
    originalSetItem.call(localStorage, ACTIVE_KEY, emailKey);
  }

  function mountActiveAccount() {
    migrateLegacyProfile();
    const current = currentAccount();
    if (!current) {
      const guestSave = readJson(localStorage, SAVE_KEY, emptySave());
      originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify({
        ...emptySave(),
        sound: guestSave && typeof guestSave.sound === 'boolean' ? guestSave.sound : true
      }));
      return;
    }

    const profile = profileFromAccount(current.account);
    const save = current.account.save && typeof current.account.save === 'object'
      ? { ...emptySave(profile), ...current.account.save, profile }
      : emptySave(profile);
    current.account.save = save;
    saveAccountStore(current.store);
    originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify(save));
  }

  function syncMountedSave(value) {
    const current = currentAccount();
    if (!current) return;
    try {
      const parsed = JSON.parse(value);
      parsed.profile = profileFromAccount(current.account);
      current.account.save = parsed;
      current.account.newsletter = parsed.profile.newsletter !== false;
      saveAccountStore(current.store);
    } catch (_) {
      // Ungültige Fremddaten werden nicht in ein Konto übernommen.
    }
  }

  Storage.prototype.setItem = function patchedSetItem(key, value) {
    originalSetItem.call(this, key, value);
    if (this === localStorage && key === SAVE_KEY) syncMountedSave(value);
  };

  Storage.prototype.removeItem = function patchedRemoveItem(key) {
    if (this === localStorage && key === SAVE_KEY) {
      const current = currentAccount();
      if (current) {
        current.account.save = emptySave(profileFromAccount(current.account));
        saveAccountStore(current.store);
        originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify(current.account.save));
        return;
      }
    }
    originalRemoveItem.call(this, key);
  };

  mountActiveAccount();

  function bytesToBase64(bytes) {
    let binary = '';
    bytes.forEach(byte => { binary += String.fromCharCode(byte); });
    return btoa(binary);
  }

  function base64ToBytes(value) {
    const binary = atob(value);
    return Uint8Array.from(binary, char => char.charCodeAt(0));
  }

  function newSalt() {
    const bytes = new Uint8Array(16);
    crypto.getRandomValues(bytes);
    return bytesToBase64(bytes);
  }

  async function hashPassword(password, saltBase64, iterations = HASH_ITERATIONS) {
    if (!window.crypto || !crypto.subtle) throw new Error('Die sichere Passwortfunktion ist in diesem Browser nicht verfügbar.');
    const material = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(password),
      { name: 'PBKDF2' },
      false,
      ['deriveBits']
    );
    const bits = await crypto.subtle.deriveBits({
      name: 'PBKDF2',
      hash: 'SHA-256',
      salt: base64ToBytes(saltBase64),
      iterations
    }, material, 256);
    return bytesToBase64(new Uint8Array(bits));
  }

  function secureEqual(left, right) {
    if (left.length !== right.length) return false;
    let difference = 0;
    for (let index = 0; index < left.length; index += 1) difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
    return difference === 0;
  }

  function modalElements() {
    return {
      backdrop: document.querySelector('#modalBackdrop'),
      content: document.querySelector('#modalContent')
    };
  }

  function openAuthModal(html) {
    const { backdrop, content } = modalElements();
    if (!backdrop || !content) return;
    content.innerHTML = html;
    backdrop.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => content.querySelector('input, button, select')?.focus());
  }

  function closeAuthModal() {
    const { backdrop, content } = modalElements();
    if (!backdrop || !content) return;
    backdrop.classList.add('hidden');
    content.innerHTML = '';
    document.body.style.overflow = '';
  }

  function authError(message) {
    const node = document.querySelector('#authError');
    if (!node) return;
    node.textContent = message;
    node.hidden = false;
  }

  function accountCount() {
    return Object.keys(accountStore().accounts).length;
  }

  function openAuthChoice() {
    openAuthModal(`
      <span class="micro-label">CUSTOMAGOTCHI-KONTO</span>
      <h2 id="modalTitle">Willkommen!</h2>
      <p class="modal-lead">Registriere ein neues lokales Konto oder melde dich mit einem bereits auf diesem Gerät angelegten Konto an.</p>
      <div class="auth-choice-grid">
        <button class="auth-choice-card" type="button" data-auth-action="register">
          <span>✦</span><strong>Registrieren</strong><small>Neues Konto und Profil erstellen</small>
        </button>
        <button class="auth-choice-card" type="button" data-auth-action="login">
          <span>→</span><strong>Login</strong><small>Vorhandenes Konto öffnen</small>
        </button>
      </div>
      <p class="auth-local-note">Konten und Spielstände bleiben wegen GitHub Pages ausschließlich in diesem Browser gespeichert.</p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-auth-close>Schließen</button></div>`);
  }

  function openRegisterModal() {
    openAuthModal(`
      <span class="micro-label">NEUES KONTO</span>
      <h2 id="modalTitle">Customagotchi registrieren</h2>
      <p class="modal-lead">Erstelle dein lokales Konto. Das Passwort wird mit PBKDF2 und einem individuellen Salt gehasht gespeichert.</p>
      <form id="localRegisterForm">
        <div class="form-grid">
          <div class="field"><label for="registerName">Anzeigename</label><input id="registerName" name="name" required minlength="2" maxlength="20" autocomplete="nickname"></div>
          <div class="field"><label for="registerEmail">E-Mail</label><input id="registerEmail" name="email" required type="email" autocomplete="email"></div>
          <div class="field"><label for="registerPassword">Passwort</label><input id="registerPassword" name="password" required type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
          <div class="field"><label for="registerPasswordRepeat">Passwort wiederholen</label><input id="registerPasswordRepeat" name="passwordRepeat" required type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
        </div>
        <div class="plan-grid">${['plus', 'pro', 'elite', 'legend'].map((plan, index) => `<label class="plan-choice"><input type="radio" name="plan" value="${plan}" ${index === 0 ? 'checked' : ''}><span><b>${plan.toUpperCase()}</b><small>${plan === 'plus' ? 'ab 7 Tagen' : 'Turnier sofort'}</small></span></label>`).join('')}</div>
        <div class="field"><label for="registerBilling">Laufzeit</label><select id="registerBilling" name="billing"><option value="monthly">Monatlich</option><option value="yearly">Jährlich</option><option value="lifetime">Lifetime · einmalig</option></select></div>
        <label class="consent"><input name="consent" type="checkbox" required> <span>Ich akzeptiere das Regelwerk und weiß, dass Konto und Spielstand lokal auf diesem Gerät gespeichert werden.</span></label>
        <p class="auth-error" id="authError" hidden></p>
        <div class="modal-actions"><button class="secondary-button" type="button" data-auth-action="login">Zum Login</button><button class="primary-button" type="submit">Registrieren <span>→</span></button></div>
      </form>`);

    document.querySelector('#localRegisterForm')?.addEventListener('submit', registerAccount);
  }

  async function registerAccount(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const form = new FormData(event.currentTarget);
    const name = String(form.get('name') || '').trim();
    const email = String(form.get('email') || '').trim();
    const emailKey = normalizeEmail(email);
    const password = String(form.get('password') || '');
    const repeat = String(form.get('passwordRepeat') || '');

    if (name.length < 2) return authError('Der Anzeigename muss mindestens zwei Zeichen lang sein.');
    if (!/^\S+@\S+\.\S+$/.test(email)) return authError('Bitte gib eine gültige E-Mail-Adresse ein.');
    if (password.length < 8) return authError('Das Passwort muss mindestens acht Zeichen lang sein.');
    if (password !== repeat) return authError('Die beiden Passwörter stimmen nicht überein.');

    const store = accountStore();
    if (store.accounts[emailKey]) return authError('Für diese E-Mail-Adresse existiert auf diesem Gerät bereits ein Konto.');

    try {
      submit.disabled = true;
      submit.textContent = 'Wird erstellt …';
      const salt = newSalt();
      const passwordHash = await hashPassword(password, salt, HASH_ITERATIONS);
      const profile = {
        name,
        email,
        plan: String(form.get('plan') || 'plus'),
        billing: String(form.get('billing') || 'monthly'),
        registeredAt: now(),
        newsletter: true
      };
      store.accounts[emailKey] = {
        id: `account-${now().toString(36)}`,
        ...profile,
        salt,
        passwordHash,
        iterations: HASH_ITERATIONS,
        needsPassword: false,
        save: emptySave(profile)
      };
      saveAccountStore(store);
      originalSetItem.call(localStorage, ACTIVE_KEY, emailKey);
      originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify(store.accounts[emailKey].save));
      location.reload();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Registrieren →';
      authError(error.message || 'Das Konto konnte nicht erstellt werden.');
    }
  }

  function openLoginModal() {
    const existing = accountCount();
    openAuthModal(`
      <span class="micro-label">BEREITS REGISTRIERT</span>
      <h2 id="modalTitle">Einloggen</h2>
      <p class="modal-lead">Melde dich mit einem Konto an, das zuvor in diesem Browser registriert wurde.${existing ? ` ${existing} Konto/Konten sind vorhanden.` : ' Auf diesem Gerät wurde noch kein Konto angelegt.'}</p>
      <form id="localLoginForm">
        <div class="form-grid auth-login-grid">
          <div class="field full-field"><label for="loginEmail">E-Mail</label><input id="loginEmail" name="email" required type="email" autocomplete="email"></div>
          <div class="field full-field"><label for="loginPassword">Passwort</label><input id="loginPassword" name="password" required type="password" autocomplete="current-password"></div>
        </div>
        <p class="auth-error" id="authError" hidden></p>
        <div class="modal-actions"><button class="secondary-button" type="button" data-auth-action="register">Registrieren</button><button class="primary-button" type="submit">Login <span>→</span></button></div>
      </form>`);

    document.querySelector('#localLoginForm')?.addEventListener('submit', loginAccount);
  }

  async function loginAccount(event) {
    event.preventDefault();
    const submit = event.currentTarget.querySelector('button[type="submit"]');
    const form = new FormData(event.currentTarget);
    const emailKey = normalizeEmail(form.get('email'));
    const password = String(form.get('password') || '');
    const store = accountStore();
    const account = store.accounts[emailKey];
    if (!account) return authError('Dieses Konto wurde in diesem Browser nicht gefunden.');
    if (account.needsPassword) return openLegacyPasswordModal(emailKey);

    try {
      submit.disabled = true;
      submit.textContent = 'Wird geprüft …';
      const candidate = await hashPassword(password, account.salt, account.iterations || HASH_ITERATIONS);
      if (!secureEqual(candidate, account.passwordHash)) {
        submit.disabled = false;
        submit.textContent = 'Login →';
        return authError('E-Mail-Adresse oder Passwort ist falsch.');
      }
      originalSetItem.call(localStorage, ACTIVE_KEY, emailKey);
      mountActiveAccount();
      location.reload();
    } catch (error) {
      submit.disabled = false;
      submit.textContent = 'Login →';
      authError(error.message || 'Die Anmeldung konnte nicht geprüft werden.');
    }
  }

  function openLegacyPasswordModal(emailKey = activeAccountKey()) {
    const store = accountStore();
    const account = store.accounts[emailKey];
    if (!account) return openLoginModal();
    openAuthModal(`
      <span class="micro-label">KONTO-AKTUALISIERUNG</span>
      <h2 id="modalTitle">Login-Passwort festlegen</h2>
      <p class="modal-lead">Dein bisheriges Profil „${escapeHtml(account.name)}“ wurde übernommen. Lege jetzt ein Passwort fest, damit du dich nach einer Abmeldung wieder einloggen kannst.</p>
      <form id="legacyPasswordForm">
        <div class="form-grid auth-login-grid">
          <div class="field full-field"><label for="legacyPassword">Neues Passwort</label><input id="legacyPassword" name="password" required type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
          <div class="field full-field"><label for="legacyPasswordRepeat">Passwort wiederholen</label><input id="legacyPasswordRepeat" name="passwordRepeat" required type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
        </div>
        <p class="auth-error" id="authError" hidden></p>
        <div class="modal-actions"><button class="primary-button" type="submit">Passwort speichern <span>→</span></button></div>
      </form>`);

    document.querySelector('#legacyPasswordForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const password = String(form.get('password') || '');
      const repeat = String(form.get('passwordRepeat') || '');
      if (password.length < 8) return authError('Das Passwort muss mindestens acht Zeichen lang sein.');
      if (password !== repeat) return authError('Die beiden Passwörter stimmen nicht überein.');
      const submit = event.currentTarget.querySelector('button[type="submit"]');
      try {
        submit.disabled = true;
        submit.textContent = 'Wird gespeichert …';
        const salt = newSalt();
        account.salt = salt;
        account.passwordHash = await hashPassword(password, salt, HASH_ITERATIONS);
        account.iterations = HASH_ITERATIONS;
        account.needsPassword = false;
        saveAccountStore(store);
        closeAuthModal();
        updateAuthUi();
      } catch (error) {
        submit.disabled = false;
        submit.textContent = 'Passwort speichern →';
        authError(error.message || 'Das Passwort konnte nicht gespeichert werden.');
      }
    });
  }

  function openAccountPanel() {
    const current = currentAccount();
    if (!current) return openAuthChoice();
    const account = current.account;
    const billing = { monthly: 'Monatlich', yearly: 'Jährlich', lifetime: 'Lifetime' }[account.billing] || account.billing;
    openAuthModal(`
      <span class="micro-label">ANGEMELDETES KONTO</span>
      <h2 id="modalTitle">Hallo, ${escapeHtml(account.name)}.</h2>
      <p class="modal-lead">Dein Konto und Spielstand sind lokal in diesem Browser gespeichert.</p>
      <div class="account-overview">
        <div class="account-stat"><small>E-MAIL</small><b>${escapeHtml(account.email)}</b></div>
        <div class="account-stat"><small>RANG</small><b>${escapeHtml(String(account.plan).toUpperCase())}</b></div>
        <div class="account-stat"><small>LAUFZEIT</small><b>${escapeHtml(billing)}</b></div>
        <div class="account-stat"><small>STATUS</small><b>Angemeldet</b></div>
      </div>
      <div class="modal-actions auth-account-actions">
        <button class="secondary-button" type="button" data-auth-close>Schließen</button>
        <button class="secondary-button" type="button" data-auth-action="change-password">Passwort ändern</button>
        <button class="danger-button" type="button" data-auth-action="logout" ${account.needsPassword ? 'disabled title="Lege zuerst ein Passwort fest"' : ''}>Abmelden</button>
      </div>
      ${account.needsPassword ? '<p class="auth-error visible">Bitte lege zuerst ein Passwort fest, damit du dich später wieder anmelden kannst.</p><button class="primary-button full" type="button" data-auth-action="legacy-password">Passwort jetzt festlegen</button>' : ''}`);
  }

  function openChangePasswordModal() {
    const current = currentAccount();
    if (!current) return openLoginModal();
    if (current.account.needsPassword) return openLegacyPasswordModal(current.key);
    openAuthModal(`
      <span class="micro-label">KONTOSICHERHEIT</span>
      <h2 id="modalTitle">Passwort ändern</h2>
      <form id="changePasswordForm">
        <div class="form-grid auth-login-grid">
          <div class="field full-field"><label for="currentPassword">Aktuelles Passwort</label><input id="currentPassword" name="currentPassword" required type="password" autocomplete="current-password"></div>
          <div class="field full-field"><label for="newPassword">Neues Passwort</label><input id="newPassword" name="newPassword" required type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
          <div class="field full-field"><label for="newPasswordRepeat">Neues Passwort wiederholen</label><input id="newPasswordRepeat" name="newPasswordRepeat" required type="password" minlength="8" maxlength="128" autocomplete="new-password"></div>
        </div>
        <p class="auth-error" id="authError" hidden></p>
        <div class="modal-actions"><button class="secondary-button" type="button" data-auth-action="account">Zurück</button><button class="primary-button" type="submit">Passwort ändern <span>→</span></button></div>
      </form>`);

    document.querySelector('#changePasswordForm')?.addEventListener('submit', async event => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const oldPassword = String(form.get('currentPassword') || '');
      const newPassword = String(form.get('newPassword') || '');
      const repeat = String(form.get('newPasswordRepeat') || '');
      if (newPassword.length < 8) return authError('Das neue Passwort muss mindestens acht Zeichen lang sein.');
      if (newPassword !== repeat) return authError('Die neuen Passwörter stimmen nicht überein.');
      const candidate = await hashPassword(oldPassword, current.account.salt, current.account.iterations || HASH_ITERATIONS);
      if (!secureEqual(candidate, current.account.passwordHash)) return authError('Das aktuelle Passwort ist falsch.');
      const salt = newSalt();
      current.account.salt = salt;
      current.account.passwordHash = await hashPassword(newPassword, salt, HASH_ITERATIONS);
      current.account.iterations = HASH_ITERATIONS;
      saveAccountStore(current.store);
      openAccountPanel();
    });
  }

  function logoutAccount() {
    const current = currentAccount();
    if (!current || current.account.needsPassword) return;
    const currentSave = readJson(localStorage, SAVE_KEY, emptySave(profileFromAccount(current.account)));
    currentSave.profile = profileFromAccount(current.account);
    current.account.save = currentSave;
    saveAccountStore(current.store);
    originalRemoveItem.call(localStorage, ACTIVE_KEY);
    originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify(emptySave()));
    location.reload();
  }

  function resetCurrentAccountGame() {
    const current = currentAccount();
    if (!current) {
      originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify(emptySave()));
      location.reload();
      return;
    }
    openAuthModal(`
      <span class="micro-label">SPIELSTAND ZURÜCKSETZEN</span>
      <h2 id="modalTitle">Fortschritt wirklich löschen?</h2>
      <p class="modal-lead">Gotchi, Turnierfortschritt und Postfach werden gelöscht. Dein registriertes Konto und Login bleiben erhalten.</p>
      <div class="modal-actions"><button class="secondary-button" type="button" data-auth-close>Abbrechen</button><button class="danger-button" type="button" id="confirmAccountReset">Spielstand löschen</button></div>`);
    document.querySelector('#confirmAccountReset')?.addEventListener('click', () => {
      current.account.save = emptySave(profileFromAccount(current.account));
      saveAccountStore(current.store);
      originalSetItem.call(localStorage, SAVE_KEY, JSON.stringify(current.account.save));
      location.reload();
    });
  }

  function updateAuthUi() {
    const current = currentAccount();
    const guestActions = document.querySelector('#guestAuthActions');
    const accountButton = document.querySelector('#accountButton');
    const accountLabel = document.querySelector('#accountLabel');
    const guestHero = document.querySelector('#guestHeroActions');
    const memberHero = document.querySelector('#memberHeroActions');

    guestActions?.classList.toggle('hidden', Boolean(current));
    accountButton?.classList.toggle('hidden', !current);
    guestHero?.classList.toggle('hidden', Boolean(current));
    memberHero?.classList.toggle('hidden', !current);
    if (accountLabel) accountLabel.textContent = current ? `${current.account.name} · ${String(current.account.plan).toUpperCase()}` : '';
  }

  function interceptAuthInteractions() {
    document.addEventListener('click', event => {
      const actionNode = event.target.closest('[data-auth-action]');
      if (actionNode) {
        event.preventDefault();
        event.stopImmediatePropagation();
        const action = actionNode.dataset.authAction;
        if (action === 'register') openRegisterModal();
        else if (action === 'login') openLoginModal();
        else if (action === 'logout') logoutAccount();
        else if (action === 'account') openAccountPanel();
        else if (action === 'change-password') openChangePasswordModal();
        else if (action === 'legacy-password') openLegacyPasswordModal();
        return;
      }

      if (event.target.closest('[data-auth-close]')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        closeAuthModal();
        return;
      }

      if (event.target.closest('#accountButton')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openAccountPanel();
        return;
      }

      if (event.target.closest('#resetData')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        resetCurrentAccountGame();
        return;
      }

      if (!currentAccount() && event.target.closest('[data-open="membership"], #createPetBanner, .choose-species, #openInbox')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openAuthChoice();
      }
    }, true);

    document.addEventListener('change', event => {
      if (!currentAccount() && event.target.matches('#newsletterToggle')) {
        event.preventDefault();
        event.stopImmediatePropagation();
        event.target.checked = false;
        openAuthChoice();
      }
    }, true);
  }

  class CheerfulMusic {
    constructor() {
      this.context = null;
      this.master = null;
      this.timer = 0;
      this.step = 0;
      this.nextNoteAt = 0;
      this.running = false;
      this.settings = {
        volume: 0.18,
        muted: false,
        paused: false,
        ...readJson(localStorage, MUSIC_KEY, {})
      };
      this.sequence = [
        [523.25, 0.28], [659.25, 0.28], [783.99, 0.28], [659.25, 0.28],
        [587.33, 0.28], [698.46, 0.28], [880.00, 0.28], [698.46, 0.28],
        [659.25, 0.28], [783.99, 0.28], [987.77, 0.28], [783.99, 0.28],
        [587.33, 0.28], [698.46, 0.28], [783.99, 0.28], [659.25, 0.56]
      ];
      this.bass = [261.63, 293.66, 329.63, 293.66];
    }

    saveSettings() {
      writeJson(localStorage, MUSIC_KEY, this.settings);
    }

    ensureContext() {
      if (this.context) return;
      const Context = window.AudioContext || window.webkitAudioContext;
      if (!Context) return;
      this.context = new Context();
      this.master = this.context.createGain();
      this.master.gain.value = this.settings.muted ? 0 : this.settings.volume;
      this.master.connect(this.context.destination);
    }

    scheduleTone(frequency, start, duration, type = 'sine', volume = 0.08) {
      if (!this.context || !this.master) return;
      const oscillator = this.context.createOscillator();
      const gain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(volume, start + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(gain);
      gain.connect(this.master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.03);
    }

    scheduleStep() {
      const [frequency, duration] = this.sequence[this.step];
      this.scheduleTone(frequency, this.nextNoteAt, duration, 'triangle', 0.055);
      this.scheduleTone(frequency * 2, this.nextNoteAt, duration * 0.7, 'sine', 0.018);
      if (this.step % 4 === 0) {
        const bassIndex = Math.floor(this.step / 4) % this.bass.length;
        this.scheduleTone(this.bass[bassIndex], this.nextNoteAt, 0.72, 'sine', 0.025);
      }
      this.step = (this.step + 1) % this.sequence.length;
      this.nextNoteAt += 0.31;
    }

    scheduler() {
      if (!this.context || !this.running) return;
      while (this.nextNoteAt < this.context.currentTime + 0.25) this.scheduleStep();
    }

    async play() {
      if (this.settings.paused) return;
      this.ensureContext();
      if (!this.context) return;
      try { await this.context.resume(); } catch (_) { /* Start erfolgt beim nächsten Benutzerklick. */ }
      if (this.context.state !== 'running') {
        this.running = false;
        this.updateUi('Startet beim ersten Klick');
        return;
      }
      if (!this.running) {
        this.running = true;
        this.nextNoteAt = this.context.currentTime + 0.06;
        this.timer = window.setInterval(() => this.scheduler(), 90);
      }
      this.updateVolume();
      this.updateUi('Läuft');
    }

    pause() {
      this.settings.paused = true;
      this.saveSettings();
      this.running = false;
      if (this.timer) window.clearInterval(this.timer);
      this.timer = 0;
      this.context?.suspend().catch(() => {});
      this.updateUi('Pausiert');
    }

    resume() {
      this.settings.paused = false;
      this.saveSettings();
      this.play();
    }

    togglePause() {
      if (this.settings.paused || !this.running) this.resume();
      else this.pause();
    }

    toggleMute() {
      this.settings.muted = !this.settings.muted;
      this.saveSettings();
      this.updateVolume();
      this.updateUi(this.settings.paused ? 'Pausiert' : this.running ? 'Läuft' : 'Bereit');
    }

    setVolume(percent) {
      this.settings.volume = Math.max(0, Math.min(1, Number(percent) / 100));
      if (this.settings.volume > 0) this.settings.muted = false;
      this.saveSettings();
      this.updateVolume();
      this.updateUi(this.settings.paused ? 'Pausiert' : this.running ? 'Läuft' : 'Bereit');
    }

    updateVolume() {
      if (!this.master || !this.context) return;
      const target = this.settings.muted ? 0 : this.settings.volume;
      this.master.gain.cancelScheduledValues(this.context.currentTime);
      this.master.gain.linearRampToValueAtTime(target, this.context.currentTime + 0.08);
    }

    updateUi(status) {
      const play = document.querySelector('#musicPlayPause');
      const mute = document.querySelector('#musicMute');
      const volume = document.querySelector('#musicVolume');
      const label = document.querySelector('#musicStatus');
      if (play) {
        play.textContent = this.settings.paused || !this.running ? '▶ Abspielen' : 'Ⅱ Pausieren';
        play.setAttribute('aria-pressed', String(!this.settings.paused && this.running));
      }
      if (mute) {
        mute.textContent = this.settings.muted ? '♪ Ton an' : '× Stumm';
        mute.setAttribute('aria-pressed', String(this.settings.muted));
      }
      if (volume) volume.value = String(Math.round(this.settings.volume * 100));
      if (label) label.textContent = `Hintergrundmusik: ${status}${this.settings.muted ? ' · stumm' : ''}`;
    }
  }

  const music = new CheerfulMusic();

  function initMusic() {
    document.querySelector('#musicPlayPause')?.addEventListener('click', () => music.togglePause());
    document.querySelector('#musicMute')?.addEventListener('click', () => music.toggleMute());
    document.querySelector('#musicVolume')?.addEventListener('input', event => music.setVolume(event.target.value));
    music.updateUi(music.settings.paused ? 'Pausiert' : 'Wird vorbereitet');

    if (!music.settings.paused) music.play();
    const unlock = () => {
      if (!music.settings.paused && !music.running) music.play();
      document.removeEventListener('pointerdown', unlock, true);
      document.removeEventListener('keydown', unlock, true);
    };
    document.addEventListener('pointerdown', unlock, true);
    document.addEventListener('keydown', unlock, true);
  }

  function init() {
    interceptAuthInteractions();
    updateAuthUi();
    initMusic();
    const current = currentAccount();
    if (current?.account.needsPassword) window.setTimeout(() => openLegacyPasswordModal(current.key), 500);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true });
  else init();
})();
