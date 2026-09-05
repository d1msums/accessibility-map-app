'use strict';
/**
 * Wardrobe — the character/shop system that turns the helper game into a "dress-up" loop.
 *
 *  • Coins: earned alongside points (1 coin per 5 points, plus bonuses), spent in the shop.
 *  • Catalogue: layered items (hair, outfit, item, glasses, aid, pet, background, frame).
 *    Items are RENDERED FROM FILES the designer drops into public/assets/character/<layer>/<id>.png
 *    (transparent PNG, 1024×1024, same canvas for every layer so they stack) — no code needed.
 *    manifest.json in that folder declares names / prices / rarity; missing files fall back to the
 *    built-in line-art avatar (KBAvatar) so the app never breaks while art is being produced.
 *  • Inventory: everything a user owns; equipped = what the character wears now.
 */
const fs = require('fs');
const path = require('path');

const LAYERS = ['background', 'aid_behind', 'body', 'outfit', 'head', 'hair', 'glasses', 'item', 'aid', 'pet', 'frame'];
const EQUIPPABLE = ['background', 'outfit', 'hair', 'glasses', 'item', 'aid', 'pet', 'frame'];
const RARITY = { common: 1, rare: 2, epic: 3, legendary: 4 };

const ASSET_DIR = process.env.KB_ASSETS || path.join(__dirname, '..', 'public', 'assets', 'character');
const MANIFEST = path.join(ASSET_DIR, 'manifest.json');

/** Built-in catalogue (used until/unless manifest.json overrides it). Prices in coins. */
const DEFAULT_ITEMS = [
  // hair — free starters + purchasable styles
  { id: 'hair_curly', layer: 'hair', name: 'Curly', nameMs: 'Kerinting', price: 0, rarity: 'common', starter: true, keywords: 'curly kerinting' },
  { id: 'hair_short', layer: 'hair', name: 'Short', nameMs: 'Pendek', price: 0, rarity: 'common', starter: true, keywords: 'short pendek' },
  { id: 'hair_bob', layer: 'hair', name: 'Bob', nameMs: 'Bob', price: 0, rarity: 'common', starter: true, keywords: 'bob' },
  { id: 'hair_hijab', layer: 'hair', name: 'Hijab', nameMs: 'Tudung', price: 0, rarity: 'common', starter: true, keywords: 'hijab tudung scarf' },
  { id: 'hair_bun', layer: 'hair', name: 'Bun', nameMs: 'Sanggul', price: 40, rarity: 'common', keywords: 'bun sanggul' },
  { id: 'hair_afro', layer: 'hair', name: 'Afro', nameMs: 'Afro', price: 60, rarity: 'rare', keywords: 'afro' },
  { id: 'hair_long', layer: 'hair', name: 'Long', nameMs: 'Panjang', price: 60, rarity: 'rare', keywords: 'long panjang' },
  { id: 'hair_cap', layer: 'hair', name: 'Cap', nameMs: 'Topi', price: 80, rarity: 'rare', keywords: 'cap hat topi' },
  // outfits
  { id: 'outfit_tee', layer: 'outfit', name: 'T-shirt', nameMs: 'Baju-T', price: 0, rarity: 'common', starter: true, keywords: 'tee tshirt t-shirt baju-t' },
  { id: 'outfit_shirt', layer: 'outfit', name: 'Shirt', nameMs: 'Kemeja', price: 0, rarity: 'common', starter: true, keywords: 'shirt kemeja' },
  { id: 'outfit_hoodie', layer: 'outfit', name: 'Hoodie', nameMs: 'Hoodie', price: 90, rarity: 'rare', keywords: 'hoodie hoodi' },
  { id: 'outfit_baju', layer: 'outfit', name: 'Baju Melayu', nameMs: 'Baju Melayu', price: 120, rarity: 'rare', keywords: 'baju melayu kurung' },
  { id: 'outfit_dress', layer: 'outfit', name: 'Dress', nameMs: 'Gaun', price: 120, rarity: 'rare', keywords: 'dress gaun' },
  { id: 'outfit_blazer', layer: 'outfit', name: 'Blazer', nameMs: 'Blazer', price: 160, rarity: 'epic', keywords: 'blazer jacket kot' },
  { id: 'outfit_hero', layer: 'outfit', name: 'Community Hero cape', nameMs: 'Jubah Wira Komuniti', price: 400, rarity: 'legendary', minLevel: 5, keywords: 'hero cape jubah wira' },
  // glasses
  { id: 'glasses_round', layer: 'glasses', name: 'Round glasses', nameMs: 'Cermin mata bulat', price: 30, rarity: 'common', keywords: 'glasses round spectacles specs cermin mata bulat' },
  { id: 'glasses_square', layer: 'glasses', name: 'Square glasses', nameMs: 'Cermin mata segi', price: 30, rarity: 'common', keywords: 'glasses square spectacles specs cermin mata segi' },
  { id: 'glasses_shades', layer: 'glasses', name: 'Shades', nameMs: 'Cermin mata hitam', price: 70, rarity: 'rare', keywords: 'shades sunglasses cermin mata hitam gelap' },
  // items (held)
  { id: 'item_phone', layer: 'item', name: 'Phone', nameMs: 'Telefon', price: 0, rarity: 'common', starter: true, keywords: 'phone telefon' },
  { id: 'item_coffee', layer: 'item', name: 'Kopi', nameMs: 'Kopi', price: 40, rarity: 'common', keywords: 'coffee kopi teh tarik cup' },
  { id: 'item_bag', layer: 'item', name: 'Backpack', nameMs: 'Beg galas', price: 60, rarity: 'common', keywords: 'bag backpack beg galas' },
  { id: 'item_book', layer: 'item', name: 'Book', nameMs: 'Buku', price: 50, rarity: 'common', keywords: 'book buku' },
  { id: 'item_plant', layer: 'item', name: 'Plant', nameMs: 'Pokok', price: 80, rarity: 'rare', keywords: 'plant pokok bunga' },
  { id: 'item_cane', layer: 'item', name: 'White cane', nameMs: 'Tongkat putih', price: 0, rarity: 'common', starter: true, keywords: 'white cane tongkat putih' },
  // mobility aids (always free — never gate accessibility identity behind coins)
  { id: 'aid_wheelchair', layer: 'aid', name: 'Wheelchair', nameMs: 'Kerusi roda', price: 0, rarity: 'common', starter: true, keywords: 'wheelchair kerusi roda' },
  { id: 'aid_cane', layer: 'aid', name: 'Walking stick', nameMs: 'Tongkat', price: 0, rarity: 'common', starter: true, keywords: 'walking stick tongkat' },
  { id: 'aid_guidedog', layer: 'aid', name: 'Guide dog', nameMs: 'Anjing pemandu', price: 0, rarity: 'common', starter: true, keywords: 'guide dog anjing pemandu' },
  { id: 'aid_hearing', layer: 'aid', name: 'Hearing aid', nameMs: 'Alat bantu dengar', price: 0, rarity: 'common', starter: true, keywords: 'hearing aid alat bantu dengar' },
  // pets (the fun part)
  { id: 'pet_cat', layer: 'pet', name: 'Black cat', nameMs: 'Kucing hitam', price: 150, rarity: 'epic', keywords: 'cat kucing black hitam' },
  { id: 'pet_kitten', layer: 'pet', name: 'Kitten', nameMs: 'Anak kucing', price: 100, rarity: 'rare', keywords: 'kitten anak kucing' },
  { id: 'pet_bird', layer: 'pet', name: 'Merbok', nameMs: 'Merbok', price: 120, rarity: 'rare', keywords: 'bird burung merbok' },
  // backgrounds
  { id: 'bg_sand', layer: 'background', name: 'Sand', nameMs: 'Pasir', price: 0, rarity: 'common', starter: true, keywords: 'sand pasir' },
  { id: 'bg_mist', layer: 'background', name: 'Mist', nameMs: 'Kabus', price: 0, rarity: 'common', starter: true, keywords: 'mist kabus' },
  { id: 'bg_kl', layer: 'background', name: 'KL skyline', nameMs: 'Latar KL', price: 200, rarity: 'epic', keywords: 'kl skyline city bandar latar' },
  { id: 'bg_cyber', layer: 'background', name: 'Cyberjaya lake', nameMs: 'Tasik Cyberjaya', price: 200, rarity: 'epic', keywords: 'cyberjaya lake tasik' },
  // frames (profile ring)
  { id: 'frame_none', layer: 'frame', name: 'No frame', nameMs: 'Tiada bingkai', price: 0, rarity: 'common', starter: true, keywords: 'no frame tiada bingkai' },
  { id: 'frame_sparkle', layer: 'frame', name: 'Sparkle frame', nameMs: 'Bingkai kilauan', price: 120, rarity: 'rare', keywords: 'sparkle frame bingkai kilauan' },
  { id: 'frame_gold', layer: 'frame', name: 'City Guardian frame', nameMs: 'Bingkai Penjaga Bandar', price: 500, rarity: 'legendary', minLevel: 6, keywords: 'gold frame bingkai emas guardian penjaga' },
];

/** Map legacy KBAvatar parts → wardrobe item ids (so existing accounts keep their look). */
const LEGACY = {
  hair: { curly: 'hair_curly', bob: 'hair_bob', short: 'hair_short', bun: 'hair_bun', long: 'hair_long', afro: 'hair_afro', hijab: 'hair_hijab', cap: 'hair_cap', bald: null },
  body: { shirt: 'outfit_shirt', tee: 'outfit_tee', hoodie: 'outfit_hoodie', blazer: 'outfit_blazer', dress: 'outfit_dress', baju: 'outfit_baju' },
  item: { none: null, phone: 'item_phone', bag: 'item_bag', coffee: 'item_coffee', book: 'item_book', cane: 'item_cane', plant: 'item_plant' },
  glasses: { none: null, round: 'glasses_round', square: 'glasses_square', shades: 'glasses_shades' },
  aid: { none: null, wheelchair: 'aid_wheelchair', cane: 'aid_cane', guidedog: 'aid_guidedog', hearing: 'aid_hearing' },
};
const LEGACY_BACK = {};
for (const [part, map] of Object.entries(LEGACY)) for (const [legacyId, itemId] of Object.entries(map)) if (itemId) LEGACY_BACK[itemId] = { part, legacyId };

let cache = { at: 0, items: null, files: new Set() };
/** Catalogue = built-ins, overridden/extended by public/assets/character/manifest.json; `art:true` when a PNG exists. */
function catalogue() {
  if (cache.items && Date.now() - cache.at < 5000) return cache.items;
  let items = DEFAULT_ITEMS.map((i) => ({ ...i }));
  try {
    if (fs.existsSync(MANIFEST)) {
      const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
      const extra = Array.isArray(m) ? m : Array.isArray(m.items) ? m.items : [];
      for (const it of extra) {
        if (!it || !it.id || !LAYERS.includes(it.layer)) continue;
        const idx = items.findIndex((x) => x.id === it.id);
        const clean = { id: String(it.id), layer: it.layer, name: String(it.name || it.id), nameMs: String(it.nameMs || it.name || it.id), price: Math.max(0, Number(it.price) || 0), rarity: RARITY[it.rarity] ? it.rarity : 'common', starter: !!it.starter, minLevel: Number(it.minLevel) || 0, file: it.file ? String(it.file) : undefined, offset: it.offset || undefined, keywords: it.keywords ? String(it.keywords) : undefined };
        if (idx >= 0) items[idx] = { ...items[idx], ...clean }; else items.push(clean);
      }
    }
  } catch { /* keep built-ins */ }
  const files = new Set();
  for (const it of items) {
    const rel = it.file || `${it.layer}/${it.id}.png`;
    const abs = path.join(ASSET_DIR, rel);
    if (fs.existsSync(abs)) { it.art = `/assets/character/${rel.replace(/\\/g, '/')}`; files.add(rel); } else it.art = null;
    // mobility aids may have a second file drawn BEHIND the body (e.g. wheelchair back wheel): aid_behind/<id>.png
    if (it.layer === 'aid') { const back = `aid_behind/${it.id}.png`; it.artBehind = fs.existsSync(path.join(ASSET_DIR, back)) ? `/assets/character/${back}` : null; }
    it.legacy = LEGACY_BACK[it.id] || null;
  }
  // base layers (body/head) are files only — one per skin tone if provided
  const base = {};
  for (const layer of ['body', 'head']) {
    const dir = path.join(ASSET_DIR, layer);
    base[layer] = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.png')).sort().map((f) => `/assets/character/${layer}/${f}`) : [];
  }
  cache = { at: Date.now(), items, files, base };
  return items;
}
function baseLayers() { catalogue(); return cache.base || { body: [], head: [] }; }
function item(id) { return catalogue().find((i) => i.id === id) || null; }
function starters() { return catalogue().filter((i) => i.starter).map((i) => i.id); }
function coinsFor(points) { return Math.max(0, Math.floor(points / 5)); }

/** Ensure a user record has wardrobe fields (idempotent; migrates legacy avatar parts). */
function ensure(u) {
  if (!u) return u;
  if (typeof u.coins !== 'number') u.coins = coinsFor(u.points || 0) + 60; // welcome coins
  if (!Array.isArray(u.inventory)) {
    u.inventory = [...new Set(starters())];
    for (const [part, legacyId] of Object.entries(u.avatar || {})) { const id = LEGACY[part] && LEGACY[part][legacyId]; if (id && !u.inventory.includes(id)) u.inventory.push(id); }
  }
  if (!u.equipped || typeof u.equipped !== 'object') {
    const eq = { background: 'bg_sand', frame: 'frame_none' };
    for (const [part, legacyId] of Object.entries(u.avatar || {})) { const id = LEGACY[part] && LEGACY[part][legacyId]; if (id) eq[LEGACY_BACK[id].part === 'body' ? 'outfit' : LEGACY_BACK[id].part] = id; }
    u.equipped = eq;
  }
  if (!u.skin) u.skin = 1;
  return u;
}
function ownedItems(u) { ensure(u); return catalogue().filter((i) => u.inventory.includes(i.id)); }
function canBuy(u, it, level) {
  if (!it) return { ok: false, error: 'unknown_item' };
  if (u.inventory.includes(it.id)) return { ok: false, error: 'already_owned' };
  if (it.minLevel && level < it.minLevel) return { ok: false, error: 'level_locked', minLevel: it.minLevel };
  if (u.coins < it.price) return { ok: false, error: 'not_enough_coins', need: it.price - u.coins };
  return { ok: true };
}
function buy(u, id, level) {
  ensure(u);
  const it = item(id); const chk = canBuy(u, it, level);
  if (!chk.ok) return chk;
  u.coins -= it.price; u.inventory.push(it.id);
  return { ok: true, item: it, coins: u.coins };
}
function equip(u, id, on = true) {
  ensure(u);
  const it = item(id); if (!it) return { ok: false, error: 'unknown_item' };
  if (!u.inventory.includes(it.id)) return { ok: false, error: 'not_owned' };
  if (!EQUIPPABLE.includes(it.layer)) return { ok: false, error: 'not_equippable' };
  if (on) u.equipped[it.layer] = it.id; else if (u.equipped[it.layer] === it.id) delete u.equipped[it.layer];
  // keep the legacy avatar in sync so every existing avatar render still matches the character
  syncLegacy(u);
  return { ok: true, equipped: u.equipped };
}
function syncLegacy(u) {
  const av = { ...(u.avatar || {}) };
  for (const part of Object.keys(LEGACY)) {
    const layer = part === 'body' ? 'outfit' : part;
    const eqId = u.equipped[layer];
    const back = eqId && LEGACY_BACK[eqId];
    if (back && back.part === part) av[part] = back.legacyId;
    else if (!eqId && part !== 'hair' && part !== 'body') av[part] = 'none';
  }
  u.avatar = av;
}
/** What the client needs to draw + shop. */
function view(u, lang = 'en', level = 1) {
  ensure(u);
  const items = catalogue().map((i) => ({ id: i.id, layer: i.layer, name: lang === 'ms' ? i.nameMs : i.name, price: i.price, rarity: i.rarity, minLevel: i.minLevel || 0, keywords: i.keywords || '', art: i.art, artBehind: i.artBehind || null, offset: i.offset || null, legacy: i.legacy, owned: u.inventory.includes(i.id), equipped: u.equipped[i.layer] === i.id, locked: !!(i.minLevel && level < i.minLevel) }));
  const base = baseLayers();
  return { coins: u.coins, skin: u.skin, equipped: u.equipped, inventory: u.inventory, items, base, layers: LAYERS, hasArt: items.some((i) => i.art) || base.body.length > 0 };
}

const ILLU_DIR = process.env.KB_ILLUSTRATIONS || path.join(__dirname, '..', 'public', 'assets', 'illustrations');
const ILLU_SLOTS = ['hero', 'helper', 'oku', 'permissions', 'empty_requests', 'empty_map', 'empty_feed', 'reward', 'levelup', 'welcome', 'cat_idle', 'cat_listen', 'cat_talk', 'cat_happy', 'cat_sleep'];
/** Which illustration slots have a real file (png/svg/webp) — drop-in, no code change. */
function illustrations() {
  const out = {};
  for (const slot of ILLU_SLOTS) for (const ext of ['png', 'svg', 'webp', 'jpg']) { if (fs.existsSync(path.join(ILLU_DIR, `${slot}.${ext}`))) { out[slot] = `/assets/illustrations/${slot}.${ext}`; break; } }
  return out;
}
/** Public catalogue for the client renderer (no user data). */
function publicCatalogue(lang = 'en') {
  const items = catalogue().map((i) => ({ id: i.id, layer: i.layer, name: lang === 'ms' ? i.nameMs : i.name, price: i.price, rarity: i.rarity, minLevel: i.minLevel || 0, art: i.art, artBehind: i.artBehind || null, offset: i.offset || null, legacy: i.legacy }));
  const base = baseLayers();
  return { items, base, layers: LAYERS, hasArt: items.some((i) => i.art) || base.body.length > 0, assetDir: 'public/assets/character', illustrations: illustrations() };
}
module.exports = { LAYERS, EQUIPPABLE, RARITY, ILLU_SLOTS, illustrations, catalogue, publicCatalogue, baseLayers, item, starters, coinsFor, ensure, ownedItems, canBuy, buy, equip, syncLegacy, view, ASSET_DIR, LEGACY, LEGACY_BACK };
