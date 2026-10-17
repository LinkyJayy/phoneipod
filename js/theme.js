// Theme model. Keys marked `linked` follow the accent color until the user sets them explicitly.
const Theme = (() => {
  const STORAGE_KEY = 'phoneipod.theme';

  const KEYS = [
    { key: 'accent', label: 'Accent Color', css: '--accent' },
    { key: 'selectionTop', label: 'Selection Top', css: '--selection-top', linked: a => mix(a, '#ffffff', 0.22) },
    { key: 'selectionBottom', label: 'Selection Bottom', css: '--selection-bottom', linked: a => mix(a, '#000000', 0.12) },
    { key: 'selectionText', label: 'Selection Text', css: '--selection-text' },
    { key: 'background', label: 'Background', css: '--background' },
    { key: 'text', label: 'Text', css: '--text' },
    { key: 'secondaryText', label: 'Secondary Text', css: '--secondary-text' },
    { key: 'chevron', label: 'Arrows & Icons', css: '--chevron' },
    { key: 'headerTop', label: 'Title Bar Top', css: '--header-top' },
    { key: 'headerBottom', label: 'Title Bar Bottom', css: '--header-bottom' },
    { key: 'headerText', label: 'Title Bar Text', css: '--header-text' },
    { key: 'headerLine', label: 'Title Bar Line', css: '--header-line' },
    { key: 'playIcon', label: 'Play Icon', css: '--play-icon', linked: a => mix(a, '#000000', 0.15) },
    { key: 'batteryOutline', label: 'Battery Outline', css: '--battery-outline' },
    { key: 'batteryFill', label: 'Battery Fill', css: '--battery-fill', linked: a => a },
    { key: 'batteryLow', label: 'Battery Low', css: '--battery-low' },
    { key: 'batteryCharging', label: 'Battery Charging', css: '--battery-charging' },
    { key: 'progressFill', label: 'Progress Bar', css: '--progress-fill', linked: a => a },
    { key: 'progressTrack', label: 'Progress Track', css: '--progress-track' },
    { key: 'scrollThumb', label: 'Scroll Bar', css: '--scroll-thumb', linked: a => mix(a, '#000000', 0.1) },
    { key: 'scrollTrack', label: 'Scroll Track', css: '--scroll-track' },
  ];

  // `null` means "follow the accent color".
  const DEFAULT = {
    accent: '#b8a1e3',
    selectionTop: null,
    selectionBottom: null,
    selectionText: '#ffffff',
    background: '#ffffff',
    text: '#000000',
    secondaryText: '#6b6b6b',
    chevron: '#000000',
    headerTop: '#fefefe',
    headerBottom: '#d2d2d2',
    headerText: '#000000',
    headerLine: '#9a9a9a',
    playIcon: null,
    batteryOutline: '#5c5c5c',
    batteryFill: null,
    batteryLow: '#e0473f',
    batteryCharging: '#f2c230',
    progressFill: null,
    progressTrack: '#e6e6e6',
    scrollThumb: null,
    scrollTrack: '#ececec',
  };

  const PRESETS = [
    { name: 'Pastel Purple', values: {} },
    { name: 'Classic Blue', values: { accent: '#3f86e0', batteryFill: '#5fc341' } },
    { name: 'Mint', values: { accent: '#7fd1b0' } },
    { name: 'Peach', values: { accent: '#f4a77c' } },
    { name: 'Rose', values: { accent: '#ee8fb0' } },
    { name: 'Sky', values: { accent: '#8cc4f0' } },
    { name: 'Lemon', values: { accent: '#e8cf52', selectionText: '#2a2a2a' } },
    {
      name: 'Midnight',
      values: {
        accent: '#9d86d8', background: '#121214', text: '#f2f2f2', secondaryText: '#9a9aa0',
        chevron: '#e6e6e6', headerTop: '#3a3a40', headerBottom: '#1d1d21', headerText: '#f2f2f2',
        headerLine: '#000000', batteryOutline: '#c8c8c8', progressTrack: '#2c2c31', scrollTrack: '#202024',
      },
    },
    {
      name: 'Silver & Black',
      values: {
        accent: '#5a5a5a', selectionTop: '#7a7a7a', selectionBottom: '#2e2e2e', batteryFill: '#5fc341',
      },
    },
  ];

  function hexToRgb(hex) {
    const n = parseInt(hex.replace('#', ''), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  function mix(a, b, t) {
    const A = hexToRgb(a);
    const B = hexToRgb(b);
    return '#' + A.map((v, i) => Math.round(v + (B[i] - v) * t).toString(16).padStart(2, '0')).join('');
  }

  const isHex = v => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

  let values = load();

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      return sanitize(saved);
    } catch {
      return { ...DEFAULT };
    }
  }

  function sanitize(obj) {
    const out = { ...DEFAULT };
    if (obj && typeof obj === 'object') {
      for (const { key, linked } of KEYS) {
        if (isHex(obj[key])) out[key] = obj[key].toLowerCase();
        else if (obj[key] === null && linked) out[key] = null;
      }
    }
    return out;
  }

  function save() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(values)); } catch { /* storage unavailable */ }
  }

  function resolve(key) {
    const def = KEYS.find(k => k.key === key);
    const v = values[key];
    return v == null && def.linked ? def.linked(values.accent) : v;
  }

  function apply() {
    const root = document.documentElement.style;
    for (const { key, css } of KEYS) root.setProperty(css, resolve(key));
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = resolve('headerTop');
  }

  function set(key, value) {
    values[key] = value;
    save();
    apply();
  }

  function applyPreset(preset) {
    values = { ...DEFAULT, ...preset.values };
    save();
    apply();
  }

  function isPreset(preset) {
    const target = { ...DEFAULT, ...preset.values };
    return KEYS.every(({ key }) => target[key] === values[key]);
  }

  return {
    KEYS,
    PRESETS,
    get: key => values[key],
    resolve,
    set,
    isLinked: key => values[key] == null,
    canLink: key => !!KEYS.find(k => k.key === key).linked,
    resetKey: key => set(key, DEFAULT[key]),
    reset: () => applyPreset(PRESETS[0]),
    applyPreset,
    isPreset,
    export: () => JSON.stringify({ phoneipodTheme: 1, values }, null, 2),
    import(json) {
      const parsed = JSON.parse(json);
      values = sanitize(parsed.values || parsed);
      save();
      apply();
    },
    apply,
  };
})();

Theme.apply();
