'use strict';
/**
 * Local pedestrian router for central Kuala Lumpur.
 *
 * A* over a compact OpenStreetMap graph (data/graph_kl.json, built by
 * scripts/build-graph.js). Why our own router instead of only OSRM?
 *
 *  1. Need-aware costs. OSRM's foot profile happily sends a wheelchair down a
 *     staircase. Here `steps` are impassable for wheelchair/elderly, roads without
 *     sidewalks are penalised, dedicated footways are preferred, OSM `wheelchair=*`
 *     tags are honoured.
 *  2. Obstacle-aware costs. Active KitaBantu obstacle reports become soft
 *     penalties on nearby edges (severity × trust) BEFORE the search, so the
 *     router finds a detour by itself instead of us guessing via-points.
 *  3. Offline / on-stage reliability. No external dependency for the core demo.
 *
 * OSRM stays as an optional cross-check (lib/routing.js) — when reachable it
 * contributes extra alternatives that are scored the same way.
 */

const fs = require('fs');
const path = require('path');
const geo = require('./geo');
const { typeInfo } = require('./catalogue');

const GRAPH_DIR = path.join(__dirname, '..', 'data');
const GRAPH_PATH = process.env.KB_GRAPH || null; // optional: force a single graph file

const F_STEPS = 1, F_WC_NO = 2, F_WC_YES = 4, F_FOOT = 8, F_ROAD_NO_SIDEWALK = 16;
const WALK_MPS = 1.2;
const EMPTY = new Set();
const LIFT_UNLOCK_RADIUS_M = 80;   // a working lift reported within this distance makes nearby stairs passable
const LIFT_BROKEN_RADIUS_M = 80;   // ...unless a broken-lift report sits within this distance of the same stairs
const UNLOCK_MIN_TRUST = 40;

let GRAPHS = null;   // all loaded areas
let G = null;        // the area currently selected for a route() call

function loadOne(file) {
  const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  const nodes = raw.nodes.map(([lat, lng]) => ({ lat, lng }));
  const adj = nodes.map(() => []);
  const edges = raw.edges.map(([a, b, len, flags, name, via], i) => ({ id: i, a, b, len, flags, name: raw.names[name] || '', via: via || [] }));
  for (const e of edges) { adj[e.a].push(e); adj[e.b].push(e); }
  // spatial grid for snapping & obstacle lookup (cell ≈ 55 m)
  const cell = 0.0005;
  const grid = new Map();
  const key = (lat, lng) => `${Math.floor(lat / cell)}:${Math.floor(lng / cell)}`;
  nodes.forEach((n, i) => { const k = key(n.lat, n.lng); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(i); });
  return { nodes, edges, adj, grid, cell, key, bbox: raw.bbox, name: path.basename(file, '.json').replace(/^graph_/, '') };
}

/** Load every data/graph_*.json (or KB_GRAPH). Returns the list of areas. */
function loadAll() {
  if (GRAPHS) return GRAPHS;
  const files = GRAPH_PATH ? [GRAPH_PATH] : fs.existsSync(GRAPH_DIR) ? fs.readdirSync(GRAPH_DIR).filter((f) => /^graph_.*\.json$/.test(f)).map((f) => path.join(GRAPH_DIR, f)) : [];
  GRAPHS = files.filter((f) => fs.existsSync(f)).map(loadOne);
  return GRAPHS;
}
function inArea(g, p) { const [s, w, n, e] = g.bbox; return p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e; }
/** Pick the area containing both points (or the given point). */
function areaFor(...pts) { return loadAll().find((g) => pts.every((p) => inArea(g, p))) || null; }
/** Graph selected by route() (via use()); standalone helpers fall back to the first area. */
function load() { return G || loadAll()[0] || null; }
function use(g) { G = g; return g; }

function inBBox(p) { return !!areaFor(p); }

function nearestNode(p, maxM = 250) {
  const g = (G && inArea(G, p)) ? G : (areaFor(p) || load());
  if (!g) return -1;
  const ci = Math.floor(p.lat / g.cell), cj = Math.floor(p.lng / g.cell);
  let best = -1, bestD = Infinity;
  for (let r = 0; r <= 4 && best === -1; r++) {
    for (let i = ci - r; i <= ci + r; i++) for (let j = cj - r; j <= cj + r; j++) {
      const bucket = g.grid.get(`${i}:${j}`); if (!bucket) continue;
      for (const idx of bucket) { const d = geo.haversine(p, g.nodes[idx]); if (d < bestD) { bestD = d; best = idx; } }
    }
  }
  return bestD <= maxM ? best : -1;
}

/** Per-need base multiplier for an edge. Infinity = impassable. */
function edgeFactor(e, need, unlocked = EMPTY) {
  let f = e.flags;
  let m = 1;
  if ((f & F_STEPS) && unlocked.has(e.id)) { f &= ~F_STEPS; m *= 1.15; } // lift nearby: stairs passable, small wait cost
  if (need === 'wheelchair') {
    if (f & F_STEPS) return Infinity;
    if (f & F_WC_NO) return Infinity;
    if (f & F_WC_YES) m *= 0.85;
    if (f & F_FOOT) m *= 0.9;
    if (f & F_ROAD_NO_SIDEWALK) m *= 1.6;
  } else if (need === 'elderly') {
    if (f & F_STEPS) m *= 4;
    if (f & F_WC_NO) m *= 1.5;
    if (f & F_FOOT) m *= 0.9;
    if (f & F_ROAD_NO_SIDEWALK) m *= 1.4;
  } else if (need === 'visual') {
    if (f & F_STEPS) m *= 1.3;
    if (f & F_FOOT) m *= 0.85;             // separated from traffic
    if (f & F_ROAD_NO_SIDEWALK) m *= 2.0;  // sharing a lane with cars is the main hazard
  } else {
    if (f & F_STEPS) m *= 1.5;
    if (f & F_FOOT) m *= 0.95;
    if (f & F_ROAD_NO_SIDEWALK) m *= 1.3;
  }
  return m;
}

/** All edges whose geometry passes within `radius` m of point p. */
function edgesNear(p, radius) {
  const g = (G && inArea(G, p)) ? G : (areaFor(p) || load());
  if (!g) return [];
  const ci = Math.floor(p.lat / g.cell), cj = Math.floor(p.lng / g.cell);
  const span = Math.ceil(radius / 55) + 1;
  const seen = new Set();
  const out = [];
  for (let i = ci - span; i <= ci + span; i++) for (let j = cj - span; j <= cj + span; j++) {
    const bucket = g.grid.get(`${i}:${j}`); if (!bucket) continue;
    for (const n of bucket) for (const e of g.adj[n]) {
      if (seen.has(e.id)) continue; seen.add(e.id);
      const line = [g.nodes[e.a], ...e.via.map(([lat, lng]) => ({ lat, lng })), g.nodes[e.b]];
      const d = geo.distToPolyline(p, line).d;
      if (d <= radius) out.push({ e, d, g });
    }
  }
  return out;
}

/**
 * Stairs that the community has made passable: an active `lift_ok` report with
 * decent trust within 80 m unlocks nearby `steps` edges for wheelchair/elderly
 * users — unless a `lift_broken` report sits within 60 m of the same stairs.
 * OSM rarely maps station lifts as routable ways; KitaBantu's own data fills
 * the gap, and because trust decays, an un-reconfirmed lift stops unlocking.
 */
function stepsUnlocks(reports, need, minTrust = UNLOCK_MIN_TRUST) {
  const unlocked = new Map(); // edgeId -> reportId
  if (need !== 'wheelchair' && need !== 'elderly') return unlocked;
  const lifts = reports.filter((r) => r.status === 'active' && r.trust >= minTrust && r.type === 'lift_ok');
  const broken = reports.filter((r) => r.status === 'active' && r.trust >= UNLOCK_MIN_TRUST && r.type === 'lift_broken');
  const cur = G; // when routing, only unlock edges of the area being routed
  for (const r of lifts) {
    for (const { e, g } of edgesNear({ lat: r.lat, lng: r.lng }, LIFT_UNLOCK_RADIUS_M)) {
      if ((cur && g !== cur) || !(e.flags & F_STEPS)) continue;
      const line = [g.nodes[e.a], ...e.via.map(([lat, lng]) => ({ lat, lng })), g.nodes[e.b]];
      const vetoed = broken.some((b) => geo.distToPolyline({ lat: b.lat, lng: b.lng }, line).d <= LIFT_BROKEN_RADIUS_M);
      if (!vetoed) unlocked.set(e.id, r.id);
    }
  }
  return unlocked;
}

/**
 * Build an edge-penalty map from active obstacle reports.
 * An obstacle within `radius` of an edge adds  severity × trust / 100 × K  metres
 * of virtual length (K = 8 → a trust-90 blocked kerb (sev 50) ≈ +360 m; for a
 * wheelchair user a fully-trusted broken lift (sev 60) is close to impassable).
 */
function obstaclePenalties(reports, need, radiusFor) {
  const pen = new Map();
  const cur = G;
  const relevant = reports.filter((r) => r.status === 'active' && r.trust > 0 && r.kind === 'obstacle' && (!need || r.affects.includes(need)));
  for (const r of relevant) {
    const info = typeInfo(r.type);
    const add = (info.severity * r.trust / 100) * 8;
    for (const { e, g } of edgesNear({ lat: r.lat, lng: r.lng }, radiusFor(r.type))) if (!cur || g === cur) pen.set(e.id, (pen.get(e.id) || 0) + add);
  }
  return pen;
}

class MinHeap {
  constructor() { this.a = []; }
  push(x) { const a = this.a; a.push(x); let i = a.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (a[p].f <= a[i].f) break; [a[p], a[i]] = [a[i], a[p]]; i = p; } }
  pop() { const a = this.a; const top = a[0]; const last = a.pop(); if (a.length) { a[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < a.length && a[l].f < a[m].f) m = l; if (r < a.length && a[r].f < a[m].f) m = r; if (m === i) break; [a[m], a[i]] = [a[i], a[m]]; i = m; } } return top; }
  get size() { return this.a.length; }
}

function astar(src, dst, need, { penalties = new Map(), unlocked = new Map() } = {}, avoidEdges = new Set()) {
  const unlockedSet = new Set(unlocked.keys());
  const g = load();
  const gScore = new Map([[src, 0]]);
  const prev = new Map();
  const open = new MinHeap();
  const h = (n) => geo.haversine(g.nodes[n], g.nodes[dst]) * 0.8;
  open.push({ n: src, f: h(src) });
  const closed = new Set();
  while (open.size) {
    const { n } = open.pop();
    if (n === dst) break;
    if (closed.has(n)) continue;
    closed.add(n);
    for (const e of g.adj[n]) {
      if (avoidEdges.has(e.id)) continue;
      const fac = edgeFactor(e, need, unlockedSet);
      if (!Number.isFinite(fac)) continue;
      const other = e.a === n ? e.b : e.a;
      const cost = e.len * fac + (penalties.get(e.id) || 0);
      const ng = gScore.get(n) + cost;
      if (ng < (gScore.get(other) ?? Infinity)) { gScore.set(other, ng); prev.set(other, { n, e }); open.push({ n: other, f: ng + h(other) }); }
    }
  }
  if (!prev.has(dst) && src !== dst) return null;
  const nodesPath = [dst]; const edgesPath = [];
  let cur = dst;
  while (cur !== src) { const p = prev.get(cur); edgesPath.push(p.e); cur = p.n; nodesPath.push(cur); }
  nodesPath.reverse(); edgesPath.reverse();
  // geometry
  const coords = [];
  const names = []; // street name of the edge that *leaves* each coordinate (same length as coords)
  for (let i = 0; i < edgesPath.length; i++) {
    const e = edgesPath[i]; const from = nodesPath[i];
    const via = e.a === from ? e.via : [...e.via].reverse();
    if (i === 0) { coords.push(g.nodes[from]); names.push(e.name); }
    for (const [lat, lng] of via) { coords.push({ lat, lng }); names.push(e.name); }
    coords.push(g.nodes[e.a === from ? e.b : e.a]); names.push(edgesPath[i + 1] ? edgesPath[i + 1].name : e.name);
  }
  const distanceM = edgesPath.reduce((s, e) => s + e.len, 0);
  const cost = gScore.get(dst);
  const streets = [...new Set(edgesPath.map((e) => e.name).filter(Boolean))];
  const stepsEdges = edgesPath.filter((e) => e.flags & F_STEPS);
  const flags = {
    steps: stepsEdges.length,
    stepsUnlocked: stepsEdges.filter((e) => unlocked.has(e.id)).length,
    unlockedBy: [...new Set(stepsEdges.map((e) => unlocked.get(e.id)).filter(Boolean))],
    noSidewalk: Math.round(edgesPath.filter((e) => e.flags & F_ROAD_NO_SIDEWALK).reduce((s, e) => s + e.len, 0)),
  };
  return { coords, names, distanceM, durationS: distanceM / WALK_MPS, cost, edgeIds: edgesPath.map((e) => e.id), streets, flags };
}

/**
 * Public API: up to `k` diverse routes.
 *  - route 0: obstacle- and need-aware (the recommendation)
 *  - route 1: need-aware but obstacle-blind ("what you'd walk into" = the naive shortest)
 *  - route 2: obstacle-aware alternative that avoids the top route's middle third (diversity)
 */
function route({ from, to, need, reports = [], radiusFor = () => 20, k = 3 }) {
  if (!loadAll().length) return { ok: false, reason: 'no_graph' };
  const g = areaFor(from, to);
  if (!g) return { ok: false, reason: 'outside_coverage' };
  use(g);
  try { return routeIn(g, { from, to, need, reports, radiusFor, k }); } finally { use(null); }
}
function routeIn(g, { from, to, need, reports, radiusFor, k }) {
  const s = nearestNode(from), d = nearestNode(to);
  if (s < 0 || d < 0) return { ok: false, reason: 'no_nearby_path' };
  const unlocked = stepsUnlocks(reports, need);
  const penalties = obstaclePenalties(reports, need, radiusFor);
  const out = [];
  const best = astar(s, d, need, { penalties, unlocked });
  if (!best) return { ok: false, reason: 'unreachable' };
  out.push({ ...best, kind: 'aware' });
  const naive = astar(s, d, need, { unlocked });
  if (naive && naive.edgeIds.join() !== best.edgeIds.join()) out.push({ ...naive, kind: 'naive' });
  if (out.length < k) {
    const mid = best.edgeIds.slice(Math.floor(best.edgeIds.length / 3), Math.ceil((2 * best.edgeIds.length) / 3));
    const alt = astar(s, d, need, { penalties, unlocked }, new Set(mid));
    if (alt && !out.some((r) => r.edgeIds.join() === alt.edgeIds.join()) && alt.distanceM <= best.distanceM * 1.6) out.push({ ...alt, kind: 'alt' });
  }
  // stitch the exact endpoints on (snapping gap)
  for (const r of out) { r.coords = [from, ...r.coords, to]; r.names = [r.names[0] || '', ...r.names, '']; r.distanceM += geo.haversine(from, g.nodes[s]) + geo.haversine(to, g.nodes[d]); r.durationS = r.distanceM / WALK_MPS; }

  // "Could be shorter": would a *stale* lift report (active but below the unlock
  // threshold) open a much shorter way? If so, tell the user which report to re-confirm.
  let unlockHint = null;
  if (need === 'wheelchair' || need === 'elderly') {
    const stale = stepsUnlocks(reports, need, 1);
    const extra = [...stale.entries()].filter(([eid]) => !unlocked.has(eid));
    if (extra.length) {
      const merged = new Map([...unlocked, ...extra]);
      const hyp = astar(s, d, need, { penalties, unlocked: merged });
      if (hyp && hyp.distanceM + 40 < best.distanceM * 0.8) {
        const ids = [...new Set(hyp.edgeIds.filter((eid) => merged.has(eid) && !unlocked.has(eid)).map((eid) => merged.get(eid)))];
        if (ids.length) unlockHint = { distanceM: Math.round(hyp.distanceM + geo.haversine(from, g.nodes[s]) + geo.haversine(to, g.nodes[d])), reportIds: ids };
      }
    }
  }
  return { ok: true, routes: out, unlockHint, area: g.name };
}

module.exports = { load, loadAll, areaFor, use, route, nearestNode, inBBox, edgesNear, edgeFactor, obstaclePenalties, stepsUnlocks, astar, UNLOCK_MIN_TRUST, F_STEPS, F_WC_NO, F_WC_YES, F_FOOT, F_ROAD_NO_SIDEWALK };
