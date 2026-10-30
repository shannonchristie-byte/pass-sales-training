/* Training courses in the app: sections, then questions checked one at a
   time with feedback, a score at the end, and a pass recorded with its date.
   Answers stay on the server until each one is given. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startApp } from './helpers.js';
import { loadTrainingContent, TRAINING_DIR } from '../src/training-content.js';
import { SERVICE_KEYS } from '../src/services.js';

const COURSE = {
  key: 'test-course', title: 'Test course', service: 'pfs', passMark: 50,
  items: [
    { kind: 'section', title: 'Welcome', body: '## Hello\nRead this first.' },
    { kind: 'question', question: 'Two plus two?', options: ['3', '4'], answer: 1, feedback: 'It is 4.' },
    { kind: 'question', question: 'Sky colour?', options: ['Blue', 'Green', 'Red'], answer: 0, feedback: 'Blue on a clear day.' },
  ],
};

async function withCourse() {
  const t = await startApp();
  const dir = mkdtempSync(join(tmpdir(), 'courses-'));
  mkdirSync(join(dir, 'courses'));
  writeFileSync(join(dir, 'courses', '10-test.json'), JSON.stringify(COURSE));
  loadTrainingContent(t.db, dir);
  return t;
}

test('every course file in training/courses is valid', () => {
  const cdir = join(TRAINING_DIR, 'courses');
  if (!existsSync(cdir)) return;
  for (const f of readdirSync(cdir).filter((x) => x.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(cdir, f), 'utf8'));
    assert.ok(c.key && c.title && Array.isArray(c.items) && c.items.length, f);
    if (c.service) assert.ok(SERVICE_KEYS.includes(c.service), f);
    for (const [i, it] of c.items.entries()) {
      const where = `${f} item ${i + 1}`;
      assert.ok(['section', 'question'].includes(it.kind), where);
      if (it.kind === 'section') assert.ok(it.title && it.body, where);
      else {
        assert.ok(it.question && it.options.length >= 2, where);
        assert.ok(Number.isInteger(it.answer) && it.answer >= 0 && it.answer < it.options.length, where);
      }
    }
    assert.doesNotMatch(readFileSync(join(cdir, f), 'utf8'), /password|passcode|login details/i, f);
  }
});

test('a course opens with its service, and its answers never reach the page early', async () => {
  const t = await withCourse();
  try {
    const exec = t.person('Exec A');
    assert.deepEqual((await (await t.call('/api/courses', { as: exec.token })).json()).courses, []);
    assert.equal((await t.call('/api/courses/test-course', { as: exec.token })).status, 403);

    t.db.prepare("INSERT INTO person_services (person_id, service) VALUES (?, 'pfs')").run(exec.id);
    const list = (await (await t.call('/api/courses', { as: exec.token })).json()).courses;
    assert.equal(list[0].questions, 2);
    assert.equal(list[0].sections, 1);

    const body = await (await t.call('/api/courses/test-course', { as: exec.token })).json();
    assert.equal(body.items.length, 3);
    assert.doesNotMatch(JSON.stringify(body), /"answer"|feedback|It is 4/);
  } finally { await t.close(); }
});

test('answers are checked one at a time with feedback, and a pass is recorded with its date', async () => {
  const t = await withCourse();
  try {
    const exec = t.person('Exec A');
    t.db.prepare("INSERT INTO person_services (person_id, service) VALUES (?, 'pfs')").run(exec.id);
    const { items } = await (await t.call('/api/courses/test-course', { as: exec.token })).json();
    const [, q1, q2] = items;

    const { attemptId } = await (await t.call('/api/courses/test-course/start', { as: exec.token, method: 'POST', body: {} })).json();
    let res = await (await t.call('/api/courses/test-course/answer', { as: exec.token, method: 'POST', body: { attemptId, itemId: q1.id, chosen: 0 } })).json();
    assert.deepEqual([res.right, res.answer, res.feedback], [false, 1, 'It is 4.']);
    res = await (await t.call('/api/courses/test-course/answer', { as: exec.token, method: 'POST', body: { attemptId, itemId: q1.id, chosen: 1 } })).json();
    assert.equal(res.chosen, 0, 'an answer can’t be changed after its feedback');
    assert.equal((await t.call('/api/courses/test-course/answer', { as: exec.token, method: 'POST', body: { attemptId, itemId: q2.id, chosen: 7 } })).status, 400);

    /* Carrying on shows what was already answered. */
    const again = await (await t.call('/api/courses/test-course/start', { as: exec.token, method: 'POST', body: {} })).json();
    assert.equal(again.attemptId, attemptId);
    assert.equal(again.answered.length, 1);

    await t.call('/api/courses/test-course/answer', { as: exec.token, method: 'POST', body: { attemptId, itemId: q2.id, chosen: 0 } });
    const done = await (await t.call('/api/courses/test-course/finish', { as: exec.token, method: 'POST', body: { attemptId } })).json();
    assert.deepEqual([done.score, done.total, done.passed], [1, 2, true]);
    assert.equal(done.results[0].feedback, 'It is 4.');
    assert.equal((await t.call('/api/courses/test-course/finish', { as: exec.token, method: 'POST', body: { attemptId } })).status, 409);

    const mine = (await (await t.call('/api/courses', { as: exec.token })).json()).courses[0];
    assert.ok(mine.passedAt, 'the pass has its date');
    assert.equal(mine.best.score, 1);

    const trainer = t.person('Trainer A', 'trainer');
    const theirs = (await (await t.call(`/api/courses/person/${exec.id}`, { as: trainer.token })).json()).courses[0];
    assert.ok(theirs.passedAt);
    const other = t.person('Exec B');
    assert.equal((await t.call(`/api/courses/person/${exec.id}`, { as: other.token })).status, 403);
    assert.equal((await t.call('/api/courses/test-course/start', { as: other.token, method: 'POST', body: {} })).status, 403);
  } finally { await t.close(); }
});
