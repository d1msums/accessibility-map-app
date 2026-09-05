// Import only the submodules actually used, not the whole @turf/turf bundle --
// @turf/turf pulls in every turf package and meaningfully slows Edge Function
// cold starts for a handful of functions. Also bumped 6.5.0 -> 7.4.0 (current).
import { point } from 'npm:@turf/helpers@7.4.0';
import { lineString } from 'npm:@turf/helpers@7.4.0';
import { nearestPointOnLine } from 'npm:@turf/nearest-point-on-line@7.4.0';
import { distance } from 'npm:@turf/distance@7.4.0';
import { bearing } from 'npm:@turf/bearing@7.4.0';
import { makeGridCell, scoreFromOSMTags, OSMTagScore } from './osm_scoring.ts';

export interface OSMWayGeo {
  id: number;
  geometry: [number, number][]; // [lng, lat]
  tags: Record<string, string>;
  timestamp?: string;
}

export interface SnappedSegment {
  lat: number;
  lng: number;
  grid_cell: string;
  heading: number | null;
  source: 'osm';
  osm_tags: Record<string, unknown>;
  detected_features: string[];
  ai_confidence: number;
  score: number;
  distance: number; // meters from original sample point
}

/**
 * Snap route sample points to nearest OSM way within threshold.
 * Returns scored segments only for points that actually matched a way.
 */
export function snapRouteToOSM(
  routePoints: [number, number][], // [lng, lat]
  osmWays: OSMWayGeo[],
  thresholdMeters = 15
): SnappedSegment[] {
  const lines = osmWays.map(w => lineString(w.geometry));
  const out: SnappedSegment[] = [];

  for (const [lng, lat] of routePoints) {
    const pt = point([lng, lat]);
    let best: { wayIdx: number; snapped: any; dist: number } | null = null;

    for (let i = 0; i < lines.length; i++) {
      const snapped = nearestPointOnLine(lines[i], pt);
      const distKm = distance(pt, snapped, { units: 'kilometers' });
      const distM = distKm * 1000;

      if (distM <= thresholdMeters && (!best || distM < best.dist)) {
        best = { wayIdx: i, snapped, dist: distM };
      }
    }

    if (!best) continue;

    const way = osmWays[best.wayIdx];
    const scored = scoreFromOSMTags(way.tags, way.timestamp);
    if (scored.score === null) continue;

    const [sLng, sLat] = best.snapped.geometry.coordinates;

    // heading along the way at the snapped index
    let heading: number | null = null;
    const idx = best.snapped.properties.index ?? 0;
    if (idx < way.geometry.length - 1) {
      heading = bearing(
        point(way.geometry[idx]),
        point(way.geometry[idx + 1])
      );
    }

    out.push({
      lat: sLat,
      lng: sLng,
      grid_cell: makeGridCell(sLat, sLng),
      heading,
      source: 'osm',
      osm_tags: { ...way.tags, '@timestamp': way.timestamp, '@way_id': way.id },
      detected_features: scored.features,
      ai_confidence: scored.confidence,
      score: scored.score,
      distance: best.dist,
    });
  }

  return out;
}