/* API client for the projector, plus the one seam that becomes real later.

   Everything below talks to the daemon's v1 API. The exception is the
   cassette library: `/api/library` does not exist yet, so the client falls
   back to a fixture generated from the real databases by
   app/tools/mock_library.py. One seam, deleted when the library service
   lands. No other mock data lives in this app. */

const j = async (url, opts) => {
  const r = await fetch(url, opts);
  if (!r.ok) throw new Error(`${url} -> ${r.status}`);
  return r.json();
};

export const api = {
  health: () => j('/api/health'),

  search: (q, { n = 8, deep = false, codex = '' } = {}) => j(
    `/api/search?q=${encodeURIComponent(q)}&n=${n}&deep=${deep ? 1 : 0}` +
    (codex ? `&codex=${encodeURIComponent(codex)}` : '')),

  doc: (codex, id) => j(
    `/api/doc?codex=${encodeURIComponent(codex)}&id=${encodeURIComponent(id)}`),

  /* Art is optional by design: a missing art.db degrades to no picture,
     never to an error. */
  art: (codex, id) => j(
    `/api/art?codex=${encodeURIComponent(codex)}&id=${encodeURIComponent(id)}`
  ).catch(() => null),

  browse: (prefix, { n = 200, codex = '' } = {}) => j(
    `/api/browse?prefix=${encodeURIComponent(prefix)}&n=${n}` +
    (codex ? `&codex=${encodeURIComponent(codex)}` : '')),
};

export const library = {
  /* Real endpoint when present, generated fixture otherwise. */
  async load() {
    try {
      const r = await fetch('/api/library');
      if (r.ok) {
        const d = await r.json();
        return { ...d, mock: false };
      }
    } catch (e) { /* daemon older than the library service */ }
    const d = await j('/static/mock/library.json');
    return { ...d, mock: true };
  },
};
