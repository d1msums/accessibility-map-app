'use strict';
/**
 * Turn-by-turn instructions from a polyline + optional street names.
 * Used when Google Routes is unavailable (local A* router / OSRM / straight line),
 * so the voice guide always has something to say.
 *
 * steps = buildSteps(coords, { streets, lang })
 *   -> [{ text, distanceM, durationS, maneuver, lat, lng }]
 */
const geo = require('./geo');

const WALK_MPS = 1.2;

const T = {
  en: {
    start: (s) => (s ? `Head out along ${s}` : 'Head out'),
    straight: (s) => (s ? `Continue straight along ${s}` : 'Continue straight'),
    slight_left: (s) => (s ? `Bear slightly left onto ${s}` : 'Bear slightly left'),
    slight_right: (s) => (s ? `Bear slightly right onto ${s}` : 'Bear slightly right'),
    left: (s) => (s ? `Turn left onto ${s}` : 'Turn left'),
    right: (s) => (s ? `Turn right onto ${s}` : 'Turn right'),
    sharp_left: (s) => (s ? `Turn sharply left onto ${s}` : 'Turn sharply left'),
    sharp_right: (s) => (s ? `Turn sharply right onto ${s}` : 'Turn sharply right'),
    uturn: () => 'Make a U-turn',
    arrive: () => 'You have arrived at your destination',
    for: (m) => ` and continue for ${fmtDist('en', m)}`,
  },
  ms: {
    start: (s) => (s ? `Mula berjalan di sepanjang ${s}` : 'Mula berjalan'),
    straight: (s) => (s ? `Terus lurus di sepanjang ${s}` : 'Terus lurus'),
    slight_left: (s) => (s ? `Condong sedikit ke kiri ke ${s}` : 'Condong sedikit ke kiri'),
    slight_right: (s) => (s ? `Condong sedikit ke kanan ke ${s}` : 'Condong sedikit ke kanan'),
    left: (s) => (s ? `Belok kiri ke ${s}` : 'Belok kiri'),
    right: (s) => (s ? `Belok kanan ke ${s}` : 'Belok kanan'),
    sharp_left: (s) => (s ? `Belok tajam ke kiri ke ${s}` : 'Belok tajam ke kiri'),
    sharp_right: (s) => (s ? `Belok tajam ke kanan ke ${s}` : 'Belok tajam ke kanan'),
    uturn: () => 'Buat pusingan U',
    arrive: () => 'Anda telah tiba di destinasi',
    for: (m) => ` dan teruskan sejauh ${fmtDist('ms', m)}`,
  },
};

function fmtDist(lang, m) {
  if (m >= 950) return `${(m / 1000).toFixed(1)} km`;
  const r = m >= 100 ? Math.round(m / 10) * 10 : Math.max(5, Math.round(m / 5) * 5);
  return lang === 'ms' ? `${r} meter` : `${r} metres`;
}

function turnKind(delta) {
  const d = ((delta + 540) % 360) - 180; // -180..180, positive = right
  const a = Math.abs(d);
  if (a < 20) return 'straight';
  if (a < 50) return d > 0 ? 'slight_right' : 'slight_left';
  if (a < 130) return d > 0 ? 'right' : 'left';
  if (a < 165) return d > 0 ? 'sharp_right' : 'sharp_left';
  return 'uturn';
}

/**
 * Simplify: drop points that are almost collinear so tiny jitters don't
 * become "turns". Keeps the first/last points.
 */
function simplify(coords, minSegM = 8) {
  const idx = [0];
  for (let i = 1; i < coords.length - 1; i++) {
    if (geo.haversine(coords[idx[idx.length - 1]], coords[i]) >= minSegM) idx.push(i);
  }
  idx.push(coords.length - 1);
  return idx;
}

/**
 * @param coords   [{lat,lng}] route geometry (start .. end)
 * @param opts.streets  optional ordered street names (from the local router) — used as hints only
 * @param opts.names    optional per-coordinate street names (same length as coords) for precise naming
 * @param opts.lang     'en' | 'ms'
 */
function buildSteps(coords, { streets = [], names = null, lang = 'en' } = {}) {
  const L = T[lang] || T.en;
  if (!coords || coords.length < 2) return [];
  const keep = simplify(coords);
  const pts = keep.map((i) => coords[i]);
  if (pts.length < 2) return [];
  const steps = [];
  let legDist = 0;
  let prevBearing = geo.bearing(pts[0], pts[1]);
  // street name of the segment leaving simplified point k (nearest original index with a name)
  const nameAt = (k) => { if (!names) return null; for (let i = keep[k]; i < (keep[k + 1] ?? coords.length); i++) if (names[i]) return names[i]; return null; };
  let streetIdx = 0;
  const nextStreet = () => (!names && streets[streetIdx] ? streets[streetIdx++] : null);
  let curName = nameAt(0) || nextStreet();

  steps.push({ maneuver: 'start', text: L.start(curName), lat: pts[0].lat, lng: pts[0].lng, distanceM: 0 });

  for (let i = 1; i < pts.length - 1; i++) {
    legDist += geo.haversine(pts[i - 1], pts[i]);
    const b = geo.bearing(pts[i], pts[i + 1]);
    const kind = turnKind(b - prevBearing);
    prevBearing = b;
    const nm = nameAt(i);
    const nameChanged = nm && nm !== curName;
    if (kind === 'straight' && !nameChanged) continue;
    if (kind === 'straight' && nameChanged && legDist < 40) { curName = nm; continue; } // road renamed mid-block: not worth an instruction
    // close the previous leg
    const prevStep = steps[steps.length - 1];
    prevStep.distanceM = Math.round(legDist);
    prevStep.text += L.for(legDist);
    const street = kind === 'uturn' ? null : (nm && nm !== curName ? nm : (names ? null : nextStreet()));
    steps.push({ maneuver: kind, text: L[kind](street), lat: pts[i].lat, lng: pts[i].lng, distanceM: 0 });
    if (nm) curName = nm;
    legDist = 0;
  }
  legDist += geo.haversine(pts[pts.length - 2], pts[pts.length - 1]);
  const last = steps[steps.length - 1];
  last.distanceM = Math.round(legDist);
  last.text += L.for(legDist);
  steps.push({ maneuver: 'arrive', text: L.arrive(), lat: pts[pts.length - 1].lat, lng: pts[pts.length - 1].lng, distanceM: 0 });

  // merge very short legs (< 12 m) into the previous instruction to avoid chatter
  const merged = [];
  for (const s of steps) {
    const prev = merged[merged.length - 1];
    if (prev && s.maneuver !== 'arrive' && prev.maneuver !== 'start' && prev.distanceM < 12) { prev.distanceM += s.distanceM; prev.text = s.text; prev.maneuver = s.maneuver; continue; }
    merged.push(s);
  }
  for (const s of merged) s.durationS = Math.round(s.distanceM / WALK_MPS);
  return merged;
}

module.exports = { buildSteps, turnKind, fmtDist, simplify };
