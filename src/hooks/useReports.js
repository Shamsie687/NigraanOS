import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchReports } from '../services/reports';

export default function useReports(citizenId) {
  const [reports, setReports] = useState([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const request = useRef(0);
  const refresh = useCallback(async (append = false) => {
    const version = ++request.current;
    setLoading(true);
    setError('');
    try {
      const result = await fetchReports({ citizenId, offset: append ? reports.length : 0 });
      if (request.current !== version) return;
      setReports(previous => append ? [...previous, ...result.reports] : result.reports);
      setTotal(result.total);
    } catch (cause) {
      if (request.current === version) {
        setReports(previous => append ? previous : []);
        setError('Unable to load reports: ' + cause.message);
      }
    } finally {
      if (request.current === version) setLoading(false);
    }
  }, [citizenId, reports.length]);
  useEffect(() => {
    refresh();
    return () => { request.current++; };
    // Initial load only. Explicit refresh/load-more actions handle subsequent reads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [citizenId]);
  return { reports, total, loading, error, refresh };
}
