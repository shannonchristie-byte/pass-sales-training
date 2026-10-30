/* Training and development: the new starter plan, resources and quizzes.
   Everyone sees their own; trainers see everybody's; quiz answers stay on the
   server; only approved questions reach a sales executive. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { startApp } from './helpers.js';
import { loadNewPages, contentFiles, parsePageFile } from '../src/content.js';
import { loadTrainingContent, quizFiles, TRAINING_DIR } from '../src/training-content.js';
import { workingDay, stageFor } from '../src/plan.js';
import { SERVICE_KEYS } from '../src/services.js';

async function withTraining() {
  const t = await startApp();
  loadNewPages(t.db);
  loadTrainingContent(t.db);
  return t;
}

const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));
const switchOn = (t, personId, service) =>
  t.db.prepare('INSERT INTO person_services (person_id, service) VALUES (?, ?)').run(personId, service);
const approveAll = (t, quiz) =>
  t.db.prepare("UPDATE quiz_questions SET status = 'approved' WHERE quiz_key = ?").run(quiz);

/* ------------------------- the files ------------------------------- */

test('the plan, resources and quizzes in training/ are all valid', () => {
  const { stages } = readJson(join(TRAINING_DIR, 'plan.json'));
  assert.ok(stages.length >= 9);
  stages.forEach((s, i) => {
    assert.ok(s.key && s.title && s.expectation && Number.isInteger(s.fromDay), s.key);
    if (i) assert.ok(s.fromDay > stages[i - 1].fromDay, `${s.key} starts after the stage before it`);
  });
  assert.equal(stages[0].fromDay, 1);

  const slugs = new Set(contentFiles().map((f) => parsePageFile(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).slug));
  const { resources } = readJson(join(TRAINING_DIR, 'resources.json'));
  assert.equal(new Set(resources.map((r) => r.key)).size, resources.length, 'resource keys are unique');
  for (const r of resources) {
    assert.ok(['proprofs', 'doc', 'slides', 'demo', 'recording', 'web', 'kb'].includes(r.kind), r.key);
    assert.match(r.url, /^(https:\/\/|#\/kb\/)/, r.key);
    if (r.service) assert.ok(SERVICE_KEYS.includes(r.service), r.key);
    const page = r.url.match(/^#\/kb\/p\?slug=(.+)$/);
    if (page) assert.ok(slugs.has(page[1]), `${r.key} links to missing page ${page[1]}`);
  }

  const quizKeys = new Set();
  for (const file of quizFiles()) {
    const quiz = readJson(file);
    assert.ok(!quizKeys.has(quiz.key), `${quiz.key} is used once`);
    quizKeys.add(quiz.key);
    if (quiz.service) assert.ok(SERVICE_KEYS.includes(quiz.service), quiz.key);
    assert.equal(new Set(quiz.questions.map((q) => q.key)).size, quiz.questions.length, `${quiz.key} question keys are unique`);
    for (const q of quiz.questions) {
      const where = `${quiz.key}/${q.key}`;
      assert.ok(q.options.length >= 2 && q.options.length <= 5, where);
      assert.ok(Number.isInteger(q.answer) && q.answer >= 0 && q.answer < q.options.length, where);
      assert.ok(q.explanation, `${where} explains the answer`);
      assert.ok(slugs.has(q.page), `${where} points at a page that exists`);
    }
  }
});

test('nothing in training/ holds a password or sign-in details', () => {
  const files = [join(TRAINING_DIR, 'plan.json'), join(TRAINING_DIR, 'resources.json'), ...quizFiles()];
  for (const f of files) assert.doesNotMatch(readFileSync(f, 'utf8'), /password|passcode|login details|\?login=/i, f);
  assert.ok(readdirSync(TRAINING_DIR).length >= 3);
});

test('working days count Monday to Friday from the start date', () => {
  // 26 Oct 2026 is a Monday.
  assert.equal(workingDay('2026-10-26', '2026-10-25'), 0, 'before the first day');
  assert.equal(workingDay('2026-10-26', '2026-10-26'), 1);
  assert.equal(workingDay('2026-10-26', '2026-10-30'), 5);
  assert.equal(workingDay('2026-10-26', '2026-11-01'), 5, 'a weekend counts as the Friday');
  assert.equal(workingDay('2026-10-26', '2026-11-02'), 6);
  assert.equal(workingDay(null), null);

  const stages = readJson(join(TRAINING_DIR, 'plan.json')).stages.map((s) => ({ key: s.key, from_day: s.fromDay }));
  assert.equal(stageFor(stages, 0), null);
  assert.equal(stageFor(stages, 1).key, 'day-1');
  assert.equal(stageFor(stages, 5).key, 'days-4-5');
  assert.equal(stageFor(stages, 6).key, 'week-2');
  assert.equal(stageFor(stages, 21).key, 'month-2', 'month 2 starts on the 21st working day');
  assert.equal(stageFor(stages, 200).key, 'month-3');
});

test('loading training content twice adds it once, and never undoes an edit', async () => {
  const t = await withTraining();
  try {
    t.db.prepare("UPDATE plan_stages SET expectation = 'Edited' WHERE key = 'day-1'").run();
    t.db.prepare("UPDATE quiz_questions SET status = 'approved' WHERE key = 'pfs-level-2'").run();
    const again = loadTrainingContent(t.db);
    assert.deepEqual(again, { stages: 0, resources: 0, quizzes: 0, questions: 0, setup: 0, courses: 0 });
    assert.equal(t.db.prepare("SELECT expectation FROM plan_stages WHERE key = 'day-1'").get().expectation, 'Edited');
    assert.equal(t.db.prepare("SELECT status FROM quiz_questions WHERE key = 'pfs-level-2'").get().status, 'approved');
    assert.equal(t.db.prepare("SELECT COUNT(*) AS n FROM quiz_questions WHERE status = 'draft'").get().n > 0, true, 'questions arrive as drafts');
  } finally { await t.close(); }
});

/* ------------------------- records --------------------------------- */

test('a sales executive sees their own plan, and only the resources for their services', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const other = t.person('Exec B');
    const mgr = t.person('Manager A', 'manager');
    switchOn(t, exec.id, 'pfs');

    let res = await t.call(`/api/people/${exec.id}/start-date`, { as: mgr.token, method: 'PUT', body: { date: '2026-10-26' } });
    assert.equal(res.status, 200);
    assert.equal((await t.call(`/api/people/${exec.id}/start-date`, { as: mgr.token, method: 'PUT', body: { date: 'soon' } })).status, 400);
    assert.equal((await t.call(`/api/people/${exec.id}/start-date`, { as: exec.token, method: 'PUT', body: { date: '2026-10-01' } })).status, 403);

    const me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(me.person.start_date, '2026-10-26');
    assert.ok(me.day >= 1 && me.stage, 'placed on the plan');
    assert.equal(me.plan.length, 9);
    assert.ok(me.resources.some((r) => r.service === 'pfs'));
    assert.ok(me.resources.some((r) => r.service === null), 'resources for everyone are there');
    assert.ok(!me.resources.some((r) => r.service && r.service !== 'pfs'), 'nothing for services that are off');

    assert.equal((await t.call(`/api/training/person/${other.id}`, { as: exec.token })).status, 403);
    assert.equal((await t.call(`/api/training/person/${exec.id}`, { as: exec.token })).status, 200);
  } finally { await t.close(); }
});

test('people tick off their own resources; trainers can tick anyone’s', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const other = t.person('Exec B');
    const trainer = t.person('Trainer A', 'trainer');
    switchOn(t, exec.id, 'pfs');
    const pfs = t.db.prepare("SELECT id FROM training_resources WHERE key = 'pfs-proprofs-1'").get().id;
    const astar = t.db.prepare("SELECT id FROM training_resources WHERE key = 'astar-proprofs'").get().id;

    assert.equal((await t.call(`/api/training/resources/${pfs}/done`, { as: exec.token, method: 'POST', body: {} })).status, 200);
    assert.equal((await t.call(`/api/training/resources/${astar}/done`, { as: exec.token, method: 'POST', body: {} })).status, 404, 'A Star is off for them');
    assert.equal((await t.call(`/api/training/resources/${pfs}/done`, { as: exec.token, method: 'POST', body: { personId: other.id } })).status, 403);

    const presentation = t.db.prepare("SELECT id FROM training_resources WHERE key = 'presentation'").get().id;
    assert.equal((await t.call(`/api/training/resources/${presentation}/done`, { as: trainer.token, method: 'POST', body: { personId: other.id } })).status, 200);

    const me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.ok(me.resources.find((r) => r.id === pfs).done);
    await t.call(`/api/training/resources/${pfs}/done`, { as: exec.token, method: 'POST', body: { done: false } });
    const after = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(after.resources.find((r) => r.id === pfs).done, null);
  } finally { await t.close(); }
});

test('only trainers and managers sign off stages, see the team, or look after resources and questions', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    const trainer = t.person('Trainer A', 'trainer');
    const q = t.db.prepare("SELECT id FROM quiz_questions WHERE key = 'pfs-level-2'").get().id;
    const tries = [
      ['GET', '/api/training/team'],
      ['POST', `/api/training/person/${exec.id}/stages/day-1`, {}],
      ['GET', '/api/training/resources'],
      ['POST', '/api/training/resources', { title: 'x', kind: 'web', url: 'https://example.test' }],
      ['GET', '/api/training/quizzes'],
      ['POST', '/api/training/quizzes/pfs/questions', { question: 'x', options: ['a', 'b'], answer: 0 }],
      ['PUT', `/api/training/questions/${q}`, { question: 'x', options: ['a', 'b'], answer: 0 }],
      ['POST', `/api/training/questions/${q}/status`, { status: 'approved' }],
      ['PUT', '/api/training/plan/day-1', { expectation: 'x' }],
    ];
    for (const [method, path, body] of tries) {
      assert.equal((await t.call(path, { as: exec.token, method, body })).status, 403, `${method} ${path}`);
    }

    const signed = await t.call(`/api/training/person/${exec.id}/stages/day-1`, { as: trainer.token, method: 'POST', body: { note: 'Good listening' } });
    assert.equal(signed.status, 200);
    assert.equal((await signed.json()).plan[0].signedOff.by_name, 'Trainer A');

    assert.equal((await t.call('/api/training/plan/day-1', { as: trainer.token, method: 'PUT', body: { expectation: 'x' } })).status, 403, 'the plan is the managers’');

    const team = await (await t.call('/api/training/team', { as: trainer.token })).json();
    assert.equal(team.people.find((p) => p.id === exec.id).stagesSignedOff, 1);
  } finally { await t.close(); }
});

test('a manager changes the plan', async () => {
  const t = await withTraining();
  try {
    const mgr = t.person('Manager A', 'manager');
    let res = await t.call('/api/training/plan/week-3', { as: mgr.token, method: 'PUT', body: { expectation: 'Averaging 5 stars a day', activities: ['One', '', 'Two'] } });
    assert.equal(res.status, 200);
    const row = t.db.prepare("SELECT * FROM plan_stages WHERE key = 'week-3'").get();
    assert.equal(row.expectation, 'Averaging 5 stars a day');
    assert.equal(row.activities, 'One\nTwo');
    res = await t.call('/api/training/plan/week-3', { as: mgr.token, method: 'PUT', body: { expectation: ' ' } });
    assert.equal(res.status, 400);
  } finally { await t.close(); }
});

/* ------------------------- quizzes --------------------------------- */

test('draft questions never reach a sales executive', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    switchOn(t, exec.id, 'pfs');
    let me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(me.quizzes.length, 0, 'nothing approved yet');
    assert.equal((await t.call('/api/training/quizzes/pfs/take', { as: exec.token })).status, 404);
    assert.equal((await t.call('/api/training/quizzes/pfs/take?preview=1', { as: exec.token })).status, 404, 'preview is for trainers');

    t.db.prepare("UPDATE quiz_questions SET status = 'approved' WHERE key = 'pfs-level-2'").run();
    me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.deepEqual(me.quizzes.map((q) => [q.key, q.questions]), [['pfs', 1]]);
    const take = await (await t.call('/api/training/quizzes/pfs/take', { as: exec.token })).json();
    assert.equal(take.questions.length, 1);
  } finally { await t.close(); }
});

test('quiz answers stay on the server until the quiz is handed in, then it is marked and kept', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    switchOn(t, exec.id, 'pfs');
    approveAll(t, 'pfs');

    const take = await (await t.call('/api/training/quizzes/pfs/take', { as: exec.token })).json();
    const sent = JSON.stringify(take);
    assert.doesNotMatch(sent, /"answer"|explanation/, 'no answers in what the page gets');

    const right = Object.fromEntries(t.db.prepare("SELECT id, answer FROM quiz_questions WHERE quiz_key = 'pfs'").all().map((q) => [q.id, q.answer]));
    const answers = { ...right };
    const [firstId] = Object.keys(right);
    answers[firstId] = (right[firstId] + 1) % 2; // one wrong
    const res = await t.call('/api/training/quizzes/pfs/attempts', { as: exec.token, method: 'POST', body: { answers } });
    const marked = await res.json();
    assert.equal(marked.total, take.questions.length);
    assert.equal(marked.score, marked.total - 1);
    assert.equal(marked.passed, (marked.score * 100) / marked.total >= 80);
    assert.ok(marked.results.every((r) => typeof r.explanation === 'string' && r.kb_slug));

    const me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(me.quizzes[0].attempts, 1);
    assert.equal(me.quizzes[0].best.score, marked.score);
  } finally { await t.close(); }
});

test('a quiz is closed until its service is switched on', async () => {
  const t = await withTraining();
  try {
    const exec = t.person('Exec A');
    approveAll(t, 'astar');
    approveAll(t, 'rules');
    assert.equal((await t.call('/api/training/quizzes/astar/take', { as: exec.token })).status, 403);
    assert.equal((await t.call('/api/training/quizzes/astar/attempts', { as: exec.token, method: 'POST', body: { answers: {} } })).status, 403);
    assert.equal((await t.call('/api/training/quizzes/rules/take', { as: exec.token })).status, 200, 'the rules quiz is for everyone');
  } finally { await t.close(); }
});

test('a trainer previews drafts without it counting, and editing an approved question sends it back to draft', async () => {
  const t = await withTraining();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const take = await (await t.call('/api/training/quizzes/astar/take?preview=1', { as: trainer.token })).json();
    assert.ok(take.preview && take.questions.every((q) => q.draft));
    const res = await t.call('/api/training/quizzes/astar/attempts', { as: trainer.token, method: 'POST', body: { answers: {}, preview: true } });
    assert.equal((await res.json()).score, 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM quiz_attempts').get().n, 0, 'a preview is not an attempt');

    const id = t.db.prepare("SELECT id FROM quiz_questions WHERE key = 'astar-who'").get().id;
    await t.call(`/api/training/questions/${id}/status`, { as: trainer.token, method: 'POST', body: { status: 'approved' } });
    let row = t.db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(id);
    assert.equal(row.status, 'approved');
    assert.equal(row.approved_by, trainer.id);

    const edit = await t.call(`/api/training/questions/${id}`, { as: trainer.token, method: 'PUT', body: { question: 'Who is it for?', options: ['Teachers', 'Pilots'], answer: 0, kb_slug: 'astar-at-a-glance' } });
    assert.equal(edit.status, 200);
    row = t.db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(id);
    assert.equal(row.status, 'draft');
    assert.equal(row.approved_by, null);

    const bad = await t.call(`/api/training/questions/${id}`, { as: trainer.token, method: 'PUT', body: { question: 'x', options: ['a', 'b'], answer: 2 } });
    assert.equal(bad.status, 400, 'the right answer has to be one of the answers');
  } finally { await t.close(); }
});

test('resources need a real link and a known service', async () => {
  const t = await withTraining();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const bad = [
      { title: 'x', kind: 'web', url: 'javascript:alert(1)' },
      { title: 'x', kind: 'web', url: 'https://example.test', service: 'mme' },
      { title: 'x', kind: 'pdf', url: 'https://example.test' },
      { title: '', kind: 'web', url: 'https://example.test' },
    ];
    for (const body of bad) {
      assert.equal((await t.call('/api/training/resources', { as: trainer.token, method: 'POST', body })).status, 400, JSON.stringify(body));
    }
    const res = await t.call('/api/training/resources', { as: trainer.token, method: 'POST', body: { title: 'Objection role play', kind: 'doc', url: 'https://docs.google.com/document/d/x/edit', service: 'pfs' } });
    assert.equal(res.status, 201);
    const { resource } = await res.json();
    const archived = await t.call(`/api/training/resources/${resource.id}`, { as: trainer.token, method: 'PUT', body: { archived: true } });
    assert.equal((await archived.json()).resource.archived, 1);
  } finally { await t.close(); }
});
