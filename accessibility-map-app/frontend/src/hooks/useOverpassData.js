import { useCallback, useState } from 'react';
import { bboxFromPath, fetchOverpassData } from '../utils/overpass';

export function useOverpassData() {
  const [bbox, setBbox] = useState(null);
  const [elements, setElements] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const loadForPath = useCallback(async (path) => {
    const box = bboxFromPath(path);
    if (!box) return;

    setBbox(box);
    setLoading(true);
    setError(null);
    setElements([]);

    try {
      const els = await fetchOverpassData(box);
      setElements(els);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Overpass query failed');
    } finally {
      setLoading(false);
    }
  }, []);

  const clear = useCallback(() => {
    setBbox(null);
    setElements([]);
    setError(null);
  }, []);

  return { bbox, elements, loading, error, loadForPath, clear };
}
