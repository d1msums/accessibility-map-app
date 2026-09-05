// node scripts/check_osm_coverage.js 3.058 101.691 3.062 101.695
const [,, minLat, minLng, maxLat, maxLng] = process.argv;
if ([minLat, minLng, maxLat, maxLng].some(v => v === undefined)) {
  console.log('Usage: node check_osm_coverage.js <minLat> <minLng> <maxLat> <maxLng>');
  process.exit(1);
}

const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;

const QUERY = `
[out:json][timeout:25];
(
  way["highway"="footway"]["footway"="sidewalk"](${bbox});
  way["sidewalk"](${bbox});
  way["wheelchair"](${bbox});
  node["kerb"](${bbox});
  node["tactile_paving"](${bbox});
  node["barrier"](${bbox});
);
out geom meta;
`;

async function main() {
  const res = await fetch('https://overpass-api.de/api/interpreter', {
    method: 'POST',
    body: QUERY,
  });

  if (!res.ok) {
    const text = await res.text();
    console.error(`Overpass request failed: ${res.status} ${res.statusText}`);
    console.error(text.slice(0, 500));
    process.exit(1);
  }

  const data = await res.json();

  const ways = data.elements.filter(e => e.type === 'way');
  const nodes = data.elements.filter(e => e.type === 'node');

  // Tag counters
  const tagStats = {};
  for (const el of [...ways, ...nodes]) {
    for (const [k, v] of Object.entries(el.tags || {})) {
      const key = `${k}=${v}`;
      tagStats[key] = (tagStats[key] || 0) + 1;
    }
  }

  // Age histogram
  const now = Date.now();
  const ageBuckets = { '<1y': 0, '1-2y': 0, '2-4y': 0, '>4y': 0 };
  for (const el of [...ways, ...nodes]) {
    if (!el.timestamp) continue;
    const y = (now - new Date(el.timestamp).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (y < 1) ageBuckets['<1y']++;
    else if (y < 2) ageBuckets['1-2y']++;
    else if (y < 4) ageBuckets['2-4y']++;
    else ageBuckets['>4y']++;
  }

  // Rough score preview
  const scorePreview = { high: 0, medium: 0, low: 0, null: 0 };
  for (const el of [...ways, ...nodes]) {
    const t = el.tags || {};
    let s = null;
    if (t.wheelchair === 'yes') s = 'high';
    else if (t.wheelchair === 'limited') s = 'medium';
    else if (t.wheelchair === 'no') s = 'low';
    else if (t.kerb === 'flush' || t.kerb === 'lowered') s = 'high';
    else if (t.kerb === 'raised') s = 'low';
    else if (t.sidewalk === 'no') s = 'low';
    else if (t.barrier) s = 'medium'; // flag for review
    scorePreview[s ?? 'null']++;
  }

  console.log('\n=== OSM Coverage Report ===');
  console.log(`Ways:  ${ways.length}`);
  console.log(`Nodes: ${nodes.length}`);
  console.log('\n--- Tag distribution ---');
  Object.entries(tagStats).sort((a,b) => b[1]-a[1]).slice(0,15).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log('\n--- Data age ---');
  Object.entries(ageBuckets).forEach(([k,v]) => console.log(`  ${k}: ${v}`));
  console.log('\n--- Rough score preview ---');
  Object.entries(scorePreview).forEach(([k,v]) => console.log(`  ${k}: ${v}`));

  if (ways.length + nodes.length < 10) {
    console.log('\n⚠️  Coverage is near-zero. Budget MORE time for vision-LLM fallback.');
  } else {
    console.log('\n✅ OSM baseline will contribute signal. Budget accordingly.');
  }
}

main().catch(console.error);