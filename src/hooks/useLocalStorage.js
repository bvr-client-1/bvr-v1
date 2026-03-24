import { useEffect, useState } from 'react';

export function useLocalStorage(key, fallback) {
  const [value, setValue] = useState(() => {
    try {
      const stored = window.localStorage.getItem(key);
      return stored ? JSON.parse(stored) : fallback;
    } catch {
      return fallback;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Ignore localStorage failures.
    }
  }, [key, value]);

  return [value, setValue];
}
