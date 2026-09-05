'use strict';
/**
 * Obstacle-aware route planning.
 *
 * Inside the pilot area (central KL) we run our own router (lib/localrouter.js):
 * A* over OpenStreetMap footways where stairs are impassable for wheelchairs
 * unless a trusted "lift working" report unlocks them, roads without sidewalks
 * are penalised, and active KitaBantu obstacle reports add cost to nearby edges
 * BEFORE the search — so detours emerge from the search itself.
 *
 * Outside the pilot area we fall back to OSRM's generic foot profile (public
 * server) and say so; if that is unreachable, a straight-line estimate.
 *
 * Every candidate route is then scored the same way:
 *   score    = 100 − Σ severity × trust of obstacles on the path (blended with the worst hit)
 *   coverage = share of the path that has *any* recent report nearby
 *              (no reports ≠ accessible; it means *unknown*, and the UI says so)
 * and split into coloured segments the UI can draw directly.
 */

const geo = require('./geo');
const { typeInfo } = require('./catalogue');
const local = require('./localrouter');

// Primary: OSRM foot profile (FOSSGIS). Secondary: the project demo server (car profile,
// but still a real street network) — only used if the primary fails, and flagged in the response.
const OSRM_BASES = (process.env.OSRM_BASE ? [process.env.OSRM_BASE] : ['https://routing.openstreetmap.de/routed-foot', 'https://router.project-osrm.org']);
const UA = 'KitaBantu-hackathon-demo/1.0 (+https://github.com/kitabantu)';

const RADIUS = { lift_broken: 30, kerb_blocked: 20, construction: 35, pavement: 15, steps_only: 12, parking_blocked: 10, tactile_blocked: 20, other_obstacle: 20 };
const radiusFor = (t) => RADIUS[t] || 20;
const FEATURE_RADIUS = 40;
const COVERAGE_RADIUS = 60;

const CACHE_TTL = 60 * 60 * 1000;
const cache = new Map(); // key -> { at, routes }

async function osrmRoute(points, { alternatives = true, signal } = {}) {
  const coords = points.map((p) => `${p.lng.toFixed(5)},${p.lat.toFixed(5)}`).join(';');
  const key = `${coords}|${alternatives ? 'alt' : 'one'}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL) return hit.routes.map((r) => ({ ...r, coords: r.coords.slice() }));
  let lastErr = null;
  for (const base of OSRM_BASES) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const url = `${base}/route/v1/foot/${coords}?overview=full&geometries=geojson&steps=false&alternatives=${alternatives ? 3 : 'false'}`;
        const res = await fetch(url, { headers: { 'User-Agent': UA }, signal });
        if (!res.ok) throw new Error(`OSRM ${res.status}`);
        const data = await res.json();
        if (data.code !== 'Ok') throw new Error(`OSRM ${data.code}`);
        const routes = data.routes.map((r) => ({
          coords: r.geometry.coordinates.map(([lng, lat]) => ({ lat, lng })),
          distanceM: r.distance,
          durationS: r.duration,
          engine: base.includes('project-osrm') ? 'osrm-demo' : 'osrm-foot',
        }));
        cache.set(key, { at: Date.now(), routes });
        return routes.map((r) => ({ ...r, coords: r.coords.slice() }));
      } catch (err) {
        lastErr = err;
        if (signal?.aborted) throw err;
      }
    }
  }
  throw lastErr || new Error('OSRM unavailable');
}

/** Straight-line fallback so the demo never hard-fails if the router is down. */
function straightLine(a, b) {
  const n = 12;
  const coords = [];
  for (let i = 0; i <= n; i++) coords.push({ lat: a.lat + ((b.lat - a.lat) * i) / n, lng: a.lng + ((b.lng - a.lng) * i) / n });
  const d = geo.haversine(a, b);
  return { coords, distanceM: d, durationS: d / 1.2, fallback: true };
}

/** Which scored reports touch this route? */
function hitsForRoute(route, reports, need) {
  const hits = [];
  const features = [];
  for (const r of reports) {
    if (r.status !== 'active' || r.trust <= 0) continue;
    const info = typeInfo(r.type);
    if (need && !info.affects.includes(need)) continue;
    const near = geo.distToPolyline({ lat: r.lat, lng: r.lng }, route.coords);
    if (info.kind === 'obstacle') {
      const radius = RADIUS[r.type] || 20;
      if (near.d <= radius) hits.push({ report: r, distM: near.d, alongM: near.alongM, index: near.index, penalty: (info.severity * r.trust) / 100 });
    } else if (near.d <= FEATURE_RADIUS) {
      features.push({ report: r, distM: near.d, alongM: near.alongM });
    }
  }
  hits.sort((a, b) => a.alongM - b.alongM);
  features.sort((a, b) => a.alongM - b.alongM);
  return { hits, features };
}

/** Fraction of path (sampled every 25 m) within COVERAGE_RADIUS of any active report. */
function coverageForRoute(route, reports) {
  const active = reports.filter((r) => r.status === 'active' && r.trust >= 20);
  if (!active.length) return 0;
  const step = 25;
  let samples = 0, covered = 0;
  const line = route.coords;
  let carry = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = geo.haversine(line[i], line[i + 1]);
    let pos = carry;
    while (pos <= segLen) {
      const t = segLen === 0 ? 0 : pos / segLen;
      const p = { lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t, lng: line[i].lng + (line[i + 1].lng - line[i].lng) * t };
      samples++;
      if (active.some((r) => geo.haversine(p, { lat: r.lat, lng: r.lng }) <= COVERAGE_RADIUS)) covered++;
      pos += step;
    }
    carry = pos - segLen;
  }
  return samples ? covered / samples : 0;
}

function scoreRoute(route, reports, need) {
  const { hits, features } = hitsForRoute(route, reports, need);
  const totalPenalty = hits.reduce((s, h) => s + h.penalty, 0);
  const worst = hits.reduce((m, h) => Math.max(m, h.penalty), 0);
  const featureBonus = Math.min(10, features.length * 2.5);
  const raw = 100 - (0.6 * totalPenalty + 0.4 * worst * 1.5) + featureBonus;
  const score = Math.max(0, Math.min(100, Math.round(raw)));
  const coverage = coverageForRoute(route, reports);
  return { ...route, hits, features, score, coverage: Math.round(coverage * 100), segments: buildSegments(route, hits) };
}

/** Split the polyline into coloured chunks: 'obstacle' near a hit, else 'clear'. */
function buildSegments(route, hits) {
  const line = route.coords;
  if (!hits.length) return [{ status: 'clear', coords: line.map((p) => [p.lat, p.lng]) }];
  const segments = [];
  let current = { status: 'clear', coords: [] };
  const flush = () => { if (current.coords.length > 1) segments.push(current); };
  for (let i = 0; i < line.length; i++) {
    const p = line[i];
    const nearHit = hits.some((h) => geo.haversine(p, { lat: h.report.lat, lng: h.report.lng }) <= (RADIUS[h.report.type] || 20) + 25);
    const status = nearHit ? 'obstacle' : 'clear';
    if (status !== current.status) {
      // share the boundary point so there is no visual gap
      current.coords.push([p.lat, p.lng]);
      flush();
      current = { status, coords: [[p.lat, p.lng]] };
    } else {
      current.coords.push([p.lat, p.lng]);
    }
  }
  flush();
  return segments;
}

/** Point on the polyline at a given distance from its start (clamped). */
function pointAlong(line, alongM) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = geo.haversine(line[i], line[i + 1]);
    if (acc + segLen >= alongM) {
      const t = segLen === 0 ? 0 : (alongM - acc) / segLen;
      return { lat: line[i].lat + (line[i + 1].lat - line[i].lat) * t, lng: line[i].lng + (line[i + 1].lng - line[i].lng) * t, index: i };
    }
    acc += segLen;
  }
  const last = line[line.length - 1];
  return { lat: last.lat, lng: last.lng, index: line.length - 2 };
}

/**
 * Candidate detours around one obstacle. Two families, both sides of the path:
 *  - single via point pushed sideways from the obstacle (quick sidestep)
 *  - "box" detour: leave the path ~120 m *before* the obstacle and rejoin ~120 m
 *    after it, offset ~90 m to one side — forces the router onto a parallel street.
 * Returns an array of waypoint lists (each list goes between from and to).
 */
function detourWaypoints(route, hit) {
  const line = route.coords;
  const i = Math.max(0, Math.min(line.length - 2, hit.index));
  const brg = geo.bearing(line[i], line[i + 1]);
  const centre = { lat: hit.report.lat, lng: hit.report.lng };
  const before = pointAlong(line, Math.max(0, hit.alongM - 120));
  const after = pointAlong(line, hit.alongM + 120);
  const out = [];
  for (const side of [90, -90]) {
    const b = (brg + side + 360) % 360;
    out.push([geo.destination(centre, b, 80)]);
    out.push([geo.destination(centre, b, 140)]);
    out.push([geo.destination(before, b, 90), geo.destination(after, b, 90)]);
  }
  return out;
}

function dedupe(routes) {
  const seen = [];
  return routes.filter((r) => {
    const key = `${Math.round(r.distanceM)}:${r.coords.length}`;
    if (seen.includes(key)) return false;
    seen.push(key);
    return true;
  });
}

/**
 * Main entry. `reports` must already be scored (trust/status present).
 * Returns { engine, routes: [...ranked], recommended, note, need }.
 */
async function planRoute({ from, to, need, reports, timeoutMs = 7000 }) {
  let note = null;
  let engine = 'kitabantu';
  let candidates = [];
  let unlockHint = null;

  // 1. Local accessibility-aware router (pilot area)
  const loc = local.route({ from, to, need, reports, radiusFor });
  if (loc.ok) {
    candidates = loc.routes.map((r) => ({ ...scoreRoute(r, reports, need), kind: r.kind, flags: r.flags, streets: r.streets }));
    if (loc.unlockHint) {
      unlockHint = {
        distanceM: loc.unlockHint.distanceM,
        reports: loc.unlockHint.reportIds.map((id) => reports.find((x) => x.id === id)).filter(Boolean).map((x) => ({ reportId: x.id, label: x.label, place: x.place, trust: x.trust, color: x.color, hoursSinceVerified: x.hoursSinceVerified })),
        minTrust: local.UNLOCK_MIN_TRUST,
      };
    }
  } else {
    // 2. OSRM fallback (generic foot profile) + via-point detours
    engine = 'osrm';
    note = loc.reason === 'outside_coverage'
      ? 'Outside the pilot areas (central KL, Cyberjaya): using a generic walking router that is not accessibility-aware.'
      : `Local router unavailable (${loc.reason}); using a generic walking router.`;
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const base = await osrmRoute([from, to], { alternatives: true, signal: ctrl.signal });
      candidates = base.map((r) => scoreRoute(r, reports, need));
      candidates.sort((a, b) => b.score - a.score || a.distanceM - b.distanceM);
      const first = candidates[0];
      if (first && first.hits.length) {
        const worstHit = [...first.hits].sort((a, b) => b.penalty - a.penalty)[0];
        if (worstHit.penalty >= 15) {
          const extra = await Promise.allSettled(detourWaypoints(first, worstHit).map((v) => osrmRoute([from, ...v, to], { alternatives: false, signal: ctrl.signal })));
          for (const r of extra) if (r.status === 'fulfilled') for (const rt of r.value) candidates.push({ ...scoreRoute(rt, reports, need), detour: true });
        }
      }
      if (base.some((r) => r.engine === 'osrm-demo')) note += ' Primary walking router unreachable; routes come from the backup router.';
    } catch (err) {
      engine = 'straight-line';
      note = `Routing engines unavailable (${err.message}); showing a straight-line estimate.`;
      candidates = [scoreRoute(straightLine(from, to), reports, need)];
    } finally {
      clearTimeout(timer);
    }
  }

  candidates = dedupe(candidates);
  candidates.sort((a, b) => b.score - a.score || (a.cost ?? a.distanceM) - (b.cost ?? b.distanceM));

  // Presentation set: best route, the obstacle-blind/shortest route (what you'd walk
  // into) when it tells the user something, and at most one more *distinct* alternative.
  const best = candidates[0];
  const naiveCand = candidates.find((c) => c !== best && c.kind === 'naive')
    || [...candidates].filter((c) => c !== best && !c.detour).sort((a, b) => a.distanceM - b.distanceM).find((c) => c.distanceM < best.distanceM);
  const naive = naiveCand && (naiveCand.hits.length || naiveCand.distanceM < best.distanceM * 0.97) ? naiveCand : null;
  const picked = [best];
  if (naive) picked.push(naive);
  const similar = (a, b) => Math.abs(a.distanceM - b.distanceM) <= Math.max(25, a.distanceM * 0.03) && a.score === b.score;
  const alt = candidates.find((c) => !picked.includes(c) && c.distanceM <= best.distanceM * 1.6 && !picked.some((p) => similar(p, c)));
  if (alt && picked.length < 3) picked.push(alt);

  const ranked = picked.map((c, idx) => ({
    id: `r${idx}`,
    rank: idx + 1,
    role: c === best ? 'recommended' : c === naive ? 'shortest' : 'alternative',
    recommended: c === best,
    detour: !!c.detour || (c === best && !!naive && best.kind === 'aware' && best.distanceM > naive.distanceM * 1.02),
    fallback: !!c.fallback,
    distanceM: Math.round(c.distanceM),
    durationMin: Math.max(1, Math.round(c.durationS / 60)),
    score: c.score,
    coverage: c.coverage,
    verdict: verdictFor(c),
    flags: c.flags || null,
    streets: (c.streets || []).slice(0, 5),
    hits: c.hits.map((h) => ({ reportId: h.report.id, type: h.report.type, icon: h.report.icon, label: h.report.label, trust: h.report.trust, band: h.report.band, color: h.report.color, distM: Math.round(h.distM), alongM: Math.round(h.alongM), penalty: Math.round(h.penalty), lat: h.report.lat, lng: h.report.lng })),
    features: c.features.map((f) => ({ reportId: f.report.id, type: f.report.type, icon: f.report.icon, label: f.report.label, trust: f.report.trust, alongM: Math.round(f.alongM) })),
    segments: c.segments,
    coords: c.coords,
    names: c.names || null,
  }));

  // Resolve "unlocked by" lift reports into something the UI can show
  for (const r of ranked) {
    if (r.flags && r.flags.unlockedBy && r.flags.unlockedBy.length) {
      r.flags.unlockedByReports = r.flags.unlockedBy.map((id) => reports.find((x) => x.id === id)).filter(Boolean).map((x) => ({ reportId: x.id, label: x.label, place: x.place, trust: x.trust, color: x.color }));
    }
  }

  return { engine, routes: ranked, recommended: ranked[0] || null, note, need: need || null, unlockHint };
}

function verdictFor(c) {
  if (c.score >= 80) {
    if (c.hits.some((h) => h.report.trust < 20)) return 'stale_obstacles'; // expired-band report still on the path
    return c.coverage >= 40 ? 'accessible' : 'likely_clear_unverified';
  }
  if (c.score >= 50) return 'caution';
  return 'blocked';
}

module.exports = { planRoute, scoreRoute, hitsForRoute, coverageForRoute, buildSegments, detourWaypoints, pointAlong, straightLine, RADIUS, radiusFor };
