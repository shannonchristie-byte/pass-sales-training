/* Bringing the team in from the B2C Sales app, the new starter plan switch,
   and the date somebody finished their training on each service. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { loadTrainingContent } from '../src/training-content.js';
import { personFromB2C } from '../src/auth.js';

const FEED = {
  month: '2026-10',
  target1PerDay: 8,
  teams: [
    {
      half: 'john', trainerStaffId: 900, trainerName: 'Feed Trainer',
      people: [
        { staffId: 101, name: 'Feed Established', starsPerDay: 9, counted: true },
        { staffId: 102, name: 'Feed Starter', starsPerDay: 3, counted: false, reason: 'inside their first four weeks' },
      ],
    },
    { half: 'lucy', trainerStaffId: 901, trainerName: 'Feed Trainer Two', people: [{ staffId: 103, name: 'Feed Other', starsPerDay: 7, counted: true }] },
  ],
};

test('managers bring the team in; the established are off the plan and new starters on it', async () => {
  const t = await startApp({ feed: async () => FEED });
  try {
    loadTrainingContent(t.db);
    const mgr = t.person('Manager A', 'manager');
    const exec = t.person('Exec A');
    assert.equal((await t.call('/api/people/import-from-b2c', { as: exec.token, method: 'POST' })).status, 403);

    let res = await t.call('/api/people/import-from-b2c', { as: mgr.token, method: 'POST' });
    assert.equal((await res.json()).added, 5);
    res = await t.call('/api/people/import-from-b2c', { as: mgr.token, method: 'POST' });
    assert.equal((await res.json()).added, 0, 'nobody is added twice');

    const row = (id) => t.db.prepare('SELECT * FROM people WHERE b2c_staff_id = ?').get(id);
    assert.equal(row(101).on_plan, 0);
    assert.equal(row(102).on_plan, 1, 'still inside their first four weeks');
    assert.equal(row(900).role, 'trainer');
    assert.match(row(101).email, /not-signed-in\.invalid$/);

    const { people } = await (await t.call('/api/people', { as: mgr.token })).json();
    assert.equal(people.find((p) => p.b2c_staff_id === 101).signedIn, false);

    const team = await (await t.call('/api/training/team', { as: mgr.token })).json();
    assert.ok(team.people.some((p) => p.name === 'Feed Established'), 'on the team before signing in');

    /* Their first sign-in finds the same record. */
    const { person } = personFromB2C(t.db, { staffId: 101, email: 'real@example.test', name: 'Feed Established', role: 'staff', scheme: 'exec', status: 'active' });
    assert.equal(person.id, row(101).id);
    assert.equal(person.email, 'real@example.test');
    assert.equal(person.on_plan, 0, 'still off the plan');
  } finally { await t.close(); }
});

test('off the plan, there is no stage and no plan reasons to look', async () => {
  const t = await startApp();
  try {
    loadTrainingContent(t.db);
    const mgr = t.person('Manager A', 'manager');
    const exec = t.person('Exec A');
    t.db.prepare("UPDATE people SET start_date = '2026-01-05' WHERE id = ?").run(exec.id);

    let rec = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(rec.person.on_plan, true, 'new people start on the plan');
    assert.ok(rec.stage);

    assert.equal((await t.call(`/api/people/${exec.id}/plan`, { as: mgr.token, method: 'PUT', body: { on: false } })).status, 200);
    rec = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(rec.person.on_plan, false);
    assert.equal(rec.stage, null);
    const team = await (await t.call('/api/training/team', { as: mgr.token })).json();
    assert.deepEqual(team.people.find((p) => p.id === exec.id).needsLook, []);
    assert.equal((await t.call(`/api/people/${exec.id}/plan`, { as: exec.token, method: 'PUT', body: { on: true } })).status, 403);
  } finally { await t.close(); }
});

test('trainers record when somebody finished training on a service', async () => {
  const t = await startApp();
  try {
    loadTrainingContent(t.db);
    const trainer = t.person('Trainer A', 'trainer');
    const exec = t.person('Exec A');
    const path = `/api/training/person/${exec.id}/services/astar/trained`;

    assert.equal((await t.call(path, { as: exec.token, method: 'PUT', body: { date: '2026-03-12' } })).status, 403);
    assert.equal((await t.call(path, { as: trainer.token, method: 'PUT', body: { date: 'March' } })).status, 400);

    const rec = await (await t.call(path, { as: trainer.token, method: 'PUT', body: { date: '2026-03-12' } })).json();
    const astar = rec.services.find((s) => s.key === 'astar');
    assert.equal(astar.on, true, 'recording training switches the service on');
    assert.equal(astar.trained_on, '2026-03-12');

    const tracker = await (await t.call('/api/coaching/tracker', { as: trainer.token })).json();
    assert.equal(tracker.people.find((p) => p.id === exec.id).services.find((s) => s.key === 'astar').trainedOn, '2026-03-12');

    await t.call(path, { as: trainer.token, method: 'PUT', body: { date: null } });
    assert.equal(t.db.prepare("SELECT trained_on FROM person_services WHERE person_id = ? AND service = 'astar'").get(exec.id).trained_on, null);
  } finally { await t.close(); }
});
