'use strict';
/** Small geodesy toolkit (metres, WGS-84 approximations good to city scale). */

const R = 6371000;
const toRad = (d) => (d * Math.PI) / 180;
const toDeg = (r) => (r * 180) / Math.PI;

function haversine(a, b) {
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Local equirectangular projection around `origin` -> metres (x east, y north). */
function project(p, origin) {
  const x = toRad(p.lng - origin.lng) * Math.cos(toRad(origin.lat)) * R;
  const y = toRad(p.lat - origin.lat) * R;
  return { x, y };
}

function unproject(xy, origin) {
  const lat = origin.lat + toDeg(xy.y / R);
  const lng = origin.lng + toDeg(xy.x / (R * Math.cos(toRad(origin.lat))));
  return { lat, lng };
}

/** Distance (m) from point p to segment a-b, plus the fraction t along the segment. */
function distToSegment(p, a, b) {
  const P = project(p, a);
  const B = project(b, a);
  const len2 = B.x * B.x + B.y * B.y;
  let t = len2 === 0 ? 0 : (P.x * B.x + P.y * B.y) / len2;
  t = Math.max(0, Math.min(1, t));
  const cx = B.x * t;
  const cy = B.y * t;
  return { d: Math.hypot(P.x - cx, P.y - cy), t };
}

/**
 * Nearest approach of point p to a polyline [{lat,lng}...].
 * Returns { d, index, t, alongM } where alongM is distance from start of line.
 */
function distToPolyline(p, line) {
  let best = { d: Infinity, index: -1, t: 0, alongM: 0 };
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) {
    const segLen = haversine(line[i], line[i + 1]);
    const { d, t } = distToSegment(p, line[i], line[i + 1]);
    if (d < best.d) best = { d, index: i, t, alongM: acc + segLen * t };
    acc += segLen;
  }
  return best;
}

function polylineLength(line) {
  let acc = 0;
  for (let i = 0; i < line.length - 1; i++) acc += haversine(line[i], line[i + 1]);
  return acc;
}

/** Initial bearing (deg) from a to b. */
function bearing(a, b) {
  const φ1 = toRad(a.lat), φ2 = toRad(b.lat), Δλ = toRad(b.lng - a.lng);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Destination point given start, bearing (deg) and distance (m). */
function destination(a, brg, dist) {
  const δ = dist / R, θ = toRad(brg);
  const φ1 = toRad(a.lat), λ1 = toRad(a.lng);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lng: toDeg(λ2) };
}

module.exports = { haversine, project, unproject, distToSegment, distToPolyline, polylineLength, bearing, destination };
