// Shared OSM scoring utilities.
//
// scoreFromOSMTags now returns a structured OSMTagScore instead of a bare
// number. Two things this fixes:
//   1. snap_route.ts already imported `scoreFromOSMTags` and `OSMTagScore`
//      expecting this exact shape ({ score, features, confidence }) -- the
//      old single-number version didn't export OSMTagScore at all, so
//      snap_route.ts's import was broken and would fail at load time.
//   2. A tag-less way (e.g. a plain `highway=footway` with no wheelchair/
//      kerb/tactile info) used to score 0 -- the same as an *explicit*
//      `wheelchair=no`. Those are different things: one is "known bad", the
//      other is "no signal, go check imagery." score is now nullable, and
//      null is what should trigger the Phase 2 vision-LLM fallback.

export interface OSMTagScore {
  score: number | null;   // null = no accessibility signal in these tags
  features: string[];     // which tags actually contributed to the score
  confidence: number;     // 0-1, how much to trust this score
}

export function makeGridCell(lat: number, lng: number): string {
  return `${lat.toFixed(5)}_${lng.toFixed(5)}`;
}

/**
 * @param tags OSM tag map for a node or way
 * @param timestampStr optional OSM edit timestamp (needs `out meta;` in the
 *   Overpass query) -- older edits reduce confidence, since infrastructure
 *   changes (construction, a since-repaired lift) aren't reflected.
 */
export function scoreFromOSMTags(tags: Record<string, string> | null | undefined, timestampStr?: string): OSMTagScore {
  const empty: OSMTagScore = { score: null, features: [], confidence: 0 };
  if (!tags) return empty;

  let ageDiscount = 1.0;
  if (timestampStr) {
    const ageYears = (Date.now() - new Date(timestampStr).getTime()) / (1000 * 60 * 60 * 24 * 365);
    if (ageYears > 4) ageDiscount = 0.5;
    else if (ageYears > 2) ageDiscount = 0.7;
    else if (ageYears > 1) ageDiscount = 0.85;
  }

  // Wheelchair tag is the most direct signal -> highest base confidence.
  if (tags.wheelchair === 'yes') return { score: 90, features: ['wheelchair=yes'], confidence: 0.9 * ageDiscount };
  if (tags.wheelchair === 'limited') return { score: 60, features: ['wheelchair=limited'], confidence: 0.9 * ageDiscount };
  if (tags.wheelchair === 'no') return { score: 10, features: ['wheelchair=no'], confidence: 0.9 * ageDiscount };

  // Kerb ramps.
  if (tags.kerb === 'flush' || tags.kerb === 'lowered') return { score: 80, features: [`kerb=${tags.kerb}`], confidence: 0.85 * ageDiscount };
  if (tags.kerb === 'raised') return { score: 20, features: ['kerb=raised'], confidence: 0.85 * ageDiscount };

  if (tags.tactile_paving === 'yes') return { score: 70, features: ['tactile_paving=yes'], confidence: 0.7 * ageDiscount };

  // A tagged sidewalk/footway with no further specifics: weak positive
  // signal (it exists and is pedestrian-designated), not "no data".
  if (tags.footway === 'sidewalk' || tags.sidewalk === 'yes' || tags.highway === 'footway') {
    return { score: 55, features: ['footway/sidewalk present'], confidence: 0.4 * ageDiscount };
  }
  if (tags.sidewalk === 'no') return { score: 15, features: ['sidewalk=no'], confidence: 0.7 * ageDiscount };

  // Barriers: don't auto-penalize. A vehicle gate with foot=yes/
  // motor_vehicle=no is a non-issue for a pedestrian; only score it down
  // when there's actually a reason to think a person on foot is blocked.
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
    // Unknown barrier with no foot/access info -- flag for review, don't guess.
    return { score: null, features: [`barrier=${tags.barrier} (unclassified)`], confidence: 0 };
  }

  return empty;
}

export function buildOverpassQuery(minLat: number, minLng: number, maxLat: number, maxLng: number): string {
  const bbox = `${minLat},${minLng},${maxLat},${maxLng}`;
  // `out geom meta;` -- meta is required to get each element's edit
  // timestamp (used above for the age discount). Without it every row
  // silently loses its staleness signal.
  return `[out:json][timeout:60];(way["highway"="footway"]["footway"="sidewalk"](${bbox});way["sidewalk"](${bbox});way["wheelchair"](${bbox});node["kerb"](${bbox});node["tactile_paving"](${bbox});node["barrier"](${bbox}););out geom meta;`;
}

export function discretizeWay(way: any, sampleInterval: number = 20): any[] {
  const segments: any[] = [];
  if (!way.geometry || way.geometry.length < 2) return segments;

  const scored = scoreFromOSMTags(way.tags, way.timestamp);
  const points = way.geometry.map((p: any) => ({ lat: p.lat, lng: p.lon }));

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const dist = haversineDistance(p1.lat, p1.lng, p2.lat, p2.lng);
    const heading = calculateBearing(p1.lat, p1.lng, p2.lat, p2.lng);
    const steps = dist < sampleInterval ? 1 : Math.ceil(dist / sampleInterval);

    for (let j = 0; j < steps; j++) {
      const t = j / steps;
      segments.push({
        lat: p1.lat + (p2.lat - p1.lat) * t,
        lng: p1.lng + (p2.lng - p1.lng) * t,
        heading,
        score: scored.score,
        ai_confidence: scored.confidence,
        osm_tags: way.tags || {},
        detected_features: scored.features,
      });
    }
  }
  return segments;
}

export function nodeToSegment(node: any): any | null {
  // `!node.lat` rejects a valid 0 coordinate (equator/prime meridian) --
  // check the type instead of relying on truthiness.
  if (typeof node.lat !== 'number' || typeof node.lon !== 'number') return null;
  const scored = scoreFromOSMTags(node.tags, node.timestamp);
  return {
    lat: node.lat,
    lng: node.lon,
    heading: 0,
    score: scored.score,
    ai_confidence: scored.confidence,
    osm_tags: node.tags || {},
    detected_features: scored.features,
  };
}

// Helper functions
function haversineDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371000; // meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon/2) * Math.sin(dLon/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  return R * c;
}

function calculateBearing(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const y = Math.sin(dLon) * Math.cos(lat2 * Math.PI / 180);
  const x = Math.cos(lat1 * Math.PI / 180) * Math.sin(lat2 * Math.PI / 180) -
            Math.sin(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.cos(dLon);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  brng = (brng + 360) % 360;
  return brng;
}
