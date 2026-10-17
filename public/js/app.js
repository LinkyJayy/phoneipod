(() => {
  const $ = id => document.getElementById(id);
  const screenEl = $('screen');
  const titleEl = $('title');
  const backBtn = $('back');
  const playIndicator = $('play-indicator');
  const batteryEl = $('battery');
  const toastEl = $('toast');
  const fileInput = $('file-input');
  const themeInput = $('theme-input');
  const colorInput = $('color-input');

  const SETTINGS_KEY = 'phoneipod.settings';
  const UNKNOWN_ARTIST = 'Unknown Artist';
  const UNKNOWN_ALBUM = 'Unknown Album';

  const ICONS = {
    chevron: '<svg class="chevron" viewBox="0 0 10 16"><polyline points="2,2 8,8 2,14"/></svg>',
    speaker: '<svg class="speaker" viewBox="0 0 24 24"><path d="M3 9h4l5-4v14l-5-4H3z"/><path d="M15.5 8.5a5 5 0 0 1 0 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
    check: '<svg class="check" viewBox="0 0 16 16"><polyline points="2,8.5 6.5,13 14,3"/></svg>',
    note: '<svg viewBox="0 0 24 24"><path d="M9 3v11.55A4 4 0 1 0 11 18V7h6V3H9z"/></svg>',
    prev: '<svg viewBox="0 0 24 24"><path d="M6 5h2v14H6zM20 5v14L9 12z"/></svg>',
    next: '<svg viewBox="0 0 24 24"><path d="M16 5h2v14h-2zM4 5v14l11-7z"/></svg>',
    play: '<svg viewBox="0 0 24 24"><path d="M7 4v16l13-8z"/></svg>',
    pause: '<svg viewBox="0 0 24 24"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>',
  };

  // ---------- State ----------
  const DEFAULT_SETTINGS = { shuffle: false, repeat: 'off', volume: 1 };
  const state = {
    user: null,
    allowSignups: true,
    tracks: [],
    queue: [],
    qi: -1,
    settings: loadSettings(),
  };
  const audio = new Audio();
  audio.preload = 'auto';

  function loadSettings() {
    try {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(localStorage.getItem(SETTINGS_KEY)) };
    } catch {
      return { ...DEFAULT_SETTINGS };
    }
  }

  // Preferences are cached locally and synced to the account, batched so dragging a color doesn't flood the server.
  const pendingPrefs = {};
  let prefsTimer;
  function syncPrefs(part) {
    if (!state.user) return;
    Object.assign(pendingPrefs, part);
    clearTimeout(prefsTimer);
    prefsTimer = setTimeout(() => {
      const body = { ...pendingPrefs };
      for (const k of Object.keys(pendingPrefs)) delete pendingPrefs[k];
      API.savePrefs(body).catch(() => toast("Couldn't save your settings"));
    }, 600);
  }
  Theme.onChange(theme => syncPrefs({ theme }));

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ }
    syncPrefs({ settings: state.settings });
  }
  audio.volume = state.settings.volume;

  // ---------- Helpers ----------
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const byText = (a, b) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true });
  const artistOf = t => t.artist || UNKNOWN_ARTIST;
  const albumOf = t => t.album || UNKNOWN_ALBUM;

  function fmtTime(sec) {
    if (!isFinite(sec) || sec < 0) sec = 0;
    sec = Math.floor(sec);
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = String(sec % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
  }

  function fmtBytes(n) {
    const units = ['B', 'KB', 'MB', 'GB'];
    let i = 0;
    while (n >= 1024 && i < units.length - 1) { n /= 1024; i++; }
    return `${n.toFixed(i ? 1 : 0)} ${units[i]}`;
  }

  function sortedSongs(list = state.tracks) {
    return [...list].sort((a, b) => byText(a.title, b.title));
  }
  function albumSongs(list) {
    return [...list].sort((a, b) => (a.track || 999) - (b.track || 999) || byText(a.title, b.title));
  }
  const unique = arr => [...new Set(arr)].sort(byText);

  const artUrl = track => (track.hasArt ? API.artUrl(track.id) : null);

  let toastTimer;
  function toast(msg, ms = 2200) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    if (ms) toastTimer = setTimeout(() => toastEl.classList.remove('show'), ms);
  }

  // ---------- Playback ----------
  const current = () => state.tracks.find(t => t.id === state.queue[state.qi]);

  function shuffled(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function playList(list, index) {
    let ids = list.map(t => t.id);
    if (state.settings.shuffle) {
      const first = ids[index];
      ids = [first, ...shuffled(ids.filter((_, i) => i !== index))];
      index = 0;
    }
    state.queue = ids;
    state.qi = index;
    load(true);
  }

  function load(autoplay) {
    const t = current();
    if (!t) return stop();
    audio.src = API.audioUrl(t.id);
    if (autoplay) audio.play().catch(() => updateIndicators());
    updateMediaSession();
    refreshPlayingViews();
  }

  function stop() {
    audio.pause();
    audio.removeAttribute('src');
    audio.load();
    state.queue = [];
    state.qi = -1;
    updateIndicators();
    refreshPlayingViews();
  }

  function togglePlay() {
    if (!current()) return;
    if (audio.paused) audio.play().catch(() => {});
    else audio.pause();
  }

  function next(auto = false) {
    if (!state.queue.length) return;
    if (auto && state.settings.repeat === 'one') {
      audio.currentTime = 0;
      audio.play().catch(() => {});
      return;
    }
    if (state.qi < state.queue.length - 1) state.qi++;
    else if (state.settings.repeat === 'all' || !auto) state.qi = 0;
    else {
      audio.pause();
      audio.currentTime = 0;
      return;
    }
    load(true);
  }

  function prev() {
    if (!state.queue.length) return;
    if (audio.currentTime > 3) {
      audio.currentTime = 0;
      return;
    }
    state.qi = state.qi > 0 ? state.qi - 1 : state.queue.length - 1;
    load(true);
  }

  function shuffleAll() {
    if (!state.tracks.length) return toast('Add some tracks first');
    const ids = shuffled(state.tracks.map(t => t.id));
    state.queue = ids;
    state.qi = 0;
    load(true);
    push('nowPlaying');
  }

  audio.addEventListener('ended', () => next(true));
  audio.addEventListener('play', updateIndicators);
  audio.addEventListener('pause', updateIndicators);
  audio.addEventListener('timeupdate', updateProgress);
  audio.addEventListener('loadedmetadata', updateProgress);
  audio.addEventListener('error', () => {
    if (audio.getAttribute('src')) toast("Can't play this file");
  });

  function updateMediaSession() {
    if (!('mediaSession' in navigator)) return;
    const t = current();
    if (!t) return;
    const art = artUrl(t);
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title,
      artist: artistOf(t),
      album: albumOf(t),
      artwork: art ? [{ src: new URL(art, location.href).href, sizes: '512x512' }] : [],
    });
  }
  if ('mediaSession' in navigator) {
    const ms = navigator.mediaSession;
    const handlers = {
      play: () => audio.play(),
      pause: () => audio.pause(),
      previoustrack: prev,
      nexttrack: () => next(),
      seekto: e => { audio.currentTime = e.seekTime; },
    };
    for (const [action, fn] of Object.entries(handlers)) {
      try { ms.setActionHandler(action, fn); } catch { /* unsupported */ }
    }
  }

  function updateIndicators() {
    const has = !!current();
    playIndicator.className = 'play-indicator' + (has ? (audio.paused ? ' paused' : ' playing') : '');
    if (np) np.play.innerHTML = audio.paused ? ICONS.play : ICONS.pause;
    if ('mediaSession' in navigator) navigator.mediaSession.playbackState = has ? (audio.paused ? 'paused' : 'playing') : 'none';
  }

  // ---------- Battery ----------
  function setBattery(level, charging) {
    batteryEl.querySelector('.battery-fill').style.width = `${Math.max(4, level * 100)}%`;
    batteryEl.classList.toggle('charging', charging);
    batteryEl.classList.toggle('low', !charging && level <= 0.2);
    batteryEl.setAttribute('aria-label', `Battery ${Math.round(level * 100)}%${charging ? ', charging' : ''}`);
  }
  setBattery(1, false);
  if (navigator.getBattery) {
    navigator.getBattery().then(b => {
      const update = () => setBattery(b.level, b.charging);
      update();
      b.addEventListener('levelchange', update);
      b.addEventListener('chargingchange', update);
    }).catch(() => {});
  }

  // ---------- Importing tracks ----------
  const AUDIO_EXT = /\.(mp3|m4a|aac|mp4|wav|ogg|oga|opus|flac|webm|aiff?|caf)$/i;

  function metaFromName(name) {
    let base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').trim();
    let artist = '';
    const parts = base.split(' - ');
    if (parts.length >= 2) {
      const [a, ...rest] = parts;
      if (/^\d+$/.test(a.trim())) base = rest.join(' - ');
      else { artist = a.trim(); base = rest.join(' - '); }
    }
    return { title: base.replace(/^\d{1,3}[\s.\-]+/, '').trim() || name, artist };
  }

  function probeDuration(blob) {
    return new Promise(resolve => {
      const a = new Audio();
      const url = URL.createObjectURL(blob);
      let done = false;
      const finish = v => {
        if (done) return;
        done = true;
        URL.revokeObjectURL(url);
        a.removeAttribute('src');
        resolve(v);
      };
      a.preload = 'metadata';
      a.onloadedmetadata = () => finish(isFinite(a.duration) ? a.duration : 0);
      a.onerror = () => finish(null);
      setTimeout(() => finish(0), 10000);
      a.src = url;
    });
  }

  async function importFiles(fileList) {
    const files = [...fileList].filter(f => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name));
    if (!files.length) return toast('No audio files found');
    let added = 0;
    let failed = 0;
    let lastError = '';
    for (const [i, file] of files.entries()) {
      const label = `Uploading ${i + 1} of ${files.length}`;
      toast(`${label}…`, 0);
      const duration = await probeDuration(file);
      if (duration === null) { failed++; lastError = "Your browser can't play that format"; continue; }
      const tags = await ID3.parse(file);
      const fromName = metaFromName(file.name);
      const form = new FormData();
      form.append('meta', JSON.stringify({
        title: tags.title || fromName.title,
        artist: tags.artist || fromName.artist,
        album: tags.album || '',
        track: tags.track,
        duration,
      }));
      form.append('audio', file, file.name);
      if (tags.art) form.append('art', tags.art, 'cover');
      try {
        const track = await API.upload(form, p => toast(`${label}… ${Math.round(p * 100)}%`, 0));
        state.tracks.push(track);
        added++;
      } catch (e) {
        failed++;
        lastError = e.message;
        if (e.status === 401 || e.status === 0) break;
        if (e.status === 413 && /storage/i.test(e.message)) break;
      }
    }
    const summary = `Added ${added} track${added === 1 ? '' : 's'}`;
    toast(failed ? `${summary} · ${failed} failed: ${lastError}` : summary, failed ? 5000 : 3000);
    rerender();
  }

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length) importFiles(fileInput.files);
    fileInput.value = '';
  });
  const pickFiles = () => fileInput.click();

  let dragDepth = 0;
  window.addEventListener('dragenter', e => {
    if (![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    document.body.classList.add('drop-active');
  });
  window.addEventListener('dragleave', () => {
    if (--dragDepth <= 0) { dragDepth = 0; document.body.classList.remove('drop-active'); }
  });
  window.addEventListener('dragover', e => e.preventDefault());
  window.addEventListener('drop', e => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('drop-active');
    if (e.dataTransfer.files.length) importFiles(e.dataTransfer.files);
  });

  async function deleteTracks(ids) {
    const set = new Set(ids);
    if (current() && set.has(current().id)) stop();
    const removed = new Set();
    try {
      for (const id of ids) {
        await API.remove(id);
        removed.add(id);
      }
    } catch (e) {
      toast(e.message);
    }
    set.forEach(id => removed.has(id) || set.delete(id));
    state.tracks = state.tracks.filter(t => !set.has(t.id));
    const cur = state.queue[state.qi];
    state.queue = state.queue.filter(id => !set.has(id));
    state.qi = state.queue.indexOf(cur);
    return set.size;
  }

  // ---------- Theme color picking ----------
  let colorTarget = null;
  colorInput.addEventListener('input', () => {
    if (!colorTarget) return;
    Theme.set(colorTarget, colorInput.value);
    rerender();
  });
  colorInput.addEventListener('change', () => { colorTarget = null; });

  function pickColor(key) {
    colorTarget = key;
    colorInput.value = Theme.resolve(key);
    try {
      if (colorInput.showPicker) colorInput.showPicker();
      else colorInput.click();
    } catch {
      colorInput.click();
    }
  }

  themeInput.addEventListener('change', async () => {
    const file = themeInput.files[0];
    themeInput.value = '';
    if (!file) return;
    try {
      Theme.import(await file.text());
      toast('Theme imported');
      rerender();
    } catch {
      toast("That isn't a valid theme file");
    }
  });

  function exportTheme() {
    const url = URL.createObjectURL(new Blob([Theme.export()], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'phoneipod-theme.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---------- Screens ----------
  // A screen returns { title, items } for a menu, or { title, render(view) } for a custom view.
  const swatch = key => `<span class="swatch" style="background:${Theme.resolve(key)}"></span>`;
  const songItem = (t, list, i, sub) => ({
    label: t.title,
    sub,
    playing: current() && current().id === t.id,
    action: () => { playList(list, i); push('nowPlaying'); },
  });
  const emptyLibrary = () => [{ label: 'Add Tracks…', action: pickFiles }];

  const screens = {
    loading: () => ({ title: 'iPod', render: view => { view.innerHTML = '<div class="message">Loading…</div>'; } }),

    offline: () => ({
      title: 'iPod',
      message: "Can't reach the server. Check your connection.",
      items: [{ label: 'Try Again', chevron: false, action: boot }],
    }),

    welcome: () => ({
      title: 'iPod',
      message: 'Sign in to play your music on any device.',
      items: [
        { label: 'Sign In', to: ['signIn'] },
        state.allowSignups && { label: 'Create Account', to: ['signUp'] },
      ],
    }),

    signIn: () => ({
      title: 'Sign In',
      form: {
        fields: [
          { name: 'username', label: 'Username', autocomplete: 'username' },
          { name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' },
        ],
        submit: 'Sign In',
        onSubmit: async v => signedIn(await API.login(v.username.trim(), v.password)),
      },
    }),

    signUp: () => ({
      title: 'Create Account',
      form: {
        fields: [
          { name: 'username', label: 'Username', autocomplete: 'username' },
          { name: 'password', label: 'Password', type: 'password', autocomplete: 'new-password' },
          { name: 'confirm', label: 'Confirm Password', type: 'password', autocomplete: 'new-password' },
        ],
        hint: '3–32 letters or numbers. Password of at least 8 characters.',
        submit: 'Create Account',
        onSubmit: async v => {
          if (v.password !== v.confirm) throw new Error("Passwords don't match");
          signedIn(await API.signup(v.username.trim(), v.password));
        },
      },
    }),

    account: () => ({
      title: 'Account',
      items: [
        { label: 'Username', value: state.user.username, chevron: false },
        { label: 'Change Password', to: ['changePassword'] },
        { label: 'Sign Out', to: ['confirm', {
          title: 'Sign Out',
          message: 'Sign out of this device? Your music stays in your account.',
          confirm: 'Sign Out',
          onConfirm: async () => {
            await API.logout().catch(() => {});
            signedOut();
          },
        }] },
        { label: 'Delete Account', to: ['deleteAccount'] },
      ],
    }),

    changePassword: () => ({
      title: 'Change Password',
      form: {
        fields: [
          { name: 'current', label: 'Current Password', type: 'password', autocomplete: 'current-password' },
          { name: 'next', label: 'New Password', type: 'password', autocomplete: 'new-password' },
          { name: 'confirm', label: 'Confirm New Password', type: 'password', autocomplete: 'new-password' },
        ],
        hint: 'Other devices will be signed out.',
        submit: 'Change Password',
        onSubmit: async v => {
          if (v.next !== v.confirm) throw new Error("Passwords don't match");
          await API.changePassword(v.current, v.next);
          toast('Password changed');
          back();
        },
      },
    }),

    deleteAccount: () => ({
      title: 'Delete Account',
      form: {
        hint: `This permanently deletes your account and all ${state.tracks.length} of your tracks.`,
        fields: [{ name: 'password', label: 'Password', type: 'password', autocomplete: 'current-password' }],
        submit: 'Delete Account',
        onSubmit: async v => {
          await API.deleteAccount(v.password);
          signedOut();
          toast('Account deleted');
        },
      },
    }),

    main: () => ({
      title: 'iPod',
      items: [
        { label: 'Music', to: ['music'] },
        { label: 'Add Tracks', action: pickFiles, chevron: false },
        { label: 'Settings', to: ['settings'] },
        { label: 'Shuffle Songs', action: shuffleAll, chevron: false },
        current() && { label: 'Now Playing', to: ['nowPlaying'] },
      ],
    }),

    music: () => ({
      title: 'Music',
      items: [
        { label: 'Artists', to: ['artists'] },
        { label: 'Albums', to: ['albums'] },
        { label: 'Songs', to: ['songs'] },
        { label: 'Recently Added', to: ['recent'] },
      ],
    }),

    songs: () => {
      const list = sortedSongs();
      return {
        title: 'Songs',
        empty: 'No songs yet',
        items: list.length ? list.map((t, i) => songItem(t, list, i)) : emptyLibrary(),
      };
    },

    recent: () => {
      const list = [...state.tracks].sort((a, b) => b.added - a.added).slice(0, 50);
      return {
        title: 'Recently Added',
        items: list.length ? list.map((t, i) => songItem(t, list, i, artistOf(t))) : emptyLibrary(),
      };
    },

    artists: () => {
      const artists = unique(state.tracks.map(artistOf));
      return {
        title: 'Artists',
        items: artists.length ? artists.map(a => ({ label: a, to: ['artist', { artist: a }] })) : emptyLibrary(),
      };
    },

    artist: ({ artist }) => {
      const tracks = state.tracks.filter(t => artistOf(t) === artist);
      const albums = unique(tracks.map(albumOf));
      return {
        title: artist,
        items: [
          { label: 'All Songs', to: ['songList', { title: artist, artist }] },
          ...albums.map(al => ({ label: al, to: ['songList', { title: al, artist, album: al }] })),
        ],
      };
    },

    albums: () => {
      const albums = unique(state.tracks.map(albumOf));
      return {
        title: 'Albums',
        items: albums.length ? albums.map(al => {
          const artists = unique(state.tracks.filter(t => albumOf(t) === al).map(artistOf));
          return { label: al, sub: artists.length > 1 ? 'Various Artists' : artists[0], to: ['songList', { title: al, album: al }] };
        }) : emptyLibrary(),
      };
    },

    songList: ({ title, artist, album }) => {
      let list = state.tracks.filter(t => (!artist || artistOf(t) === artist) && (!album || albumOf(t) === album));
      list = album ? albumSongs(list) : sortedSongs(list);
      return { title, items: list.map((t, i) => songItem(t, list, i)) };
    },

    nowPlaying: () => ({ title: 'Now Playing', render: renderNowPlaying }),

    settings: () => ({
      title: 'Settings',
      items: [
        { label: 'Account', to: ['account'] },
        { label: 'Theme', to: ['theme'] },
        { label: 'Shuffle', value: state.settings.shuffle ? 'Songs' : 'Off', action: () => { state.settings.shuffle = !state.settings.shuffle; saveSettings(); rerender(); } },
        { label: 'Repeat', value: { off: 'Off', one: 'One', all: 'All' }[state.settings.repeat], action: () => {
          const order = ['off', 'one', 'all'];
          state.settings.repeat = order[(order.indexOf(state.settings.repeat) + 1) % 3];
          saveSettings();
          rerender();
        } },
        { label: 'Manage Library', to: ['library'] },
        { label: 'About', to: ['about'] },
      ],
    }),

    theme: () => ({
      title: 'Theme',
      items: [
        { label: 'Accent Color', html: swatch('accent'), action: () => pickColor('accent') },
        { label: 'Presets', to: ['presets'] },
        { label: 'Customize Colors', to: ['colors'] },
        { label: 'Export Theme', action: exportTheme, chevron: false },
        { label: 'Import Theme', action: () => themeInput.click(), chevron: false },
        { label: 'Reset Theme', to: ['confirm', {
          title: 'Reset Theme',
          message: 'Restore the default pastel purple theme?',
          confirm: 'Reset',
          onConfirm: () => { Theme.reset(); toast('Theme reset'); },
        }] },
      ],
    }),

    presets: () => ({
      title: 'Presets',
      items: Theme.PRESETS.map(p => ({
        label: p.name,
        html: `<span class="swatch" style="background:${p.values.accent || '#b8a1e3'}"></span>${Theme.isPreset(p) ? ICONS.check : ''}`,
        chevron: false,
        action: () => { Theme.applyPreset(p); rerender(); },
      })),
    }),

    colors: () => ({
      title: 'Colors',
      items: Theme.KEYS.map(({ key, label }) => ({
        label,
        html: (Theme.canLink(key) && Theme.isLinked(key) ? '<span class="swatch-link">Accent</span>' : '') + swatch(key),
        to: key === 'accent' ? null : ['color', { key, label }],
        action: key === 'accent' ? () => pickColor('accent') : null,
      })),
    }),

    color: ({ key, label }) => ({
      title: label,
      items: [
        { label: 'Choose Color…', html: swatch(key), action: () => pickColor(key) },
        Theme.canLink(key) && {
          label: 'Match Accent',
          html: Theme.isLinked(key) ? ICONS.check : '',
          chevron: false,
          action: () => { Theme.set(key, Theme.isLinked(key) ? Theme.resolve(key) : null); rerender(); },
        },
        { label: 'Reset to Default', chevron: false, action: () => { Theme.resetKey(key); rerender(); } },
      ],
    }),

    library: () => ({
      title: 'Manage Library',
      items: [
        { label: 'Add Tracks', action: pickFiles, chevron: false },
        { label: 'Delete Tracks', to: ['deleteList'] },
        state.tracks.length && { label: 'Delete All Tracks', to: ['confirm', {
          title: 'Delete All',
          message: `Delete all ${state.tracks.length} tracks from this device?`,
          confirm: 'Delete All',
          onConfirm: async () => { if (await deleteTracks(state.tracks.map(t => t.id))) toast('Library cleared'); },
        }] },
      ],
    }),

    deleteList: () => {
      const list = sortedSongs();
      return {
        title: 'Delete Tracks',
        items: list.length ? list.map(t => ({
          label: t.title,
          sub: artistOf(t),
          to: ['confirm', {
            title: 'Delete Track',
            message: `Delete “${t.title}”?`,
            confirm: 'Delete',
            onConfirm: async () => { if (await deleteTracks([t.id])) toast('Track deleted'); },
          }],
        })) : [{ label: 'No tracks', disabled: true, chevron: false }],
      };
    },

    confirm: ({ title, message, confirm, onConfirm }) => ({
      title,
      message,
      items: [
        { label: 'Cancel', chevron: false, action: back },
        { label: confirm, chevron: false, action: async () => { await onConfirm(); back(); } },
      ],
    }),

    about: () => {
      const bytes = state.tracks.reduce((n, t) => n + (t.size || 0), 0);
      const total = state.tracks.reduce((n, t) => n + (t.duration || 0), 0);
      return {
        title: 'About',
        items: [
          { label: 'Songs', value: String(state.tracks.length), chevron: false },
          { label: 'Artists', value: String(unique(state.tracks.map(artistOf)).length), chevron: false },
          { label: 'Albums', value: String(unique(state.tracks.map(albumOf)).length), chevron: false },
          { label: 'Play Time', value: fmtTime(total), chevron: false },
          { label: 'Used', value: fmtBytes(bytes), chevron: false },
          { label: 'Version', value: '1.0', chevron: false },
        ],
      };
    },
  };

  // ---------- Navigation & rendering ----------
  const stack = [{ id: 'loading', args: {}, sel: 0, scroll: 0 }];
  let activeList = null; // { el, items, entry }
  let activeForm = null;
  let np = null; // Now Playing element refs

  // Replaces the whole navigation stack, e.g. after signing in or out.
  function resetTo(id) {
    stack.length = 0;
    stack.push({ id, args: {}, sel: 0, scroll: 0 });
    render(0);
  }

  function push(id, args = {}) {
    saveScroll();
    stack.push({ id, args, sel: 0, scroll: 0 });
    render(1);
  }

  function back() {
    if (stack.length === 1) return;
    stack.pop();
    render(-1);
  }

  function saveScroll() {
    if (activeList) activeList.entry.scroll = activeList.el.scrollTop;
  }

  function rerender() {
    if (activeForm) return; // don't wipe what the user is typing
    saveScroll();
    render(0);
  }

  function refreshPlayingViews() {
    const top = stack[stack.length - 1];
    if (top.id === 'nowPlaying' && !current()) { back(); return; }
    rerender();
  }

  function render(direction) {
    const entry = stack[stack.length - 1];
    const def = screens[entry.id](entry.args);
    titleEl.textContent = def.title;
    document.title = def.title === 'iPod' ? 'PhoneiPod' : `${def.title} · PhoneiPod`;
    backBtn.hidden = stack.length === 1;

    const view = document.createElement('div');
    view.className = 'view';
    activeList = null;
    activeForm = null;
    np = null;

    if (def.render) def.render(view);
    else if (def.form) buildForm(view, def);
    else buildList(view, def, entry);

    const old = [...screenEl.children];
    screenEl.appendChild(view);
    if (direction) {
      const dir = direction > 0 ? 'forward' : 'back';
      view.classList.add(`enter-${dir}`);
      old.forEach(o => {
        o.classList.add(`leave-${dir}`);
        o.addEventListener('animationend', () => o.remove(), { once: true });
        setTimeout(() => o.remove(), 400);
      });
    } else {
      old.forEach(o => o.remove());
    }
    if (activeList) {
      activeList.el.scrollTop = entry.scroll;
      updateScrollbar();
    }
    updateIndicators();
    updateProgress();
  }

  function buildForm(view, def) {
    const { fields, hint, submit, onSubmit } = def.form;
    const form = document.createElement('form');
    form.className = 'form';
    form.noValidate = true;
    form.innerHTML =
      (hint ? `<p class="form-hint">${esc(hint)}</p>` : '') +
      fields.map(f => `
        <label class="field">
          <span>${esc(f.label)}</span>
          <input name="${f.name}" type="${f.type || 'text'}" autocomplete="${f.autocomplete || 'off'}"
            autocapitalize="off" autocorrect="off" spellcheck="false" required>
        </label>`).join('') +
      '<div class="form-error" role="alert"></div>' +
      `<button type="submit" class="form-submit">${esc(submit)}</button>`;
    const errorEl = form.querySelector('.form-error');
    const button = form.querySelector('.form-submit');

    form.addEventListener('submit', async e => {
      e.preventDefault();
      const values = Object.fromEntries(new FormData(form));
      if (fields.some(f => !values[f.name])) {
        errorEl.textContent = 'Please fill in every field';
        return;
      }
      errorEl.textContent = '';
      button.disabled = true;
      try {
        await onSubmit(values);
      } catch (err) {
        errorEl.textContent = err.message;
      } finally {
        button.disabled = false;
      }
    });

    view.appendChild(form);
    activeForm = form;
    if (matchMedia('(pointer: fine)').matches) setTimeout(() => form.querySelector('input')?.focus(), 250);
  }

  function buildList(view, def, entry) {
    const items = def.items.filter(Boolean);
    if (def.message) {
      view.classList.add('with-message');
      view.insertAdjacentHTML('beforeend', `<div class="message">${esc(def.message)}</div>`);
    }
    const ul = document.createElement('ul');
    ul.className = 'list';
    ul.setAttribute('role', 'menu');
    entry.sel = Math.min(entry.sel, Math.max(0, items.length - 1));

    items.forEach((item, i) => {
      const li = document.createElement('li');
      li.className = 'row' + (item.sub ? ' two-line' : '') + (item.disabled ? ' disabled' : '');
      li.setAttribute('role', 'menuitem');
      const showChevron = item.chevron !== false && !item.value && !item.disabled && (item.to || item.chevron);
      li.innerHTML =
        `<span class="label">${esc(item.label)}${item.sub ? `<span class="sub">${esc(item.sub)}</span>` : ''}</span>` +
        (item.value ? `<span class="value">${esc(item.value)}</span>` : '') +
        (item.playing ? ICONS.speaker : '') +
        (item.html || '') +
        (showChevron ? ICONS.chevron : '');
      li.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') select(i, false); });
      li.addEventListener('click', () => { select(i, false); activate(i); });
      ul.appendChild(li);
    });

    const bar = document.createElement('div');
    bar.className = 'scrollbar';
    bar.innerHTML = '<div class="scrollbar-thumb"></div>';
    view.append(ul, bar);
    ul.addEventListener('scroll', updateScrollbar, { passive: true });
    activeList = { el: ul, items, entry, view, bar };
    markSelected();
  }

  function markSelected() {
    if (!activeList) return;
    [...activeList.el.children].forEach((li, i) => li.classList.toggle('selected', i === activeList.entry.sel));
  }

  function select(i, scroll = true) {
    if (!activeList || !activeList.items.length) return;
    const n = activeList.items.length;
    activeList.entry.sel = Math.max(0, Math.min(n - 1, i));
    markSelected();
    if (scroll) activeList.el.children[activeList.entry.sel].scrollIntoView({ block: 'nearest' });
  }

  function activate(i) {
    const item = activeList && activeList.items[i];
    if (!item || item.disabled) return;
    if (item.action) item.action();
    else if (item.to) push(...item.to);
  }

  function updateScrollbar() {
    if (!activeList) return;
    const { el, view, bar } = activeList;
    const overflow = el.scrollHeight > el.clientHeight + 1;
    view.classList.toggle('scrollable', overflow);
    bar.style.display = overflow ? '' : 'none';
    if (!overflow) return;
    const ratio = el.clientHeight / el.scrollHeight;
    const h = Math.max(20, bar.clientHeight * ratio);
    const top = (el.scrollTop / (el.scrollHeight - el.clientHeight)) * (bar.clientHeight - h);
    Object.assign(bar.firstChild.style, { height: `${h}px`, top: `${top}px` });
  }
  window.addEventListener('resize', updateScrollbar);

  // ---------- Now Playing view ----------
  function renderNowPlaying(view) {
    const t = current();
    if (!t) {
      view.innerHTML = '<div class="message"><strong>Nothing Playing</strong>Pick a song from Music.</div>';
      return;
    }
    const art = artUrl(t);
    const modes = [
      state.settings.shuffle && 'Shuffle',
      state.settings.repeat !== 'off' && `Repeat ${state.settings.repeat === 'one' ? 'One' : 'All'}`,
    ].filter(Boolean).join(' · ');
    view.innerHTML = `
      <div class="np">
        <div class="np-count">${state.qi + 1} of ${state.queue.length}</div>
        <div class="np-main">
          <div class="np-art">${art ? `<img src="${art}" alt="">` : ICONS.note}</div>
          <div class="np-info">
            <div class="np-title">${esc(t.title)}</div>
            <div class="np-artist">${esc(artistOf(t))}</div>
            <div class="np-album">${esc(albumOf(t))}</div>
          </div>
        </div>
        <div class="np-progress">
          <div class="bar" role="slider" aria-label="Seek"><div class="bar-fill"></div></div>
          <div class="times"><span class="elapsed">0:00</span><span class="remaining">-0:00</span></div>
        </div>
        <div class="np-modes">${esc(modes)}</div>
        <div class="np-controls">
          <button class="prev" aria-label="Previous">${ICONS.prev}</button>
          <button class="play" aria-label="Play/Pause">${ICONS.play}</button>
          <button class="next" aria-label="Next">${ICONS.next}</button>
        </div>
      </div>`;
    const q = s => view.querySelector(s);
    np = { fill: q('.bar-fill'), elapsed: q('.elapsed'), remaining: q('.remaining'), play: q('.play'), bar: q('.bar') };
    q('.prev').addEventListener('click', prev);
    q('.next').addEventListener('click', () => next());
    np.play.addEventListener('click', togglePlay);

    const bar = np.bar;
    const seek = e => {
      const r = bar.getBoundingClientRect();
      const pct = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
      if (isFinite(audio.duration)) audio.currentTime = pct * audio.duration;
      updateProgress();
    };
    bar.addEventListener('pointerdown', e => {
      bar.setPointerCapture(e.pointerId);
      seek(e);
      bar.addEventListener('pointermove', seek);
      bar.addEventListener('pointerup', () => bar.removeEventListener('pointermove', seek), { once: true });
    });
  }

  function updateProgress() {
    if (!np) return;
    const t = current();
    const dur = isFinite(audio.duration) ? audio.duration : (t && t.duration) || 0;
    const pos = audio.currentTime || 0;
    np.fill.style.width = dur ? `${(pos / dur) * 100}%` : '0';
    np.elapsed.textContent = fmtTime(pos);
    np.remaining.textContent = '-' + fmtTime(dur - pos);
  }

  // ---------- Volume overlay ----------
  const volumeEl = $('volume');
  let volumeTimer;
  function changeVolume(delta) {
    audio.volume = Math.max(0, Math.min(1, Math.round((audio.volume + delta) * 20) / 20));
    state.settings.volume = audio.volume;
    saveSettings();
    volumeEl.querySelector('.volume-fill').style.width = `${audio.volume * 100}%`;
    volumeEl.classList.add('show');
    clearTimeout(volumeTimer);
    volumeTimer = setTimeout(() => volumeEl.classList.remove('show'), 1200);
  }

  // ---------- Input ----------
  backBtn.addEventListener('click', back);
  titleEl.addEventListener('click', back);

  document.addEventListener('keydown', e => {
    if (e.target.tagName === 'INPUT' || e.metaKey || e.ctrlKey || e.altKey) return;
    const onNP = stack[stack.length - 1].id === 'nowPlaying';
    const handled = {
      ArrowUp: () => (onNP ? changeVolume(0.05) : select(activeList ? activeList.entry.sel - 1 : 0)),
      ArrowDown: () => (onNP ? changeVolume(-0.05) : select(activeList ? activeList.entry.sel + 1 : 0)),
      ArrowRight: () => (onNP ? next() : activeList && activate(activeList.entry.sel)),
      ArrowLeft: () => (onNP ? prev() : back()),
      Enter: () => (onNP ? togglePlay() : activeList && activate(activeList.entry.sel)),
      Escape: back,
      Backspace: back,
      ' ': togglePlay,
      Home: () => select(0),
      End: () => select(Infinity),
    }[e.key];
    if (handled) {
      e.preventDefault();
      handled();
    }
  });

  // Swipe right from anywhere to go back, like pressing MENU.
  let touchStart = null;
  screenEl.addEventListener('touchstart', e => {
    const t = e.touches[0];
    touchStart = { x: t.clientX, y: t.clientY, time: Date.now() };
  }, { passive: true });
  screenEl.addEventListener('touchend', e => {
    if (!touchStart) return;
    const t = e.changedTouches[0];
    const dx = t.clientX - touchStart.x;
    const dy = Math.abs(t.clientY - touchStart.y);
    if (dx > 70 && dy < 50 && Date.now() - touchStart.time < 600 && !e.target.closest('.bar')) back();
    touchStart = null;
  }, { passive: true });

  // ---------- Boot ----------
  async function signedIn(user) {
    state.user = user;
    const { theme, settings } = user.prefs || {};
    // A brand new account keeps whatever theme was in use when it was created.
    if (theme) Theme.load(theme);
    else syncPrefs({ theme: Theme.values() });
    if (settings) {
      state.settings = { ...DEFAULT_SETTINGS, ...settings };
      audio.volume = state.settings.volume;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings)); } catch { /* ignore */ }
    }
    try {
      state.tracks = await API.tracks();
    } catch (e) {
      state.tracks = [];
      toast(e.message);
    }
    resetTo('main');
  }

  function signedOut() {
    stop();
    state.user = null;
    state.tracks = [];
    resetTo('welcome');
  }

  window.addEventListener('api:unauthorized', () => {
    if (!state.user) return;
    signedOut();
    toast('You were signed out');
  });

  async function boot() {
    resetTo('loading');
    try {
      state.allowSignups = (await API.config()).allowSignups;
    } catch {
      return resetTo('offline');
    }
    try {
      await signedIn(await API.me());
    } catch (e) {
      resetTo(e.status === 0 ? 'offline' : 'welcome');
    }
  }
  boot();

  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
