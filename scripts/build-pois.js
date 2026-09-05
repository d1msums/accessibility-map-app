#!/usr/bin/env node
'use strict';
/**
 * Build an offline POI snapshot for the pilot areas from OpenStreetMap (Overpass).
 * One bulk query per bbox, retried across mirrors; output data/pois.json:
 *   { builtAt, areas: [{ id, bbox }], pois: [{ id, name, lat, lng, type, tags: {wheelchair, toilets:wheelchair, wheelchair:description, addr} }] }
 * Usage: node scripts/build-pois.js  (≈ 1 request per area, a few seconds each)
 * Data © OpenStreetMap contributors (ODbL).
 */
const fs = require('fs');
const path = require('path');

const AREAS = [
  { id: 'cyberjaya', bbox: [2.885, 101.605, 2.96, 101.72] },
  { id: 'kl', bbox: [3.108, 101.66, 3.162, 101.722] },
];
const MIRRORS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];
const SEL = [
  '["amenity"~"^(hospital|clinic|doctors|dentist|pharmacy|bank|atm|place_of_worship|toilets|bus_station|library|townhall|community_centre|university|college|school|police|post_office|restaurant|cafe|fast_food|food_court|parking|marketplace|cinema|theatre|fuel)$"]',
  '["shop"~"^(mall|supermarket|department_store|convenience)$"]',
  '["railway"="station"]', '["public_transport"~"^(station|platform|stop_position)$"]', '["highway"="bus_stop"]',
  '["tourism"~"^(hotel|hostel|guest_house|attraction|museum)$"]', '["leisure"~"^(park|sports_centre|stadium|fitness_centre)$"]',
  '["office"~"^(government|company)$"]', '["healthcare"]',
];

async function fetchArea(a) {
  const [s, w, n, e] = a.bbox;
  const q = `[out:json][timeout:60][bbox:${s},${w},${n},${e}];(${SEL.map((c) => `nwr${c};`).join('')});out center tags 4000;`;
  let lastErr = null;
  for (let attempt = 0; attempt < 6; attempt++) {
    const url = MIRRORS[attempt % MIRRORS.length];
    const ctrl = new AbortController(); const t = setTimeout(() => ctrl.abort(), 70000);
    try {
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'KitaBantu-hackathon-demo/1.0' }, signal: ctrl.signal });
      if (!res.ok) throw new Error(`overpass ${res.status} @ ${url}`);
      const data = await res.json();
      console.log(`${a.id}: ${data.elements.length} elements from ${url}`);
      return data.elements;
    } catch (err) { lastErr = err; console.warn(`${a.id}: attempt ${attempt + 1} failed (${err.message}); retrying…`); await new Promise((r) => setTimeout(r, 3000)); }
    finally { clearTimeout(t); }
  }
  throw lastErr;
}

function typeOf(t) {
  if (t.shop === 'mall' || t.shop === 'department_store') return 'shopping_mall';
  if (t.shop === 'supermarket' || t.shop === 'convenience') return 'supermarket';
  if (t.railway === 'station' || t.public_transport === 'station') return 'transit_station';
  if (t.highway === 'bus_stop' || t.public_transport === 'platform' || t.public_transport === 'stop_position') return 'bus_stop';
  if (t.amenity === 'bus_station') return 'bus_station';
  if (t.amenity === 'place_of_worship') return t.religion === 'muslim' ? 'mosque' : t.religion === 'christian' ? 'church' : t.religion === 'hindu' ? 'hindu_temple' : t.religion === 'buddhist' ? 'buddhist_temple' : 'place_of_worship';
  if (t.tourism) return t.tourism === 'hotel' || t.tourism === 'hostel' || t.tourism === 'guest_house' ? 'hotel' : t.tourism;
  if (t.leisure) return t.leisure;
  if (t.healthcare && !t.amenity) return t.healthcare === 'hospital' ? 'hospital' : 'clinic';
  if (t.office) return 'office';
  return t.amenity || 'point_of_interest';
}

(async () => {
  const pois = []; const seen = new Set();
  for (const a of AREAS) {
    const els = await fetchArea(a);
    for (const e of els) {
      const t = e.tags || {}; const name = t.name || t['name:en'] || t['name:ms'] || t.brand || t.operator;
      const lat = e.lat ?? e.center?.lat, lng = e.lon ?? e.center?.lon;
      if (!name || lat == null) continue;
      const type = typeOf(t);
      const dk = `${name.toLowerCase()}|${type}|${lat.toFixed(3)}|${lng.toFixed(3)}`; if (seen.has(dk)) continue; seen.add(dk);
      const tags = {};
      for (const k of ['wheelchair', 'toilets:wheelchair', 'wheelchair:description', 'opening_hours', 'addr:street', 'addr:city', 'level', 'elevator', 'tactile_paving', 'name:ms', 'name:en']) if (t[k]) tags[k] = t[k];
      pois.push({ id: `osm_${e.type}_${e.id}`, area: a.id, name, lat, lng, type, tags });
    }
  }
  const out = { builtAt: new Date().toISOString(), attribution: '© OpenStreetMap contributors (ODbL)', areas: AREAS, pois };
  const file = path.join(__dirname, '..', 'data', 'pois.json');
  fs.writeFileSync(file, JSON.stringify(out));
  const by = {}; for (const p of pois) by[p.area] = (by[p.area] || 0) + 1;
  console.log(`wrote ${file}: ${pois.length} POIs`, by);
})().catch((e) => { console.error(e); process.exit(1); });
