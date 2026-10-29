/* Team performance from the B2C Sales app's figures feed: trainers and
   managers only, matched to people here by their B2C staff id, with focus
   suggestions measured against the new starter plan. A pretend feed stands
   in for the B2C Sales app. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { loadTrainingContent } from '../src/training-content.js';
import { focusReason } from '../src/routes/performance.js';
import { b2cFeed } from '../src/b2c-feed.js';

const FEED = {
  month: '2026-10',
  target1PerDay: 8,
  teamAverage: 7.5,
  teams: [
    {
      half: 'john', trainerStaffId: 900, trainerName: 'Feed Trainer', average: 9,
      people: [
        { staffId: 101, name: 'Feed A', starsPerDay: 10, daysSold: 18, counted: true },
        { staffId: 102, name: 'Feed B', starsPerDay: 6, daysSold: 15, counted: true },
      ],
    },
    {
      half: 'lucy', trainerStaffId: 901, average: 6,
      people: [{ staffId: 103, name: 'Feed C', starsPerDay: 3, daysSold: 4, counted: false, reason: 'inside their first four weeks' }],
    },
  ],
};

test('team performance is for trainers and managers, and matches people by their B2C id', async () => {
  const t = await startApp({ feed: async () => FEED });
  try {
    loadTrainingContent(t.db);
    const exec = t.person('Exec A');
    const trainer = t.person('Trainer A', 'trainer');
    t.db.prepare('UPDATE people SET b2c_staff_id = 101 WHERE id = ?').run(exec.id);
    t.db.prepare('UPDATE people SET b2c_staff_id = 900 WHERE id = ?').run(trainer.id);

    assert.equal((await t.call('/api/performance', { as: exec.token })).status, 403);

    const res = await (await t.call('/api/performance?month=2026-10', { as: trainer.token })).json();
    assert.equal(res.connected, true);
    assert.equal(res.target1PerDay, 8);
    const john = res.teams.find((x) => x.half === 'john');
    assert.equal(john.trainer, 'Trainer A', 'the name here wins');
    assert.equal(john.vsTarget, 113);
    assert.equal(john.people[0].personId, exec.id);
    assert.equal(john.people[0].name, 'Exec A');
    assert.deepEqual(res.focus.map((f) => f.name), ['Feed B'], 'Feed C is inside their first four weeks');
    assert.doesNotMatch(JSON.stringify(res), /reward|prize|money|£/i);
  } finally { await t.close(); }
});

test('without the B2C Sales app link, team performance says so', async () => {
  const t = await startApp();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const res = await (await t.call('/api/performance', { as: trainer.token })).json();
    assert.equal(res.connected, false);
  } finally { await t.close(); }
});

test('if the B2C Sales app is down, the screen gets a clear error', async () => {
  const t = await startApp({ feed: async () => { throw new Error('The B2C Sales app didn’t send the team figures (500).'); } });
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const res = await t.call('/api/performance', { as: trainer.token });
    assert.equal(res.status, 502);
    assert.match((await res.json()).error, /team figures/);
  } finally { await t.close(); }
});

test('focus follows the new starter plan', () => {
  const at = (pace) => ({ starsPerDay: pace });
  assert.equal(focusReason(at(0), { key: 'week-2', title: 'Week 2' }, 8), null, 'not measured on stars yet');
  assert.match(focusReason(at(4), { key: 'week-3', title: 'Week 3' }, 8), /building to 5/);
  assert.equal(focusReason(at(5.5), { key: 'week-3', title: 'Week 3' }, 8), null);
  assert.equal(focusReason(at(7), { key: 'month-2', title: 'Month 2' }, 8), null, 'within 80% of target 1');
  assert.match(focusReason(at(6), { key: 'month-2', title: 'Month 2' }, 8), /aiming close to target 1/);
  assert.match(focusReason(at(7.9), null, 8), /Below target 1/);
  assert.equal(focusReason(at(8), { key: 'month-3', title: 'Month 3' }, 8), null);
});

test('the feed sends the shared key, and keeps figures for a few minutes', async () => {
  const calls = [];
  const fetchImpl = async (url, opts) => {
    calls.push({ url, auth: opts.headers.Authorization });
    return { ok: true, status: 200, json: async () => FEED };
  };
  const feed = b2cFeed({ ready: true, b2cUrl: 'https://b2c.example.test', key: 'k' }, { fetchImpl });
  await feed('2026-10');
  await feed('2026-10');
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://b2c.example.test/api/training-feed/teams?month=2026-10');
  assert.equal(calls[0].auth, 'Bearer k');
  assert.equal(await b2cFeed({ ready: false })('2026-10'), null);
});
