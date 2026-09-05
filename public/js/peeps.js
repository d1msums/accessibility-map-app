/* KBPeeps — Open Peeps avatar engine driven by /assets/assetsManifest.json
 *
 *  • load()            fetches the manifest once (cached) and inlines the atom SVGs on demand
 *  • options(layer,…)  catalogue for the builder with gender + level filtering and lock info
 *  • render(peep,…)    the stacked character: <div class="peep"> with absolutely-positioned layers
 *                      body → pose → face → facial-hair → head → accessories  (z-order)
 *  • save()/current()  local persistence (localStorage kb.peep) + server sync via PATCH /api/me
 *
 *  A "peep" = { mode:'bust'|'full', body, pose, head, face, facialHair, accessory, gender, skin, hair, cloth, bg }
 *  Ids are manifest ids: "body/hoodie", "head/afro", "face/smile", "facial-hair/goatee", "accessories/glasses", "pose/wheelchair".
 */
(function (root) {
  const KEY = 'kb.peep';
  let M = null, loading = null;
  const svgCache = new Map();

  // ---------- gender rules (hair only; body / face / accessories stay unisex) ----------
  const MALE_HEAD = /^(short(-\w+)?|shaved(-\w+)?|bald|no-hair(-\w+)?|flat-top(-\w+)?|pomp|mohawk(-\w+)?|afro|cornrows(-\w+)?|twists(-\w+)?|dreads-\w+|bantu-knots|bear|beanie|hat-\w+|turban|doc-\w+|gray-short|color-medium|medium-1|medium-one|wavy)$/;
  const FEMALE_HEAD = /^(long(-\w+)?|longbangs|medium(-\w+)?|bangs(-\w+)?|bun(-\w+)?|buns|color-bun|gray-bun|gray-medium|hijab|long-afro|long-curly|long-hair|cornrows-light|bantu-knots|twists(-\w+)?|afro|beanie|hat-\w+|doc-\w+|bear|wavy|dreads-\w+|short-1|short-one|short-4|short-four)$/;
  function genderOk(layer, slug, gender) {
    if (!gender || gender === 'any') return true;
    if (layer === 'facial-hair') return gender === 'male';                       // rule: facial hair is a male option
    if (layer === 'head') return gender === 'male' ? MALE_HEAD.test(slug) : FEMALE_HEAD.test(slug);
    if (layer === 'body' && /dress/.test(slug)) return gender === 'female';        // dresses: female wardrobe
    return true;                                                                   // body, face, accessories, pose: unisex
  }

  // ---------- progression: tiers unlock with level / points ----------
  // tier → { minLevel, minPoints }; the item's tier comes from TIER_OF (hats & accessories are the "high-tier" ones)
  const TIERS = { free: { minLevel: 1, minPoints: 0 }, bronze: { minLevel: 2, minPoints: 100 }, silver: { minLevel: 3, minPoints: 300 }, gold: { minLevel: 4, minPoints: 700 }, hero: { minLevel: 5, minPoints: 1500 } };
  const TIER_OF = {
    // hats / head-wear
    'head/beanie': 'bronze', 'head/hat-beanie': 'bronze', 'head/hat-hip': 'silver', 'head/turban': 'free', 'head/hijab': 'free', 'head/doc-one': 'gold', 'head/doc-two': 'gold', 'head/doc-three': 'gold', 'head/bear': 'hero',
    // statement hair
    'head/mohawk': 'silver', 'head/mohawk-2': 'silver', 'head/mohawk-knots': 'gold', 'head/pomp': 'bronze', 'head/long-afro': 'silver', 'head/long-curly': 'silver', 'head/dreads-one': 'silver', 'head/dreads-two': 'silver', 'head/color-bun': 'gold', 'head/color-medium': 'gold', 'head/medium-bangs-color': 'gold', 'head/bun-clip': 'bronze', 'head/bun-two': 'bronze',
    // accessories
    'accessories/glasses': 'free', 'accessories/glasses-2': 'free', 'accessories/glasses-two': 'bronze', 'accessories/glasses-3': 'bronze', 'accessories/glasses-three': 'bronze', 'accessories/glasses-4': 'silver', 'accessories/glasses-four': 'silver', 'accessories/glasses-5': 'silver', 'accessories/glasses-five': 'silver', 'accessories/glasses-six': 'gold', 'accessories/sunglasses': 'free', 'accessories/sunglasses-2': 'silver', 'accessories/sunglasses-two': 'silver', 'accessories/eyepatch': 'gold', 'accessories/eye-patch': 'gold',
    // outfits
    'body/blazer-black-tee': 'silver', 'body/fur-jacket': 'gold', 'body/polka-dot-jacket': 'silver', 'body/polkadot-jacket': 'silver', 'body/jacket': 'bronze', 'body/shirt-and-coat': 'silver', 'body/killer': 'hero', 'body/macbook': 'gold', 'body/computer': 'gold', 'body/gaming': 'silver', 'body/thunder-tee': 'bronze', 'body/thunder-t-shirt': 'bronze',
    // poses
    'pose/dancer': 'silver', 'pose/robot-dance-1': 'gold', 'pose/robot-dance-2': 'gold', 'pose/robot-dance-3': 'gold', 'pose/doc': 'gold', 'pose/doc-stethoscope': 'gold', 'pose/doc-hazardous': 'hero', 'pose/bike': 'silver',
    // faces
    'face/monster': 'hero', 'face/cyclops': 'hero', 'face/angry-fang': 'gold', 'face/angry-with-fang': 'gold', 'face/love-grin-tongue': 'silver', 'face/love-grin-teeth': 'silver',
  };
  // accessibility identity is NEVER locked (wheelchair, prosthesis poses, white-cane style items, elderly faces)
  const ALWAYS_FREE = /^(pose\/(wheelchair|.*prothesis.*)|face\/old|head\/gray-.*|accessories\/sunglasses)$/;
  function tierOf(id) { if (ALWAYS_FREE.test(id)) return 'free'; return TIER_OF[id] || 'free'; }
  function lockFor(id, user) {
    const tier = tierOf(id); const need = TIERS[tier];
    const level = Number((user && user.level) || 1), points = Number((user && user.points) || 0);
    const locked = level < need.minLevel && points < need.minPoints;
    return { tier, locked, minLevel: need.minLevel, minPoints: need.minPoints };
  }

  // ---------- manifest ----------
  async function load(force = false) {
    if (M && !force) return M;
    if (loading && !force) return loading;
    loading = fetch('/assets/assetsManifest.json').then((r) => r.json()).then((d) => {
      const byId = {};
      for (const L of Object.values(d.avatar_parts.layers)) for (const it of L.items) byId[it.id] = it;
      M = { raw: d, byId, comp: d.avatar_parts.composition, layers: d.avatar_parts.layers, ui: d.ui_elements };
      return M;
    }).catch((e) => { console.warn('[peeps] manifest failed', e); loading = null; throw e; });
    return loading;
  }
  const ready = () => !!M;
  const item = (id) => (M && M.byId[id]) || null;

  /** Options for one layer, filtered by gender and annotated with lock state. */
  function options(layer, { gender = 'any', user = null, includeLocked = true } = {}) {
    if (!M) return [];
    const L = M.layers[layer]; if (!L) return [];
    return L.items.filter((it) => genderOk(layer, it.slug, gender)).map((it) => ({ ...it, ...lockFor(it.id, user) })).filter((it) => includeLocked || !it.locked);
  }
  function ui(section) { if (!M) return []; const ids = (M.ui.sections[section] || {}).ids || []; return ids.map((id) => M.ui.items.find((i) => i.id === id)).filter(Boolean); }
  function uiByRole(role) { if (!M) return []; return M.ui.items.filter((i) => i.role === role); }

  // ---------- SVG loading / recolouring ----------
  async function svgOf(id) {
    const it = item(id); if (!it) return '';
    if (svgCache.has(id)) return svgCache.get(id);
    const p = fetch(it.url).then((r) => (r.ok ? r.text() : '')).then((s) => { const m = /<svg[^>]*>([\s\S]*?)<\/svg>/i.exec(s); return m ? m[1].replace(/<title>[\s\S]*?<\/title>/g, '') : ''; }).catch(() => '');
    svgCache.set(id, p); return p;
  }
  const INK = /\b(fill|stroke)="(#000000|#000|#231f20|#221e1f|#22252b)"/gi;
  const NO_TINT = /bald|no-hair|hijab|turban|beanie|hat-|doc-|bear|shaved-one/;      // no hair to tint → keep the outline black
  /** Monochrome by design: only the hair ink gets a (grey) tone. Skin and clothes stay white + black ink like the reference art. */
  function paint(inner, layer, colours, slug = '') {
    if (!inner || layer !== 'head' || !colours.hair || colours.hair === '#111111' || NO_TINT.test(slug)) return inner;
    return inner.replace(INK, (m, a) => `${a}="${colours.hair}"`);
  }

  // ---------- layered render ----------
  // Draw order. NOTE: Open Peeps head atoms carry the skin fill, so the face/facial hair must sit ABOVE the head
  // (otherwise the skin covers the features). Accessories always on top.
  const ORDER = ['body', 'pose', 'head', 'face', 'facial-hair', 'accessories'];
  const layerKey = { body: 'body', pose: 'pose', face: 'face', 'facial-hair': 'facialHair', head: 'head', accessories: 'accessory' };
  /** Geometry per mode: canvas + translate for the base and the head; face/hair/accessory hang off the head origin. */
  function geometry(peep) {
    const c = M.comp; const full = peep.mode === 'full' && peep.pose && item(peep.pose);
    if (!full) return { canvas: c.bust.canvas, base: c.bust.body, head: c.bust.head, mode: 'bust' };
    const it = item(peep.pose); const wide = (c.sittingWide.appliesTo || []).includes(peep.pose);
    const L = wide ? c.sittingWide : it.kind === 'sitting' ? c.sitting : c.standing;
    return { canvas: L.canvas, base: L.pose, head: L.head, mode: it.kind };
  }
  /** Layer descriptors (id, url, x, y, w, h, z) in canvas units — used by the DOM renderer and by exports. */
  function layout(peep) {
    const g = geometry(peep); const c = M.comp; const out = [];
    const put = (layer, id, x, y, z) => { const it = item(id); if (!it) return; out.push({ layer, id, url: it.url, x, y, w: it.width, h: it.height, z }); };
    if (g.mode === 'bust') put('body', peep.body, g.base.x, g.base.y, 1); else put('pose', peep.pose, g.base.x, g.base.y, 1);
    put('head', peep.head, g.head.x, g.head.y, 2);
    put('face', peep.face, g.head.x + c.faceOffset.x, g.head.y + c.faceOffset.y, 3);
    if (peep.facialHair) put('facial-hair', peep.facialHair, g.head.x + c.facialHairOffset.x, g.head.y + c.facialHairOffset.y, 4);
    if (peep.accessory) put('accessories', peep.accessory, g.head.x + c.accessoriesOffset.x, g.head.y + c.accessoriesOffset.y, 5);
    return { canvas: g.canvas, layers: out.sort((a, b) => a.z - b.z), mode: g.mode };
  }
  /**
   * Synchronous HTML: a square viewport with each atom absolutely positioned (percent units of the canvas)
   * as an <img>; the crop zooms on the head ("head"), bust ("bust") or shows everything ("full").
   * When colours are set (skin/hair/cloth) the atoms are inlined + recoloured asynchronously via hydrate().
   */
  function render(peep, size = 96, { crop = 'bust', bg = null, className = '', alt = 'avatar' } = {}) {
    if (!M || !peep || !peep.head || !peep.face) return '';
    const { canvas, layers, mode } = layout(peep);
    // viewport: choose a square window over the canvas
    const cw = canvas.width, ch = canvas.height;
    const win = crop === 'head' ? { s: 620, cx: (mode === 'bust' ? 372 : mode === 'standing' ? 404 : peep.pose && (M.comp.sittingWide.appliesTo || []).includes(peep.pose) ? 665 : 345) + 236, cy: 180 + 300 }
      : crop === 'bust' ? { s: mode === 'bust' ? Math.max(cw, 1136) : 1500, cx: (mode === 'bust' ? 568 : mode === 'standing' ? 640 : 700) + (mode === 'sitting' && peep.pose && (M.comp.sittingWide.appliesTo || []).includes(peep.pose) ? 320 : 0), cy: mode === 'bust' ? 766 : 900 }
      : { s: Math.max(cw, ch), cx: cw / 2, cy: ch / 2 };
    const x0 = win.cx - win.s / 2, y0 = win.cy - win.s / 2;
    const pct = (v) => (v / win.s * 100).toFixed(3) + '%';
    const imgs = layers.map((l) => `<img class="pl pl-${l.layer}" data-id="${l.id}" src="${l.url}" alt="" draggable="false" style="left:${pct(l.x - x0)};top:${pct(l.y - y0)};width:${pct(l.w)};height:${pct(l.h)}">`).join('');
    const colours = peep.hair && peep.hair !== '#111111' ? ` data-hair="${peep.hair}"` : '';
    return `<span class="peep peep-${mode} ${className}" role="img" aria-label="${alt}" style="width:${size}px;height:${size}px;${bg && bg !== 'none' ? `background:${bg};` : peep.bg && bg !== 'none' ? `background:${peep.bg};` : ''}"${colours}>${imgs}</span>`;
  }
  /** Replace <img> layers with inline, recoloured SVG (for skin / hair / cloth tints). Safe to call repeatedly. */
  async function hydrate(rootEl = document) {
    if (!M) return;
    const nodes = rootEl.querySelectorAll ? rootEl.querySelectorAll('.peep[data-hair]') : [];
    for (const el of nodes) {
      if (el.dataset.hydrated === '1') continue; el.dataset.hydrated = '1';
      const colours = { hair: el.dataset.hair || null };
      for (const img of [...el.querySelectorAll('img.pl')]) {
        const it = item(img.dataset.id); if (!it) continue;
        const inner = await svgOf(it.id); if (!inner || !img.isConnected) continue;
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', it.viewBox || `0 0 ${it.width} ${it.height}`); svg.setAttribute('class', img.className); svg.setAttribute('style', img.getAttribute('style')); svg.setAttribute('data-id', it.id);
        svg.innerHTML = paint(inner, it.layer, colours, it.slug);
        img.replaceWith(svg);
      }
    }
  }
  /** One standalone SVG string (for download / og image). */
  async function toSVG(peep) {
    const { canvas, layers } = layout(peep); const colours = { hair: peep.hair };
    const parts = [];
    for (const l of layers) { const inner = await svgOf(l.id); const it = item(l.id); parts.push(`<g transform="translate(${l.x},${l.y})"><svg viewBox="${it.viewBox}" width="${l.w}" height="${l.h}" overflow="visible">${paint(inner, l.layer, colours, it.slug)}</svg></g>`); }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvas.width} ${canvas.height}" width="${canvas.width}" height="${canvas.height}">${peep.bg ? `<rect width="100%" height="100%" fill="${peep.bg}"/>` : ''}${parts.join('')}</svg>`;
  }

  // ---------- defaults / randomiser ----------
  const HAIRS = ['#111111', '#4a4a4a', '#8a8a8a', '#c9c9c9'];                       // ink tones (mono style)
  const BGS = ['#e9e5f5', '#e4f0ee', '#fbe8e0', '#e8eef8', '#f3e8f2', '#f4f1ea', '#e5e5e5', '#ffffff'];
  const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
  function defaults(role, need, gender = 'any') {
    const p = { mode: 'bust', gender, body: 'body/hoodie', pose: null, head: gender === 'female' ? 'head/medium-1' : 'head/short-1', face: 'face/smile', facialHair: null, accessory: null, hair: '#111111', bg: BGS[0] };
    if (role === 'oku' && need === 'wheelchair') { p.mode = 'full'; p.pose = 'pose/wheelchair'; }
    if (role === 'oku' && need === 'visual') p.accessory = 'accessories/sunglasses';
    if (role === 'oku' && need === 'elderly') { p.face = 'face/old'; p.head = gender === 'female' ? 'head/gray-bun' : 'head/gray-short'; p.hair = '#8a8a8a'; }
    return p;
  }
  function random(role, need, gender = 'any', user = null) {
    const p = defaults(role, need, gender);
    const opt = (layer) => options(layer, { gender, user, includeLocked: false });
    const heads = opt('head'); if (heads.length) p.head = pick(heads).id;
    const faces = opt('face').filter((f) => /positive|neutral/.test(f.tags.join(' ')) && !/mask|fantasy/.test(f.tags.join(' '))); if (faces.length && !(role === 'oku' && need === 'elderly')) p.face = pick(faces).id;
    const bodies = opt('body').filter((b) => !/holding-prop|gesture/.test(b.tags.join(' '))); if (bodies.length) p.body = pick(bodies).id;
    if (gender === 'male' && Math.random() < 0.35) { const fh = opt('facial-hair'); if (fh.length) p.facialHair = pick(fh).id; }
    if (Math.random() < 0.3 && !(role === 'oku' && need === 'visual')) { const ac = opt('accessories').filter((a) => !/eyepatch/.test(a.tags.join(' '))); if (ac.length) p.accessory = pick(ac).id; }
    p.hair = Math.random() < 0.7 ? '#111111' : pick(HAIRS); p.bg = pick(BGS);
    return p;
  }
  /** Drop any equipped item the user is no longer allowed (locked) — keeps saved combos honest. */
  function sanitize(peep, user) {
    if (!peep || !M) return peep;
    const out = { ...peep };
    for (const [layer, key] of Object.entries(layerKey)) {
      const id = out[key]; if (!id) continue;
      if (!item(id)) { out[key] = null; continue; }
      if (lockFor(id, user).locked) out[key] = null;
    }
    if (out.gender && out.gender !== 'any') {
      for (const [layer, key] of Object.entries(layerKey)) { const it = out[key] && item(out[key]); if (it && !genderOk(layer, it.slug, out.gender)) out[key] = null; }
    }
    if (!out.head) out.head = out.gender === 'female' ? 'head/medium-1' : 'head/short-1'; if (!out.face) out.face = 'face/smile'; if (!out.body) out.body = 'body/hoodie';
    if (out.mode === 'full' && !out.pose) out.mode = 'bust';
    return out;
  }

  // ---------- persistence ----------
  function current() { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } }
  function saveLocal(peep) { try { localStorage.setItem(KEY, JSON.stringify(peep)); } catch { /* ignore */ } }
  async function save(peep, { api = null } = {}) {
    saveLocal(peep);
    if (api) { try { await api('/api/me', { method: 'PATCH', body: { peep } }); } catch (e) { console.warn('[peeps] server save failed', e); } }
    document.dispatchEvent(new CustomEvent('kb:peep', { detail: peep }));
  }
  /** The peep to draw for a user object: server value, else (for the signed-in user) the local copy. */
  function forUser(u, me = null) { if (!u) return null; if (u.peep && u.peep.head) return u.peep; if (me && u.id === me.id) return current(); return null; }

  root.KBPeeps = { load, ready, item, options, ui, uiByRole, render, hydrate, toSVG, layout, defaults, random, sanitize, lockFor, tierOf, TIERS, ORDER, HAIRS, BGS, current, save, saveLocal, forUser, genderOk };
})(window);
