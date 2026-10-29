/**
 * plan.js — where somebody is on the new starter plan.
 *
 * The plan is Shannon's (28 Oct 2026): day 1 to month 3, each stage starting
 * on a working day. Working days are Monday to Friday counted from the
 * person's start date, which is also how the B2C Sales app counts a new
 * starter's 21st working day for the team averages. Bank holidays aren't
 * taken off: the team works them.
 */

/** Today's date in the UK, as YYYY-MM-DD. */
export function ukToday(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export const isIsoDate = (s) => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));

/**
 * Which working day `today` is for somebody who started on `start`: 1 on
 * their first day, 0 before it. A weekend counts as the working day before.
 */
export function workingDay(start, today = ukToday()) {
  if (!isIsoDate(start)) return null;
  const from = new Date(`${start}T00:00:00Z`);
  const to = new Date(`${today}T00:00:00Z`);
  if (to < from) return 0;
  let n = 0;
  for (const d = new Date(from); d <= to; d.setUTCDate(d.getUTCDate() + 1)) {
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) n++;
  }
  return n;
}

/** The stage somebody is on, given the stages in order. Null before day 1. */
export function stageFor(stages, day) {
  if (day == null || day < 1) return null;
  let current = null;
  for (const s of stages) if (s.from_day <= day) current = s;
  return current;
}
