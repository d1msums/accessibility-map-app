/* KBMapEngine — one small map API over two engines:
 *   • Google Maps JavaScript API (real, full-detail map; key from /api/config)
 *   • Leaflet + OpenStreetMap tiles (automatic fallback when the key is missing / blocked / offline)
 *
 * API (identical for both engines):
 *   const eng = await KBMapEngine.create(el, { center, zoom, onClick(ll), onContextMenu(ll) })
 *   eng.kind                       'google' | 'leaflet'
 *   eng.setView(ll, zoom) / eng.flyTo(ll, zoom) / eng.panTo(ll) / eng.getZoom() / eng.getCenter()
 *   eng.fitBounds(points, { padding })
 *   const m = eng.marker(ll, { html, size:[w,h], anchor:[x,y], z, onClick, interactive })  → { setLatLng, setHtml, remove, el }
 *   const p = eng.polyline(points, { color, weight, opacity, dashed, onClick })            → { remove, setStyle }
 *   eng.clear(group)  — groups: eng.group() returns { add(obj), clear() }
 *   eng.invalidate()
 */
window.KBMapEngine = (() => {
  let googleLoading = null;

  function loadGoogle(key) {
    if (window.google && window.google.maps) return Promise.resolve(true);
    if (googleLoading) return googleLoading;
    googleLoading = new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 9000);
      window.__kbGmapsReady = () => { clearTimeout(timer); resolve(true); };
      window.gm_authFailure = () => { clearTimeout(timer); window.__kbGmapsAuthFailed = true; resolve(false); };
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&libraries=marker,geometry&loading=async&callback=__kbGmapsReady&language=${document.documentElement.lang || 'en'}&region=MY`;
      s.async = true; s.onerror = () => { clearTimeout(timer); resolve(false); };
      document.head.appendChild(s);
    });
    return googleLoading;
  }

  // Calm map style: keep every real detail (roads, buildings, POIs, transit) but tone
  // colours down so the black/white UI and the pins stay readable.
  const GOOGLE_STYLE = [
    { elementType: 'geometry', stylers: [{ saturation: -35 }, { lightness: 8 }] },
    { elementType: 'labels.text.fill', stylers: [{ color: '#3d3d3d' }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: '#ffffff' }] },
    { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#cfdbe6' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#d9e6d3' }] },
    { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#ffffff' }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: '#dcdcdc' }] },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: '#f7f2e8' }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#f2e6cc' }] },
    { featureType: 'transit.line', stylers: [{ saturation: -20 }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'on' }] },
  ];

  // ---------- Google engine ----------
  class GoogleHtmlMarker {
    constructor(map, ll, opts) {
      this.opts = opts; this.map = map;
      const G = google.maps;
      const self = this;
      const Ov = class extends G.OverlayView {
        onAdd() {
          const el = document.createElement('div');
          el.style.position = 'absolute'; el.style.cursor = opts.interactive === false ? 'default' : 'pointer';
          el.style.pointerEvents = opts.interactive === false ? 'none' : 'auto';
          el.style.zIndex = String(opts.z || 100);
          el.innerHTML = opts.html;
          if (opts.onClick) { el.addEventListener('click', (e) => { e.stopPropagation(); opts.onClick(e); }); G.OverlayView.preventMapHitsAndGesturesFrom(el); }
          self.el = el;
          this.getPanes().overlayMouseTarget.appendChild(el);
        }
        draw() {
          if (!self.el) return;
          const p = this.getProjection().fromLatLngToDivPixel(new G.LatLng(self.ll.lat, self.ll.lng));
          if (!p) return;
          const [ax, ay] = opts.anchor || [(opts.size || [30, 30])[0] / 2, (opts.size || [30, 30])[1] / 2];
          self.el.style.left = `${p.x - ax}px`; self.el.style.top = `${p.y - ay}px`;
        }
        onRemove() { if (self.el && self.el.parentNode) self.el.parentNode.removeChild(self.el); self.el = null; }
      };
      this.ll = { lat: ll.lat, lng: ll.lng };
      this.ov = new Ov(); this.ov.setMap(map);
    }
    setLatLng(ll) { this.ll = { lat: ll.lat, lng: ll.lng }; this.ov.draw(); }
    setHtml(html) { this.opts.html = html; if (this.el) this.el.innerHTML = html; }
    remove() { this.ov.setMap(null); }
  }

  function googleEngine(el, opts) {
    const G = google.maps;
    const map = new G.Map(el, {
      center: opts.center, zoom: opts.zoom || 16, disableDefaultUI: true, zoomControl: true, zoomControlOptions: { position: G.ControlPosition.LEFT_BOTTOM },
      clickableIcons: false, gestureHandling: 'greedy', styles: GOOGLE_STYLE, backgroundColor: '#eeeeee', mapTypeControl: false, fullscreenControl: false, streetViewControl: false,
    });
    if (opts.onClick) map.addListener('click', (e) => opts.onClick({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
    if (opts.onContextMenu) map.addListener('rightclick', (e) => opts.onContextMenu({ lat: e.latLng.lat(), lng: e.latLng.lng() }));
    const eng = {
      kind: 'google', raw: map,
      setView: (ll, z) => { map.setCenter(ll); if (z) map.setZoom(z); },
      flyTo: (ll, z) => { map.panTo(ll); if (z && z !== map.getZoom()) map.setZoom(z); },
      panTo: (ll) => map.panTo(ll),
      getZoom: () => map.getZoom(), getCenter: () => { const c = map.getCenter(); return { lat: c.lat(), lng: c.lng() }; },
      fitBounds: (pts, { padding = 40, paddingRight = 0, paddingBottom = 0 } = {}) => { const b = new G.LatLngBounds(); pts.forEach((p) => b.extend(p)); map.fitBounds(b, { top: padding, left: padding, right: padding + paddingRight, bottom: padding + paddingBottom }); },
      marker: (ll, o) => new GoogleHtmlMarker(map, ll, o),
      polyline: (pts, o = {}) => {
        const line = new G.Polyline({ path: pts, map, strokeColor: o.color || '#111', strokeWeight: o.weight || 5, strokeOpacity: o.dashed ? 0 : (o.opacity ?? 1), zIndex: o.z || 1, clickable: !!o.onClick,
          icons: o.dashed ? [{ icon: { path: 'M 0,-1 0,1', strokeOpacity: o.opacity ?? 1, strokeWeight: o.weight || 5, scale: 1 }, offset: '0', repeat: '14px' }] : null });
        if (o.onClick) line.addListener('click', o.onClick);
        return { remove: () => line.setMap(null), setStyle: (s) => line.setOptions({ strokeColor: s.color, strokeWeight: s.weight, strokeOpacity: s.opacity }) };
      },
      invalidate: () => G.event.trigger(map, 'resize'),
      setHeading: () => {},
    };
    return eng;
  }

  // ---------- Leaflet engine ----------
  function leafletEngine(el, opts) {
    const map = L.map(el, { zoomControl: false, attributionControl: true }).setView([opts.center.lat, opts.center.lng], opts.zoom || 16);
    L.control.zoom({ position: 'bottomleft' }).addTo(map);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors' }).addTo(map);
    if (opts.onClick) map.on('click', (e) => opts.onClick({ lat: e.latlng.lat, lng: e.latlng.lng }));
    if (opts.onContextMenu) map.on('contextmenu', (e) => opts.onContextMenu({ lat: e.latlng.lat, lng: e.latlng.lng }));
    return {
      kind: 'leaflet', raw: map,
      setView: (ll, z) => map.setView([ll.lat, ll.lng], z || map.getZoom()),
      flyTo: (ll, z) => map.flyTo([ll.lat, ll.lng], z || map.getZoom()),
      panTo: (ll) => map.panTo([ll.lat, ll.lng], { animate: true }),
      getZoom: () => map.getZoom(), getCenter: () => { const c = map.getCenter(); return { lat: c.lat, lng: c.lng }; },
      fitBounds: (pts, { padding = 40, paddingRight = 0, paddingBottom = 0 } = {}) => map.fitBounds(L.latLngBounds(pts.map((p) => [p.lat, p.lng])), { paddingTopLeft: [padding, padding], paddingBottomRight: [padding + paddingRight, padding + paddingBottom] }),
      marker: (ll, o) => {
        const size = o.size || [30, 30];
        const m = L.marker([ll.lat, ll.lng], { icon: L.divIcon({ className: '', html: o.html, iconSize: size, iconAnchor: o.anchor || [size[0] / 2, size[1] / 2] }), zIndexOffset: o.z || 0, interactive: o.interactive !== false, riseOnHover: true }).addTo(map);
        if (o.onClick) m.on('click', o.onClick);
        return { setLatLng: (p) => m.setLatLng([p.lat, p.lng]), setHtml: (html) => m.setIcon(L.divIcon({ className: '', html, iconSize: size, iconAnchor: o.anchor || [size[0] / 2, size[1] / 2] })), remove: () => map.removeLayer(m), get el() { return m.getElement(); } };
      },
      polyline: (pts, o = {}) => {
        const line = L.polyline(pts.map((p) => [p.lat, p.lng]), { color: o.color || '#111', weight: o.weight || 5, opacity: o.opacity ?? 1, dashArray: o.dashed ? '6 10' : null, lineCap: 'round' }).addTo(map);
        if (o.onClick) line.on('click', o.onClick);
        return { remove: () => map.removeLayer(line), setStyle: (s) => line.setStyle(s) };
      },
      invalidate: () => map.invalidateSize(),
      setHeading: () => {},
    };
  }

  async function create(el, opts = {}) {
    let key = null;
    try { key = (await (await fetch('/api/config')).json()).googleMapsKey; } catch { /* offline */ }
    const wantGoogle = key && !window.__kbGmapsAuthFailed && localStorage.getItem('kb.mapEngine') !== 'osm';
    if (wantGoogle && await loadGoogle(key)) {
      try { return googleEngine(el, opts); } catch (err) { console.warn('Google Maps failed, falling back to OSM:', err); }
    }
    return leafletEngine(el, opts);
  }

  const group = () => { const items = []; return { add: (o) => { items.push(o); return o; }, clear: () => { items.splice(0).forEach((o) => o.remove()); } }; };

  return { create, group };
})();
