// Mirrors buildOverpassQuery / scoreFromOSMTags from
// supabase/functions/_shared/osm_scoring.ts. Kept as a plain copy instead of
// an import: that module lives in the Deno edge-function tree, outside
// Vite's project root, and pulling it in would need server.fs.allow plus
// bundling code written for a different runtime. Keep the query string and
// scoring rules in sync with osm_scoring.ts by hand if either changes.

const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

export function buildOverpassQuery(minLat, minLng, maxLat, maxLng) {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  return `[out:json][timeout:60];(way["highway"="footway"]["footway"="sidewalk"](${bbox});way["sidewalk"](${bbox});way["wheelchair"](${bbox});node["kerb"](${bbox});node["tactile_paving"](${bbox});node["barrier"](${bbox}););out geom meta;`;
}

export function scoreFromOSMTags(tags, timestampStr) {
  const empty = { score: null, features: [], confidence: 0 };
  if (!tags) return empty;

  let ageDiscount = 1.0;
  if (timestampStr) {
    const ageYears = (Date.now() - new Date(timestampStr).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (ageYears > 4) ageDiscount = 0.5;
    else if (ageYears > 2) ageDiscount = 0.7;
    else if (ageYears > 1) ageDiscount = 0.85;
  }

  if (tags.wheelchair === 'yes') return { score: 90, features: ['wheelchair=yes'], confidence: 0.9 * ageDiscount };
  if (tags.wheelchair === 'limited') return { score: 60, features: ['wheelchair=limited'], confidence: 0.9 * ageDiscount };
  if (tags.wheelchair === 'no') return { score: 10, features: ['wheelchair=no'], confidence: 0.9 * ageDiscount };

  if (tags.kerb === 'flush' || tags.kerb === 'lowered') return { score: 80, features: [`kerb=${tags.kerb}`], confidence: 0.85 * ageDiscount };
  if (tags.kerb === 'raised') return { score: 20, features: ['kerb=raised'], confidence: 0.85 * ageDiscount };

  if (tags.tactile_paving === 'yes') return { score: 70, features: ['tactile_paving=yes'], confidence: 0.7 * ageDiscount };

  if (tags.footway === 'sidewalk' || tags.sidewalk === 'yes' || tags.highway === 'footway') {
    return { score: 55, features: ['footway/sidewalk present'], confidence: 0.4 * ageDiscount };
  }
  if (tags.sidewalk === 'no') return { score: 15, features: ['sidewalk=no'], confidence: 0.7 * ageDiscount };

  if (tags.barrier) {
    if (tags.foot === 'yes' || tags.motor_vehicle === 'no') {
      return { score: 85, features: [`barrier=${tags.barrier}`, 'foot=yes/motor_vehicle=no'], confidence: 0.6 * ageDiscount };
    }
    if (tags.foot === 'no') {
      return { score: 5, features: [`barrier=${tags.barrier}`, 'foot=no'], confidence: 0.8 * ageDiscount };
    }
    if (tags.barrier === 'bollard' && tags.maxwidth) {
      const width = parseFloat(tags.maxwidth);
      return { score: width >= 0.9 ? 70 : 30, features: [`barrier=bollard`, `maxwidth=${tags.maxwidth}`], confidence: 0.5 * ageDiscount };
    }
    if (tags.barrier === 'gate' && tags.access !== 'no') {
      return { score: 50, features: [`barrier=gate`], confidence: 0.4 * ageDiscount };
    }
    return { score: null, features: [`barrier=${tags.barrier} (unclassified)`], confidence: 0 };
  }

  return empty;
}

export function colorForScore(score) {
  if (score === null || score === undefined) return '#9aa0a6'; // gray — no signal
  if (score >= 70) return '#1e8e3e'; // green
  if (score >= 40) return '#f9ab00'; // amber
  return '#d93025'; // red
}

// path: array of {lat, lng}. Pads the tight bounding box by paddingMeters on
// every side so nearby sidewalk/kerb data just off the route line is still
// captured, not just points exactly on the polyline.
export function bboxFromPath(path, paddingMeters = 30) {
  if (!path || path.length === 0) return null;

  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const p of path) {
    if (p.lat < minLat) minLat = p.lat;
    if (p.lat > maxLat) maxLat = p.lat;
    if (p.lng < minLng) minLng = p.lng;
    if (p.lng > maxLng) maxLng = p.lng;
  }

  const midLat = (minLat + maxLat) / 2;
  const latPad = paddingMeters / 111320; // meters per degree latitude, ~constant
  const lngPad = paddingMeters / (111320 * Math.cos((midLat * Math.PI) / 180));

  return {
    minLat: minLat - latPad,
    minLng: minLng - lngPad,
    maxLat: maxLat + latPad,
    maxLng: maxLng + lngPad,
  };
}

export async function fetchOverpassData(bbox) {
  const query = buildOverpassQuery(bbox.minLat, bbox.minLng, bbox.maxLat, bbox.maxLng);

  // POST, not GET — a long transit route's bbox query can exceed practical
  // URL length limits some proxies/browsers enforce.
  const resp = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `data=${encodeURIComponent(query)}`,
  });

  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`Overpass API error: ${resp.status} - ${text.slice(0, 200)}`);
  }

  const data = await resp.json();
  return data.elements || [];
}
