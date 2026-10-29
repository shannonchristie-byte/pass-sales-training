/* Session feedback, help requests, the tracker, and managers' own notes.
   The private note never reaches the person; manager notes never reach
   trainers; everyone only raises and sees their own help requests. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { loadNewPages } from '../src/content.js';
import { loadTrainingContent } from '../src/training-content.js';
import { needsLook } from '../src/progress.js';

async function withTraining() {
  const t = await startApp();
  loadNewPages(t.db);
  loadTrainingContent(t.db);
  return t;
}

const SESSION = { session_date: '2026-10-28', kind: 'Call listening', service: 'pfs', shared_note: 'Great rapport. Next: ask the deadline earlier.', private_note: 'Rushed the close twice.' };

test('the private note never reaches the person, and nobody else’s sessions do either', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const other = t.person('Exec B');
    const trainer = t.person('Trainer A', 'trainer');
    const mgr = t.person('Manager A', 'manager');

    let res = await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: trainer.token, method: 'POST', body: SESSION });
    assert.equal(res.status, 201);

    const own = await (await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: exec.token })).json();
    assert.equal(own.sessions.length, 1);
    assert.equal(own.sessions[0].shared_note, SESSION.shared_note);
    assert.ok(!('private_note' in own.sessions[0]));
    assert.doesNotMatch(JSON.stringify(own), /Rushed the close/);

    assert.equal((await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: other.token })).status, 403);

    for (const who of [trainer, mgr]) {
      const all = await (await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: who.token })).json();
      assert.equal(all.sessions[0].private_note, SESSION.private_note, 'trainers and managers read every private note');
      assert.equal(all.sessions[0].trainer_name, 'Trainer A');
    }
  } finally { await t.close(); }
});

test('only trainers and managers write feedback; the person says they have read it', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const trainer = t.person('Trainer A', 'trainer');
    assert.equal((await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: exec.token, method: 'POST', body: SESSION })).status, 403);

    assert.equal((await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: trainer.token, method: 'POST', body: { ...SESSION, kind: 'Karaoke' } })).status, 400);
    assert.equal((await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: trainer.token, method: 'POST', body: { ...SESSION, session_date: 'Tuesday' } })).status, 400);
    assert.equal((await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: trainer.token, method: 'POST', body: { ...SESSION, trainer_id: exec.id } })).status, 400, 'a session is with a trainer or manager');

    const { id } = await (await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: trainer.token, method: 'POST', body: SESSION })).json();
    assert.equal((await t.call(`/api/coaching/sessions/${id}`, { as: exec.token, method: 'PUT', body: { shared_note: 'x' } })).status, 403);

    assert.equal((await t.call(`/api/coaching/sessions/${id}/acknowledge`, { as: trainer.token, method: 'POST' })).status, 404, 'only the person acknowledges');
    assert.equal((await t.call(`/api/coaching/sessions/${id}/acknowledge`, { as: exec.token, method: 'POST' })).status, 200);
    assert.ok(t.db.prepare('SELECT acknowledged_at FROM sessions_log WHERE id = ?').get(id).acknowledged_at);

    await t.call(`/api/coaching/sessions/${id}`, { as: trainer.token, method: 'PUT', body: { private_note: 'Better today.' } });
    assert.ok(t.db.prepare('SELECT acknowledged_at FROM sessions_log WHERE id = ?').get(id).acknowledged_at, 'a private change doesn’t ask again');
    await t.call(`/api/coaching/sessions/${id}`, { as: trainer.token, method: 'PUT', body: { shared_note: 'Updated feedback.' } });
    assert.equal(t.db.prepare('SELECT acknowledged_at FROM sessions_log WHERE id = ?').get(id).acknowledged_at, null, 'new feedback to read');
  } finally { await t.close(); }
});

test('people raise and see only their own help requests; trainers see and answer all', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const other = t.person('Exec B');
    const trainer = t.person('Trainer A', 'trainer');

    assert.equal((await t.call('/api/coaching/help', { as: exec.token, method: 'POST', body: { body: '  ' } })).status, 400);
    const { id } = await (await t.call('/api/coaching/help', { as: exec.token, method: 'POST', body: { body: 'Payl8r wording', service: 'pfs' } })).json();
    await t.call('/api/coaching/help', { as: other.token, method: 'POST', body: { body: 'A Star fast track' } });

    const mine = await (await t.call('/api/coaching/help', { as: exec.token })).json();
    assert.deepEqual(mine.requests.map((r) => r.body), ['Payl8r wording']);
    assert.equal((await t.call('/api/coaching/help/count', { as: exec.token })).status, 403);
    assert.equal((await t.call(`/api/coaching/help/${id}/answer`, { as: other.token, method: 'POST', body: { answer: 'x' } })).status, 403);
    assert.equal((await t.call(`/api/coaching/help/${id}/close`, { as: other.token, method: 'POST' })).status, 404, 'nobody closes someone else’s');

    const all = await (await t.call('/api/coaching/help', { as: trainer.token })).json();
    assert.equal(all.requests.length, 2);
    assert.equal((await (await t.call('/api/coaching/help/count', { as: trainer.token })).json()).open, 2);

    assert.equal((await t.call(`/api/coaching/help/${id}/answer`, { as: trainer.token, method: 'POST', body: { answer: 'Only say it’s an option. Let’s go through it at 2.' } })).status, 200);
    const answered = (await (await t.call('/api/coaching/help', { as: exec.token })).json()).requests[0];
    assert.equal(answered.status, 'answered');
    assert.equal(answered.answered_by_name, 'Trainer A');
    assert.equal((await t.call(`/api/coaching/help/${id}/close`, { as: exec.token, method: 'POST' })).status, 200);
  } finally { await t.close(); }
});

test('manager notes and the set-up checklist are for Shannon and Poppy only', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const trainer = t.person('Trainer A', 'trainer');
    const mgr = t.person('Manager A', 'manager');
    const item = t.db.prepare("SELECT id FROM setup_items WHERE key = 'aircall'").get().id;

    for (const who of [exec, trainer]) {
      for (const [method, path, body] of [
        ['GET', `/api/coaching/person/${exec.id}/notes`],
        ['POST', `/api/coaching/person/${exec.id}/notes`, { body: 'x' }],
        ['GET', '/api/coaching/setup-items'],
        ['POST', '/api/coaching/setup-items', { title: 'x' }],
        ['GET', `/api/coaching/person/${exec.id}/setup`],
        ['POST', `/api/coaching/person/${exec.id}/setup/${item}`, {}],
      ]) {
        assert.equal((await t.call(path, { as: who.token, method, body })).status, 403, `${method} ${path}`);
      }
    }

    assert.equal((await t.call(`/api/coaching/person/${exec.id}/notes`, { as: mgr.token, method: 'POST', body: { body: 'Talk about hours.' } })).status, 201);
    const { notes } = await (await t.call(`/api/coaching/person/${exec.id}/notes`, { as: mgr.token })).json();
    assert.equal(notes[0].author_name, 'Manager A');

    await t.call(`/api/coaching/person/${exec.id}/setup/${item}`, { as: mgr.token, method: 'POST', body: {} });
    const { items } = await (await t.call(`/api/coaching/person/${exec.id}/setup`, { as: mgr.token })).json();
    assert.ok(items.find((i) => i.id === item).done);
    assert.ok(items.length >= 10);
  } finally { await t.close(); }
});

test('the tracker is for trainers and managers, and shows who is on what', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const trainer = t.person('Trainer A', 'trainer');
    t.db.prepare("INSERT INTO person_services (person_id, service) VALUES (?, 'pfs')").run(exec.id);
    t.db.prepare("UPDATE quiz_questions SET status = 'approved' WHERE quiz_key = 'pfs'").run();
    await t.call(`/api/coaching/person/${exec.id}/sessions`, { as: trainer.token, method: 'POST', body: { ...SESSION, session_date: '2099-01-04', status: 'planned', shared_note: '', private_note: '' } });

    assert.equal((await t.call('/api/coaching/tracker', { as: exec.token })).status, 403);
    const tracker = await (await t.call('/api/coaching/tracker', { as: trainer.token })).json();
    const row = tracker.people.find((p) => p.id === exec.id);
    const pfs = row.services.find((s) => s.key === 'pfs');
    assert.equal(pfs.on, true);
    assert.ok(pfs.resourcesTotal > 0);
    assert.deepEqual(pfs.quiz, { pct: null, passed: false });
    assert.equal(row.services.find((s) => s.key === 'astar').on, false);
    assert.equal(row.nextSession.session_date, '2099-01-04');
    assert.equal(row.lastSession, null, 'a planned session isn’t a done one');
  } finally { await t.close(); }
});

test('needs a look: open help, a stage left unsigned, a quiz not passed, a quiet spell', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    t.db.prepare("UPDATE people SET start_date = '2026-10-01' WHERE id = ?").run(exec.id);
    t.db.prepare("INSERT INTO help_requests (person_id, body) VALUES (?, 'help')").run(exec.id);
    const person = t.db.prepare('SELECT * FROM people WHERE id = ?').get(exec.id);
    const record = {
      day: 20, stage: 'week-4',
      plan: [{ key: 'day-1', title: 'Day 1', signedOff: { at: 'x' } }, { key: 'day-2', title: 'Day 2', signedOff: null }, { key: 'week-4', title: 'Week 4', signedOff: null }],
      quizzes: [{ title: 'Pass Functional Skills', attempts: 2, best: { passed: false } }, { title: 'A Star Equivalency', attempts: 0, best: null }],
    };
    const reasons = needsLook(t.db, person, record, '2026-10-29');
    assert.deepEqual(reasons, ['1 help request waiting', 'Day 2 not signed off', 'Pass Functional Skills quiz not passed yet', 'No session logged yet']);

    t.db.prepare("INSERT INTO sessions_log (person_id, session_date, kind) VALUES (?, '2026-10-27', 'Coaching')").run(exec.id);
    assert.ok(!needsLook(t.db, person, record, '2026-10-29').some((r) => r.startsWith('No session')));
  } finally { await t.close(); }
});
