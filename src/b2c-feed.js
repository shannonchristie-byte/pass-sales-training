/**
 * b2c-feed.js — team figures from the B2C Sales app.
 *
 * Reads GET /api/training-feed/teams?month=YYYY-MM with the shared key: each
 * sales executive's stars per day sold, each team's average and target 1 as a
 * daily pace. No pay ever comes across (the B2C Sales app builds that answer
 * field by field), and nothing here is stored: it's read when a screen needs
 * it and kept in memory for a few minutes so the Team screen stays quick.
 */

const CACHE_MS = 5 * 60 * 1000;

export function b2cFeed(config, { fetchImpl = fetch } = {}) {
  const cache = new Map();

  return async function teams(month) {
    if (!config.ready) return null;
    const hit = cache.get(month);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.data;

    const res = await fetchImpl(`${config.b2cUrl}/api/training-feed/teams?month=${encodeURIComponent(month)}`, {
      headers: { Authorization: `Bearer ${config.key}` },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return { month, notOut: true, teams: [] };
    if (!res.ok) throw new Error(`The B2C Sales app didn't send the team figures (${res.status}).`);
    const data = await res.json();
    cache.set(month, { at: Date.now(), data });
    return data;
  };
}
