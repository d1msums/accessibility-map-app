'use strict';
/**
 * Build a compact pedestrian graph for central Kuala Lumpur from a raw Overpass
 * dump (data/osm_kl_raw.json) -> data/graph_kl.json
 *
 * Query used (bbox 3.108,101.660,3.162,101.722):
 *   way["highway"]["highway"!~"motorway|motorway_link|trunk|trunk_link|raceway|proposed|
 *   construction|bus_guideway|abandoned|planned"]["foot"!~"no"]["access"!~"private|no"];
 *
 * Output: { nodes: [[lat,lng],...], edges: [[a,b,lengthM,flags,nameIdx],...], names: [...] }
 *   flags bit 0 = steps (stairs)            bit 1 = wheelchair=no
 *   flags bit 2 = wheelchair=yes             bit 3 = footway/pedestrian/corridor (dedicated foot)
 *   flags bit 4 = road with no sidewalk info (shared with traffic)
 */
const fs = require('fs');
const path = require('path');

// Usage: node scripts/build-graph.js [rawJson] [outJson] [south,west,north,east]
const RAW = process.argv[2] || path.join(__dirname, '..', 'data', 'osm_kl_raw.json');
const OUT = process.argv[3] || path.join(__dirname, '..', 'data', 'graph_kl.json');
const BBOX = process.argv[4] ? process.argv[4].split(',').map(Number) : [3.108, 101.660, 3.162, 101.722];

const raw = JSON.parse(fs.readFileSync(RAW, 'utf8'));
const nodeById = new Map();
for (const e of raw.elements) if (e.type === 'node') nodeById.set(e.id, e);

const R = 6371000;
const hav = (a, b) => {
  const toR = (d) => (d * Math.PI) / 180;
  const dLat = toR(b.lat - a.lat), dLng = toR(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

const FOOT_DEDICATED = new Set(['footway', 'pedestrian', 'corridor', 'path', 'living_street', 'steps', 'crossing']);
const idx = new Map(); // osm node id -> compact index
const nodes = [];
const edges = [];
const names = [];
const nameIdx = new Map();
const useCount = new Map();

const ways = raw.elements.filter((e) => e.type === 'way' && e.tags && e.tags.highway);
for (const w of ways) for (const n of w.nodes) useCount.set(n, (useCount.get(n) || 0) + 1);

function nid(osmId) {
  let i = idx.get(osmId);
  if (i == null) { const n = nodeById.get(osmId); i = nodes.length; nodes.push([+n.lat.toFixed(6), +n.lon.toFixed(6)]); idx.set(osmId, i); }
  return i;
}
function nameId(s) {
  if (!s) return -1;
  let i = nameIdx.get(s);
  if (i == null) { i = names.length; names.push(s); nameIdx.set(s, i); }
  return i;
}

let skipped = 0;
for (const w of ways) {
  const t = w.tags;
  let flags = 0;
  if (t.highway === 'steps') flags |= 1;
  if (t.wheelchair === 'no') flags |= 2;
  if (t.wheelchair === 'yes') flags |= 4;
  if (FOOT_DEDICATED.has(t.highway)) flags |= 8;
  if (!FOOT_DEDICATED.has(t.highway) && !t.sidewalk) flags |= 16;
  if (t.highway === 'service' && (t.service === 'parking_aisle' || t.service === 'driveway') && t.foot !== 'yes') { skipped++; continue; }
  const ni = nameId(t.name || '');
  // Split ways at nodes shared with other ways (intersections) — keep intermediate geometry in one edge
  let segStart = 0;
  for (let i = 1; i < w.nodes.length; i++) {
    const isJunction = useCount.get(w.nodes[i]) > 1 || i === w.nodes.length - 1;
    if (!isJunction) continue;
    const chain = w.nodes.slice(segStart, i + 1).filter((id) => nodeById.has(id));
    if (chain.length >= 2) {
      let len = 0;
      for (let k = 1; k < chain.length; k++) len += hav(nodeById.get(chain[k - 1]), nodeById.get(chain[k]));
      const a = nid(chain[0]), b = nid(chain[chain.length - 1]);
      const via = chain.slice(1, -1).map((id) => { const n = nodeById.get(id); return [+n.lat.toFixed(6), +n.lon.toFixed(6)]; });
      edges.push([a, b, Math.round(len * 10) / 10, flags, ni, via]);
    }
    segStart = i;
  }
}

fs.writeFileSync(OUT, JSON.stringify({ bbox: BBOX, nodes, edges, names }));
console.log(`graph: ${nodes.length} nodes, ${edges.length} edges, ${names.length} names, skipped ${skipped} private service ways -> ${OUT} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB)`);
