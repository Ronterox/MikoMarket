import { useEffect, useState } from 'react';

/** Live media-query match (layout switches between mobile / tablet / desktop). */
export function useMedia(query: string): boolean {
  const get = () => { try { return window.matchMedia(query).matches; } catch { return false; } };
  const [match, setMatch] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(query); } catch { return; }
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [query]);
  return match;
}

export const DESKTOP = '(min-width: 1024px)';
