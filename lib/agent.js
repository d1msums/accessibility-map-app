'use strict';
/**
 * KitaBantu Agent — the voice assistant with FULL access to the app.
 *
 * Gemini native function calling in a loop (max ~6 rounds). Two kinds of tools:
 *   • SERVER tools: executed here, immediately, with the signed-in user's authority
 *     (search the whole map, places, requests, reports, answers, thanks, profile,
 *     leaderboard, feed, routing, geocoding, demo clock). Results go back to the model.
 *   • CLIENT tools: returned to the browser as `actions[]` and executed by guide.js
 *     (navigate, show places on the map, open screens, camera, language, mute, zoom …).
 *
 * Memory: a short per-user conversation transcript (server-side, in RAM) so follow-ups
 * like "the second one" / "yes do it" work across turns.
 *
 * Model access: the same hedged generate loop as assistant.js (free tier: 429/503 spikes).
 */
const { KINDS, parseQuery } = require('./places');
const { TYPES, NEEDS } = require('./catalogue');

const KEY = () => process.env.GEMINI_API_KEY || '';
const enabled = () => true; // the assistant always works: Gemini when a key exists, rule-based otherwise
const FALLBACKS = () => [process.env.GEMINI_MODEL || 'gemini-3.6-flash', 'gemini-3.5-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite'].filter((v, i, a) => a.indexOf(v) === i);
const cooldown = new Map();
let lastGood = null;

async function callModel(model, body, timeoutMs) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-goog-api-key': KEY() }, body: JSON.stringify(body), signal: ctrl.signal,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) { const e = new Error(data.error?.message || `Gemini ${res.status}`); e.status = res.status; throw e; }
    return data;
  } finally { clearTimeout(t); }
}
function noteFailure(model, err) {
  if (err.status === 429) { const m = /retry in ([\d.]+)s/i.exec(err.message); cooldown.set(model, Date.now() + Math.min(60e3, (m ? Number(m[1]) : 20) * 1000)); }
  else if (err.status === 503 || err.status === 500) cooldown.set(model, Date.now() + 30e3);
  else if (err.name === 'AbortError') cooldown.set(model, Date.now() + 20e3);
  if (lastGood === model) lastGood = null;
}
function order() { const list = FALLBACKS(); return lastGood && list.includes(lastGood) ? [lastGood, ...list.filter((m) => m !== lastGood)] : list; }
/** hedged: start the next model after hedgeMs while the previous one is still running; first good answer wins */
async function generate(body, { timeoutMs = 20000, hedgeMs = 4000, deadline = Infinity } = {}) {
  let models = order().filter((m) => (cooldown.get(m) || 0) <= Date.now());
  if (!models.length) {
    const soonest = Math.min(...order().map((m) => cooldown.get(m) || 0)) - Date.now();
    if (soonest > Math.min(15000, deadline - Date.now() - 3000)) { const e = new Error('no_model_available: rate limited, retry in ' + Math.ceil(soonest / 1000) + 's'); e.status = 429; throw e; }
    await new Promise((r) => setTimeout(r, Math.max(0, soonest) + 200));
    models = order().filter((m) => (cooldown.get(m) || 0) <= Date.now()); if (!models.length) models = order();
  }
  return new Promise((resolve, reject) => {
    let idx = 0, inflight = 0, done = false, lastErr = null;
    const launch = () => {
      if (done) return;
      if (idx >= models.length) { if (inflight === 0) reject(lastErr || new Error('no_model_available')); return; }
      const model = models[idx++]; inflight++;
      const hedge = setTimeout(launch, hedgeMs);
      callModel(model, body, timeoutMs)
        .then((data) => { clearTimeout(hedge); inflight--; if (done) return; done = true; lastGood = model; resolve({ data, model }); })
        .catch((err) => { clearTimeout(hedge); inflight--; lastErr = err; noteFailure(model, err); if (!done) launch(); });
    };
    launch();
  });
}

// ---------------------------------------------------------------------------------------
// Tool declarations (Gemini function-calling schema)
// ---------------------------------------------------------------------------------------
const S = (props, required = []) => ({ type: 'object', properties: props, required });
const str = (description, extra = {}) => ({ type: 'string', description, ...extra });
const numT = (description) => ({ type: 'number', description });
const boolT = (description) => ({ type: 'boolean', description });

const SERVER_TOOLS = [
  { name: 'search_places', description: 'Search the WHOLE map for places by free text and/or category near a point. Use for "find X", "nearest pharmacy", "where is DPulze", "any mall around". Returns names, coordinates, distance and known accessibility facts. Search before navigating when the user names a place.',
    parameters: S({ query: str('Free-text name/keywords, e.g. "DPulze", "farmasi", "hospital". Empty for category only.'), kind: str('Category filter', { enum: ['any', ...Object.keys(KINDS).filter((k) => k !== 'any')] }), radius_m: numT('Search radius in metres (default 1500, max 30000)'), lat: numT('Centre latitude (default: user location)'), lng: numT('Centre longitude') }) },
  { name: 'geocode', description: 'Resolve an address / place name anywhere in Malaysia to coordinates (Google or OpenStreetMap). Use when search_places finds nothing.', parameters: S({ query: str('Address or place name') }, ['query']) },
  { name: 'list_reports', description: 'Community accessibility reports (features like ramps/lifts and obstacles like broken lifts/blocked kerbs) with trust scores, near a point or for a need.', parameters: S({ radius_m: numT('Radius in metres (default 1500)'), need: str('Filter by need', { enum: ['wheelchair', 'visual', 'elderly'] }), kind: str('feature or obstacle', { enum: ['feature', 'obstacle'] }), lat: numT('Centre latitude (default user)'), lng: numT('Centre longitude') }) },
  { name: 'list_requests', description: 'Check-requests ("tasks") from OKU members: open ones near the user, or the user\'s own. Includes bounties, urgency, distance and any answers.', parameters: S({ status: str('open | answered | closed | all', { enum: ['open', 'answered', 'closed', 'all'] }), mine: boolT('Only the signed-in user\'s own requests (OKU) / answered by them (helper)'), limit: numT('Max results (default 10)') }) },
  { name: 'get_request', description: 'Full detail of one check-request, including all answers and AI assessments.', parameters: S({ id: str('Request id') }, ['id']) },
  { name: 'answer_request', description: 'HELPERS ONLY. Submit the user\'s answer to a check-request (yes / partly / no + a note). Only call when the user clearly stated their answer; confirm the verdict in your reply. Earns points.', parameters: S({ id: str('Request id'), verdict: str('yes | partly | no', { enum: ['yes', 'partly', 'no'] }), note: str('Short note in the user\'s words (>= 5 chars)') }, ['id', 'verdict', 'note']) },
  { name: 'create_request', description: 'OKU MEMBERS ONLY. Post a new check-request to the community ("ask the community whether X is accessible"). Needs a place with coordinates (use search_places/geocode first) and the question text.', parameters: S({ place: str('Place name'), lat: numT('Latitude'), lng: numT('Longitude'), question: str('The question (>= 8 chars), in the user\'s language'), urgency: str('today | this_week | whenever', { enum: ['today', 'this_week', 'whenever'] }) }, ['place', 'lat', 'lng', 'question']) },
  { name: 'thank_answer', description: 'OKU MEMBERS ONLY. Send a thank-you (+5 pts) to the helper who answered one of the user\'s requests.', parameters: S({ request_id: str('Request id'), answer_id: str('Answer id (from get_request); omit to thank the latest answer') }, ['request_id']) },
  { name: 'create_report', description: 'Create a community report at coordinates: a feature (ramp, lift_ok, tactile, toilet, entrance, crossing, parking, staff) or an obstacle (lift_broken, kerb_blocked, construction, pavement, steps_only, parking_blocked, tactile_blocked, other_obstacle). Use the user\'s current location unless they name a place. Confirm before creating unless the user was explicit.', parameters: S({ type: str('Report type id', { enum: Object.keys(TYPES) }), place: str('Place name'), note: str('Short description'), lat: numT('Latitude (default user location)'), lng: numT('Longitude') }, ['type', 'note']) },
  { name: 'verify_report', description: 'Confirm ("still true") or dispute ("no longer true / wrong") an existing community report. Earns points.', parameters: S({ id: str('Report id'), action: str('confirm | dispute', { enum: ['confirm', 'dispute'] }), note: str('Optional note') }, ['id', 'action']) },
  { name: 'route_between', description: 'Answer "how do I get from A to B / how long / how far / is it step-free / any obstacles on the way": resolves BOTH place names (from_query may be omitted = user location), compares accessible route options for the need, lists obstacles and features on each. Follow it with show_route so the map draws it.',
    parameters: S({ to_query: str('Destination place name or address'), from_query: str('Origin place name ONLY when the user names a different starting point; OMIT it to start from the user\'s current GPS position (never pass the city/area name from context)'), need: str('wheelchair | visual | elderly (default: user need)', { enum: ['wheelchair', 'visual', 'elderly'] }) }, ['to_query']) },
  { name: 'plan_route', description: 'Compare accessible route options between two points for a need (recommended vs shortest, obstacles on the way, scores). Use to answer "is the way to X step-free / how far / how long". To actually START guidance use the client tool start_navigation.', parameters: S({ to_lat: numT('Destination latitude'), to_lng: numT('Destination longitude'), from_lat: numT('Origin latitude (default user)'), from_lng: numT('Origin longitude'), need: str('wheelchair | visual | elderly', { enum: ['wheelchair', 'visual', 'elderly'] }) }, ['to_lat', 'to_lng']) },
  { name: 'get_wardrobe', description: 'The user\'s character wardrobe: coins, what is equipped, items owned, and the shop (items with price/rarity/level lock). Use for "what can I buy", "how many coins", "show my character".', parameters: S({}) },
  { name: 'buy_item', description: 'Buy a shop item with coins (then it is equipped automatically). Only on clear intent ("buy the hoodie", "beli topi"). Resolve the id with get_wardrobe first.', parameters: S({ id: str('Item id from get_wardrobe.shop') }, ['id']) },
  { name: 'equip_item', description: 'Wear / remove an owned item on the character ("wear the cap", "pakai hoodie", "take off the glasses"). Resolve the id with get_wardrobe first.', parameters: S({ id: str('Item id from get_wardrobe.owned'), on: boolT('true = wear, false = remove') }, ['id']) },
  { name: 'get_profile', description: 'The signed-in user\'s profile: points, level, streak, badges, missions, rank, recent notifications, stats.', parameters: S({}) },
  { name: 'update_profile', description: 'Change the user\'s profile: display name, home area, or accessibility need (wheelchair / visual / elderly). Only when the user asks.', parameters: S({ name: str('New display name'), area: str('Home area / neighbourhood'), need: str('Need', { enum: ['wheelchair', 'visual', 'elderly'] }) }) },
  { name: 'get_leaderboard', description: 'Weekly or all-time helper leaderboard, optionally the user\'s rank.', parameters: S({ period: str('week | all', { enum: ['week', 'all'] }), limit: numT('Rows (default 5)') }) },
  { name: 'get_feed', description: 'Latest community activity (reports, answers, thanks).', parameters: S({ limit: numT('Items (default 8)') }) },
  { name: 'get_stats', description: 'App-wide live numbers: active reports, open requests, helpers.', parameters: S({}) },
  { name: 'demo_control', description: 'Demo tools: advance the demo clock by hours (to show trust decay) or reset the demo data. Only when the user explicitly asks.', parameters: S({ action: str('advance | reset', { enum: ['advance', 'reset'] }), hours: numT('Hours to advance (for advance)') }, ['action']) },
];

const CLIENT_TOOLS = [
  { name: 'start_navigation', description: 'Start spoken turn-by-turn guidance on the map to coordinates (from search_places/geocode/a request). The app speaks each turn. Prefer this when the user says take me / bring me / go to / navigate.', parameters: S({ lat: numT('Destination latitude'), lng: numT('Destination longitude'), label: str('Destination name shown in the banner'), request_id: str('If this is a check-request task, its id (enables camera → answer on arrival)') }, ['lat', 'lng', 'label']) },
  { name: 'show_route', description: 'Draw a route comparison on the map between two points (after route_between). Does NOT start guidance.', parameters: S({ from_lat: numT('Origin latitude'), from_lng: numT('Origin longitude'), from_label: str('Origin name'), to_lat: numT('Destination latitude'), to_lng: numT('Destination longitude'), to_label: str('Destination name'), need: str('wheelchair | visual | elderly', { enum: ['wheelchair', 'visual', 'elderly'] }) }, ['from_lat', 'from_lng', 'to_lat', 'to_lng']) },
  { name: 'stop_navigation', description: 'Stop the current guidance.', parameters: S({}) },
  { name: 'navigation_step', description: 'Repeat the current instruction or read the next one / all remaining steps aloud.', parameters: S({ which: str('repeat | next | all', { enum: ['repeat', 'next', 'all'] }) }, ['which']) },
  { name: 'show_places_on_map', description: 'Open the map and show a category of places around the user with pins and a list (mall, transit, hospital, toilet, parking, restaurant, pharmacy, mosque, bank, any), optionally filtered by text.', parameters: S({ kind: str('Category', { enum: Object.keys(KINDS) }), query: str('Optional text filter') }, ['kind']) },
  { name: 'focus_map', description: 'Move/zoom the map to a point (or the user) and optionally drop a highlight pin with a label. Use for "show me where X is" without navigating.', parameters: S({ lat: numT('Latitude'), lng: numT('Longitude'), zoom: numT('Zoom 12–19 (default 17)'), label: str('Pin label') }, ['lat', 'lng']) },
  { name: 'map_zoom', description: 'Zoom the map in or out, or set the need filter shown on the map.', parameters: S({ direction: str('in | out', { enum: ['in', 'out'] }), need_filter: str('Need filter for pins: all | wheelchair | visual | elderly', { enum: ['all', 'wheelchair', 'visual', 'elderly'] }) }) },
  { name: 'open_screen', description: 'Navigate the app UI: home, requests (task board), map, community (leaderboard), profile, shop (character wardrobe & coin shop), ask (OKU ask form), request:<id> (a request detail), report:<id> (a report on the map).', parameters: S({ screen: str('home | requests | map | community | profile | shop | ask | request:<id> | report:<id>') }, ['screen']) },
  { name: 'open_camera', description: 'Open the in-app camera so the user can photograph the place; the AI then assesses accessibility and can pre-fill an answer/report. Use when the user has arrived or wants to check something with the camera.', parameters: S({ request_id: str('Request id the photo answers, if any') }) },
  { name: 'prefill_ask', description: 'OKU: open the Ask form pre-filled with a place and question so the user just taps Send (use instead of create_request when they may want to edit).', parameters: S({ place: str('Place name'), lat: numT('Latitude'), lng: numT('Longitude'), question: str('Question text'), urgency: str('today | this_week | whenever', { enum: ['today', 'this_week', 'whenever'] }) }, ['place']) },
  { name: 'set_language', description: 'Switch the whole app UI + voice to English (en) or Bahasa Melayu (ms).', parameters: S({ lang: str('en | ms', { enum: ['en', 'ms'] }) }, ['lang']) },
  { name: 'set_setting', description: 'Toggle app settings: voice guidance mute, large text, or re-open the permissions dialog.', parameters: S({ mute: boolT('true = mute spoken guidance, false = unmute'), large_text: boolT('Large text mode'), permissions: boolT('true = open the permissions dialog') }) },
  { name: 'logout', description: 'Sign the user out (only on an explicit request).', parameters: S({}) },
];
const CLIENT_TOOL_NAMES = new Set(CLIENT_TOOLS.map((t) => t.name));

const SYSTEM = `You are KitaBantu Agent — the voice assistant INSIDE a Malaysian accessibility app for OKU (persons with disabilities) and community helpers. You have full authority to operate the app on the user's behalf through tools: search the whole map, read and act on tasks, create requests/reports, control navigation, the camera, screens and settings.

RULES
- Language: users speak English or Bahasa Melayu (often mixed). Reply in the language of the user's LAST message (a BM message gets a BM reply even if the UI language is English). Keep replies to 1–2 short spoken sentences (they are read aloud) — no emoji, no markdown, no lists.
- Nearest-first: when the user asks for the nearest / a category near them, ALWAYS talk about the closest result (smallest distM) and show the whole category with show_places_on_map.
- Be an agent, not a chatbot: when the user asks for something, DO it with tools, then report what you did. Chain tools freely (e.g. search_places → start_navigation; search_places → create_request; list_requests → get_request → answer_request).
- Places: ALWAYS resolve a named place with search_places (then geocode if empty) before start_navigation / focus_map / create_request. Pick the best match by name and distance; if several plausible matches exist and the choice matters, name the top 2–3 and ask which one — otherwise just pick the nearest.
- Whenever you look places up for the user ("find", "where is", "show", "nearest", "any X around"), ALWAYS also display them on the map in the SAME turn: show_places_on_map(kind) for a category, focus_map(lat,lng,label) for one named place. Never ask "would you like me to show it" — just show it and say the distance. Only start_navigation when they ask to go / take / bring / navigate.
- Routes between two places ("from A to B", "how long to X", "is the way to X step-free", "any obstacles on the way") → route_between (one call resolves both names) then show_route; speak distance, minutes, score and the obstacles by name. Only start_navigation if they want to go now.
- Requests by voice ("make a request for someone to check X", "buat permintaan", "I need someone to see if the lift at X works") → OKU: search_places(X) then create_request; helpers: explain only OKU members post requests and offer list_requests instead.
- Tasks: "tasks", "requests", "kerja", "permintaan" = check-requests from list_requests. "Take me to the task / the first one / Aisha's one" → get its coordinates and start_navigation with request_id.
- Destructive or point-earning actions (answer_request, create_request, create_report, verify_report, thank_answer, update_profile, demo_control, logout) need clear intent in the user's words; if the intent is clear, act without asking again. Never invent a verdict — if the user has not said whether something is accessible, ask (or open_camera).
- Accessibility questions ("is X accessible?", "is the lift working?") → search_places + list_reports (and get_request) and answer honestly with how recent/trusted the information is; when nothing is known suggest asking the community (OKU) or checking it (helper).
- Context provided each turn: user profile, GPS location + name, active navigation, current screen, current time. Use it; do not ask for things you already know.
- Client tools run in the app after your reply; describe the outcome as done ("Starting guidance to DPulze, about 800 metres.").
- Character & shop: helpers earn coins with points and dress a 2D character (hair, outfit, glasses, item, pet, background, frame). "buy X / beli X" → get_wardrobe → buy_item; "wear X / pakai X" → equip_item; "show my character / open the shop" → open_screen("shop"). Mobility aids are always free.
- Malaysian context: OKU, surau, LRT/MRT, Grab, "lif rosak" etc. Be warm, brief, practical.`;

// ---------------------------------------------------------------------------------------
// Memory (per user, in RAM)
// ---------------------------------------------------------------------------------------
const MEM = new Map(); // key -> { turns: [ {role, parts} ], at }
const MEM_TTL = 30 * 60e3;
function memory(key) { const m = MEM.get(key); if (m && Date.now() - m.at < MEM_TTL) return m; const fresh = { turns: [], at: Date.now() }; MEM.set(key, fresh); return fresh; }
const isText = (c) => !!(c && c.parts && c.parts.some((p) => typeof p.text === 'string' && p.text.trim()));
const hasCall = (c) => !!(c && c.parts && c.parts.some((p) => p.functionCall));
const hasResp = (c) => !!(c && c.parts && c.parts.some((p) => p.functionResponse));
/**
 * Keep a valid Gemini transcript: starts with a plain user text turn, every functionCall model turn is immediately
 * followed by its functionResponse user turn, and it ends with a model text turn (so the next user turn can follow).
 */
function trimTurns(turns) {
  let out = turns.slice(-16);
  while (out.length && !(out[0].role === 'user' && isText(out[0]) && !hasResp(out[0]))) out.shift();
  const clean = [];
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (hasCall(c)) { const nx = out[i + 1]; if (!nx || nx.role !== 'user' || !hasResp(nx)) break; clean.push(c, nx); i++; continue; }
    if (hasResp(c)) break; // orphan response
    clean.push(c);
  }
  while (clean.length && !(clean[clean.length - 1].role === 'model' && isText(clean[clean.length - 1]) && !hasCall(clean[clean.length - 1]))) clean.pop();
  return clean;
}
function clearMemory(key) { MEM.delete(key); }

// ---------------------------------------------------------------------------------------
// Local fast path — simple app commands never need the LLM (instant, works when rate-limited)
// ---------------------------------------------------------------------------------------
const BM_MARKERS = /\b(saya|awak|anda|bawa|cari|carikan|tandas|tukar|buka|pergi|di mana|dimana|tunjuk|tunjukkan|papar|senyap|senyapkan|bahasa|papan|profil|peta|berhenti|hentikan|ulang|kamera|farmasi|dekat|terdekat|tugasan|permintaan|jawab|tanya|laman|utama|besar|kecil|masuk|keluar|hidupkan|matikan|teks|kebenaran|mata|sampai|dah|sudah|apa|mana|boleh|nak|hendak|mahu|tolong|sila)\b/i;
function guessLang(text, ui) { const hits = (String(text).match(BM_MARKERS) || []).length; if (hits >= 1 && !/\b(the|please|show|open|take|find|where|is|my|me|to|and)\b/i.test(text)) return 'ms'; if (hits >= 2) return 'ms'; if (/\b(the|please|show|open|take|find|where|is|my|me|and)\b/i.test(text)) return 'en'; return ui; }
const T = {
  en: { stopped: 'Guidance stopped.', no_nav: 'There is no active guidance.', camera: 'Opening the camera.', screen: 'Opening {s}.', lang_ms: 'Beralih ke Bahasa Melayu.', lang_en: 'Switching to English.', mute: 'Voice muted.', unmute: 'Voice on.', big_on: 'Large text on.', big_off: 'Large text off.', perms: 'Opening the permissions dialog.', zin: 'Zooming in.', zout: 'Zooming out.', logout: 'Signing you out.', nav: 'Taking you to {n}.', found: 'I found {c} places. Nearest: {l}. Showing them on the map.', none: 'I could not find {q} nearby.', req: 'Opening {p}.', noreq: 'I could not find that request.', busy: 'The AI is busy right now, but I can still open screens, navigate and search places for you.',
    screens: { home: 'home', requests: 'the task board', map: 'the map', community: 'the community leaderboard', profile: 'your profile', ask: 'the ask form', shop: 'your character and the shop' } },
  ms: { stopped: 'Panduan dihentikan.', no_nav: 'Tiada panduan aktif.', camera: 'Membuka kamera.', screen: 'Membuka {s}.', lang_ms: 'Beralih ke Bahasa Melayu.', lang_en: 'Switching to English.', mute: 'Suara disenyapkan.', unmute: 'Suara dihidupkan.', big_on: 'Teks besar dihidupkan.', big_off: 'Teks besar dimatikan.', perms: 'Membuka tetapan kebenaran.', zin: 'Zum masuk.', zout: 'Zum keluar.', logout: 'Log keluar.', nav: 'Membawa anda ke {n}.', found: 'Saya jumpa {c} tempat. Paling dekat: {l}. Dipaparkan di peta.', none: 'Saya tidak jumpa {q} berdekatan.', req: 'Membuka {p}.', noreq: 'Saya tidak jumpa permintaan itu.', busy: 'AI sedang sibuk, tetapi saya masih boleh buka skrin, navigasi dan cari tempat untuk anda.',
    screens: { home: 'laman utama', requests: 'papan tugasan', map: 'peta', community: 'papan pendahulu komuniti', profile: 'profil anda', ask: 'borang tanya', shop: 'karakter anda dan kedai' } },
};
const fmt = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => (o[k] != null ? o[k] : ''));
const VERB = '(?:open|go to|goto|show|show me|take me to|bring up|buka|pergi ke|tunjuk|tunjukkan|papar|paparkan|pergi|lihat|tengok|display|switch to|back to)';
const SCREEN_RE = {
  community: /\b(leaderboard|leader board|community|komuniti|papan pendahulu|ranking|carta)\b/i,
  requests: /\b(task board|tasks|requests|tugasan|permintaan|jobs|kerja)\b/i,
  shop: /\b(shop|store|kedai|wardrobe|almari|closet|my character|karakter|watak|avatar|outfits?|pakaian|coins?|syiling|duit)\b/i,
  profile: /\b(profile|profil|settings|tetapan|my badges|lencana|account|akaun)\b/i,
  map: /\b(map|peta)\b/i,
  home: /\b(home|dashboard|laman utama|utama|papan pemuka)\b/i,
  ask: /\b(ask form|borang tanya|ask screen|new request|permintaan baru)\b/i,
};
/** Returns { say, actions } or null when the LLM is needed. */
function quickIntent(text, { lang, nav, role }) {
  const x = String(text).trim(); const low = x.toLowerCase(); const L = guessLang(x, lang); const tt = T[L];
  const words = low.split(/\s+/).length;
  const actions = []; const says = [];
  const add = (a, say) => { actions.push(a); if (say) says.push(say); };
  // navigation control
  if (/^(stop|berhenti|hentikan|batal|cancel|end|tamat)\b/.test(low) || /\b(stop|hentikan|berhenti(kan)?|batalkan|cancel)\b.*\b(navigation|navigasi|guidance|panduan|route|laluan|trip|perjalanan)\b/.test(low)) add({ type: 'stop_navigation' }, nav ? tt.stopped : tt.no_nav);
  else if (nav && /\b(repeat|ulang|sekali lagi|say again|apa tadi)\b/.test(low)) add({ type: 'navigation_step', which: 'repeat' });
  else if (nav && /\b(next step|what next|seterusnya|langkah seterusnya|lepas ni|then what)\b/.test(low)) add({ type: 'navigation_step', which: 'next' });
  else if (nav && /\b(all steps|read all|baca semua|semua langkah|whole route|seluruh laluan)\b/.test(low)) add({ type: 'navigation_step', which: 'all' });
  // camera
  if (/\b(open|buka|start|launch|use|guna|switch on)\b.*\b(camera|kamera)\b|\b(take|ambil|snap)\b.*\b(photo|picture|gambar|foto)\b|\b(i have arrived|i'm here|i am here|saya (dah|sudah|telah) sampai|dah sampai)\b/.test(low)) add({ type: 'open_camera', request_id: nav && nav.requestId ? nav.requestId : undefined }, tt.camera);
  // language
  if (/\b(bahasa melayu|bahasa malaysia|malay|melayu|\bbm\b)\b/.test(low) && /\b(switch|change|tukar|guna|use|to|ke|dalam|in|speak|cakap|set|pakai|back)\b/.test(low)) add({ type: 'set_language', lang: 'ms' }, T.ms.lang_ms);
  else if (/\b(english|inggeris|bahasa inggeris|\ben\b)\b/.test(low) && /\b(switch|change|tukar|guna|use|to|ke|dalam|in|speak|cakap|set|pakai|back)\b/.test(low)) add({ type: 'set_language', lang: 'en' }, T.en.lang_en);
  // settings
  const setting = {};
  if (/\b(unmute|nyahsenyap|hidupkan suara|voice on|turn on (the )?voice|suara on|bunyikan|sound on)\b/.test(low)) { setting.mute = false; says.push(tt.unmute); }
  else if (/\b(mute|senyap|senyapkan|diam|diamkan|matikan suara|quiet|silence|no voice|voice off|sound off)\b/.test(low)) { setting.mute = true; says.push(tt.mute); }
  if (/\b(large text|big text|bigger text|larger text|teks besar|tulisan besar|font besar|huruf besar|besarkan (teks|tulisan|huruf))\b/.test(low)) { const off = /\b(off|matikan|tutup|disable|smaller|kecil|normal|turn off)\b/.test(low); setting.large_text = !off; says.push(off ? tt.big_off : tt.big_on); }
  if (/\b(permission|permissions|kebenaran|izin)\b/.test(low) && /\b(open|show|ask|request|grant|allow|buka|tunjuk|minta|benarkan|beri|semak|check|fix|enable)\b/.test(low)) { setting.permissions = true; says.push(tt.perms); }
  if (Object.keys(setting).length) actions.push({ type: 'set_setting', ...setting });
  // map zoom
  if (/\b(zoom in|besarkan peta|dekatkan peta|zum masuk|closer)\b/.test(low)) add({ type: 'map_zoom', direction: 'in' }, tt.zin);
  else if (/\b(zoom out|kecilkan peta|jauhkan peta|zum keluar|further out)\b/.test(low)) add({ type: 'map_zoom', direction: 'out' }, tt.zout);
  // logout
  if (/\b(log ?out|sign out|log keluar|keluar (dari )?akaun|logout)\b/.test(low)) add({ type: 'logout' }, tt.logout);
  // screens (need a navigation verb, or be a bare screen name)
  if (!actions.some((a) => a.type === 'open_camera')) {
    const verbed = new RegExp(`\\b${VERB}\\b`).test(low) || words <= 3;
    if (verbed) for (const [sc, re] of Object.entries(SCREEN_RE)) if (re.test(low)) { if (sc === 'requests' && role === 'oku') break; if (sc === 'ask' && role !== 'oku') break; add({ type: 'open_screen', screen: sc }, fmt(tt.screen, { s: tt.screens[sc] })); break; }
  }
  if (!actions.length) return null;
  // anything that smells like a place search / question / task action → let the LLM handle it (it can still emit these tools)
  if (/\b(near|nearest|dekat|terdekat|where is|di mana|dimana|find|cari|carikan|search|take me|bawa|navigate|route|laluan|is it|adakah|how|berapa|why|kenapa|what|apa|who|siapa|request|permintaan|task|tugasan|answer|jawab|report|lapor|thank|terima kasih)\b/.test(low) && !actions.some((a) => a.type === 'open_screen' && a.screen === 'requests') && words > 3) return null;
  if (words > 14) return null;
  return { say: says.join(' ') || (L === 'ms' ? 'Baik.' : 'Okay.'), lang: L, actions, model: 'local' };
}

const ms = (L) => L === 'ms';
const TYPE_KIND = { pharmacy: 'pharmacy', hospital: 'hospital', clinic: 'hospital', doctors: 'hospital', dentist: 'hospital', toilets: 'toilet', parking: 'parking', restaurant: 'restaurant', cafe: 'restaurant', fast_food: 'restaurant', food_court: 'restaurant', place_of_worship: 'mosque', mosque: 'mosque', bank: 'bank', atm: 'bank', shopping_mall: 'mall', supermarket: 'mall', department_store: 'mall', bus_stop: 'transit', bus_station: 'transit', transit_station: 'transit', station: 'transit' };
/** Rule-based fallback when the LLM is unavailable: still search / navigate / open requests. */
async function fallback(text, { lang, exec, nav, role }) {
  const x = String(text).trim(); const low = x.toLowerCase(); const L = guessLang(x, lang); const tt = T[L];
  const clean = (q) => q.split(/[?!.,;]| \b(?:just|and|then|but|dan|kemudian|lepas tu|on the map|di peta|please|tolong)\b/i)[0].replace(/\b(please|tolong|sila|now|sekarang|for me|untuk saya|the|to|ke|nearest|terdekat|near me|dekat saya|nearby|berdekatan|around me|sekitar saya|paling dekat|is|located|terletak)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  let m;
  if ((m = /\b(?:take me|bring me|bawa saya|bawa|navigate|guide me|pergi|go)\s+(?:to|ke)?\s*(.+)$/i.exec(x))) {
    const q = clean(m[1]);
    if (/\b(task|request|tugasan|permintaan)\b/i.test(q) || /\b(first|second|third|pertama|kedua|ketiga)\b/i.test(q)) {
      const r = await exec('list_requests', { status: 'open', limit: 10 });
      const who = q.toLowerCase().replace(/['’]s\b/g, '').split(/\s+/).filter((w) => w.length > 2 && !/^(task|request|tugasan|permintaan|the|first|second|third|pertama|kedua|ketiga|nearest|closest|terdekat|one|that|this|punya)$/.test(w));
      const score = (rq) => who.filter((w) => `${rq.place} ${rq.question} ${rq.by}`.toLowerCase().includes(w)).length;
      let rq = who.length ? r.requests.slice().sort((a, b) => score(b) - score(a) || a.distM - b.distM)[0] : null;
      if (rq && score(rq) === 0) rq = null;
      if (!rq) { const idx = /\b(second|kedua)\b/i.test(q) ? 1 : /\b(third|ketiga)\b/i.test(q) ? 2 : 0; rq = r.requests[idx]; }
      if (rq) return { say: fmt(tt.nav, { n: rq.place, d: rq.distM }), lang: L, actions: [{ type: 'start_navigation', lat: rq.lat, lng: rq.lng, label: rq.place, request_id: rq.id }], model: 'local' };
    }
    const r = await exec('search_places', { query: q, kind: 'any', radius_m: 4000 }); const p = r.places[0];
    if (p) return { say: fmt(tt.nav, { n: p.name, d: p.distM }), lang: L, actions: [{ type: 'start_navigation', lat: p.lat, lng: p.lng, label: p.name }], model: 'local' };
    return { say: fmt(tt.none, { q }), lang: L, actions: [], model: 'local' };
  }
  // route between two places: "route from KL Sentral to MAB", "berapa lama dari DPulze ke Shaftsbury", "how do I get to X"
  const needOf = (q) => /\b(wheelchair|kerusi roda|wheel chair)\b/i.test(q) ? 'wheelchair' : /\b(blind|visual|buta|penglihatan|white cane|tongkat putih)\b/i.test(q) ? 'visual' : /\b(elderly|warga emas|orang tua|senior|walking stick)\b/i.test(q) ? 'elderly' : undefined;
  const placeOnly = (q) => clean(q).replace(/\b(with|in|on|using|for|by|dengan|guna|untuk|pakai|naik)\s+(a|an|the|my|me)?\s*(wheelchair|wheel chair|kerusi roda|white cane|tongkat putih|walking stick|tongkat|guide dog|anjing pemandu|foot|kaki|elderly person|warga emas|blind person|orang buta)\b.*$/i, '').replace(/\b(ada halangan.*|any obstacles?.*|is it .*|adakah .*|step[- ]free.*|boleh diakses.*|accessible.*|how long.*|berapa lama.*|berapa jauh.*|how far.*|berapa minit.*|how many minutes.*|safely.*|dengan selamat.*|tak|ke)$/i, '').replace(/\s+/g, ' ').trim();
  if ((m = /\b(?:from|dari)\s+(.+?)\s+(?:to|ke)\s+(.+?)\s*[?.!]*$/i.exec(x)) && /\b(route|path|way|laluan|jalan|how long|berapa lama|how far|berapa jauh|obstacle|halangan|step-free|accessible|boleh diakses|minutes?|minit|go|pergi|get)\b/i.test(x)) {
    const from = placeOnly(m[1]), to = placeOnly(m[2]);
    const r = await exec('route_between', { from_query: from, to_query: to, need: needOf(x) });
    if (r.error) return { say: fmt(tt.none, { q: r.query || to }), lang: L, actions: [], model: 'local' };
    return { say: summariseTrace([{ name: 'route_between', raw: r }], [], L), lang: L, actions: [{ type: 'show_route', from_lat: r.from.lat, from_lng: r.from.lng, from_label: r.from.name, to_lat: r.to.lat, to_lng: r.to.lng, to_label: r.to.name, need: r.need }], model: 'local' };
  }
  if ((m = /\b(?:how long|how far|berapa lama|berapa jauh|is the way|any obstacles?|ada halangan|step-free|route|laluan)\b.*?\b(?:to|ke|reach|sampai)\s+(.+?)\s*[?.!]*$/i.exec(x))) {
    const to = placeOnly(m[1]);
    const r = await exec('route_between', { to_query: to, need: needOf(x) });
    if (!r.error) return { say: summariseTrace([{ name: 'route_between', raw: r }], [], L), lang: L, actions: [{ type: 'show_route', from_lat: r.from.lat, from_lng: r.from.lng, from_label: r.from.name, to_lat: r.to.lat, to_lng: r.to.lng, to_label: r.to.name, need: r.need }], model: 'local' };
  }
  // helper answers a request by voice: "answer Kumar's toilet request: yes, it is open and clean"
  if (role === 'helper' && /\b(answer|jawab|reply|balas|submit|hantar)\b/i.test(x) && /\b(request|permintaan|task|tugasan|question|soalan)\b/i.test(x)) {
    const verdict = /\b(partly|partially|sebahagian|separuh|kind of|somewhat)\b/i.test(x) ? 'partly' : /\b(not|no|tidak|tak|bukan|rosak|broken|closed|tutup|blocked|tersekat)\b/i.test(x) ? 'no' : /\b(yes|ya|boleh|ok|okay|working|berfungsi|open|dibuka|accessible|clean|bersih|ada)\b/i.test(x) ? 'yes' : null;
    const r = await exec('list_requests', { status: 'open', limit: 20 });
    const toks = clean(x).toLowerCase().replace(/'s\b/g, '').split(/\s+/).filter((w) => w.length > 3 && !/^(answer|request|permintaan|task|tugasan|question|soalan|submit|that|this|with|jawab|hantar|accessible|there|about|kumar|aisha|siti)$/.test(w));
    const score = (rq) => toks.filter((w) => `${rq.place} ${rq.question} ${rq.by}`.toLowerCase().includes(w)).length;
    const byName = (rq) => (/kumar/i.test(x) && /kumar/i.test(rq.by)) || (/aisha/i.test(x) && /aisha/i.test(rq.by)) || (/siti/i.test(x) && /siti/i.test(rq.by)) ? 2 : 0;
    const best = r.requests.filter((rq) => !rq.mine && !rq.answeredByMe).sort((a, b) => (score(b) + byName(b)) - (score(a) + byName(a)) || a.distM - b.distM)[0];
    if (!best) return { say: tt.noreq, lang: L, actions: [], model: 'local' };
    if (!verdict) return { say: L === 'ms' ? `Untuk ${best.place}: adakah ia boleh diakses — ya, sebahagian atau tidak?` : `For ${best.place}: is it accessible — yes, partly or no?`, lang: L, actions: [{ type: 'open_screen', screen: `request:${best.id}` }], model: 'local' };
    const note = (x.split(/[:\-–—]/).slice(1).join(':').trim() || x).slice(0, 300);
    const out = await exec('answer_request', { id: best.id, verdict, note });
    if (out.error) return { say: L === 'ms' ? `Tidak dapat menghantar jawapan (${out.error}).` : `Could not submit the answer (${out.error}).`, lang: L, actions: [{ type: 'open_screen', screen: `request:${best.id}` }], model: 'local' };
    return { say: L === 'ms' ? `Jawapan "${verdict === 'yes' ? 'ya' : verdict === 'no' ? 'tidak' : 'sebahagian'}" dihantar untuk ${best.place}. Anda dapat ${out.points || 25} mata.` : `Answer "${verdict}" submitted for ${best.place}. You earned ${out.points || 25} points.`, lang: L, actions: [], model: 'local' };
  }
  // OKU asks the community: "tanya komuniti sama ada tandas OKU di Gem In Mall dibuka hari ini"
  if (role === 'oku' && (/\b(ask|tanya|tanyakan|post|create|make|send|raise|open|buat|hantar|cipta|minta|mintak)\b/i.test(x) && /\b(community|komuniti|request|permintaan|helpers?|pembantu|someone|somebody|seseorang|sesiapa|orang|whether|sama ada|if|kalau|adakah)\b/i.test(x) || /\b(i need|saya perlukan|saya nak|tolong)\b.*\b(check|semak|tengok|see|confirm|sahkan)\b/i.test(x))) {
    const pm = /\b(?:at|in|di|dekat|kat|near|to)\s+([A-Z][\w'&.-]*(?:\s+[A-Z][\w'&.-]*){0,4}|[\w'&.-]+(?:\s+[\w'&.-]+){0,3})/.exec(x.replace(/\b(hari ini|today|esok|tomorrow|sekarang|now|is working|works|berfungsi|dibuka|open|rosak|broken|please|tolong)\b.*$/i, '').replace(/\b(the|a|an|my|our)\s+(lift|lif|ramp|toilet|tandas|entrance|pintu|parking|kerb|elevator|escalator)\b/gi, ''));
    const placeQ = pm ? pm[1].trim() : '';
    const r = placeQ ? await exec('search_places', { query: placeQ, kind: 'any', radius_m: 15000 }) : { places: [] };
    const top = r.places[0];
    if (!top) return { say: L === 'ms' ? 'Tempat mana yang anda maksudkan? Saya akan buka borang tanya.' : 'Which place do you mean? I will open the ask form.', lang: L, actions: [{ type: 'prefill_ask', place: placeQ || '', question: x }], model: 'local' };
    const question = x.replace(/^\s*(please|tolong|sila)?\s*(ask|tanya|tanyakan|make|create|post|send|buat|hantar|cipta|minta)\s+(a\s+|the\s+|satu\s+)?(community|komuniti|request|permintaan)?\s*(for|to|kepada|untuk)?\s*(someone|somebody|seseorang|sesiapa|orang)?\s*(to\s+)?(come\s+(and\s+)?|datang\s+(dan\s+)?)?(check|semak|tengok|see|confirm|sahkan)?\s*(whether|if|sama ada|adakah|kalau)?\s*/i, '').trim();
    const urgency = /\b(today|hari ini|now|sekarang|urgent|segera|tonight|malam ini)\b/i.test(x) ? 'today' : /\b(this week|minggu ini)\b/i.test(x) ? 'this_week' : 'today';
    const out = await exec('create_request', { place: top.name, lat: top.lat, lng: top.lng, question: question.length >= 8 ? question : x, urgency });
    if (out.error) return { say: L === 'ms' ? 'Saya buka borang tanya untuk anda semak.' : 'I opened the ask form for you to check.', lang: L, actions: [{ type: 'prefill_ask', place: top.name, lat: top.lat, lng: top.lng, question: x, urgency }], model: 'local' };
    return { say: L === 'ms' ? `Soalan anda tentang ${top.name} telah dihantar kepada komuniti. Anda akan dimaklumkan bila ada jawapan.` : `Your question about ${top.name} has been posted to the community. I will tell you when someone answers.`, lang: L, actions: [{ type: 'open_screen', screen: `request:${out.id}` }], model: 'local' };
  }
  if ((m = /\b(?:open|buka|show|tunjuk|tunjukkan|go to|pergi ke)\s+(?:the\s+)?(.*?)\s*\b(?:request|permintaan|task|tugasan)\b\s*(.*)$/i.exec(x))) {
    const r = await exec('list_requests', { status: 'all', limit: 20 }); const toks = clean(`${m[1] || ''} ${m[2] || ''}`).toLowerCase().replace(/['’]s\b/g, '').split(' ').filter((w) => w.length > 2 && !/^(first|second|third|pertama|kedua|ketiga|nearest|closest|terdekat|that|this|itu|ini|one|punya)$/.test(w));
    if (/\b(first|pertama|nearest|closest|terdekat)\b/i.test(x) && !toks.length) { const rq = r.requests[0]; if (rq) return { say: fmt(tt.req, { p: rq.place }), lang: L, actions: [{ type: 'open_screen', screen: `request:${rq.id}` }], model: 'local' }; }
    if (/\b(second|kedua)\b/i.test(x) && !toks.length) { const rq = r.requests[1]; if (rq) return { say: fmt(tt.req, { p: rq.place }), lang: L, actions: [{ type: 'open_screen', screen: `request:${rq.id}` }], model: 'local' }; }
    const score = (rq) => toks.filter((w) => `${rq.place} ${rq.question} ${rq.by}`.toLowerCase().includes(w)).length;
    const best = r.requests.slice().sort((a, b) => score(b) - score(a) || a.distM - b.distM)[0];
    if (best && (!toks.length || score(best) > 0)) return { say: fmt(tt.req, { p: best.place }), lang: L, actions: [{ type: 'open_screen', screen: `request:${best.id}` }], model: 'local' };
    return { say: tt.noreq, lang: L, actions: [], model: 'local' };
  }
  // shop by voice: "buy the hoodie" / "beli topi" / "wear the cap" / "pakai cermin mata"
  if ((m = /\b(?:buy|beli|belikan|purchase|get me)\s+(?:the\s+|a\s+|an\s+)?(.+?)\s*[.!]*$/i.exec(x)) || (m = /\b(?:wear|pakai|pakaikan|equip|put on|take off|tanggal|buka|remove)\s+(?:the\s+|my\s+)?(.+?)\s*[.!]*$/i.exec(x))) {
    const wanted = clean(m[1]).toLowerCase(); const off = /\b(take off|tanggal|remove|buka)\b/i.test(x); const buying = /\b(buy|beli|belikan|purchase|get me)\b/i.test(x);
    const w = await exec('get_wardrobe', {}); if (w.error) return { say: tt.busy, lang: L, actions: [], model: 'local' };
    const score = (i) => wanted.split(/\s+/).filter((t) => t.length > 2 && `${i.name} ${i.keywords || ''}`.toLowerCase().includes(t)).length;
    const pool = buying ? w.shop : w.owned;
    const hit = pool.slice().sort((a, b) => score(b) - score(a))[0];
    if (!buying && !(hit && score(hit) > 0)) { // wants to wear something not owned → point at the shop item
      const sh = w.shop.slice().sort((a, b) => score(b) - score(a))[0];
      if (sh && score(sh) > 0) return { say: ms(L) ? `Anda belum ada ${sh.name} — harganya ${sh.price} syiling${sh.locked ? ` dan dibuka pada tahap ${sh.minLevel}` : ''}. Sebut "beli ${sh.name}" untuk membelinya.` : `You don't own the ${sh.name} yet — it costs ${sh.price} coins${sh.locked ? ` and unlocks at level ${sh.minLevel}` : ''}. Say "buy ${sh.name}" to get it.`, lang: L, actions: [{ type: 'open_screen', screen: `shop/${sh.layer}` }], model: 'local' };
    }
    if (hit && score(hit) > 0) {
      const r = buying ? await exec('buy_item', { id: hit.id }) : await exec('equip_item', { id: hit.id, on: !off });
      if (r.error === 'not_enough_coins') return { say: ms(L) ? `Tak cukup syiling untuk ${hit.name} — perlukan ${r.need} lagi. Jawab permintaan untuk dapat syiling!` : `Not enough coins for ${hit.name} — you need ${r.need} more. Answer requests to earn coins!`, lang: L, actions: [{ type: 'open_screen', screen: 'shop' }], model: 'local' };
      if (r.error === 'level_locked') return { say: ms(L) ? `${hit.name} dibuka pada tahap ${r.minLevel}.` : `${hit.name} unlocks at level ${r.minLevel}.`, lang: L, actions: [{ type: 'open_screen', screen: 'shop' }], model: 'local' };
      if (r.error) return { say: tt.busy, lang: L, actions: [{ type: 'open_screen', screen: 'shop' }], model: 'local' };
      return { say: summariseTrace([{ name: buying ? 'buy_item' : 'equip_item', raw: r }], [], L), lang: L, actions: [{ type: 'open_screen', screen: `shop/${hit.layer}` }], model: 'local' };
    }
    if (buying || /\b(hoodie|cap|topi|glasses|cermin|hair|rambut|outfit|baju|pet|kucing|cat|frame|bingkai|background|latar)\b/i.test(wanted)) return { say: ms(L) ? 'Saya tak jumpa item itu. Ini kedai.' : "I couldn't find that item. Here is the shop.", lang: L, actions: [{ type: 'open_screen', screen: 'shop' }], model: 'local' };
  }
  // read-only questions first: profile / points / leaderboard / tasks / nearby reports (so "any obstacles near me" is not a place search)
  if (/\b(points?|mata|level|tahap|streak|rank|kedudukan|badges?|lencana|missions?|misi|notifications?|notifikasi|my profile|profil saya|how am i doing)\b/i.test(x)) {
    const r = await exec('get_profile', {}); if (r.error) return { say: tt.busy, lang: L, actions: [], model: 'local' };
    return { say: summariseTrace([{ name: 'get_profile', raw: r }], [], L), lang: L, actions: [], model: 'local' };
  }
  if (/\b(leaderboard|papan pendahulu|who is (on )?top|siapa (paling )?(atas|teratas|tinggi)|top helper|ranking)\b/i.test(x)) {
    const r = await exec('get_leaderboard', { period: /\b(all|sepanjang|keseluruhan)\b/i.test(x) ? 'all' : 'week', limit: 5 });
    return { say: summariseTrace([{ name: 'get_leaderboard', raw: r }], [], L), lang: L, actions: [{ type: 'open_screen', screen: 'community' }], model: 'local' };
  }
  if (/\b(tasks?|requests?|tugasan|permintaan|jobs?|kerja)\b/i.test(x)) {
    const r = await exec('list_requests', { status: 'open', limit: 5 });
    return { say: summariseTrace([{ name: 'list_requests', raw: r }], [], L), lang: L, actions: role === 'helper' ? [{ type: 'open_screen', screen: 'requests' }] : [], model: 'local' };
  }
  if (/\b(obstacles?|halangan|reports?|laporan)\b/i.test(x)) {
    const r = await exec('list_reports', { radius_m: 1500 });
    return { say: summariseTrace([{ name: 'list_reports', raw: r }], [], L), lang: L, actions: [{ type: 'open_screen', screen: 'map' }], model: 'local' };
  }
  // place search anywhere on the map
  if ((m = /\b(?:find|cari|carikan|search|where is|where's|di mana|dimana|show me|tunjukkan|tunjuk|any|ada|nearest|terdekat)\b\s*(.+)$/i.exec(x)) || (m = /^(.+?)\s+(?:near me|nearby|berdekatan|dekat sini|terdekat|paling dekat)$/i.exec(x))) {
    const q = clean(m[1]);
    const r = await exec('search_places', { query: q, kind: 'any', radius_m: 3000 }).catch(() => ({ places: [] }));
    if (!r.places || !r.places.length) return { say: fmt(tt.none, { q }), lang: L, actions: [], model: 'local' };
    const top = r.places[0];
    const pq = parseQuery(q);
    const toks = pq.rest.filter((w) => w.length > 2 && !/^(mall|shopping|centre|center|pusat|beli|belah)$/.test(w));
    const nq = q.toLowerCase().replace(/\b(nearest|terdekat|nearby|berdekatan|the|a|an)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const named = !pq.pureCategory && ((toks.length && toks.every((w) => top.name.toLowerCase().includes(w))) || (nq.length > 3 && top.name.toLowerCase().includes(nq)));
    const kind = named ? null : pq.pureCategory ? pq.kind : (TYPE_KIND[top.type] && r.places.filter((p) => TYPE_KIND[p.type] === TYPE_KIND[top.type]).length >= Math.min(2, r.places.length) ? TYPE_KIND[top.type] : null);
    if (named || !kind) return { say: (L === 'ms' ? `${top.name} berada kira-kira ${top.distM} meter dari anda. Saya tunjukkan di peta.` : `${top.name} is about ${top.distM} metres from you. Showing it on the map.`), lang: L, actions: [{ type: 'focus_map', lat: top.lat, lng: top.lng, label: top.name, zoom: 17 }], model: 'local' };
    const list = r.places.slice(0, 3).map((p) => `${p.name} (${p.distM} m)`).join(', ');
    return { say: fmt(tt.found, { c: r.count, l: list }), lang: L, actions: [{ type: 'show_places_on_map', kind, query: '' }], model: 'local' };
  }
  // accessibility question about a place → nearby reports around it
  if (/\b(accessible|boleh diakses|mesra|ramp|lift|lif|tandas|toilet|working|berfungsi|rosak|broken)\b/i.test(x)) {
    const r = await exec('list_reports', { radius_m: 1500 });
    return { say: summariseTrace([{ name: 'list_reports', raw: r }], [], L), lang: L, actions: [{ type: 'open_screen', screen: 'map' }], model: 'local' };
  }
  return { say: tt.busy, lang: L, actions: [], model: 'local' };
}

// ---------------------------------------------------------------------------------------
// Agent loop
// ---------------------------------------------------------------------------------------
const MAX_ROUNDS = 6;
/**
 * @param {object} p
 * @param {string} p.text           user utterance
 * @param {'en'|'ms'} p.lang        UI language (hint)
 * @param {object} p.ctx            live client context
 * @param {object} p.user           store user (or null)
 * @param {(name:string,args:object)=>Promise<object>} p.exec  executes a SERVER tool
 * @param {string} p.memoryKey
 */
const BUDGET_MS = Number(process.env.KB_AGENT_BUDGET_MS) || 16000;
const LOOKUPS = new Set(['get_wardrobe', 'get_profile', 'list_requests', 'search_places', 'geocode', 'list_reports', 'get_request', 'get_feed', 'get_stats', 'get_leaderboard']);
/** "take me to DPulze" with an unambiguous named place → start navigation instantly, no LLM round-trip */
async function navFastPath(text, { lang, exec }) {
  const m = /^\s*(?:please\s+|tolong\s+|sila\s+)?(?:take me|bring me|bawa saya|bawa|navigate me|navigate|guide me|pandu saya|go|pergi)\s+(?:to|ke)\s+(.+?)\s*[.!]?\s*$/i.exec(text);
  if (!m) return null;
  const dest = m[1].trim();
  if (dest.length < 3 || /\b(task|request|tugasan|permintaan|first|second|third|pertama|kedua|ketiga|nearest|terdekat|closest|near|dekat|one|it|there|sana|situ|that|this|itu|ini|toilet|tandas|pharmacy|farmasi|hospital|clinic|klinik|station|stesen|mall|bank|surau|masjid|mosque|restaurant|restoran|cafe|parking)\b/i.test(dest)) return null;
  const r = await exec('search_places', { query: dest, kind: 'any', radius_m: 15000 }).catch(() => null);
  const top = r && r.places && r.places[0]; if (!top) return null;
  const toks = dest.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter((w) => w.length > 1 && !/^(the|di|ke|in|at|shopping|mall|centre|center|pusat|beli|belah)$/.test(w));
  const name = top.name.toLowerCase();
  if (!(toks.length && toks.every((w) => name.includes(w)))) return null;
  const L = guessLang(text, lang);
  return { say: fmt(T[L].nav, { n: top.name, d: top.distM }), lang: L, actions: [{ type: 'start_navigation', lat: top.lat, lng: top.lng, label: top.name }], model: 'local', trace: [] };
}
async function run({ text, lang = 'en', ctx = {}, user = null, exec, memoryKey, local = false }) {
  const quick = quickIntent(text, { lang, nav: ctx.navigation, role: user && user.role });
  if (quick) return { ...quick, trace: [] };
  const nav = await navFastPath(text, { lang, exec });
  if (nav) return nav;
  if (local || !KEY()) { // rule-based only (no Gemini): debug flag or no key configured
    const fb = await fallback(text, { lang, exec, nav: ctx.navigation, role: user && user.role }).catch(() => null);
    return fb ? { ...fb, trace: [], degraded: 'local' } : { say: lang === 'ms' ? 'Maaf, saya tak faham. Cuba sebut tempat atau tugasan.' : "Sorry, I didn't get that. Try naming a place or a task.", lang, actions: [], model: 'local', trace: [] };
  }
  try { return await runLLM({ text, lang, ctx, user, exec, memoryKey, deadline: Date.now() + BUDGET_MS }); }
  catch (err) {
    console.warn(`[agent] LLM path failed (${err.status || ''} ${String(err.message).slice(0, 90)}) → ${err.partial ? 'partial' : 'local fallback'}`);
    if (err.partial && !err.partial.onlyLookups) return err.partial;
    // the model only looked things up (or nothing ran) before dying → the rule-based path may still complete the action
    const fb = await fallback(text, { lang, exec, nav: ctx.navigation, role: user && user.role }).catch(() => null);
    if (fb && (fb.actions.length || fb.say !== T[fb.lang].busy)) return { ...fb, trace: [], degraded: err.message };
    if (err.partial) return err.partial;
    if (fb) return { ...fb, trace: [], degraded: err.message };
    throw err;
  }
}
async function runLLM({ text, lang = 'en', ctx = {}, user = null, exec, memoryKey, deadline = Date.now() + BUDGET_MS }) {
  const mem = memory(memoryKey);
  const context = {
    now: new Date().toLocaleString('en-MY', { timeZone: 'Asia/Kuala_Lumpur', hour12: false }),
    ui_language: lang,
    user: user ? { id: user.id, name: user.name, role: user.role, need: user.need, points: user.points, level: user.level } : null,
    location: ctx.location || null,
    current_screen: ctx.route || null,
    navigation: ctx.navigation || null,
    visible_places: Array.isArray(ctx.places) ? ctx.places.slice(0, 8).map((p) => ({ name: p.name, lat: p.lat, lng: p.lng, type: p.type, distM: p.distM })) : undefined,
    map_engine: ctx.mapEngine || undefined,
  };
  const userTurn = { role: 'user', parts: [{ text: `[context ${JSON.stringify(context)}]\n${text}` }] };
  const contents = [...trimTurns(mem.turns), userTurn];
  const tools = [{ functionDeclarations: [...SERVER_TOOLS, ...CLIENT_TOOLS] }];
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents, tools,
    toolConfig: { functionCallingConfig: { mode: 'AUTO' } },
    generationConfig: { temperature: 0.2, thinkingConfig: { thinkingLevel: 'minimal' } },
  };
  const actions = []; const trace = []; let say = ''; let model = null;
  for (let round = 0; round < MAX_ROUNDS; round++) {
    let data, m;
    const left = deadline - Date.now();
    try {
      if (left < 2500) { const e = new Error('agent_budget_exhausted'); e.status = 504; throw e; }
      ({ data, model: m } = await generate(body, { timeoutMs: Math.min(22000, left), hedgeMs: Math.min(6000, Math.max(1500, left / 3)), deadline }));
    }
    catch (err) {
      // the model died mid-conversation: if tools already ran, report what was done instead of failing
      if (round > 0 && (actions.length || trace.length)) {
        const L = guessLang(text, lang);
        // a route answer without the map drawing → add show_route ourselves
        const rb = trace.find((t) => t.name === 'route_between' && t.raw && t.raw.from && t.raw.to);
        if (rb && !actions.some((a) => a.type === 'show_route')) actions.push({ type: 'show_route', from_lat: rb.raw.from.lat, from_lng: rb.raw.from.lng, from_label: rb.raw.from.name, to_lat: rb.raw.to.lat, to_lng: rb.raw.to.lng, to_label: rb.raw.to.name, need: rb.raw.need });
        err.partial = { say: say || summariseTrace(trace, actions, L), lang: L, actions, model: model || 'local', trace, degraded: err.message, onlyLookups: trace.every((t) => LOOKUPS.has(t.name)) && !actions.length };
      }
      throw err;
    }
    model = m;
    const cand = data.candidates && data.candidates[0];
    const parts = (cand && cand.content && cand.content.parts) || [];
    if (!parts.length) break;
    // keep the model's own turn (with thoughtSignature) in the transcript
    body.contents.push({ role: 'model', parts });
    const calls = parts.filter((p) => p.functionCall);
    const texts = parts.filter((p) => p.text).map((p) => p.text).join(' ').trim();
    if (texts) say = texts;
    if (!calls.length) break;
    const responses = [];
    for (const p of calls) {
      const { name, args = {}, id } = p.functionCall;
      let result;
      if (CLIENT_TOOL_NAMES.has(name)) { actions.push({ type: name, ...args }); result = { ok: true, queued: true, note: 'will run in the app after your reply' }; }
      else {
        try { result = await exec(name, args); } catch (err) { result = { error: err.message || String(err) }; }
      }
      trace.push({ name, args, result: summarise(result), raw: result });
      const fr = { name, response: { result } }; if (id) fr.id = id;
      responses.push({ functionResponse: fr });
    }
    body.contents.push({ role: 'user', parts: responses });
    // only client-side actions were requested → usually no need for another (quota-costly) round; template the reply.
    // Exception: the utterance asks for a server-side action too (ask/answer/report/thank/…) — let the model continue.
    const needsMore = /\b(ask|tanya|tanyakan|answer|jawab|report|lapor|laporkan|thank|terima kasih|create|buat|post|hantar|submit|confirm|sahkan|verify|dispute|update|kemas ?kini|rename|tukar nama|reset|advance)\b/i.test(text);
    if (!needsMore && calls.every((p) => CLIENT_TOOL_NAMES.has(p.functionCall.name))) { if (!say) say = summariseTrace(trace, actions, guessLang(text, lang)); break; }
    // last round: force a text answer
    if (round === MAX_ROUNDS - 2) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
  }
  if (!say) say = summariseTrace(trace, actions, guessLang(text, lang));
  say = say.replace(/[*_#`>]/g, '').replace(/\s+/g, ' ').trim().slice(0, 500);
  // persist a valid transcript; make sure the final model turn carries the text we actually said
  const hist = body.contents.slice();
  const last = hist[hist.length - 1];
  if (!(last && last.role === 'model' && isText(last) && !hasCall(last))) hist.push({ role: 'model', parts: [{ text: say }] });
  else if (say && !last.parts.some((p) => p.text === say)) hist[hist.length - 1] = { role: 'model', parts: [...last.parts.filter((p) => !p.text), { text: say }] };
  mem.turns = trimTurns(hist);
  mem.at = Date.now();
  return { say, lang: detectLang(say, lang), actions, model, trace: trace.map(({ raw, ...t }) => t) };
}
function summariseTrace(trace, actions, L) {
  const tt = T[L] || T.en; const out = [];
  for (const a of actions) {
    if (a.type === 'start_navigation') out.push(fmt(tt.nav, { n: a.label || (L === 'ms' ? 'destinasi' : 'the destination') }));
    else if (a.type === 'stop_navigation') out.push(tt.stopped);
    else if (a.type === 'open_camera') out.push(tt.camera);
    else if (a.type === 'open_screen') { const sc = String(a.screen || ''); out.push(fmt(tt.screen, { s: tt.screens[sc] || (sc.startsWith('request:') ? (L === 'ms' ? 'permintaan itu' : 'the request') : sc) })); }
    else if (a.type === 'show_places_on_map') out.push(L === 'ms' ? 'Memaparkan tempat di peta.' : 'Showing the places on the map.');
    else if (a.type === 'show_route') { /* described by route_between */ }
    else if (a.type === 'focus_map') out.push(L === 'ms' ? `Menunjukkan ${a.label || 'lokasi itu'} di peta.` : `Showing ${a.label || 'it'} on the map.`);
    else if (a.type === 'set_language') out.push(a.lang === 'ms' ? T.ms.lang_ms : T.en.lang_en);
    else if (a.type === 'set_setting') { if (a.mute === true) out.push(tt.mute); if (a.mute === false) out.push(tt.unmute); if (a.large_text === true) out.push(tt.big_on); if (a.large_text === false) out.push(tt.big_off); if (a.permissions) out.push(tt.perms); }
    else if (a.type === 'prefill_ask') out.push(L === 'ms' ? 'Borang tanya telah diisi — tekan Hantar.' : 'The ask form is filled in — tap Send.');
    else if (a.type === 'logout') out.push(tt.logout);
    else if (a.type === 'map_zoom') out.push(a.direction === 'out' ? tt.zout : tt.zin);
  }
  const ms = L === 'ms';
  const READ_ONLY = new Set(['list_requests', 'search_places', 'geocode', 'list_reports', 'get_request', 'get_feed', 'get_stats']); // route_between is kept: it IS the answer
  for (const t of trace) {
    if (CLIENT_TOOL_NAMES.has(t.name)) continue;
    if (actions.length && READ_ONLY.has(t.name)) continue; // intermediate lookup before a UI action
    const r = t.raw || {}; if (!r || typeof r !== 'object') continue;
    if (r.error) { out.push(ms ? `Maaf, ${t.name.replace(/_/g, ' ')} gagal (${r.error}).` : `Sorry, ${t.name.replace(/_/g, ' ')} failed (${r.error}).`); continue; }
    switch (t.name) {
      case 'answer_request': out.push(ms ? `Jawapan dihantar. Anda dapat ${r.points || 25} mata.` : `Answer submitted. You earned ${r.points || 25} points.`); break;
      case 'create_request': out.push(ms ? 'Soalan anda telah dihantar kepada komuniti.' : 'Your question has been posted to the community.'); break;
      case 'create_report': out.push(ms ? 'Laporan disimpan. Terima kasih!' : 'Report saved. Thank you!'); break;
      case 'verify_report': out.push(ms ? 'Pengesahan anda direkodkan.' : 'Your confirmation was recorded.'); break;
      case 'thank_answer': out.push(ms ? 'Ucapan terima kasih dihantar.' : 'Thanks sent.'); break;
      case 'update_profile': out.push(ms ? 'Profil dikemas kini.' : 'Profile updated.'); break;
      case 'buy_item': out.push(ms ? `${r.item} dibeli dan dipakai. Baki ${r.coins} syiling.` : `Bought and equipped ${r.item}. ${r.coins} coins left.`); break;
      case 'equip_item': out.push(ms ? 'Karakter dikemas kini.' : 'Your character is updated.'); break;
      case 'get_wardrobe': out.push(ms ? `Anda ada ${r.coins} syiling. Kedai: ${(r.shop || []).slice(0, 3).map((i) => `${i.name} ${i.price}`).join(', ')}.` : `You have ${r.coins} coins. In the shop: ${(r.shop || []).slice(0, 3).map((i) => `${i.name} (${i.price})`).join(', ')}.`); break;
      case 'get_profile': out.push(ms ? `Anda ada ${r.points} mata dan ${r.coins} syiling, tahap ${r.level} ${r.levelTitle || ''}, kedudukan #${r.rank}, streak ${r.streak} hari.` : `You have ${r.points} points and ${r.coins} coins, level ${r.level} ${r.levelTitle || ''}, rank #${r.rank}, ${r.streak}-day streak.`); break;
      case 'get_leaderboard': out.push((ms ? 'Papan pendahulu: ' : 'Leaderboard: ') + (r.rows || []).slice(0, 3).map((x) => `${x.rank}. ${x.name} (${x.points})`).join(', ') + (r.me ? (ms ? `. Anda #${r.me.rank}.` : `. You are #${r.me.rank}.`) : '.')); break;
      case 'list_requests': out.push((r.requests || []).length ? (ms ? `${r.count} permintaan: ` : `${r.count} requests: `) + r.requests.slice(0, 3).map((q) => `${q.place} (${q.distM} m)`).join(', ') : (ms ? 'Tiada permintaan.' : 'No requests.')); break;
      case 'get_request': out.push(`${r.place}: ${r.question} — ${(r.answers || []).length} ${ms ? 'jawapan' : 'answers'}.`); break;
      case 'search_places': case 'geocode': { const list = r.places || r.results || []; out.push(list.length ? (ms ? 'Paling dekat: ' : 'Nearest: ') + list.slice(0, 3).map((p) => `${p.name}${p.distM != null ? ` (${p.distM} m)` : ''}`).join(', ') : (ms ? 'Tiada tempat dijumpai.' : 'Nothing found.')); break; }
      case 'list_reports': out.push((r.reports || []).length ? (ms ? `${r.count} laporan berdekatan: ` : `${r.count} reports nearby: `) + r.reports.slice(0, 3).map((x) => `${x.label} — ${x.place || ''} (${x.trust}%)`).join('; ') : (ms ? 'Tiada laporan berdekatan.' : 'No reports nearby.')); break;
      case 'route_between': {
        const rs = r.routes || []; const best = rs[0]; if (!best) { out.push(ms ? 'Tiada laluan dijumpai.' : 'No route found.'); break; }
        const alt = rs.find((x) => x !== best && x.distanceM < best.distanceM);
        const obs = (best.obstacles || []).length ? (ms ? ` Halangan: ${best.obstacles.join(', ')}.` : ` Obstacles: ${best.obstacles.join(', ')}.`) : (ms ? ' Tiada halangan dilaporkan.' : ' No obstacles reported.');
        out.push(ms ? `Dari ${r.from.name} ke ${r.to.name}: laluan disyorkan ${best.distanceM} meter, kira-kira ${best.durationMin} minit, skor ${best.score}.${obs}` : `From ${r.from.name} to ${r.to.name}: recommended route ${best.distanceM} metres, about ${best.durationMin} minutes, score ${best.score}.${obs}`);
        if (alt) out.push(ms ? `Laluan terpendek ${alt.distanceM} meter tetapi ${alt.obstacles && alt.obstacles.length ? `melalui ${alt.obstacles.join(', ')}` : `skor ${alt.score}`}.` : `The shortest is ${alt.distanceM} metres but ${alt.obstacles && alt.obstacles.length ? `passes ${alt.obstacles.join(', ')}` : `scores ${alt.score}`}.`);
        break;
      }
      case 'plan_route': { const best = (r.routes || [])[0]; if (best) out.push(ms ? `Laluan disyorkan ${best.distanceM} m, ${best.durationMin} minit, skor ${best.score}.` : `Recommended route ${best.distanceM} m, ${best.durationMin} min, score ${best.score}.`); break; }
      case 'get_stats': out.push(ms ? `${r.activeReports || r.reports || 0} laporan aktif, ${r.openRequests || 0} permintaan terbuka.` : `${r.activeReports || r.reports || 0} active reports, ${r.openRequests || 0} open requests.`); break;
      case 'get_feed': out.push((r.items || []).slice(0, 2).map((i) => i.text).join(' ')); break;
      case 'demo_control': out.push(r.reset ? (ms ? 'Data demo ditetapkan semula.' : 'Demo data reset.') : (ms ? `Jam demo dimajukan ${r.advancedHours} jam.` : `Demo clock advanced ${r.advancedHours} hours.`)); break;
      default: if (r.ok) out.push(ms ? 'Selesai.' : 'Done.');
    }
  }
  return out.length ? out.filter((v, i, a) => v && a.indexOf(v) === i).join(' ') : (ms ? 'Selesai.' : 'Done.');
}
function summarise(r) { try { const s = JSON.stringify(r); return s.length > 300 ? s.slice(0, 300) + '…' : s; } catch { return String(r); } }
function detectLang(say, fallback) {
  const ms = /\b(saya|anda|ke|dan|yang|tidak|boleh|sedang|akan|ada|di|untuk|jalan|meter|minit|dengan|selesai|baik|maaf)\b/gi;
  const hits = (say.match(ms) || []).length;
  return hits >= 2 ? 'ms' : hits === 0 && /\b(the|you|to|is|and|are|near|about|metres|minutes)\b/i.test(say) ? 'en' : fallback;
}

module.exports = { run, enabled, clearMemory, quickIntent, fallback, guessLang, SERVER_TOOLS, CLIENT_TOOLS, FALLBACKS };
void NEEDS;
