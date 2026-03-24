import { useEffect, useRef } from 'react';

export function useInterval(callback, delay) {
  const saved = useRef(callback);

  useEffect(() => {
    saved.current = callback;
  }, [callback]);

  useEffect(() => {
    if (delay === null) {
      return undefined;
    }
    const id = window.setInterval(() => saved.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}
