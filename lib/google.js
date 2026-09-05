'use strict';
/**
 * Thin, key-holding wrappers around Google Maps Platform web services.
 * The browser never sees GOOGLE_MAPS_API_KEY for these; only the Maps JavaScript
 * loader (map tiles) uses it client-side via /api/config.
 *
 * Every call returns `{ ok:false, reason }` instead of throwing when the API is
 * not enabled on the project, so callers can fall back (OSM / local router).
 */
const KEY = () => process.env.GOOGLE_MAPS_API_KEY || '';
const TIMEOUT = 9000;

async function gfetch(url, { method = 'GET', headers = {}, body = null } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT);
  try {
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json', ...headers }, body: body ? JSON.stringify(body) : undefined, signal: ctrl.signal });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) return { ok: false, status: res.status, reason: data.error?.status || data.status || `http_${res.status}`, message: data.error?.message || data.error_message || '' };
    return { ok: true, data };
  } catch (err) {
    return { ok: false, reason: 'network', message: err.message };
  } finally { clearTimeout(t); }
}

const enabled = () => !!KEY();

// ---------- Places API (New) ----------
const PLACE_FIELDS = 'places.id,places.displayName,places.formattedAddress,places.location,places.types,places.primaryType,places.primaryTypeDisplayName,places.rating,places.userRatingCount,places.accessibilityOptions,places.currentOpeningHours.openNow,places.businessStatus';

function placeView(p) {
  const acc = p.accessibilityOptions || {};
  return {
    id: p.id,
    name: p.displayName?.text || '',
    address: p.formattedAddress || '',
    lat: p.location?.latitude, lng: p.location?.longitude,
    type: p.primaryType || (p.types || [])[0] || '',
    typeLabel: p.primaryTypeDisplayName?.text || '',
    rating: p.rating || null, ratings: p.userRatingCount || 0,
    openNow: p.currentOpeningHours?.openNow ?? null,
    accessibility: {
      entrance: acc.wheelchairAccessibleEntrance ?? null,
      parking: acc.wheelchairAccessibleParking ?? null,
      restroom: acc.wheelchairAccessibleRestroom ?? null,
      seating: acc.wheelchairAccessibleSeating ?? null,
      known: Object.keys(acc).length > 0,
    },
    source: 'google',
  };
}

async function nearby({ lat, lng, radius = 1000, types = null, max = 20, lang = 'en' }) {
  if (!enabled()) return { ok: false, reason: 'no_key' };
  const body = { locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } }, maxResultCount: Math.min(20, max), languageCode: lang, rankPreference: 'DISTANCE' };
  if (types && types.length) body.includedTypes = types;
  const r = await gfetch('https://places.googleapis.com/v1/places:searchNearby', { method: 'POST', headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': PLACE_FIELDS }, body });
  if (!r.ok) return r;
  return { ok: true, places: (r.data.places || []).map(placeView) };
}

async function textSearch({ q, lat, lng, radius = 5000, max = 8, lang = 'en' }) {
  if (!enabled()) return { ok: false, reason: 'no_key' };
  const body = { textQuery: q, maxResultCount: Math.min(20, max), languageCode: lang, regionCode: 'MY' };
  if (lat != null && lng != null) body.locationBias = { circle: { center: { latitude: lat, longitude: lng }, radius } };
  const r = await gfetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': PLACE_FIELDS }, body });
  if (!r.ok) return r;
  return { ok: true, places: (r.data.places || []).map(placeView) };
}

// ---------- Geocoding ----------
async function geocode({ q, lang = 'en' }) {
  if (!enabled()) return { ok: false, reason: 'no_key' };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(q)}&region=my&language=${lang}&key=${KEY()}`;
  const r = await gfetch(url);
  if (!r.ok) return r;
  if (r.data.status !== 'OK') return { ok: false, reason: r.data.status, message: r.data.error_message || '' };
  return { ok: true, results: r.data.results.map((g) => ({ name: g.formatted_address.split(',')[0], display: g.formatted_address, lat: g.geometry.location.lat, lng: g.geometry.location.lng, type: (g.types || [])[0] || '' })) };
}
async function reverse({ lat, lng, lang = 'en' }) {
  if (!enabled()) return { ok: false, reason: 'no_key' };
  const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=${lang}&key=${KEY()}`;
  const r = await gfetch(url);
  if (!r.ok) return r;
  if (r.data.status !== 'OK') return { ok: false, reason: r.data.status };
  const g = r.data.results[0];
  const comp = (t) => g.address_components.find((c) => c.types.includes(t))?.long_name;
  const name = comp('premise') || comp('point_of_interest') || comp('establishment') || comp('route') || g.formatted_address.split(',')[0];
  const area = comp('sublocality') || comp('neighborhood') || comp('locality') || '';
  return { ok: true, name: [name, area].filter(Boolean).join(', '), display: g.formatted_address };
}

// ---------- Routes API ----------
const ROUTE_FIELDS = 'routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,routes.legs.steps.navigationInstruction,routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration,routes.legs.steps.startLocation,routes.legs.steps.polyline.encodedPolyline,routes.description';

/** Decode a Google encoded polyline into [{lat,lng}]. */
function decodePolyline(str) {
  const out = []; let index = 0, lat = 0, lng = 0;
  while (index < str.length) {
    let b, shift = 0, result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lat += (result & 1) ? ~(result >> 1) : (result >> 1);
    shift = 0; result = 0;
    do { b = str.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
    lng += (result & 1) ? ~(result >> 1) : (result >> 1);
    out.push({ lat: lat / 1e5, lng: lng / 1e5 });
  }
  return out;
}
const MANEUVER = { TURN_LEFT: 'left', TURN_RIGHT: 'right', TURN_SLIGHT_LEFT: 'slight_left', TURN_SLIGHT_RIGHT: 'slight_right', TURN_SHARP_LEFT: 'sharp_left', TURN_SHARP_RIGHT: 'sharp_right', UTURN_LEFT: 'uturn', UTURN_RIGHT: 'uturn', STRAIGHT: 'straight', DEPART: 'start', NAME_CHANGE: 'straight' };

async function walkRoutes({ from, to, lang = 'en', alternatives = true }) {
  if (!enabled()) return { ok: false, reason: 'no_key' };
  const body = {
    origin: { location: { latLng: { latitude: from.lat, longitude: from.lng } } },
    destination: { location: { latLng: { latitude: to.lat, longitude: to.lng } } },
    travelMode: 'WALK', computeAlternativeRoutes: alternatives, languageCode: lang, units: 'METRIC',
  };
  const r = await gfetch('https://routes.googleapis.com/directions/v2:computeRoutes', { method: 'POST', headers: { 'X-Goog-Api-Key': KEY(), 'X-Goog-FieldMask': ROUTE_FIELDS }, body });
  if (!r.ok) return r;
  const routes = (r.data.routes || []).map((rt) => {
    const coords = decodePolyline(rt.polyline?.encodedPolyline || '');
    const steps = [];
    for (const leg of rt.legs || []) for (const s of leg.steps || []) {
      steps.push({ text: s.navigationInstruction?.instructions || '', maneuver: MANEUVER[s.navigationInstruction?.maneuver] || 'straight', distanceM: s.distanceMeters || 0, durationS: Number(String(s.staticDuration || '0s').replace('s', '')) || 0, lat: s.startLocation?.latLng?.latitude, lng: s.startLocation?.latLng?.longitude });
    }
    steps.push({ text: lang === 'ms' ? 'Anda telah tiba di destinasi' : 'You have arrived at your destination', maneuver: 'arrive', distanceM: 0, durationS: 0, lat: to.lat, lng: to.lng });
    return { coords, distanceM: rt.distanceMeters || 0, durationS: Number(String(rt.duration || '0s').replace('s', '')) || 0, steps, description: rt.description || '', engine: 'google' };
  });
  return { ok: true, routes };
}

module.exports = { enabled, nearby, textSearch, geocode, reverse, walkRoutes, decodePolyline, placeView };
