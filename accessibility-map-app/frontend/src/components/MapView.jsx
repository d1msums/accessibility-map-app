import { useCallback, useEffect, useState } from 'react';
import { GoogleMap, useJsApiLoader, Marker, DirectionsRenderer, Rectangle, Polyline } from '@react-google-maps/api';
import { useDirections, TRAVEL_MODES } from '../hooks/useDirections';
import { useOverpassData } from '../hooks/useOverpassData';
import { scoreFromOSMTags, colorForScore } from '../utils/overpass';

// APU Bukit Jalil area — change this to your demo corridor
const DEFAULT_CENTER = { lat: 3.058, lng: 101.691 };

const MAP_CONTAINER_STYLE = {
  width: '100%',
  height: '100vh',
};

const MAP_OPTIONS = {
  disableDefaultUI: false,
  zoomControl: true,
  mapTypeId: 'roadmap',
};

const SELECTED_ROUTE_COLOR = '#1a73e8';
const ALT_ROUTE_COLOR = '#9aa0a6';

export default function MapView() {
  const [map, setMap] = useState(null);

  const { isLoaded } = useJsApiLoader({
    id: 'google-map-script',
    googleMapsApiKey: import.meta.env.VITE_GOOGLE_MAPS_API_KEY,
  });

  const {
    origin,
    destination,
    travelMode,
    result,
    routes,
    selectedRouteIndex,
    setSelectedRouteIndex,
    loading,
    error,
    setPoint,
    changeTravelMode,
    reset,
  } = useDirections();

  const {
    bbox,
    elements: osmElements,
    loading: osmLoading,
    error: osmError,
    loadForPath,
    clear: clearOverpass,
  } = useOverpassData();

  const onLoad = useCallback((mapInstance) => {
    setMap(mapInstance);
  }, []);

  const onUnmount = useCallback(() => {
    setMap(null);
  }, []);

  const onMapClick = useCallback(
    (e) => {
      setPoint({ lat: e.latLng.lat(), lng: e.latLng.lng() });
    },
    [setPoint]
  );

  // Fit the map to every alternative's combined bounds once a result comes
  // back, instead of re-fitting on every route selection change.
  useEffect(() => {
    if (!result || !map || !window.google) return;
    const bounds = new window.google.maps.LatLngBounds();
    result.routes.forEach((route) => bounds.union(route.bounds));
    map.fitBounds(bounds);
  }, [result, map]);

  // A new directions result invalidates any OSM overlay drawn for a
  // previous route/bbox — don't leave stale data on the map.
  useEffect(() => {
    clearOverpass();
  }, [result, clearOverpass]);

  const onShowOSMData = useCallback(() => {
    const selectedRoute = routes[selectedRouteIndex];
    if (!selectedRoute) return;
    const path = selectedRoute.overview_path.map((p) => ({ lat: p.lat(), lng: p.lng() }));
    loadForPath(path);
  }, [routes, selectedRouteIndex, loadForPath]);

  if (!isLoaded) {
    return (
      <div style={{
        width: '100%',
        height: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: '#f0f0f0',
        fontFamily: 'sans-serif'
      }}>
        Loading map…
      </div>
    );
  }

  return (
    <div style={{ position: 'relative', width: '100%', height: '100vh' }}>
      <GoogleMap
        mapContainerStyle={MAP_CONTAINER_STYLE}
        center={DEFAULT_CENTER}
        zoom={17}
        onLoad={onLoad}
        onUnmount={onUnmount}
        onClick={onMapClick}
        options={MAP_OPTIONS}
      >
        {!result && origin && <Marker position={origin} label="A" />}
        {!result && destination && <Marker position={destination} label="B" />}

        {routes.map((_, i) => (
          <DirectionsRenderer
            key={i}
            directions={result}
            routeIndex={i}
            options={{
              preserveViewport: true,
              suppressMarkers: i !== selectedRouteIndex,
              polylineOptions: {
                strokeColor: i === selectedRouteIndex ? SELECTED_ROUTE_COLOR : ALT_ROUTE_COLOR,
                strokeWeight: i === selectedRouteIndex ? 6 : 4,
                strokeOpacity: i === selectedRouteIndex ? 0.9 : 0.5,
                zIndex: i === selectedRouteIndex ? 2 : 1,
              },
            }}
            onClick={() => setSelectedRouteIndex(i)}
          />
        ))}

        {bbox && (
          <Rectangle
            bounds={{ north: bbox.maxLat, south: bbox.minLat, east: bbox.maxLng, west: bbox.minLng }}
            options={{
              fillColor: '#673ab7',
              fillOpacity: 0.05,
              strokeColor: '#673ab7',
              strokeWeight: 1,
              clickable: false,
            }}
          />
        )}

        {osmElements
          .filter((el) => el.type === 'way' && el.geometry)
          .map((way) => {
            const scored = scoreFromOSMTags(way.tags, way.timestamp);
            return (
              <Polyline
                key={`way-${way.id}`}
                path={way.geometry.map((p) => ({ lat: p.lat, lng: p.lon }))}
                options={{
                  strokeColor: colorForScore(scored.score),
                  strokeWeight: 4,
                  strokeOpacity: 0.85,
                  zIndex: 3,
                }}
              />
            );
          })}

        {osmElements
          .filter((el) => el.type === 'node' && typeof el.lat === 'number')
          .map((node) => {
            const scored = scoreFromOSMTags(node.tags, node.timestamp);
            return (
              <Marker
                key={`node-${node.id}`}
                position={{ lat: node.lat, lng: node.lon }}
                title={Object.entries(node.tags || {}).map(([k, v]) => `${k}=${v}`).join(', ')}
                icon={{
                  path: window.google.maps.SymbolPath.CIRCLE,
                  scale: 5,
                  fillColor: colorForScore(scored.score),
                  fillOpacity: 1,
                  strokeColor: '#fff',
                  strokeWeight: 1,
                }}
                zIndex={4}
              />
            );
          })}
      </GoogleMap>

      <div
        style={{
          position: 'absolute',
          top: 12,
          left: 12,
          background: 'white',
          borderRadius: 8,
          boxShadow: '0 1px 6px rgba(0,0,0,0.3)',
          padding: 12,
          width: 280,
          fontFamily: 'sans-serif',
          fontSize: 14,
          maxHeight: 'calc(100vh - 24px)',
          overflowY: 'auto',
        }}
      >
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {TRAVEL_MODES.map((mode) => (
            <button
              key={mode}
              onClick={() => changeTravelMode(mode)}
              style={{
                flex: 1,
                padding: '6px 8px',
                borderRadius: 6,
                border: '1px solid #ccc',
                background: travelMode === mode ? SELECTED_ROUTE_COLOR : 'white',
                color: travelMode === mode ? 'white' : '#333',
                cursor: 'pointer',
              }}
            >
              {mode === 'WALKING' ? '🚶 Walk' : '🚌 Transit'}
            </button>
          ))}
        </div>

        {!origin && <p>Click the map to set your start point.</p>}
        {origin && !destination && <p>Now click to set your destination.</p>}

        {loading && <p>Finding routes…</p>}
        {error && <p style={{ color: '#c5221f' }}>{error}</p>}

        {routes.length > 0 && (
          <div>
            {routes.map((route, i) => {
              const leg = route.legs[0];
              return (
                <button
                  key={i}
                  onClick={() => setSelectedRouteIndex(i)}
                  style={{
                    display: 'block',
                    width: '100%',
                    textAlign: 'left',
                    padding: 8,
                    marginBottom: 6,
                    borderRadius: 6,
                    border: i === selectedRouteIndex ? `2px solid ${SELECTED_ROUTE_COLOR}` : '1px solid #ddd',
                    background: i === selectedRouteIndex ? '#eaf1fe' : 'white',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ fontWeight: 600 }}>
                    {route.summary || `Route ${i + 1}`}
                  </div>
                  <div>{leg.duration?.text} · {leg.distance?.text}</div>
                </button>
              );
            })}

            <button
              onClick={onShowOSMData}
              disabled={osmLoading}
              style={{
                width: '100%',
                padding: '6px 8px',
                marginBottom: 6,
                borderRadius: 6,
                border: '1px solid #673ab7',
                background: osmLoading ? '#eee' : 'white',
                color: '#673ab7',
                cursor: osmLoading ? 'default' : 'pointer',
              }}
            >
              {osmLoading ? 'Querying Overpass…' : '🗺️ Show OSM data around route'}
            </button>

            {osmError && <p style={{ color: '#c5221f' }}>{osmError}</p>}

            {osmElements.length > 0 && (
              <div style={{ fontSize: 12, color: '#555' }}>
                {osmElements.length} OSM features found in the bbox.
                <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                  <span><span style={{ color: '#1e8e3e' }}>●</span> good</span>
                  <span><span style={{ color: '#f9ab00' }}>●</span> moderate</span>
                  <span><span style={{ color: '#d93025' }}>●</span> poor</span>
                  <span><span style={{ color: '#9aa0a6' }}>●</span> no signal</span>
                </div>
              </div>
            )}
          </div>
        )}

        {(origin || destination) && (
          <button
            onClick={reset}
            style={{
              width: '100%',
              marginTop: 4,
              padding: '6px 8px',
              borderRadius: 6,
              border: '1px solid #ccc',
              background: 'white',
              cursor: 'pointer',
            }}
          >
            Clear route
          </button>
        )}
      </div>
    </div>
  );
}
