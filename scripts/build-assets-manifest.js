#!/usr/bin/env node
/**
 * Scans public/assets/character/** and public/assets/illustrations/** for SVGs and writes
 * public/assets/assetsManifest.json with two categories:
 *
 *   ui_elements  – standalone illustrations for the landing page, hero section and auth pages
 *   avatar_parts – Open Peeps atoms for the Avatar Builder (body, head, pose, face, facial-hair, accessories)
 *
 * Re-run any time files are added:  node scripts/build-assets-manifest.js
 * Idempotent: unchanged inputs produce identical output (apart from `generatedAt`).
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const PUB = path.join(ROOT, 'public');
const OUT = path.join(PUB, 'assets', 'assetsManifest.json');
const CHAR_DIR = path.join(PUB, 'assets', 'character');
const ILLU_DIR = path.join(PUB, 'assets', 'illustrations');

// ---------- helpers ----------
const walk = (dir) => {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? walk(p) : /\.svg$/i.test(e.name) ? [p] : [];
  }).sort();
};
const url = (abs) => '/' + path.relative(PUB, abs).split(path.sep).map(encodeURIComponent).join('/');
const slugOf = (file) => path.basename(file, '.svg').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const titleOf = (slug) => slug.split('-').map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w)).join(' ');
const MONO = new Set(['#000', '#000000', '#fff', '#ffffff', '#111', '#111111', '#231f20', '#221e1f', '#22252b']);
function inspect(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const vb = /viewBox="([^"]+)"/.exec(svg);
  const [, , w, h] = vb ? vb[1].trim().split(/[\s,]+/).map(Number) : [0, 0, +(/width="([\d.]+)/.exec(svg) || [])[1] || 0, +(/height="([\d.]+)/.exec(svg) || [])[1] || 0];
  const colours = new Set();
  for (const m of svg.matchAll(/(?:fill|stroke)(?:="|:\s*)(#[0-9a-fA-F]{3,6})/g)) { const c = m[1].toLowerCase(); if (!MONO.has(c)) colours.add(c); }
  const title = (/<title>([^<]*)<\/title>/.exec(svg) || [])[1] || null;
  const paintable = /id="🎨-Background"/.test(svg); // Open Peeps mono atoms: dedicated skin/cloth region that can be recoloured
  return { viewBox: vb ? vb[1].trim() : null, width: w, height: h, bytes: Buffer.byteLength(svg), monochrome: colours.size === 0, paintable, accentColours: [...colours].sort(), sourceTitle: title };
}

// ---------- avatar parts ----------
const LAYER_META = {
  body: { label: 'Body (bust outfit)', labelMs: 'Badan (pakaian separuh badan)', slot: 'body', required: true, note: 'Torso + arms with clothing; used for bust-style avatars. Mutually exclusive with pose.' },
  pose: { label: 'Pose (full body)', labelMs: 'Gaya (seluruh badan)', slot: 'pose', required: false, note: 'Full-body figure incl. legs; replaces body for full-body avatars. Sub-kinds: standing, sitting (incl. wheelchair, bike).' },
  head: { label: 'Head & hair', labelMs: 'Kepala & rambut', slot: 'head', required: true, note: 'Hair / hijab / turban / hats. Face, facial hair and accessories are anchored relative to this atom.' },
  face: { label: 'Face expression', labelMs: 'Ekspresi wajah', slot: 'face', required: true, note: 'Eyes, nose, mouth. Placed at head + faceOffset.' },
  'facial-hair': { label: 'Facial hair', labelMs: 'Bulu muka', slot: 'facialHair', required: false, note: 'Optional beard / moustache. Placed at head + facialHairOffset.' },
  accessories: { label: 'Accessories', labelMs: 'Aksesori', slot: 'accessory', required: false, note: 'Glasses, sunglasses, eyepatch. Placed at head + accessoriesOffset.' },
};
const TAGS = {
  body: (s) => [/hoodie|sweater|turtleneck|jacket|coat|blazer|fur/.test(s) && 'warm', /tee|shirt|polo|dress/.test(s) && 'casual', /blazer|button|polo|shirt-and-coat/.test(s) && 'smart', /coffee|computer|device|macbook|paper|gaming|killer/.test(s) && 'holding-prop', /explaining|pointing|whatever|arms-crossed/.test(s) && 'gesture', /dress/.test(s) && 'dress'],
  head: (s) => [/hijab|turban/.test(s) && 'head-covering', /beanie|hat/.test(s) && 'hat', /bald|no-hair|shaved/.test(s) && 'short-or-none', /long|medium|wavy|curly/.test(s) && 'long', /afro|twists|cornrows|dreads|bantu|knots|flat-top/.test(s) && 'textured', /gray/.test(s) && 'grey', /bun|buns/.test(s) && 'bun', /doc/.test(s) && 'medical', /mohawk|pomp/.test(s) && 'styled'],
  face: (s) => [/smile|grin|cheeky|cute|calm|love|happy|cheers|lol|awe/.test(s) && 'positive', /angry|rage|contempt|suspicious|fear|concerned|hectic|tired|solemn|serious|driven|blank|eyes-closed/.test(s) && 'neutral-or-negative', /mask/.test(s) && 'mask', /monster|cyclops|fang/.test(s) && 'fantasy', /old/.test(s) && 'elderly'],
  'facial-hair': (s) => [/full|goatee-full/.test(s) && 'beard', /goatee|chin/.test(s) && 'goatee', /moustache|mustache/.test(s) && 'moustache'],
  accessories: (s) => [/sunglasses/.test(s) && 'sunglasses', /^glasses/.test(s) && 'glasses', /patch/.test(s) && 'eyepatch'],
  pose: (s) => [/walking|dancer|robot-dance|jumping/.test(s) && 'moving', /wheelchair/.test(s) && 'wheelchair', /bike/.test(s) && 'bike', /prothesis/.test(s) && 'prosthesis', /doc/.test(s) && 'medical', /crossed|cross-arm/.test(s) && 'arms-crossed', /pointing/.test(s) && 'gesture', /resting|easing|closed-legs|hands-back|mid|one-leg/.test(s) && 'relaxed', /color/.test(s) && 'colour-variant (paint region on tee/pants)'],
};
// Accessibility-relevant atoms surfaced for KitaBantu's OKU personas
const A11Y = { 'pose/sitting/wheelchair': 'wheelchair', 'pose/standing/prothesis-color-pants': 'prosthesis', 'pose/standing/prothesis-color-tee': 'prosthesis', 'pose/standing/shirt-prothesis-color-pants': 'prosthesis', 'pose/standing/shirt-prothesis-color-tee': 'prosthesis', 'face/old': 'elderly', 'head/gray-bun': 'elderly', 'head/gray-medium': 'elderly', 'head/gray-short': 'elderly', 'accessories/sunglasses': 'visual', 'accessories/sunglasses-2': 'visual', 'accessories/sunglasses-two': 'visual', 'accessories/eyepatch': 'visual', 'accessories/eye-patch': 'visual', };
const CULTURE = { 'head/hijab': 'malaysia', 'head/turban': 'malaysia', 'body/dress': 'malaysia' };

const avatarParts = { layers: {}, counts: {}, total: 0 };
for (const layer of Object.keys(LAYER_META)) {
  const dir = path.join(CHAR_DIR, layer);
  const files = walk(dir);
  const items = files.map((f) => {
    const rel = path.relative(CHAR_DIR, f).split(path.sep).join('/');
    const key = rel.replace(/\.svg$/i, '');
    const slug = slugOf(f);
    const info = inspect(f);
    const kind = layer === 'pose' ? (rel.includes('/sitting/') ? 'sitting' : 'standing') : undefined;
    const tags = (TAGS[layer] ? TAGS[layer](slug) : []).filter(Boolean);
    if (!info.monochrome) tags.push('has-colour');
    if (A11Y[key]) tags.push(`a11y:${A11Y[key]}`);
    if (CULTURE[key]) tags.push(`culture:${CULTURE[key]}`);
    if (info.paintable) tags.push('paintable');
    return { id: `${layer}/${slug}`, slug, name: titleOf(slug), layer, ...(kind ? { kind } : {}), file: `character/${rel}`, url: url(f), viewBox: info.viewBox, width: info.width, height: info.height, bytes: info.bytes, monochrome: info.monochrome, paintable: info.paintable, ...(info.accentColours.length ? { accentColours: info.accentColours } : {}), tags: [...new Set(tags)].sort() };
  });
  avatarParts.layers[layer] = { ...LAYER_META[layer], count: items.length, ...(layer === 'pose' ? { kinds: { standing: items.filter((i) => i.kind === 'standing').length, sitting: items.filter((i) => i.kind === 'sitting').length } } : {}), items };
  avatarParts.counts[layer] = items.length; avatarParts.total += items.length;
}
// Composition constants (from the original Open Peeps reference compositions; used by the builder to stack atoms)
avatarParts.composition = {
  description: 'Translate each atom by these offsets inside one SVG canvas, bottom → top: pose|body, head, face, facial-hair, accessories. Offsets for face/facial-hair/accessories are relative to the head origin.',
  zOrder: ['pose|body', 'head', 'face', 'facial-hair', 'accessories'],
  bust: { canvas: { width: 1136, height: 1533 }, body: { x: 147, y: 639 }, head: { x: 372, y: 180 } },
  standing: { canvas: { width: 1179, height: 3291 }, pose: { x: -121, y: 634 }, head: { x: 404, y: 180 } },
  sitting: { canvas: { width: 1647, height: 2500 }, pose: { x: -81, y: 637 }, head: { x: 345, y: 180 } },
  sittingWide: { appliesTo: ['pose/wheelchair', 'pose/bike'], canvas: { width: 3200, height: 3000 }, pose: { x: 239, y: 637 }, head: { x: 665, y: 180 } },
  faceOffset: { x: 159, y: 186 }, facialHairOffset: { x: 123, y: 338 }, accessoriesOffset: { x: 47, y: 241 },
  recolour: { ink: ['#000000', '#000', '#231f20'], paintRegionId: '🎨-Background', inkRegionId: '🖍-Ink', note: 'Mono atoms expose a paintable background path (skin/cloth) and an ink path; colour variants use hard-coded hues listed in accentColours.' },
};
avatarParts.defaults = { bust: { body: 'body/hoodie', head: 'head/short-1', face: 'face/smile', facialHair: null, accessory: null }, oku: { wheelchair: { pose: 'pose/wheelchair' }, visual: { accessory: 'accessories/sunglasses' }, elderly: { face: 'face/old', head: 'head/gray-short' } } };

// ---------- ui elements ----------
// Placement is chosen from what each drawing depicts (reviewed visually), not only its filename.
const UI = {
  // landing page — hero + supporting sections
  'looking-ahead': { section: 'hero', role: 'hero-primary', alt: 'A person sitting and looking ahead with a backpack', notes: 'Main landing hero. Calm, forward-looking; leaves room for headline on the left.' },
  'walking-contradiction': { section: 'hero', role: 'hero-alt', alt: 'A person with a prosthetic leg walking confidently', notes: 'Alternate hero for the OKU story; prosthesis is visible and celebrated.' },
  'pondering': { section: 'hero', role: 'hero-alt', alt: 'Person standing side-on with a backpack and prosthetic leg, thinking', notes: 'Alternate hero / route-planning section.' },
  'mask': { section: 'landing', role: 'feature-check', alt: 'Person walking with a prosthetic leg and a backpack', notes: '"Verified by a neighbour" feature tile.' },
  'runner': { section: 'landing', role: 'feature-helper', alt: 'Person running with a prosthetic leg and gear', notes: 'Helper speed / "answer within 30 min" tile.' },
  'walking-1': null,
  'wont-stop': { section: 'landing', role: 'feature-helper', alt: 'Person striding forward with a bag', notes: 'Helper on the move.' },
  'late-for-class': { section: 'landing', role: 'feature-helper', alt: 'Person hurrying with headphones and a coat', notes: 'On-the-way helper illustration.' },
  'coffee': { section: 'landing', role: 'feature-helper', alt: 'Person running while spilling a coffee', notes: 'Light-hearted helper / streak tile.' },
  'groceries': { section: 'landing', role: 'feature-check', alt: 'Person carrying grocery bags, prosthetic leg visible', notes: 'Everyday errands – mall / toilet / lift checks.' },
  'consumer': { section: 'landing', role: 'feature-check', alt: 'Person carrying shopping bags', notes: 'Shopping-mall accessibility section.' },
  'plants': { section: 'landing', role: 'feature-community', alt: 'Person carrying a large bunch of plants', notes: 'Community growth / SDG 11 section.' },
  'growth': { section: 'landing', role: 'feature-community', alt: 'Person sitting cross-legged reading a book', notes: 'Trust-decay explainer / "how it works".' },
  'experiments': { section: 'landing', role: 'feature-community', alt: 'Two people sitting and building something together', notes: 'Community / co-verification tile.' },
  'fling': { section: 'landing', role: 'feature-community', alt: 'Two friends walking side by side', notes: 'Helpers + OKU walking together.' },
  'mechanical-love': { section: 'landing', role: 'feature-community', alt: 'Two people hugging', notes: 'Thank-you / gratitude section.' },
  'entertainment': { section: 'landing', role: 'stats', alt: 'Person dancing with a phone', notes: 'Live stats strip.' },
  'feliz': { section: 'landing', role: 'stats', alt: 'Person happily striding', notes: 'Leaderboard / celebration.' },
  'jumping': { section: 'landing', role: 'cta', alt: 'Person jumping with joy wearing a backpack', notes: 'Bottom call-to-action.' },
  'whoa': { section: 'landing', role: 'cta', alt: 'Person leaning back in surprise, pointing', notes: 'Reward / "level up" moment.' },
  'chaotic-good': { section: 'landing', role: 'cta', alt: 'Person kicking playfully in a long coat', notes: 'Playful CTA variant.' },
  // auth pages
  'waiting': { section: 'auth', role: 'login', alt: 'Person sitting cross-legged, waiting calmly', notes: 'Login page side panel.' },
  'new-beginnings': { section: 'auth', role: 'signup', alt: 'Person relaxing in an armchair reading', notes: 'Signup step 1 (role pick).' },
  'reflecting': { section: 'auth', role: 'signup-oku', alt: 'Person sitting hugging their knees, thoughtful', notes: 'OKU onboarding hero (needs step).' },
  'chillin': { section: 'auth', role: 'signup-helper', alt: 'Person standing casually with a prosthetic leg and a bag', notes: 'Helper onboarding hero.' },
  'chilly': { section: 'auth', role: 'signup-helper', alt: 'Person in a big coat with headphones', notes: 'Helper onboarding alternate.' },
  'bueno': { section: 'auth', role: 'welcome', alt: 'Person crouching and pointing with a thumbs-up mood', notes: 'Welcome modal after account creation.' },
  'meela-pantalones': { section: 'auth', role: 'permissions', alt: 'Person standing with hands in pockets', notes: 'Permissions prompt (location / camera / mic).' },
  'puppy': { section: 'auth', role: 'empty-state', alt: 'Person sitting and hugging a puppy', notes: 'Empty states (no requests yet) and mascot warmth.' },
  'polka-pup': { section: 'auth', role: 'empty-state', alt: 'Person in a polka-dot shirt cuddling a small dog', notes: 'Empty feed / "all caught up".' },
  'ecto-plasma': { section: 'auth', role: 'error', alt: 'Person walking away with a backpack', notes: 'Logged-out / session-expired state.' },
  // reserve — themed, keep available but not placed by default
  'astro': { section: 'reserve', role: 'unused', alt: 'Person in an astronaut helmet', notes: 'Off-theme (space); keep for 404 / "lost" page.' },
  'pilot': { section: 'reserve', role: 'unused', alt: 'Person in a pilot helmet', notes: 'Off-theme; possible navigation-mode badge.' },
  'rogue': { section: 'reserve', role: 'unused', alt: 'Person in a sci-fi helmet', notes: 'Off-theme.' },
  'roboto': { section: 'reserve', role: 'unused', alt: 'Robot-suited figure jumping', notes: 'Off-theme; AI assistant easter egg.' },
  'kiddo': { section: 'reserve', role: 'unused', alt: 'Child wearing an oversized helmet', notes: 'Off-theme.' },
  'pacheco': { section: 'reserve', role: 'unused', alt: 'Person running with a big backpack rig', notes: 'Possible "on the way" alt.' },
  'gamestation': { section: 'reserve', role: 'unused', alt: 'Person walking holding a handheld console', notes: 'Possible shop / character screen accent.' },
  'cube-leg': { section: 'reserve', role: 'unused', alt: 'Person in a long coat with a prosthetic leg', notes: 'Possible OKU alt hero.' },
};
delete UI['walking-1'];
const uiFiles = walk(ILLU_DIR);
const uiItems = uiFiles.map((f) => {
  const slug = slugOf(f); const info = inspect(f); const rel = path.relative(ILLU_DIR, f).split(path.sep).join('/');
  const meta = UI[slug] || { section: 'reserve', role: 'unused', alt: titleOf(slug), notes: 'Not yet placed — add to UI map in scripts/build-assets-manifest.js.' };
  return { id: `illustration/${slug}`, slug, name: titleOf(slug), section: meta.section, role: meta.role, alt: meta.alt, notes: meta.notes, file: `illustrations/${rel}`, url: url(f), viewBox: info.viewBox, width: info.width, height: info.height, bytes: info.bytes, monochrome: info.monochrome, style: 'open-doodles-ink' };
});
const bySection = {};
for (const it of uiItems) (bySection[it.section] = bySection[it.section] || []).push(it.id);
const uiElements = {
  description: 'Standalone 1080×1080 ink illustrations (Open Doodles style) for the landing page, hero section and auth pages. Use <img src=url> or inline; all are transparent-background SVGs.',
  sections: {
    hero: { label: 'Hero section', pick: 'hero-primary first; hero-alt rotate on reload', ids: bySection.hero || [] },
    landing: { label: 'Landing page tiles (features, stats, CTA)', ids: bySection.landing || [] },
    auth: { label: 'Auth pages (login, signup steps, welcome, permissions, empty/error states)', ids: bySection.auth || [] },
    reserve: { label: 'Available but not placed by default', ids: bySection.reserve || [] },
  },
  slots: Object.fromEntries(uiItems.filter((i) => i.section !== 'reserve').map((i) => [i.role, (uiItems.filter((x) => x.role === i.role).map((x) => x.id))])),
  count: uiItems.length,
  items: uiItems,
};

// ---------- write ----------
const manifest = {
  $schema: 'kitabantu/assets-manifest/v1',
  generatedAt: new Date().toISOString(),
  generator: 'scripts/build-assets-manifest.js',
  baseUrl: '/assets/',
  license: { avatar_parts: { name: 'Open Peeps', author: 'Pablo Stanley', license: 'CC0 1.0', url: 'https://www.openpeeps.com/' }, ui_elements: { name: 'Open Doodles', author: 'Pablo Stanley', license: 'CC0 1.0', url: 'https://www.opendoodles.com/' } },
  summary: { ui_elements: uiElements.count, avatar_parts: avatarParts.total, byLayer: avatarParts.counts, uiBySection: Object.fromEntries(Object.entries(bySection).map(([k, v]) => [k, v.length])) },
  ui_elements: uiElements,
  avatar_parts: avatarParts,
};
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(manifest, null, 2) + '\n');
console.log(`wrote ${path.relative(ROOT, OUT)}: ${uiElements.count} ui_elements (${Object.entries(bySection).map(([k, v]) => `${k} ${v.length}`).join(', ')}), ${avatarParts.total} avatar_parts (${Object.entries(avatarParts.counts).map(([k, v]) => `${k} ${v}`).join(', ')})`);
