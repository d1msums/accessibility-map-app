'use strict';
/**
 * "What is around me?" — places near a point with whatever accessibility facts
 * exist about them.
 *
 *   1. Google Places API (New) when the key has it enabled → wheelchair entrance /
 *      parking / restroom / seating flags, open-now, rating.
 *   2. OpenStreetMap Overpass fallback → wheelchair=* / toilets:wheelchair=* tags.
 *
 * Both are normalised to the same shape and cached for 10 minutes per cell.
 */
const google = require('./google');
const fs = require('fs');
const path = require('path');

const CACHE = new Map();
const TTL = 10 * 60e3;
// Disk snapshot of successful lookups: Overpass is free but spiky (5–15 s or timeouts),
// so pilot-area cells always answer instantly — even offline — from the last good result.
const SNAP = process.env.KB_PLACES_CACHE || path.join(__dirname, '..', 'data', 'places_cache.json');
try { for (const [k, v] of Object.entries(JSON.parse(fs.readFileSync(SNAP, 'utf8')))) CACHE.set(k, { at: 0, value: v }); } catch { /* no snapshot yet */ }
let saveTimer = null;
function persist() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const out = {}; for (const [k, v] of CACHE) if (v.value && v.value.places && v.value.places.length) out[k] = v.value;
    fs.writeFile(SNAP, JSON.stringify(out), () => {});
  }, 500);
}

const KINDS = {
  any:        { g: null, osm: '["amenity"~"^(hospital|clinic|pharmacy|bank|place_of_worship|toilets|bus_station|library|townhall|community_centre|university|college)$"],["shop"~"^(mall|supermarket|department_store)$"],["railway"="station"],["tourism"~"^(attraction|hotel|museum)$"]' },
  mall:       { g: ['shopping_mall', 'supermarket', 'department_store'], osm: '["shop"~"^(mall|supermarket|department_store)$"]' },
  transit:    { g: ['transit_station', 'bus_station', 'train_station', 'subway_station', 'light_rail_station'], osm: '["railway"="station"],["public_transport"="station"],["amenity"="bus_station"],["highway"="bus_stop"]' },
  hospital:   { g: ['hospital', 'doctor', 'medical_lab'], osm: '["amenity"~"^(hospital|clinic|doctors)$"]' },
  toilet:     { g: ['public_bathroom'], osm: '["amenity"="toilets"]' },
  parking:    { g: ['parking'], osm: '["amenity"="parking"]' },
  restaurant: { g: ['restaurant', 'cafe', 'food_court'], osm: '["amenity"~"^(restaurant|cafe|food_court|fast_food)$"]' },
  pharmacy:   { g: ['pharmacy', 'drugstore'], osm: '["amenity"="pharmacy"]' },
  mosque:     { g: ['mosque', 'place_of_worship'], osm: '["amenity"="place_of_worship"]' },
  bank:       { g: ['bank', 'atm'], osm: '["amenity"~"^(bank|atm)$"]' },
};

function key(o) { return JSON.stringify(o); }

// ---------- offline POI snapshot (scripts/build-pois.js) — instant answers inside the pilot areas ----------
let POIS = null; // { areas, pois }
try { POIS = JSON.parse(fs.readFileSync(process.env.KB_POIS || path.join(__dirname, '..', 'data', 'pois.json'), 'utf8')); } catch { POIS = null; }
const KIND_MATCH = {
  any: () => true,
  mall: (t) => /^(shopping_mall|supermarket|department_store|marketplace)$/.test(t),
  transit: (t) => /^(transit_station|bus_station|bus_stop|station)$/.test(t),
  hospital: (t) => /^(hospital|clinic|doctors|dentist)$/.test(t),
  toilet: (t) => t === 'toilets',
  parking: (t) => t === 'parking',
  restaurant: (t) => /^(restaurant|cafe|fast_food|food_court)$/.test(t),
  pharmacy: (t) => t === 'pharmacy',
  mosque: (t) => /^(mosque|church|hindu_temple|buddhist_temple|place_of_worship)$/.test(t),
  bank: (t) => /^(bank|atm)$/.test(t),
};
// 'any' should feel like a city map, not a bus-stop list: rank by usefulness for OKU users, then distance
const ANY_WEIGHT = { shopping_mall: 0, hospital: 0, transit_station: 0, bus_station: 0, supermarket: 1, clinic: 1, university: 1, college: 1, mosque: 1, hotel: 1, library: 1, townhall: 1, community_centre: 1, cinema: 1, pharmacy: 2, bank: 2, park: 2, police: 2, post_office: 2, restaurant: 3, cafe: 3, fast_food: 3, food_court: 3, bus_stop: 3, parking: 4, atm: 4, toilets: 4, convenience: 4, school: 4, office: 5 };
const STOP = new Set(['the', 'di', 'ke', 'in', 'at', 'near', 'nearest', 'dekat', 'terdekat', 'cyberjaya', 'kl', 'kuala', 'lumpur', 'mall', 'shopping', 'centre', 'center', 'pusat', 'beli', 'belah']);
const distM = (a, b) => Math.hypot((a.lat - b.lat) * 111320, (a.lng - b.lng) * 111320 * Math.cos(a.lat * Math.PI / 180));
function inSnapshotArea(lat, lng) { return !!(POIS && POIS.areas.some((a) => lat >= a.bbox[0] && lat <= a.bbox[2] && lng >= a.bbox[1] && lng <= a.bbox[3])); }
// free-text → category (EN / BM / colloquial), so "farmasi terdekat" also lists pharmacies without a name match
const KIND_WORDS = { pharmacy: /\b(pharmac\w*|farmasi|drug ?stores?)/i, hospital: /\b(hospitals?|klinik|clinics?|doctors?|doktor|dentists?|gigi|medical|poliklinik)\b/i, toilet: /\b(toilets?|tandas|restrooms?|washrooms?|bathrooms?|wc)\b/i, mosque: /\b(mosques?|masjid|surau|churche?s?|gereja|temples?|kuil|tokong)\b/i, bank: /\b(banks?|atm)\b/i, transit: /\b(lrt|mrt|ktm|monorail|stesen|stations?|bus(es)?|bas|terminals?|trains?|tren|erl)\b/i, mall: /\b(malls?|shopping|pusat beli|supermarkets?|pasar ?raya|grocer\w*|marts?)\b/i, restaurant: /\b(restaurants?|restoran|kedai makan|makan|food|cafes?|kafe|kopitiam|mamak|warung|gerai|coffee|kopi)\b/i, parking: /\b(parking|parkir|tempat letak|car ?parks?)\b/i };
function kindFromText(q) { for (const [k, re] of Object.entries(KIND_WORDS)) if (re.test(q)) return k; return null; }
const norm = (x) => String(x || '').toLowerCase().replace(/[^a-z0-9\u00C0-\u024F ]+/g, ' ').replace(/\s+/g, ' ').trim();
const QUALIFIERS = new Set(['oku', 'awam', 'public', 'accessible', 'wheelchair', 'kerusi', 'roda', 'disabled', 'friendly', 'mesra', 'nearest', 'terdekat', 'nearby', 'berdekatan', 'any', 'some', 'good', 'best', 'the', 'a', 'an', 'di', 'ke', 'in', 'at', 'near', 'dekat', 'paling', 'closest', 'yang', 'untuk', 'for']);
/** "farmasi terdekat" → { kind:'pharmacy', rest:[] } (pure category); "Guardian pharmacy" → { kind:'pharmacy', rest:['guardian'] }; "Hospital Cyberjaya" → { kind:'hospital', rest:['cyberjaya'] } */
function parseQuery(q) {
  const k = kindFromText(q || '');
  const rest = norm(q).replace(k ? new RegExp(KIND_WORDS[k].source, 'gi') : /$^/, ' ').split(' ').filter((w) => w.length > 1 && !QUALIFIERS.has(w));
  return { kind: k, rest, pureCategory: !!k && rest.length === 0 };
}
function snapshotAround({ lat, lng, radius, kind, lang, q, _noKindGuess = false }) {
  if (!POIS) return null;
  if (q && (!kind || kind === 'any') && !_noKindGuess) {
    const pq = parseQuery(q);
    // pure category words ("nearest pharmacy", "tandas OKU", "surau terdekat") → that category, nearest first
    if (pq.pureCategory) return snapshotAround({ lat, lng, radius: Math.max(radius, 3000), kind: pq.kind, lang, q: '' });
    // category + name ("Guardian pharmacy", "Hospital Cyberjaya", "Gem In Mall") → that name within the category
    if (pq.kind) { const inKind = snapshotAround({ lat, lng, radius: Math.max(radius, 15000), kind: pq.kind, lang, q: pq.rest.join(' '), _noKindGuess: true }) || []; if (inKind.length) return inKind; }
    // plain name search across everything; when a category was also named, append it after the name matches
    const byName = snapshotAround({ lat, lng, radius: Math.max(radius, 15000), kind: 'any', lang, q, _noKindGuess: true }) || [];
    const k = pq.kind;
    if (!k) return byName;
    const cat = snapshotAround({ lat, lng, radius: Math.max(radius, 3000), kind: k, lang, q: '' }) || [];
    const ids = new Set(byName.map((p) => p.id));
    return [...byName, ...cat.filter((p) => !ids.has(p.id))].slice(0, 40);
  }
  const match = KIND_MATCH[kind] || KIND_MATCH.any;
  const qq = norm(q);
  let toks = qq ? qq.split(' ').filter((w) => w.length > 1 && !STOP.has(w)) : [];
  if (qq && !toks.length) toks = qq.split(' ').filter((w) => w.length > 1); // "Hospital Cyberjaya" → 'cyberjaya' is a stop word but the only clue
  const seen = new Set(); const out = [];
  for (const p of POIS.pois) {
    if (!match(p.type)) continue;
    const d = distM({ lat, lng }, p); if (d > radius) continue;
    let q_score = 0;
    if (toks.length) {
      const n = norm(p.name); const nw = n.split(' ');
      if (n === qq) q_score = 3; else if (n.includes(qq)) q_score = 2; else if (toks.every((w) => nw.some((x) => x.startsWith(w)))) q_score = 1; else continue;
    }
    const name = (lang === 'ms' && p.tags['name:ms']) || p.name;
    const t = p.tags;
    out.push({ _dk: `${name}|${p.type}`,
      id: p.id, name, address: [t['addr:street'], t['addr:city']].filter(Boolean).join(', '), lat: p.lat, lng: p.lng,
      type: p.type, typeLabel: '', rating: null, ratings: 0, openNow: null,
      accessibility: { entrance: yes(t.wheelchair), parking: null, restroom: yes(t['toilets:wheelchair']), seating: null, known: t.wheelchair != null || t['toilets:wheelchair'] != null, description: t['wheelchair:description'] || null },
      source: 'osm', _d: d, _w: ANY_WEIGHT[p.type] ?? 5, _q: q_score,
    });
  }
  // text search: best name match first (then importance, then distance); browse: importance, then distance
  // specific category → nearest first; 'any' browse → importance then distance
  out.sort((a, b) => (b._q - a._q) || (kind !== 'any' ? 0 : (a._w - b._w)) || (a._d - b._d));
  // dedupe same name+type AFTER sorting so the nearest branch survives (e.g. several "CIMB Bank")
  const uniq = out.filter((p) => { if (seen.has(p._dk)) return false; seen.add(p._dk); return true; });
  return uniq.slice(0, 40).map(({ _d, _w, _q, _dk, ...p }) => p);
}

function osmKindOf(t) {
  if (t.shop === 'mall' || t.shop === 'department_store') return 'shopping_mall';
  if (t.shop) return t.shop;
  if (t.railway === 'station' || t.public_transport) return 'transit_station';
  if (t.highway === 'bus_stop') return 'bus_stop';
  if (t.amenity) return t.amenity;
  if (t.tourism) return t.tourism;
  return 'place';
}
const yes = (v) => (v === 'yes' ? true : v === 'no' ? false : v === 'limited' ? 'limited' : null);

async function osmAround({ lat, lng, radius, kind, lang }) {
  const sel = (KINDS[kind] || KINDS.any).osm;
  // sel is a comma-separated list of tag filters; one nwr(around) clause each, unioned
  const clauses = sel.match(/\[[^\]]+\]/g) || [];
  const body = `[out:json][timeout:15];(${clauses.map((c) => `nwr${c}(around:${radius},${lat},${lng});`).join('')});out center tags 60;`;
  const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  let data = null, lastErr = null;
  for (const url of MIRRORS) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 14000);
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(body), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'KitaBantu-hackathon-demo/1.0' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`overpass ${res.status}`);
      data = await res.json(); break;
    } catch (err) { lastErr = err; } finally { clearTimeout(t); }
  }
  if (!data) throw lastErr || new Error('overpass_unavailable');
  {
    const seen = new Set();
    const out = [];
    for (const e of data.elements || []) {
      const tags = e.tags || {};
      const name = tags.name || tags['name:en'] || tags['name:ms'];
      if (!name || seen.has(name)) continue;
      seen.add(name);
      const la = e.lat ?? e.center?.lat, ln = e.lon ?? e.center?.lon;
      if (la == null) continue;
      out.push({
        id: `osm_${e.type}_${e.id}`, name, address: [tags['addr:street'], tags['addr:city']].filter(Boolean).join(', '), lat: la, lng: ln,
        type: osmKindOf(tags), typeLabel: '', rating: null, ratings: 0, openNow: null,
        accessibility: { entrance: yes(tags.wheelchair), parking: null, restroom: yes(tags['toilets:wheelchair']), seating: null, known: tags.wheelchair != null || tags['toilets:wheelchair'] != null, description: tags['wheelchair:description'] || null },
        source: 'osm',
      });
    }
    return out;
  }
}

const PENDING = new Map(); // de-duplicate concurrent identical lookups
async function around(params) {
  const { lat, lng, radius = 1200, kind = 'any', q = '' } = params;
  const ck = key({ lat: lat.toFixed(3), lng: lng.toFixed(3), radius, kind, q, lang: params.lang || 'en' });
  const hit = CACHE.get(ck);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.value, cached: true };
  if (PENDING.has(ck)) return PENDING.get(ck);
  const job = fetchAround({ ...params, radius, kind, q }, ck).finally(() => PENDING.delete(ck));
  PENDING.set(ck, job);
  return job;
}
async function fetchAround({ lat, lng, radius, kind, lang = 'en', q }, ck) {
  let value = null;
  if (inSnapshotArea(lat, lng)) {
    // the snapshot covers every kind we query live, so inside a pilot area it is authoritative for browsing
    // (instant, works offline); for text search it is tried first with a wide radius, then Google / Nominatim.
    const places = snapshotAround({ lat, lng, radius: q ? Math.max(radius, 15000) : radius, kind, lang, q }) || [];
    value = { source: 'osm', offline: true, places }; CACHE.set(ck, { at: Date.now(), value }); return value;
  }
  if (google.enabled()) {
    const g = q ? await google.textSearch({ q, lat, lng, radius, max: 20, lang }) : await google.nearby({ lat, lng, radius, types: (KINDS[kind] || KINDS.any).g, max: 20, lang });
    if (g.ok) value = { source: 'google', places: g.places };
    else value = { googleError: g.reason };
  }
  if (!value || !value.places) {
    try { value = { ...(value || {}), source: 'osm', places: await osmAround({ lat, lng, radius, kind, lang }) }; }
    catch (err) {
      // never cache a failure; serve the last good result for this cell if we have one (even if stale)
      const stale = CACHE.get(ck);
      if (stale) return { ...stale.value, cached: true, stale: true };
      return { ...(value || {}), source: 'none', places: [], error: err.message };
    }
  }
  CACHE.set(ck, { at: Date.now(), value });
  if (value.places && value.places.length) persist();
  return value;
}

module.exports = { around, KINDS, inSnapshotArea, parseQuery, kindFromText };
