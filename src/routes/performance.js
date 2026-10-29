/**
 * routes/performance.js — team performance, from the B2C Sales app.
 *
 * John's and Lucy's teams side by side: each team's average stars per day,
 * each person's, and target 1 as a daily pace, read through the figures feed
 * (src/b2c-feed.js). Never any pay: the feed has none to give.
 *
 * "Focus" suggests who might need John or Lucy's time, measured against what
 * the new starter plan expects at their stage:
 *   - week 3: building to 5 stars a day, so under 5 is flagged;
 *   - week 4 and month 2: approaching target 1, so under 80% of it is flagged;
 *   - month 3 on, or anyone not on the plan: under target 1 is flagged.
 * Days 1 to 10 aren't measured on stars at all.
 *
 * Trainers and managers only, like the B2C Sales app's own "The two teams".
 */

import express from 'express';
import { requireTrainer } from '../auth.js';
import { workingDay, stageFor, ukToday } from '../plan.js';

export const NEAR_TARGET = 0.8;

export function performanceRoutes(db, { feed }) {
  const router = express.Router();
  router.use(requireTrainer);

  router.get('/', async (req, res) => {
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : ukToday().slice(0, 7);
    let data;
    try {
      data = await feed(month);
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    if (!data) return res.json({ month, connected: false });
    if (data.notOut) return res.json({ month, connected: true, notOut: true, teams: [], focus: [] });

    const stages = db.prepare('SELECT * FROM plan_stages ORDER BY from_day, position').all();
    const byStaff = new Map(db.prepare('SELECT * FROM people WHERE b2c_staff_id IS NOT NULL').all().map((p) => [p.b2c_staff_id, p]));
    const target = data.target1PerDay;
    const focus = [];

    const teams = (data.teams || []).map((t) => {
      const trainer = byStaff.get(t.trainerStaffId);
      const people = (t.people || []).map((p) => {
        const person = byStaff.get(p.staffId);
        const stage = person?.start_date ? stageFor(stages, workingDay(person.start_date)) : null;
        const row = {
          personId: person?.id ?? null,
          name: person?.name ?? p.name ?? 'Not signed in here yet',
          starsPerDay: p.starsPerDay,
          daysSold: p.daysSold,
          counted: p.counted,
          countsFrom: p.countsFrom ?? null,
          reason: p.reason ?? null,
          stage: stage?.title ?? null,
          vsTarget: target && p.starsPerDay != null ? Math.round((p.starsPerDay / target) * 100) : null,
        };
        const why = focusReason(row, stage, target);
        if (why) focus.push({ personId: row.personId, name: row.name, team: t.half, reason: why });
        return row;
      }).sort((a, b) => (b.starsPerDay ?? -1) - (a.starsPerDay ?? -1));

      return {
        half: t.half,
        trainer: trainer?.name ?? t.trainerName ?? null,
        average: t.average,
        vsTarget: target && t.average != null ? Math.round((t.average / target) * 100) : null,
        people,
      };
    });

    res.json({ month, connected: true, target1PerDay: target, teamAverage: data.teamAverage ?? null, teams, focus });
  });

  return router;
}

const fmt = (n) => (Math.round(n * 100) / 100).toString();

export function focusReason(row, stage, target) {
  const pace = row.starsPerDay;
  if (pace == null || !target) return null;
  /* Not counted yet (inside their first four weeks) and not on the plan here: too early to judge. */
  if (!stage && row.counted === false) return null;
  const key = stage?.key;
  if (key && ['day-1', 'day-2', 'day-3', 'days-4-5', 'week-2'].includes(key)) return null;
  if (key === 'week-3') return pace < 5 ? `Week 3: ${fmt(pace)} stars a day, building to 5` : null;
  if (key === 'week-4' || key === 'month-2') {
    return pace < target * NEAR_TARGET ? `${stage.title}: ${fmt(pace)} stars a day, aiming close to target 1 (${fmt(target)})` : null;
  }
  return pace < target ? `Below target 1: ${fmt(pace)} stars a day against ${fmt(target)}` : null;
}
