'use strict';
/**
 * KitaBantu API + static host.
 *
 * Auth:      POST /api/auth/register · POST /api/auth/login · POST /api/auth/logout · GET /api/me · PATCH /api/me
 * Reports:   GET /api/reports · POST /api/reports · GET /api/reports/:id · POST /api/reports/:id/verify
 * Requests:  GET /api/requests · POST /api/requests · POST /api/requests/:id/answer · POST /api/requests/:id/thank
 * Routing:   GET /api/route?from=&to=&need=
 * Places:    GET /api/geocode?q= · GET /api/reverse?lat=&lng=
 * Social:    GET /api/leaderboard · GET /api/feed · GET /api/users/:id · GET /api/stats
 * Live:      GET /api/events (SSE; per-user notifications when token is passed)
 * Demo:      POST /api/demo/advance · POST /api/demo/reset · GET /api/demo/accounts
 */

const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const express = require('express');

// Load .env (KEY=value lines) without a dependency; real env vars win.
try {
  for (const line of fs.readFileSync(path.join(__dirname, '.env'), 'utf8').split('\n')) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env */ }

const { Store, AVATARS, COLORS } = require('./lib/store');
const { planRoute } = require('./lib/routing');
const { checkPhoto } = require('./lib/photocheck');
const google = require('./lib/google');
const assistant = require('./lib/assistant');
const agent = require('./lib/agent');
const wardrobe = require('./lib/wardrobe');
const { buildSteps } = require('./lib/steps');
const places = require('./lib/places');
const { TYPES, NEEDS } = require('./lib/catalogue');
const { BANDS } = require('./lib/trust');
const gam = require('./lib/gamification');
const { DEMO_PASSWORD, USERS: SEED_USERS } = require('./data/seed');

const PORT = Number(process.env.PORT || 3000);
const UPLOADS = path.join(__dirname, 'data', 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const app = express();
const store = new Store();

function savePhoto(dataUrl) {
  const m = /^data:(image\/(?:jpeg|png|webp));base64,(.+)$/i.exec(dataUrl || '');
  if (!m) return null;
  const ext = m[1].toLowerCase().includes('png') ? 'png' : m[1].toLowerCase().includes('webp') ? 'webp' : 'jpg';
  const name = `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  fs.writeFileSync(path.join(UPLOADS, name), Buffer.from(m[2], 'base64'));
  return `/uploads/${name}`;
}

app.disable('x-powered-by');
app.use(express.json({ limit: '8mb' }));
app.use((req, res, next) => { res.setHeader('Cache-Control', req.path.startsWith('/api/') ? 'no-store' : 'public, max-age=300'); next(); });
app.use(express.static(path.join(__dirname, 'public'), {
  extensions: ['html'],
  etag: true,
  setHeaders(res, filePath) {
    // Our own HTML/JS/CSS must never be served stale from a browser or proxy cache;
    // vendored libraries/fonts and photos can be cached for a long time.
    if (/[\\/]vendor[\\/]|[\\/]seed-photos[\\/]/.test(filePath)) res.setHeader('Cache-Control', 'public, max-age=604800');
    else if (/\.html$/.test(filePath)) res.setHeader('Cache-Control', 'no-store');
    else res.setHeader('Cache-Control', 'no-cache');
  }
}));
app.use('/uploads', express.static(UPLOADS, { maxAge: '7d', immutable: true }));

const lang = (req) => (req.query.lang === 'ms' ? 'ms' : 'en');
const num = (v, d) => { const n = Number(v); return Number.isFinite(n) ? n : d; };
const tokenOf = (req) => (req.headers.authorization || '').replace(/^Bearer\s+/i, '') || req.query.token || null;
function authed(req, res, next) {
  const tok = tokenOf(req);
  const user = store.userForToken(tok);
  if (!user) {
    const shape = !tok ? 'no-token' : `${tok.split('.').length}-parts/len${tok.length}`;
    console.warn(`[auth] 401 ${req.method} ${req.path} token=${shape} ua=${(req.headers['user-agent'] || '').slice(0, 40)}`);
    return res.status(401).json({ error: 'unauthorized', reason: !tok ? 'no_token' : 'unknown_token' });
  }
  req.user = user;
  next();
}
function maybeAuthed(req, _res, next) { req.user = store.userForToken(tokenOf(req)); next(); }
const viewerOf = (req) => { if (!req.user) return null; const v = { id: req.user.id }; if (req.query.lat && req.query.lng) { v.lat = num(req.query.lat); v.lng = num(req.query.lng); } return v; };

// ---------- meta ----------
app.get('/api/meta', (req, res) => {
  const l = lang(req);
  res.json({
    needs: NEEDS,
    types: Object.fromEntries(Object.entries(TYPES).map(([k, v]) => [k, { ...v, label: l === 'ms' ? v.ms : v.en }])),
    bands: BANDS, levels: gam.LEVELS, points: gam.POINTS, badges: gam.BADGES.map(({ test, ...b }) => b), avatars: AVATARS, colors: COLORS,
    photoAI: !!process.env.GEMINI_API_KEY, ai: assistant.enabled(), googleMaps: google.enabled(), seededAt: store.seededAt, now: store.now(), stats: store.stats(), areas: [...new Set(store.users.map((u) => u.area).filter(Boolean))].sort(),
  });
});

// ---------- auth ----------
app.post('/api/auth/register', (req, res) => {
  const out = store.register(req.body || {});
  if (out.error) return res.status(400).json(out);
  res.status(201).json(out);
});
app.post('/api/auth/login', (req, res) => {
  const out = store.login(req.body || {});
  if (out.error) return res.status(401).json(out);
  res.json(out);
});
app.post('/api/auth/logout', authed, (req, res) => { store.logout(tokenOf(req)); res.json({ ok: true }); });
app.get('/api/me', authed, (req, res) => res.json(store.userView(req.user.id, lang(req))));
app.patch('/api/me', authed, (req, res) => res.json(store.updateProfile(req.user.id, req.body || {})));
// ---------- wardrobe / shop ----------
app.get('/api/wardrobe', authed, (req, res) => { const u = store.user(req.user.id); res.json(wardrobe.view(u, lang(req), gam.levelFor(u.points).level)); });
app.post('/api/wardrobe/buy', authed, (req, res) => { const out = store.buyItem(req.user.id, String((req.body || {}).id || '')); res.status(out.error ? 400 : 200).json(out); });
app.post('/api/wardrobe/equip', authed, (req, res) => { const b = req.body || {}; const out = store.equipItem(req.user.id, String(b.id || ''), b.on !== false); res.status(out.error ? 400 : 200).json(out); });
app.post('/api/wardrobe/skin', authed, (req, res) => res.json(store.setSkin(req.user.id, (req.body || {}).skin)));
app.get('/api/wardrobe/catalogue', (req, res) => res.json(wardrobe.publicCatalogue(lang(req))));
app.post('/api/me/read', authed, (req, res) => { store.markRead(req.user.id); res.json({ ok: true }); });
app.get('/api/demo/accounts', (req, res) => res.json({ password: DEMO_PASSWORD, accounts: SEED_USERS.map((u) => ({ email: u.email, name: u.name, role: u.role, need: u.need, avatar: u.avatar, color: u.color })) }));

// ---------- reports ----------
app.get('/api/reports', maybeAuthed, (req, res) => {
  const kinds = req.query.kinds ? String(req.query.kinds).split(',') : null;
  const near = req.query.lat && req.query.lng ? { lat: num(req.query.lat), lng: num(req.query.lng) } : null;
  res.json({ now: store.now(), reports: store.listReports({ need: req.query.need || null, kinds, includeExpired: req.query.all === '1', lang: lang(req), near, radiusM: num(req.query.radius, 0) }) });
});
app.get('/api/reports/:id', (req, res) => {
  const r = store.report(req.params.id);
  if (!r) return res.status(404).json({ error: 'not_found' });
  res.json(store.scored(r, store.now(), lang(req)));
});
app.post('/api/reports', authed, async (req, res) => {
  const { type, lat, lng, place, note, photo } = req.body || {};
  if (!TYPES[type]) return res.status(400).json({ error: 'unknown_type' });
  const la = num(lat), ln = num(lng);
  if (la == null || ln == null || Math.abs(la) > 90 || Math.abs(ln) > 180) return res.status(400).json({ error: 'bad_location' });
  let photoCheck = null, photoUrl = null;
  if (photo) {
    photoCheck = await checkPhoto(photo, type);
    if (!photoCheck.ok) return res.status(400).json({ error: 'photo_rejected', reason: photoCheck.reason, summary: photoCheck.summary });
    photoUrl = savePhoto(photo);
  }
  const out = store.createReport({ type, lat: la, lng: ln, place: String(place || '').slice(0, 140), note: String(note || '').slice(0, 400), photo: photoUrl, photoCheck, userId: req.user.id });
  if (out.error) return res.status(400).json(out);
  res.status(201).json(out);
});
app.post('/api/reports/:id/verify', authed, async (req, res) => {
  const { action, at, note, photo } = req.body || {};
  let photoCheck = null, photoUrl = null;
  if (photo) {
    photoCheck = await checkPhoto(photo, store.report(req.params.id)?.type);
    if (!photoCheck.ok) return res.status(400).json({ error: 'photo_rejected', reason: photoCheck.reason });
    photoUrl = savePhoto(photo);
  }
  const loc = at && Number.isFinite(Number(at.lat)) && Number.isFinite(Number(at.lng)) ? { lat: Number(at.lat), lng: Number(at.lng) } : null;
  const out = store.verify({ reportId: req.params.id, userId: req.user.id, action, at: loc, note: String(note || '').slice(0, 400), photo: photoUrl, photoCheck });
  if (out.error) return res.status(out.error === 'not_found' ? 404 : 409).json(out);
  res.json(out);
});

// ---------- check requests ----------
app.get('/api/requests', maybeAuthed, (req, res) => {
  const near = req.query.lat && req.query.lng ? { lat: num(req.query.lat), lng: num(req.query.lng) } : null;
  res.json({ now: store.now(), requests: store.listRequests({ status: req.query.status || null, lang: lang(req), viewer: viewerOf(req), mine: req.query.mine === '1', near }) });
});
app.get('/api/requests/:id', maybeAuthed, (req, res) => {
  const q = store.request(req.params.id);
  if (!q) return res.status(404).json({ error: 'not_found' });
  res.json(store.requestView(q, lang(req), viewerOf(req)));
});
app.post('/api/requests', authed, (req, res) => {
  const { place, question, lat, lng, urgency } = req.body || {};
  const la = num(lat), ln = num(lng);
  if (la == null || ln == null) return res.status(400).json({ error: 'bad_location' });
  const out = store.createRequest({ userId: req.user.id, place, question, lat: la, lng: ln, urgency });
  if (out.error) return res.status(400).json(out);
  res.status(201).json(out);
});
app.post('/api/requests/:id/answer', authed, async (req, res) => {
  const { verdict, note, photo, at, ai } = req.body || {};
  let photoUrl = null;
  if (photo) {
    const check = await checkPhoto(photo, 'other_obstacle');
    if (!check.ok) return res.status(400).json({ error: 'photo_rejected', reason: check.reason });
    photoUrl = savePhoto(photo);
  }
  const loc = at && Number.isFinite(Number(at.lat)) && Number.isFinite(Number(at.lng)) ? { lat: Number(at.lat), lng: Number(at.lng) } : null;
  const aiView = ai && typeof ai === 'object' ? { score: Math.max(0, Math.min(100, Number(ai.score) || 0)), verdict: String(ai.verdict || '').slice(0, 12), summary: String(ai.summary || '').slice(0, 400), model: String(ai.model || '').slice(0, 40) } : null;
  const out = store.answerRequest({ requestId: req.params.id, userId: req.user.id, verdict, note, photo: photoUrl, at: loc, ai: aiView });
  if (out.error) return res.status(out.error === 'not_found' ? 404 : 409).json(out);
  res.json(out);
});
app.post('/api/requests/:id/thank', authed, (req, res) => {
  const out = store.thankAnswer({ requestId: req.params.id, answerId: req.body?.answerId, userId: req.user.id });
  if (out.error) return res.status(out.error === 'not_found' ? 404 : 409).json(out);
  res.json(out);
});

// ---------- routing ----------
app.get('/api/route', async (req, res) => {
  const parse = (s) => { const [a, b] = String(s || '').split(',').map(Number); return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null; };
  const from = parse(req.query.from), to = parse(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'from and to must be lat,lng' });
  const need = NEEDS[req.query.need] ? req.query.need : null;
  try {
    const plan = await planRoute({ from, to, need, reports: store.listReports({ lang: lang(req) }) });
    res.json({ from, to, ...plan });
  } catch (err) {
    res.status(502).json({ error: 'routing_failed', detail: err.message });
  }
});

// ---------- geocoding proxy ----------
const geocodeCache = new Map();
const normName = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9\u00C0-\u024F ]+/g, ' ').replace(/\s+/g, ' ').trim();
async function geocode(q, near, L) {
  const ck = `${q}|${L}|${near ? near.lat.toFixed(2) + ',' + near.lng.toFixed(2) : ''}`;
  if (geocodeCache.has(ck)) return { results: geocodeCache.get(ck), cached: true };
  // 0. offline POI snapshot (instant, pilot areas) → 1. Google Places text search → 2. Google Geocoding → 3. Nominatim
  let results = null, source = 'osm';
  if (near && places.inSnapshotArea(near.lat, near.lng)) {
    const snap = await places.around({ lat: near.lat, lng: near.lng, kind: 'any', radius: 60000, lang: L, q });
    const nq = normName(q); const strong = (snap.places || []).filter((p) => normName(p.name).includes(nq));
    if (strong.length) snap.places = strong.concat((snap.places || []).filter((p) => !strong.includes(p)));
    if (snap.places && snap.places.length) { results = snap.places.slice(0, 6).map((p) => ({ name: p.name, display: [p.name, p.address].filter(Boolean).join(', '), lat: p.lat, lng: p.lng, type: p.type, place: p })); source = 'osm-snapshot'; }
  }
  if (!results && google.enabled()) {
    const g = await google.textSearch({ q, lat: near?.lat, lng: near?.lng, radius: 30000, max: 6, lang: L });
    if (g.ok) { results = g.places.map((p) => ({ name: p.name, display: p.address, lat: p.lat, lng: p.lng, type: p.type, place: p })); source = 'google-places'; }
    else { const gc = await google.geocode({ q, lang: L }); if (gc.ok) { results = gc.results; source = 'google-geocoding'; } }
  }
  if (!results) {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=my${near ? `&viewbox=${near.lng - 0.15},${near.lat + 0.15},${near.lng + 0.15},${near.lat - 0.15}` : '&viewbox=101.55,3.25,101.80,3.02'}&bounded=0&q=${encodeURIComponent(q)}`;
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 8000);
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'KitaBantu-hackathon-demo/1.0', 'Accept-Language': L }, signal: ctrl.signal });
      const data = r.ok ? await r.json() : [];
      results = data.map((d) => ({ name: d.name || d.display_name.split(',')[0], display: d.display_name, lat: Number(d.lat), lng: Number(d.lon), type: d.type }));
    } finally { clearTimeout(t); }
  }
  if (results.length) geocodeCache.set(ck, results);
  return { results, source };
}
app.get('/api/geocode', async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q.length < 2) return res.json({ results: [] });
  const near = req.query.lat && req.query.lng ? { lat: num(req.query.lat), lng: num(req.query.lng) } : null;
  try { res.json(await geocode(q, near, lang(req))); }
  catch (err) { res.status(502).json({ error: 'geocode_failed', detail: err.message, results: [] }); }
});
app.get('/api/reverse', async (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat,lng required' });
  const key = `${lat.toFixed(4)},${lng.toFixed(4)}|${lang(req)}`;
  if (geocodeCache.has(key)) return res.json(geocodeCache.get(key));
  if (google.enabled()) {
    const g = await google.reverse({ lat, lng, lang: lang(req) });
    if (g.ok) { const out = { name: g.name, display: g.display, source: 'google' }; geocodeCache.set(key, out); return res.json(out); }
  }
  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${lat}&lon=${lng}`;
    const r = await fetch(url, { headers: { 'User-Agent': 'KitaBantu-hackathon-demo/1.0', 'Accept-Language': lang(req) } });
    const d = r.ok ? await r.json() : {};
    const a = d.address || {};
    const name = d.name || a.building || a.amenity || a.shop || a.road || a.neighbourhood || a.suburb || '';
    const road = a.road && a.road !== name ? a.road : '';
    const area = a.neighbourhood || a.suburb || a.city_district || a.city || '';
    const out = { name: [name, road, area].filter(Boolean).slice(0, 2).join(', ') || 'Unnamed location', display: d.display_name || '', source: 'osm' };
    geocodeCache.set(key, out);
    res.json(out);
  } catch (err) { res.json({ name: 'Unnamed location', display: '', error: err.message }); }
});

// ---------- places around the user (Google Places New → OSM Overpass fallback) ----------
app.get('/api/places', async (req, res) => {
  const lat = num(req.query.lat), lng = num(req.query.lng);
  if (lat == null || lng == null) return res.status(400).json({ error: 'lat,lng required' });
  const kind = String(req.query.kind || 'any');
  const radius = Math.min(3000, Math.max(200, num(req.query.radius, 1200)));
  try {
    const out = await places.around({ lat, lng, kind, radius, lang: lang(req), q: String(req.query.q || '') });
    // attach community knowledge: nearest reports within 120 m of each place
    const reports = store.listReports({ lang: lang(req) });
    for (const p of out.places) {
      const near = reports.filter((r) => r.status === 'active' && Math.hypot((r.lat - p.lat) * 111320, (r.lng - p.lng) * 111320 * Math.cos(lat * Math.PI / 180)) <= 120);
      p.community = { reports: near.length, features: near.filter((r) => r.kind === 'feature').length, obstacles: near.filter((r) => r.kind === 'obstacle').length, top: near.sort((a, b) => b.trust - a.trust).slice(0, 3).map((r) => ({ id: r.id, type: r.type, label: r.label, trust: r.trust, kind: r.kind, icon: r.icon })) };
      p.distM = Math.round(Math.hypot((lat - p.lat) * 111320, (lng - p.lng) * 111320 * Math.cos(lat * Math.PI / 180)));
    }
    out.places.sort((a, b) => a.distM - b.distM);
    res.json(out);
  } catch (err) { res.status(502).json({ error: 'places_failed', detail: err.message, places: [] }); }
});

// ---------- turn-by-turn navigation (Google Routes → local accessibility router) ----------
app.get('/api/navigate', async (req, res) => {
  const parse = (v) => { const [a, b] = String(v || '').split(',').map(Number); return Number.isFinite(a) && Number.isFinite(b) ? { lat: a, lng: b } : null; };
  const from = parse(req.query.from), to = parse(req.query.to);
  if (!from || !to) return res.status(400).json({ error: 'from and to must be lat,lng' });
  const need = NEEDS[req.query.need] ? req.query.need : null;
  const L = lang(req);
  const reports = store.listReports({ lang: L });
  // Always compute the accessibility-aware plan (scores, obstacles, detours)
  let plan = null;
  try { plan = await planRoute({ from, to, need, reports }); } catch (err) { plan = { engine: 'none', routes: [], note: err.message }; }
  const best = plan.routes[0] || null;
  // Google Routes: real turn-by-turn with street names when the API is enabled
  let steps = null, engine = 'kitabantu', coords = best && best.coords ? best.coords.map((p) => ({ lat: p.lat, lng: p.lng })) : [from, to], distanceM = best?.distanceM || 0, durationS = best ? best.durationMin * 60 : 0, googleErr = null;
  if (google.enabled()) {
    const g = await google.walkRoutes({ from, to, lang: L, alternatives: false });
    if (g.ok && g.routes.length) {
      const gr = g.routes[0];
      // Prefer Google's instructions when its route is not much longer than our accessible route
      // (it is not accessibility-aware; when our detour is clearly different, keep ours and narrate it).
      if (!best || gr.distanceM <= best.distanceM * 1.15 || best.score < 50) { steps = gr.steps; engine = 'google'; coords = gr.coords; distanceM = gr.distanceM; durationS = gr.durationS; }
    } else googleErr = g.reason || null;
  }
  if (!steps) {
    const names = best && best.names ? best.names : null;
    steps = buildSteps(coords, { names, streets: best ? best.streets : [], lang: L });
  }
  // Obstacle warnings along the way (from the accessible plan)
  const warnings = best ? best.hits.map((h) => ({ reportId: h.reportId, label: h.label, alongM: h.alongM, trust: h.trust, icon: h.icon, lat: h.lat, lng: h.lng })) : [];
  res.json({ from, to, need, engine, google: google.enabled() ? (engine === 'google' ? 'ok' : googleErr || 'not_used') : 'off', distanceM: Math.round(distanceM), durationMin: Math.max(1, Math.round(durationS / 60)), coords, steps, warnings, score: best?.score ?? null, verdict: best?.verdict ?? null, plan: { engine: plan.engine, note: plan.note, routes: plan.routes.length } });
});

// ---------- AI assistant ----------
app.get('/api/config', (req, res) => res.json({ googleMapsKey: process.env.GOOGLE_MAPS_API_KEY || null, ai: assistant.enabled(), model: assistant.enabled() ? assistant.MODEL() : null }));
app.post('/api/assistant', maybeAuthed, async (req, res) => {
  const { text, lang: L, ctx } = req.body || {};
  if (!text || String(text).trim().length < 1) return res.status(400).json({ error: 'text_required' });
  try {
    const context = { ...(ctx || {}) };
    if (req.user) { const u = store.user(req.user.id); if (u) context.user = { name: u.name, role: u.role, need: u.need, points: u.points, level: u.level }; }
    if (context.location && context.location.lat != null) {
      const rep = store.listReports({ lang: L === 'ms' ? 'ms' : 'en' }).filter((r) => r.status === 'active').map((r) => ({ ...r, d: Math.hypot((r.lat - context.location.lat) * 111320, (r.lng - context.location.lng) * 111320) })).filter((r) => r.d <= 1500).sort((a, b) => a.d - b.d).slice(0, 12);
      context.reports = rep.map((r) => ({ id: r.id, place: r.place, type: r.type, label: r.label, kind: r.kind, trust: r.trust, band: r.bandLabel, distM: Math.round(r.d) }));
      if (!context.requests) context.requests = store.listRequests({ status: 'open', lang: L === 'ms' ? 'ms' : 'en', near: context.location }).slice(0, 8).map((q) => ({ id: q.id, place: q.place, question: q.question, need: q.need, distM: q.distM, bounty: q.bounty?.base }));
    }
    const out = await assistant.chat({ text: String(text).slice(0, 600), lang: L === 'ms' ? 'ms' : 'en', ctx: context });
    res.json(out);
  } catch (err) { res.status(502).json({ error: 'assistant_failed', detail: err.message }); }
});
// ---------- AI agent with full app access (function calling) ----------
function agentTools(req, ctx, utterance = '') {
  const L = lang(req);
  const wantsNav = /\b(take me|bring me|bawa|navigate|guide me|pandu|pergi ke|go to|jalan ke|route to|directions?|bawa saya)\b/i.test(utterance);
  const user = req.user;
  const here = () => (ctx.location && ctx.location.lat != null ? { lat: Number(ctx.location.lat), lng: Number(ctx.location.lng) } : { lat: 2.9213, lng: 101.6559 });
  const dist = (a, b) => Math.round(Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180)));
  const slimReport = (r) => ({ id: r.id, type: r.type, kind: r.kind, label: r.label, place: r.place, note: r.note, trust: r.trust, band: r.bandLabel, ageH: r.ageH != null ? Math.round(r.ageH) : undefined, lat: r.lat, lng: r.lng, distM: dist(here(), r), confirms: r.confirmations, photo: !!r.photo });
  const slimRequest = (q) => ({ id: q.id, place: q.place, question: q.question, need: q.need, urgency: q.urgency, status: q.status, by: q.by && q.by.name, mine: q.mine, answeredByMe: q.answeredByMe, lat: q.lat, lng: q.lng, distM: q.distM != null ? q.distM : dist(here(), q), ageMin: q.ageMin, bounty: q.bounty && { base: q.bounty.base, withPhoto: q.bounty.withPhoto, fastMinLeft: q.bounty.fastWindowMin }, answers: (q.answers || []).length });
  const need = (v) => (NEEDS[v] ? v : null);
  return async (name, a) => {
    switch (name) {
      case 'search_places': {
        const c = a.lat != null && a.lng != null ? { lat: Number(a.lat), lng: Number(a.lng) } : here();
        const radius = Math.min(30000, Math.max(200, Number(a.radius_m) || 1500));
        const q = String(a.query || '').trim();
        let out = await places.around({ lat: c.lat, lng: c.lng, kind: KINDS_OK(a.kind), radius, lang: L, q });
        let list = out.places || [];
        if (!list.length && q) { const g = await geocode(q, c, L).catch(() => ({ results: [] })); list = g.results.map((r) => ({ id: r.name, name: r.name, address: r.display, lat: r.lat, lng: r.lng, type: r.type || 'place', source: g.source, accessibility: r.place ? r.place.accessibility : null })); }
        const reports = store.listReports({ lang: L });
        const mapped = list.slice(0, 8).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, type: p.type, address: p.address || undefined, distM: dist(c, p), accessibility: p.accessibility && p.accessibility.known ? p.accessibility : undefined, community_reports: reports.filter((r) => r.status === 'active' && dist(r, p) <= 120).slice(0, 3).map((r) => ({ id: r.id, label: r.label, kind: r.kind, trust: r.trust })) }));
        const kindHint = a.kind && a.kind !== 'any' ? a.kind : null;
        const next = !mapped.length ? 'Nothing found — try geocode(query) or a broader radius.'
          : wantsNav ? 'The user asked to GO there: call start_navigation(lat,lng,label) with the best match NOW (not focus_map).'
          : kindHint ? `Show these to the user now with show_places_on_map(kind="${kindHint}").`
          : 'Show the chosen place on the map now with focus_map(lat,lng,label).';
        return { source: out.source, count: list.length, places: mapped, next };
      }
      case 'geocode': { const g = await geocode(String(a.query || ''), here(), L); return { source: g.source, results: g.results.slice(0, 5).map((r) => ({ name: r.name, display: r.display, lat: r.lat, lng: r.lng })) }; }
      case 'list_reports': {
        const c = a.lat != null && a.lng != null ? { lat: Number(a.lat), lng: Number(a.lng) } : here();
        const radius = Math.min(20000, Math.max(100, Number(a.radius_m) || 1500));
        let list = store.listReports({ lang: L, need: need(a.need) }).filter((r) => r.status === 'active' && dist(c, r) <= radius);
        if (a.kind) list = list.filter((r) => r.kind === a.kind);
        list.sort((x, y) => dist(c, x) - dist(c, y));
        return { count: list.length, reports: list.slice(0, 12).map(slimReport) };
      }
      case 'list_requests': {
        const status = a.status && a.status !== 'all' ? a.status : null;
        const list = store.listRequests({ status, lang: L, viewer: user ? { id: user.id, ...here() } : null, mine: !!a.mine, near: here() });
        return { count: list.length, requests: list.slice(0, Math.min(20, Number(a.limit) || 10)).map(slimRequest) };
      }
      case 'get_request': { const q = store.request(String(a.id || '')); if (!q) return { error: 'not_found' }; const v = store.requestView(q, L, user ? { id: user.id, ...here() } : null); return { ...slimRequest(v), answers: (v.answers || []).map((x) => ({ id: x.id, by: x.by && x.by.name, verdict: x.verdict, note: x.note, ageMin: x.ageMin, photo: !!x.photo, ai: x.ai || undefined })) }; }
      case 'answer_request': {
        if (!user) return { error: 'sign_in_required' }; if (user.role !== 'helper') return { error: 'helpers_only' };
        const out = store.answerRequest({ requestId: String(a.id || ''), userId: user.id, verdict: a.verdict, note: String(a.note || '').slice(0, 400), photo: null, at: ctx.location ? here() : null, ai: null });
        return out.error ? out : { ok: true, points: out.reward && out.reward.points, reward: out.reward };
      }
      case 'create_request': {
        if (!user) return { error: 'sign_in_required' };
        const out = store.createRequest({ userId: user.id, place: a.place, question: a.question, lat: Number(a.lat), lng: Number(a.lng), urgency: a.urgency || 'today' });
        return out.error ? out : { ok: true, id: out.request && out.request.id, reward: out.reward };
      }
      case 'thank_answer': {
        if (!user) return { error: 'sign_in_required' };
        const q = store.request(String(a.request_id || '')); if (!q) return { error: 'not_found' };
        const answerId = a.answer_id || (q.answers[q.answers.length - 1] || {}).id;
        const out = store.thankAnswer({ requestId: q.id, answerId, userId: user.id });
        return out.error ? out : { ok: true };
      }
      case 'create_report': {
        if (!user) return { error: 'sign_in_required' }; if (!TYPES[a.type]) return { error: 'unknown_type' };
        const c = a.lat != null && a.lng != null ? { lat: Number(a.lat), lng: Number(a.lng) } : here();
        const out = store.createReport({ type: a.type, lat: c.lat, lng: c.lng, place: String(a.place || (ctx.location && ctx.location.name) || '').slice(0, 140), note: String(a.note || '').slice(0, 400), photo: null, photoCheck: null, userId: user.id });
        return out.error ? out : { ok: true, id: out.report && out.report.id, reward: out.reward };
      }
      case 'verify_report': {
        if (!user) return { error: 'sign_in_required' };
        const out = store.verify({ reportId: String(a.id || ''), userId: user.id, action: a.action, at: ctx.location ? here() : null, note: String(a.note || '').slice(0, 400), photo: null, photoCheck: null });
        return out.error ? out : { ok: true, reward: out.reward, trust: out.report && out.report.trust };
      }
      case 'route_between': {
        const resolve = async (q) => {
          if (!q) return null;
          const nq = normName(q);
          // wide radius so "KL Sentral" resolves from Cyberjaya; prefer exact / containing name matches over loose token matches
          const r = await places.around({ lat: here().lat, lng: here().lng, kind: 'any', radius: 60000, lang: L, q: String(q) }).catch(() => ({ places: [] }));
          const list = r.places || [];
          let hit = list.find((p) => normName(p.name) === nq) || list.find((p) => normName(p.name).includes(nq));
          if (!hit) { const g = await geocode(String(q), here(), L).catch(() => ({ results: [] })); hit = g.results.find((p) => normName(p.name).includes(nq)) || g.results[0]; }
          if (!hit) hit = list[0];
          return hit ? { name: hit.name, lat: hit.lat, lng: hit.lng } : null;
        };
        const to = await resolve(a.to_query); if (!to) return { error: 'destination_not_found', query: a.to_query };
        const locName = String((ctx.location && ctx.location.name) || '').trim().toLowerCase();
        const fq = String(a.from_query || '').trim();
        const isHere = !fq || /^(here|my location|where i am|sini|di sini|lokasi saya|current location|kedudukan saya)$/i.test(fq) || (locName && (fq.toLowerCase() === locName || locName.includes(fq.toLowerCase())));
        const from = isHere ? { name: (ctx.location && ctx.location.name) || (L === 'ms' ? 'lokasi anda' : 'your location'), ...here() } : await resolve(fq);
        if (!from) return { error: 'origin_not_found', query: a.from_query };
        const nd = need(a.need) || (user && user.need) || 'wheelchair';
        const plan = await planRoute({ from, to, need: nd, reports: store.listReports({ lang: L }) });
        const lbl = (h) => `${h.label}${h.trust != null ? ` (${h.trust}% trust)` : ''}`;
        const routes = plan.routes.slice(0, 3).map((r) => ({ label: r.recommended ? 'recommended' : r.detour ? 'detour' : 'shortest', distanceM: r.distanceM, durationMin: r.durationMin, score: r.score, verdict: r.verdict, streets: r.streets, obstacles: (r.hits || []).map(lbl), features: (r.features || []).map((h) => h.label) }));
        return { from, to, need: nd, engine: plan.engine, routes, next: 'Now call show_route(from_lat,from_lng,from_label,to_lat,to_lng,to_label,need) so the user sees it on the map, and say distance, minutes and any obstacles.' };
      }
      case 'plan_route': {
        const from = a.from_lat != null ? { lat: Number(a.from_lat), lng: Number(a.from_lng) } : here();
        const to = { lat: Number(a.to_lat), lng: Number(a.to_lng) };
        const plan = await planRoute({ from, to, need: need(a.need) || (user && user.need) || null, reports: store.listReports({ lang: L }) });
        return { engine: plan.engine, note: plan.note, routes: plan.routes.slice(0, 3).map((r) => ({ label: r.recommended ? 'recommended' : 'shortest', distanceM: r.distanceM, durationMin: r.durationMin, score: r.score, verdict: r.verdict, obstacles: (r.hits || []).map((h) => h.label), features: (r.features || []).map((h) => h.label) })) };
      }
      case 'get_wardrobe': { if (!user) return { error: 'sign_in_required' }; const u = store.user(user.id); const v = wardrobe.view(u, L, gam.levelFor(u.points).level); return { coins: v.coins, equipped: v.equipped, owned: v.items.filter((i) => i.owned).map((i) => ({ id: i.id, layer: i.layer, name: i.name, keywords: i.keywords, equipped: i.equipped })), shop: v.items.filter((i) => !i.owned).map((i) => ({ id: i.id, layer: i.layer, name: i.name, keywords: i.keywords, price: i.price, rarity: i.rarity, locked: i.locked, minLevel: i.minLevel })) }; }
      case 'buy_item': { if (!user) return { error: 'sign_in_required' }; const out = store.buyItem(user.id, String(a.id || '')); return out.error ? out : { ok: true, item: L === 'ms' ? out.item.nameMs : out.item.name, coins: out.coins, equipped: true }; }
      case 'equip_item': { if (!user) return { error: 'sign_in_required' }; const out = store.equipItem(user.id, String(a.id || ''), a.on !== false); return out.error ? out : { ok: true, equipped: out.equipped }; }
      case 'get_profile': { if (!user) return { error: 'sign_in_required' }; const v = store.userView(user.id, L); return { name: v.name, role: v.role, need: v.need, points: v.points, coins: v.coins, level: v.level, levelTitle: v.title, nextLevelAt: v.nextLevelAt, streak: v.streak, rank: v.rank, badges: v.badges.map((b) => b.name), missions: v.missions.map((m) => ({ title: m.title, done: m.done, progress: m.progress, goal: m.goal })), notifications: v.notifications.slice(0, 5).map((n) => n.text), stats: v.stats }; }
      case 'update_profile': { if (!user) return { error: 'sign_in_required' }; const patch = {}; if (a.name) patch.name = String(a.name).slice(0, 40); if (a.area) patch.area = String(a.area).slice(0, 60); if (need(a.need)) patch.need = a.need; const out = store.updateProfile(user.id, patch); return out && out.error ? out : { ok: true, applied: patch }; }
      case 'get_leaderboard': { const rows = store.leaderboard(a.period === 'all' ? 'all' : 'week', L).slice(0, Math.min(20, Number(a.limit) || 5)); return { period: a.period || 'week', rows: rows.map((r) => ({ rank: r.rank, name: r.name, points: r.points, level: r.level })), me: user ? (store.leaderboard('week', L).find((r) => r.id === user.id) || null) : null }; }
      case 'get_feed': return { items: store.feed(L, Math.min(20, Number(a.limit) || 8)).map((i) => ({ text: i.text, ageMin: i.ageMin })) };
      case 'get_stats': return store.stats();
      case 'demo_control': { if (a.action === 'reset') { store.reset(); return { ok: true, reset: true }; } const h = Math.max(1, Math.min(240, Number(a.hours) || 24)); store.advance(h * 3600e3); return { ok: true, advancedHours: h }; }
      default: return { error: `unknown_tool ${name}` };
    }
  };
}
const KINDS_OK = (k) => (k && places.KINDS[k] ? k : 'any');
app.post('/api/agent', maybeAuthed, async (req, res) => {
  const { text, lang: L, ctx, reset, local } = req.body || {};
  const key = req.user ? `u:${req.user.id}` : `ip:${req.ip}`;
  if (reset) agent.clearMemory(key);
  if (!text || String(text).trim().length < 1) return res.status(400).json({ error: 'text_required' });
  if (!agent.enabled()) return res.status(503).json({ error: 'ai_off' });
  try {
    const out = await agent.run({ text: String(text).slice(0, 800), lang: L === 'ms' ? 'ms' : 'en', ctx: ctx || {}, user: req.user || null, exec: agentTools(req, ctx || {}, String(text)), local: !!local, memoryKey: key });
    res.json(out);
  } catch (err) { res.status(502).json({ error: 'agent_failed', detail: err.message }); }
});

app.post('/api/assess', authed, async (req, res) => {
  const { photo, question, need, place, lang: L } = req.body || {};
  if (!photo) return res.status(400).json({ error: 'photo_required' });
  const out = await assistant.assess({ dataUrl: photo, question, need: NEEDS[need] ? need : 'wheelchair', place, lang: L === 'ms' ? 'ms' : 'en' });
  if (!out.ok) return res.status(out.reason === 'ai_off' ? 503 : 400).json({ error: out.reason, detail: out.message });
  res.json(out);
});

// ---------- social ----------
app.get('/api/leaderboard', (req, res) => res.json({ period: req.query.period || 'week', rows: store.leaderboard(req.query.period || 'week', lang(req), req.query.area || null) }));
app.get('/api/feed', (req, res) => res.json({ items: store.feed(lang(req), num(req.query.limit, 20)) }));
app.get('/api/users/:id', (req, res) => { const u = store.user(req.params.id); if (!u) return res.status(404).json({ error: 'not_found' }); res.json({ ...store.publicUser(u, lang(req)), badges: u.badges, impact: store.impact(u.id) }); });
app.get('/api/stats', (req, res) => res.json(store.stats()));

// ---------- live updates ----------
const clients = new Set();
app.get('/api/events', maybeAuthed, (req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
  res.write(`event: hello\ndata: ${JSON.stringify({ now: store.now() })}\n\n`);
  const client = { res, userId: req.user ? req.user.id : null };
  clients.add(client);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => { clearInterval(ping); clients.delete(client); });
});
store.on('change', (evt) => {
  const payload = `event: change\ndata: ${JSON.stringify({ ...evt, now: store.now() })}\n\n`;
  for (const c of clients) c.res.write(payload);
});
store.on('notify', ({ userId, notification }) => {
  const payload = `event: notify\ndata: ${JSON.stringify(notification)}\n\n`;
  for (const c of clients) if (c.userId === userId) c.res.write(payload);
});

// ---------- demo controls ----------
app.post('/api/demo/advance', (req, res) => { store.advance(num(req.body?.hours, 1) * 3600e3); res.json({ now: store.now(), offsetH: store.clock.offsetMs / 36e5 }); });
app.post('/api/demo/reset', (req, res) => { store.reset(); res.json({ ok: true, now: store.now() }); });

app.get('/healthz', (req, res) => res.json({ ok: true, now: store.now(), reports: store.reports.length, users: store.users.length }));
app.get('*', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

app.listen(PORT, '0.0.0.0', () => {
  console.log(`KitaBantu listening on http://0.0.0.0:${PORT}  (Gemini: ${assistant.enabled() ? assistant.MODEL() : 'off'} · Google Maps: ${google.enabled() ? 'on' : 'off'})`);
  // pre-warm the places cache for the two pilot areas (Overpass can take 5–10 s cold; cached for 10 min, refreshed every 8)
  const warmPlaces = () => { for (const c of [{ lat: 2.9213, lng: 101.6559 }, { lat: 3.13431, lng: 101.68637 }]) for (const kind of ['any', 'mall', 'transit', 'hospital']) places.around({ ...c, kind, radius: 1500 }).catch(() => {}); };
  setTimeout(warmPlaces, 1500); setInterval(warmPlaces, 8 * 60e3);
  const demo = { from: { lat: 3.13431, lng: 101.68637 }, to: { lat: 3.13214, lng: 101.69091 } };
  for (const need of ['wheelchair', 'visual', 'elderly', null]) {
    planRoute({ ...demo, need, reports: store.listReports() }).then((p) => console.log(`pre-warmed route (${need || 'all'}): ${p.routes.length} options, best ${p.recommended?.score}`)).catch((e) => console.warn('pre-warm failed:', e.message));
  }
});
