/* KitaBantu avatar engine — Humation-style black-and-white line-art characters, built from SVG parts.
   An avatar is a small config object: { hair, body, item, glasses, aid, accent }.
   render(cfg, size) -> SVG string. Deterministic, no images, ~1 KB per avatar. */
(function (root) {
  const KBAvatar = (() => {
  const S = 'fill:none;stroke:#111;stroke-width:5;stroke-linecap:round;stroke-linejoin:round';
  const F = 'fill:#111;stroke:#111;stroke-width:4;stroke-linejoin:round';
  const W = 'fill:#fff;stroke:#111;stroke-width:5;stroke-linecap:round;stroke-linejoin:round';

  // ---- heads / hair (face is shared; hair drawn around it) ----
  const face = `<path style="${W}" d="M112 88c0-30 22-52 52-52s52 22 52 52v22c0 30-22 52-52 52s-52-22-52-52z"/>
    <circle cx="143" cy="106" r="4.5" fill="#111"/><circle cx="188" cy="106" r="4.5" fill="#111"/>
    <path style="${S}" d="M165 112c4 6 2 14-4 16"/><path style="${S}" d="M215 116c8-2 12 6 8 14"/>`;
  const neck = `<path style="${W}" d="M150 160 v24 h30 v-24"/>`;
  const HAIR = {
    curly: { name: 'Curly', svg: `<path style="${F}" d="M88 96c-14-8-18-30-6-42 4-18 22-30 40-26 12-16 42-20 62-8 20-4 40 8 44 28 14 6 20 26 12 40 8 14 2 34-14 38-6 8-16 12-24 8 6-12 8-30 4-42-6-12-22-22-42-22-28 0-52 6-62 24-6 10-6 24-2 34-10 2-14-14-12-32z"/>` },
    bob: { name: 'Bob', svg: `<path style="${F}" d="M104 70c0-30 26-46 60-46s60 16 60 46v66c0 10-8 18-18 16 6-16 6-36 0-52-6-16-24-26-42-26s-36 10-42 26c-6 16-6 36 0 52-10 2-18-6-18-16z"/>` },
    short: { name: 'Short', svg: `<path style="${F}" d="M108 92c-6-34 18-58 56-58s62 24 56 58c-8-20-26-32-56-32s-48 12-56 32z"/>` },
    bun: { name: 'Bun', svg: `<circle cx="164" cy="30" r="18" style="${F}"/><path style="${F}" d="M108 92c-6-34 18-58 56-58s62 24 56 58c-8-20-26-32-56-32s-48 12-56 32z"/>` },
    long: { name: 'Long', behind: `<path style="${F}" d="M104 80c0-34 26-54 60-54s60 20 60 54v110c0 10-8 16-16 16h-88c-8 0-16-6-16-16z"/>`, svg: `<path style="${F}" d="M104 92c0-38 26-60 60-60s60 22 60 60c-6-18-20-30-40-32-6 10-14 14-20 14s-14-4-20-14c-20 2-34 14-40 32z"/>` },
    afro: { name: 'Afro', svg: `<path style="${F}" d="M164 12c48 0 82 34 82 76 0 22-10 40-24 52-6-40-26-60-58-60s-52 20-58 60c-14-12-24-30-24-52 0-42 34-76 82-76z"/>` },
    hijab: { name: 'Hijab', behind: `<path style="${W}" d="M96 210c-8-70 2-130 32-160 18-20 54-20 72 0 30 30 40 90 32 160z"/>`, svg: `<path style="${W}" d="M108 96c0-34 24-60 56-60s56 26 56 60c-6-8-18-12-28-6-6-10-16-16-28-16s-22 6-28 16c-10-6-22-2-28 6z"/><path style="${S}" d="M112 104c-10 30-12 64-6 100 M216 104c10 30 12 64 6 100"/>` },
    cap: { name: 'Cap', svg: `<path style="${F}" d="M106 86c-4-32 20-54 58-54s62 22 58 54z"/><path style="${F}" d="M96 86h150c6 0 6 10 0 10H96c-6 0-6-10 0-10z"/>` },
    bald: { name: 'Bald', svg: `` },
  };
  // ---- bodies ----
  const BODY = {
    shirt: { name: 'Shirt', svg: `<path style="${W}" d="M70 300c4-60 30-104 80-116l14 22 14-22c50 12 76 56 80 116z"/><path style="${S}" d="M150 184l14 22 16-22 M164 206v94 M120 240v40 M208 240v40"/>` },
    tee: { name: 'T-shirt', svg: `<path style="${W}" d="M66 300c0-64 30-104 84-116h28c54 12 84 52 84 116z"/><path style="${S}" d="M150 184c0 12 6 18 14 18s14-6 14-18 M104 236v40 M224 236v40"/>` },
    hoodie: { name: 'Hoodie', svg: `<path style="${W}" d="M62 300c0-64 34-108 88-118h28c54 10 88 54 88 118z"/><path style="${S}" d="M136 184c0 26 12 40 28 40s28-14 28-40 M164 224v76 M144 262c0 10 6 16 20 16s20-6 20-16"/>` },
    blazer: { name: 'Blazer', svg: `<path style="${W}" d="M66 300c2-62 30-104 82-116l16 40 16-40c52 12 80 54 82 116z"/><path style="${F}" d="M148 184l16 40 16-40-8 76h-16z"/><path style="${S}" d="M104 236v42 M224 236v42"/>` },
    dress: { name: 'Dress', svg: `<path style="${W}" d="M64 300c14-56 38-100 86-116h28c48 16 72 60 86 116z"/><path style="${S}" d="M150 184c0 12 6 18 14 18s14-6 14-18 M110 300l14-64 M218 300l-14-64"/>` },
    baju: { name: 'Baju', svg: `<path style="${W}" d="M70 300c4-60 30-104 80-116h28c50 12 76 56 80 116z"/><path style="${S}" d="M150 184c0 12 6 18 14 18s14-6 14-18 M164 206v94 M170 240h10 M170 264h10"/>` },
  };
  // ---- items ----
  const ITEM = {
    none: { name: 'None', svg: `` },
    phone: { name: 'Phone', svg: `<rect x="212" y="232" width="34" height="58" rx="6" style="${W}"/><path style="${S}" d="M224 280h10"/>` },
    bag: { name: 'Bag', svg: `<path style="${S}" d="M96 200c-20 30-24 60-20 100"/><rect x="52" y="250" width="58" height="52" rx="10" style="${W}"/>` },
    coffee: { name: 'Coffee', svg: `<path style="${W}" d="M216 250h36l-6 46h-24z"/><path style="${S}" d="M252 260c10 0 14 10 8 18h-10 M226 238c0-6 4-8 8-6 M236 238c0-6 4-8 8-6"/>` },
    book: { name: 'Book', svg: `<path style="${W}" d="M62 256h44v48H62z"/><path style="${S}" d="M106 256h44v48h-44 M84 268v24 M128 268v24"/>` },
    cane: { name: 'White cane', svg: `<path style="${S}" d="M236 226l24 76"/><path style="${F}" d="M256 290l8 26 6-2-8-26z"/>` },
    plant: { name: 'Plant', svg: `<path style="${W}" d="M52 262h44l-6 40H58z"/><path style="${S}" d="M74 262v-26 M74 246c-14-4-20-14-18-26 12 2 20 12 18 26z M74 240c14-4 20-14 18-26-12 2-20 12-18 26z"/>` },
  };
  // ---- glasses ----
  const GLASSES = {
    none: { name: 'None', svg: `` },
    round: { name: 'Round', svg: `<circle cx="140" cy="106" r="15" style="${S}"/><circle cx="190" cy="106" r="15" style="${S}"/><path style="${S}" d="M155 106h20 M125 104l-12-4 M205 104l12-4"/>` },
    square: { name: 'Square', svg: `<rect x="124" y="92" width="32" height="26" rx="6" style="${S}"/><rect x="174" y="92" width="32" height="26" rx="6" style="${S}"/><path style="${S}" d="M156 104h18 M124 100l-12-4 M206 100l12-4"/>` },
    shades: { name: 'Shades', svg: `<path style="${F}" d="M122 94h36v10c0 10-8 16-18 16s-18-6-18-16z M172 94h36v10c0 10-8 16-18 16s-18-6-18-16z"/><path style="${S}" d="M158 98h14 M122 96l-12-4 M208 96l12-4"/>` },
  };
  // ---- mobility aids / accessibility (drawn in front of body) ----
  const AID = {
    none: { name: 'None', svg: `` },
    wheelchair: { name: 'Wheelchair', behind: `<path style="${S}" d="M84 240v-44h-30 M246 240v-44h30"/>`, svg: `<circle cx="78" cy="278" r="28" style="${W}"/><circle cx="78" cy="278" r="7" fill="#111"/><path style="${S}" d="M78 250v56 M50 278h56"/><circle cx="252" cy="278" r="28" style="${W}"/><circle cx="252" cy="278" r="7" fill="#111"/><path style="${S}" d="M252 250v56 M224 278h56"/>` },
    cane: { name: 'Walking stick', svg: `<path style="${S}" d="M250 300l-8-70c-2-10 6-16 14-12"/>` },
    guidedog: { name: 'Guide dog', svg: `<path style="${W}" d="M258 300v-22c0-14 12-22 24-22h20c8 0 12 6 12 12v32z"/><path style="${F}" d="M300 250c0-8 6-12 12-8 4-6 12-4 12 4-2 8-8 12-12 12s-10-2-12-8z"/><circle cx="314" cy="252" r="2" fill="#fff"/><path style="${S}" d="M236 226l24 32"/>` },
    hearing: { name: 'Hearing aid', svg: `<path style="${S}" d="M218 122c8 4 10 14 4 20"/>` },
  };

  const PARTS = { hair: HAIR, body: BODY, item: ITEM, glasses: GLASSES, aid: AID };
  const DEFAULT = { hair: 'curly', body: 'shirt', item: 'none', glasses: 'none', aid: 'none', accent: '#f4f1ea' };

  function normalize(cfg) {
    const c = { ...DEFAULT, ...(cfg || {}) };
    for (const k of Object.keys(PARTS)) if (!PARTS[k][c[k]]) c[k] = DEFAULT[k];
    if (!/^#[0-9a-f]{6}$/i.test(c.accent || '')) c.accent = DEFAULT.accent;
    return c;
  }
  /** Full SVG (viewBox 0 0 330 310). `bg` = 'none' | 'circle' | 'soft' */
  function render(cfg, size = 120, { bg = 'soft', className = '', crop = 'full' } = {}) {
    const c = normalize(cfg);
    const back = bg === 'none' ? '' : bg === 'circle' ? `<circle cx="165" cy="175" r="150" fill="${c.accent}"/>` : `<rect width="330" height="310" rx="60" fill="${c.accent}"/>`;
    const vb = crop === 'bust' ? '40 0 250 250' : crop === 'head' ? '70 -6 190 190' : crop === 'torso' ? '20 40 290 290' : '0 0 330 310';
    return `<svg class="kb-avatar ${className}" xmlns="http://www.w3.org/2000/svg" viewBox="${vb}" width="${size}" height="${size}" role="img" aria-label="avatar">${back}
      <g transform="translate(0,4)">${HAIR[c.hair].behind || ''}${AID[c.aid].behind || ''}${BODY[c.body].svg}${AID[c.aid].svg}${neck}${face}${HAIR[c.hair].svg}${GLASSES[c.glasses].svg}${ITEM[c.item].svg}</g></svg>`;
  }
  /** One option tile for the picker: current config with `kind` swapped to `id` */
  function renderPart(kind, id, size = 64, { crop = 'bust', base = null } = {}) {
    const cfg = { ...DEFAULT, ...(base || {}), [kind]: id, accent: '#ffffff' };
    return render(cfg, size, { bg: 'none', crop });
  }
  function serialize(cfg) { return JSON.stringify(normalize(cfg)); }
  function parse(str) { try { return normalize(typeof str === 'string' ? JSON.parse(str) : str); } catch { return { ...DEFAULT }; } }
  function isConfig(v) { return !!v && (typeof v === 'object' || (typeof v === 'string' && v.startsWith('{'))); }
  const ACCENTS = ['#f4f1ea', '#e9e5f5', '#e4f0ee', '#fbe8e0', '#e8eef8', '#f3e8f2', '#f1f1f1', '#e5e5e5'];
  /** Validate/clean a parts-only config (no accent) — used by the server. */
  function cleanParts(v) { const c = normalize(typeof v === 'string' ? (() => { try { return JSON.parse(v); } catch { return null; } })() : v); return { hair: c.hair, body: c.body, item: c.item, glasses: c.glasses, aid: c.aid }; }
  function randomParts(role, need) {
    const pick = (o) => { const k = Object.keys(o); return k[Math.floor(Math.random() * k.length)]; };
    const hair = pick(HAIR), body = pick(BODY), glasses = Math.random() < .35 ? pick(GLASSES) : 'none';
    const aid = role === 'oku' ? (need === 'wheelchair' ? 'wheelchair' : need === 'visual' ? (Math.random() < .5 ? 'guidedog' : 'none') : need === 'elderly' ? 'cane' : 'none') : 'none';
    const item = aid === 'none' ? (Math.random() < .5 ? pick(ITEM) : 'none') : 'none';
    return { hair, body, item, glasses, aid };
  }
  return { render, renderPart, serialize, parse, isConfig, normalize, cleanParts, randomParts, PARTS, DEFAULT, ACCENTS };
  })();
  root.KBAvatar = KBAvatar;
})(typeof window !== 'undefined' ? window : module.exports);
