import { useEffect, useRef, useState } from 'react';

const cache = new Map();

/** GET JSON with a per-session cache; failed requests are not cached. */
export function get(url) {
  if (!cache.has(url)) {
    cache.set(
      url,
      fetch(url)
        .then(async (r) => {
          const body = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(body.error ?? `${r.status} ${r.statusText}`);
          return body;
        })
        .catch((e) => {
          cache.delete(url);
          throw e;
        }),
    );
  }
  return cache.get(url);
}

/** { data, error, loading } for a URL; pass null to skip the request. */
export function useApi(url) {
  const [state, setState] = useState({ url: null, data: null, error: null });
  useEffect(() => {
    if (!url) return;
    let live = true; // ignore responses that arrive after the URL changed
    get(url).then(
      (data) => live && setState({ url, data, error: null }),
      (error) => live && setState({ url, data: null, error }),
    );
    return () => {
      live = false;
    };
  }, [url]);
  if (!url) return { data: null, error: null, loading: false };
  if (state.url !== url) return { data: null, error: null, loading: true }; // never show another ticker's data
  return { data: state.data, error: state.error, loading: false };
}

/** GET JSON from `url` again and again while the browser tab is visible; `secondsFor(lastAnswer)` picks the wait before the next
 * request. Returns { data, error } for this URL: data = the last good answer (kept when a later request fails), error = the
 * last failure's message while there is no good answer yet. Both null until the first answer. */
export function usePoll(url, secondsFor) {
  const [state, setState] = useState({ url: null, data: null, error: null });
  const wait = useRef(secondsFor);
  wait.current = secondsFor;
  useEffect(() => {
    if (!url) return undefined;
    let live = true;
    let timer;
    let last = null;
    let error = null;
    let busy = false; // one request at a time, even if the tab becomes visible while one is running
    const tick = async () => {
      clearTimeout(timer);
      if (document.hidden || busy) return; // resumed by the visibilitychange listener
      busy = true;
      try {
        const r = await fetch(url);
        const body = await r.json().catch(() => ({}));
        if (r.ok) [last, error] = [body, null];
        else error = body.error ?? `${r.status} ${r.statusText}`;
      } catch (e) {
        error = e.message; // network hiccup: keep the last answer and try again later
      }
      busy = false;
      if (!live) return;
      setState({ url, data: last, error: last ? null : error });
      timer = setTimeout(tick, wait.current(last) * 1000);
    };
    const onVisible = () => !document.hidden && tick();
    document.addEventListener('visibilitychange', onVisible);
    tick();
    return () => {
      live = false;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [url]);
  return state.url === url ? state : { data: null, error: null }; // never show another URL's (ticker's) answer
}

/** Seconds between price refreshes: real-time quotes every 15 s, delayed ones every minute, closed markets every 5 minutes. */
function pollSeconds(q) {
  if (!q?.live) return 300;
  return q.delay ? 60 : 15;
}

/** Latest Yahoo price for a symbol (GET /api/quote); null until the first answer or when it fails. */
export function useQuote(symbol) {
  return usePoll(symbol ? `/api/quote/${encodeURIComponent(symbol)}` : null, pollSeconds).data;
}
