import { useCallback, useState } from 'react';

// Walking or public transit only — this app is about pedestrian/transit
// accessibility, driving/cycling directions aren't in scope.
export const TRAVEL_MODES = ['WALKING', 'TRANSIT'];

export function useDirections() {
  const [origin, setOrigin] = useState(null);
  const [destination, setDestination] = useState(null);
  const [travelMode, setTravelMode] = useState('WALKING');
  const [result, setResult] = useState(null);
  const [selectedRouteIndex, setSelectedRouteIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchDirections = useCallback((from, to, mode) => {
    if (!from || !to || !window.google) return;

    setLoading(true);
    setError(null);

    const service = new window.google.maps.DirectionsService();
    service.route(
      {
        origin: from,
        destination: to,
        travelMode: window.google.maps.TravelMode[mode],
        provideRouteAlternatives: true,
      },
      (response, status) => {
        setLoading(false);
        if (status === 'OK' && response) {
          setResult(response);
          setSelectedRouteIndex(0);
        } else {
          // Transit coverage is patchy outside major cities with GTFS feeds
          // in Google's system — surface that distinctly from a hard error.
          setResult(null);
          setError(
            status === 'ZERO_RESULTS'
              ? `No ${mode.toLowerCase()} route found between these points.`
              : `Directions request failed: ${status}`
          );
        }
      }
    );
  }, []);

  const reset = useCallback(() => {
    setOrigin(null);
    setDestination(null);
    setResult(null);
    setSelectedRouteIndex(0);
    setError(null);
  }, []);

  const setPoint = useCallback(
    (latLng) => {
      if (!origin) {
        setOrigin(latLng);
        return;
      }
      if (!destination) {
        setDestination(latLng);
        fetchDirections(origin, latLng, travelMode);
        return;
      }
      // Both already set — a further click starts a new trip.
      setOrigin(latLng);
      setDestination(null);
      setResult(null);
      setSelectedRouteIndex(0);
      setError(null);
    },
    [origin, destination, travelMode, fetchDirections]
  );

  const changeTravelMode = useCallback(
    (mode) => {
      setTravelMode(mode);
      if (origin && destination) {
        fetchDirections(origin, destination, mode);
      }
    },
    [origin, destination, fetchDirections]
  );

  return {
    origin,
    destination,
    travelMode,
    result,
    routes: result?.routes ?? [],
    selectedRouteIndex,
    setSelectedRouteIndex,
    loading,
    error,
    setPoint,
    changeTravelMode,
    reset,
  };
}
