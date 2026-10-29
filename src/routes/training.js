/**
 * routes/training.js — training and development, personal to each person.
 *
 * Everyone sees their own record: where they are on the new starter plan, the
 * resources and quizzes for the services switched on for them, and what
 * they've done. John, Lucy, Shannon and Poppy see everybody's, sign off plan
 * stages, look after the resources and approve quiz questions. Only Shannon
 * and Poppy change the plan itself.
 *
 * Quiz answers never leave the server until a quiz is handed in, so nobody
 * can read them out of the page.
 */

import express from 'express';
import { requireSignedIn, requireTrainer, requireManager, canSeePerson, isTrainer } from '../auth.js';
import { personById, servicesFor, audit } from '../db.js';
import { SERVICES, isService } from '../services.js';
import { workingDay, stageFor } from '../plan.js';
import { needsLook } from '../progress.js';

const KINDS = ['proprofs', 'doc', 'slides', 'demo', 'recording', 'web', 'kb'];
const okUrl = (u) => typeof u === 'string' && /^(https?:\/\/|#\/)\S+$/.test(u.trim());
const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function trainingRoutes(db) {
  const router = express.Router();

  const stages = () => db.prepare('SELECT * FROM plan_stages ORDER BY from_day, position').all();
  const opensFor = (services) => (row) => row.service == null || services.includes(row.service);

  /** Quizzes with at least one approved question, which is all an exec can take. */
  const liveQuizzes = () => db.prepare(`
    SELECT q.*, COUNT(qq.id) AS questions FROM quizzes q
    JOIN quiz_questions qq ON qq.quiz_key = q.key AND qq.status = 'approved'
    GROUP BY q.key ORDER BY q.position`).all();

  function record(person) {
    const on = servicesFor(db, person.id);
    const day = workingDay(person.start_date);
    const plan = stages();
    const current = stageFor(plan, day);
    const signoffs = db.prepare(`
      SELECT s.*, p.name AS by_name FROM stage_signoffs s LEFT JOIN people p ON p.id = s.signed_by
      WHERE s.person_id = ?`).all(person.id);
    const done = db.prepare(`
      SELECT d.*, p.name AS by_name FROM resource_done d LEFT JOIN people p ON p.id = d.marked_by
      WHERE d.person_id = ?`).all(person.id);
    const attempts = db.prepare('SELECT * FROM quiz_attempts WHERE person_id = ? ORDER BY taken_at DESC, id DESC').all(person.id);

    return {
      person: { id: person.id, name: person.name, role: person.role, start_date: person.start_date },
      services: SERVICES.map((s) => ({ ...s, on: on.includes(s.key) })),
      day,
      stage: current?.key ?? null,
      plan: plan.map((s) => {
        const so = signoffs.find((x) => x.stage_key === s.key);
        return {
          key: s.key, title: s.title, from_day: s.from_day, expectation: s.expectation,
          activities: s.activities ? s.activities.split('\n').filter(Boolean) : [],
          signedOff: so ? { at: so.signed_at, by_name: so.by_name, note: so.note } : null,
        };
      }),
      resources: db.prepare('SELECT * FROM training_resources WHERE archived = 0 ORDER BY position, id').all()
        .filter(opensFor(on))
        .map((r) => {
          const d = done.find((x) => x.resource_id === r.id);
          return { id: r.id, title: r.title, kind: r.kind, url: r.url, service: r.service, note: r.note, done: d ? { at: d.done_at, by_name: d.by_name } : null };
        }),
      quizzes: liveQuizzes().filter(opensFor(on)).map((q) => {
        const mine = attempts.filter((a) => a.quiz_key === q.key);
        const best = mine.reduce((b, a) => (!b || a.score / a.total > b.score / b.total ? a : b), null);
        return {
          key: q.key, title: q.title, service: q.service, pass_mark: q.pass_mark, questions: q.questions,
          attempts: mine.length,
          best: best ? { score: best.score, total: best.total, passed: !!best.passed, taken_at: best.taken_at } : null,
        };
      }),
    };
  }

  const summary = (person) => {
    const r = record(person);
    return {
      id: person.id, name: person.name, start_date: person.start_date, day: r.day,
      stage: r.plan.find((s) => s.key === r.stage)?.title ?? null,
      stagesSignedOff: r.plan.filter((s) => s.signedOff).length, stagesTotal: r.plan.length,
      resourcesDone: r.resources.filter((x) => x.done).length, resourcesTotal: r.resources.length,
      quizzesPassed: r.quizzes.filter((q) => q.best?.passed).length, quizzesTotal: r.quizzes.length,
      services: r.services,
      needsLook: needsLook(db, person, r),
    };
  };

  /** Somebody the signed-in person may look at, or a response already sent. */
  function subject(req, res, id) {
    if (!canSeePerson(req.person, id)) {
      res.status(403).json({ error: 'That is somebody else’s training record.' });
      return null;
    }
    const person = personById(db, id);
    if (!person) {
      res.status(404).json({ error: 'No such person.' });
      return null;
    }
    return person;
  }

  /* ------------------------- records ------------------------------- */

  router.get('/me', requireSignedIn, (req, res) => {
    res.json(record(req.person));
  });

  /** Everybody's training at a glance. Trainers and managers only. */
  router.get('/team', requireTrainer, (req, res) => {
    const people = db
      .prepare("SELECT * FROM people WHERE status = 'active' AND role = 'exec' ORDER BY name COLLATE NOCASE")
      .all();
    res.json({ people: people.map(summary) });
  });

  router.get('/person/:id', requireSignedIn, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (person) res.json(record(person));
  });

  /** A trainer or manager signs off a stage of the plan, or takes it back. */
  router.post('/person/:id/stages/:key', requireTrainer, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const stage = db.prepare('SELECT * FROM plan_stages WHERE key = ?').get(req.params.key);
    if (!stage) return res.status(404).json({ error: 'No such stage.' });
    const undo = req.body?.done === false;
    if (undo) {
      db.prepare('DELETE FROM stage_signoffs WHERE person_id = ? AND stage_key = ?').run(person.id, stage.key);
    } else {
      db.prepare(`INSERT INTO stage_signoffs (person_id, stage_key, signed_by, note) VALUES (?, ?, ?, ?)
        ON CONFLICT (person_id, stage_key) DO UPDATE SET signed_by = excluded.signed_by, note = excluded.note, signed_at = datetime('now')`)
        .run(person.id, stage.key, req.person.id, text(req.body?.note, 500) || null);
    }
    audit(db, req.person.id, undo ? 'stage.undone' : 'stage.signed', person.id, { stage: stage.key });
    res.json(record(person));
  });

  /**
   * Ticking a resource off. People tick their own; John, Lucy, Shannon and
   * Poppy can tick anybody's, for instance after a session together.
   */
  router.post('/resources/:id/done', requireSignedIn, (req, res) => {
    const personId = Number(req.body?.personId ?? req.person.id);
    if (personId !== req.person.id && !isTrainer(req.person)) {
      return res.status(403).json({ error: 'You can only tick off your own training.' });
    }
    const person = subject(req, res, personId);
    if (!person) return;
    const resource = db.prepare('SELECT * FROM training_resources WHERE id = ? AND archived = 0').get(Number(req.params.id));
    if (!resource || !opensFor(servicesFor(db, person.id))(resource)) {
      return res.status(404).json({ error: 'That isn’t one of this person’s resources.' });
    }
    if (req.body?.done === false) {
      db.prepare('DELETE FROM resource_done WHERE person_id = ? AND resource_id = ?').run(person.id, resource.id);
    } else {
      db.prepare('INSERT OR IGNORE INTO resource_done (person_id, resource_id, marked_by) VALUES (?, ?, ?)')
        .run(person.id, resource.id, req.person.id);
    }
    res.json({ ok: true });
  });

  /* ------------------------- quizzes ------------------------------- */

  /**
   * The quiz and the questions to answer. Trainers can ask for a preview, to
   * try a quiz with its draft questions in before approving them; a preview
   * is never saved as an attempt.
   */
  function quizFor(req, res, previewAsked) {
    const quiz = db.prepare('SELECT * FROM quizzes WHERE key = ?').get(req.params.key);
    if (!quiz) {
      res.status(404).json({ error: 'No such quiz.' });
      return null;
    }
    const preview = previewAsked && isTrainer(req.person);
    if (!preview && quiz.service && !servicesFor(db, req.person.id).includes(quiz.service)) {
      res.status(403).json({ error: 'This quiz opens when that service is switched on for you.' });
      return null;
    }
    const statuses = preview ? "'approved', 'draft'" : "'approved'";
    const questions = db.prepare(`SELECT * FROM quiz_questions WHERE quiz_key = ? AND status IN (${statuses}) ORDER BY position, id`).all(quiz.key);
    if (!questions.length) {
      res.status(404).json({ error: 'This quiz has no questions ready yet.' });
      return null;
    }
    return { quiz, questions, preview };
  }

  router.get('/quizzes/:key/take', requireSignedIn, (req, res) => {
    const q = quizFor(req, res, req.query.preview === '1');
    if (!q) return;
    res.json({
      quiz: { key: q.quiz.key, title: q.quiz.title, service: q.quiz.service, pass_mark: q.quiz.pass_mark },
      preview: q.preview,
      questions: q.questions.map((x) => ({ id: x.id, question: x.question, options: JSON.parse(x.options), draft: x.status === 'draft' })),
    });
  });

  router.post('/quizzes/:key/attempts', requireSignedIn, (req, res) => {
    const q = quizFor(req, res, req.body?.preview === true);
    if (!q) return;
    const given = req.body?.answers || {};
    const results = q.questions.map((x) => {
      const options = JSON.parse(x.options);
      const pick = given[x.id];
      const chosen = Number.isInteger(pick) && pick >= 0 && pick < options.length ? pick : null;
      return { id: x.id, question: x.question, options, chosen, answer: x.answer, right: chosen === x.answer, explanation: x.explanation, kb_slug: x.kb_slug };
    });
    const score = results.filter((r) => r.right).length;
    const total = results.length;
    const passed = score * 100 >= q.quiz.pass_mark * total;
    if (!q.preview) {
      db.prepare('INSERT INTO quiz_attempts (quiz_key, person_id, score, total, passed, answers) VALUES (?, ?, ?, ?, ?, ?)')
        .run(q.quiz.key, req.person.id, score, total, passed ? 1 : 0, JSON.stringify(results.map((r) => ({ id: r.id, chosen: r.chosen, right: r.right }))));
    }
    res.json({ score, total, passed, pass_mark: q.quiz.pass_mark, preview: q.preview, results });
  });

  /** One person's quiz attempts, newest first, for themselves or their trainer. */
  router.get('/person/:id/attempts', requireSignedIn, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const attempts = db.prepare(`
      SELECT a.id, a.quiz_key, a.score, a.total, a.passed, a.taken_at, q.title FROM quiz_attempts a
      JOIN quizzes q ON q.key = a.quiz_key WHERE a.person_id = ? ORDER BY a.taken_at DESC, a.id DESC LIMIT 50`).all(person.id);
    res.json({ attempts });
  });

  /* ------------------------- looking after it ---------------------- */

  /** Every resource, archived ones too. */
  router.get('/resources', requireTrainer, (req, res) => {
    res.json({ resources: db.prepare('SELECT * FROM training_resources ORDER BY archived, position, id').all() });
  });

  function resourceFields(body) {
    const r = {
      title: text(body?.title, 200),
      kind: body?.kind,
      url: text(body?.url, 1000),
      service: body?.service || null,
      note: text(body?.note, 500) || null,
    };
    if (!r.title) return { error: 'Give it a title.' };
    if (!KINDS.includes(r.kind)) return { error: 'Pick what kind of resource it is.' };
    if (!okUrl(r.url)) return { error: 'The link needs to start with https:// (or #/ for a knowledge base page).' };
    if (r.service && !isService(r.service)) return { error: 'Not a service this app knows.' };
    return { r };
  }

  router.post('/resources', requireTrainer, (req, res) => {
    const { r, error } = resourceFields(req.body);
    if (error) return res.status(400).json({ error });
    const position = (db.prepare('SELECT MAX(position) AS m FROM training_resources').get().m || 0) + 10;
    const { lastInsertRowid } = db.prepare(
      'INSERT INTO training_resources (title, kind, url, service, note, position, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(r.title, r.kind, r.url, r.service, r.note, position, req.person.id);
    audit(db, req.person.id, 'resource.added', null, { id: Number(lastInsertRowid), title: r.title });
    res.status(201).json({ resource: db.prepare('SELECT * FROM training_resources WHERE id = ?').get(lastInsertRowid) });
  });

  router.put('/resources/:id', requireTrainer, (req, res) => {
    const existing = db.prepare('SELECT * FROM training_resources WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'No such resource.' });
    const { r, error } = resourceFields({ ...existing, ...req.body });
    if (error) return res.status(400).json({ error });
    const archived = req.body?.archived === undefined ? existing.archived : req.body.archived ? 1 : 0;
    db.prepare(`UPDATE training_resources SET title = ?, kind = ?, url = ?, service = ?, note = ?, archived = ?,
      updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(r.title, r.kind, r.url, r.service, r.note, archived, req.person.id, existing.id);
    audit(db, req.person.id, archived && !existing.archived ? 'resource.archived' : 'resource.changed', null, { id: existing.id });
    res.json({ resource: db.prepare('SELECT * FROM training_resources WHERE id = ?').get(existing.id) });
  });

  /** Every quiz with every question and its answer, for John and Lucy to check. */
  router.get('/quizzes', requireTrainer, (req, res) => {
    const quizzes = db.prepare('SELECT * FROM quizzes ORDER BY position').all();
    const questions = db.prepare(`
      SELECT qq.*, p.name AS approved_by_name FROM quiz_questions qq LEFT JOIN people p ON p.id = qq.approved_by
      ORDER BY qq.position, qq.id`).all();
    res.json({
      quizzes: quizzes.map((q) => ({
        ...q,
        questions: questions.filter((x) => x.quiz_key === q.key).map((x) => ({ ...x, options: JSON.parse(x.options) })),
      })),
    });
  });

  function questionFields(body) {
    const options = Array.isArray(body?.options) ? body.options.map((o) => text(o, 300)).filter(Boolean) : [];
    const q = {
      question: text(body?.question, 500),
      options,
      answer: Number(body?.answer),
      explanation: text(body?.explanation, 1000),
      kb_slug: text(body?.kb_slug, 100) || null,
    };
    if (!q.question) return { error: 'Write the question.' };
    if (options.length < 2 || options.length > 5) return { error: 'Give between 2 and 5 answers.' };
    if (!Number.isInteger(q.answer) || q.answer < 0 || q.answer >= options.length) return { error: 'Pick which answer is right.' };
    if (q.kb_slug && !db.prepare('SELECT 1 FROM kb_pages WHERE slug = ?').get(q.kb_slug)) return { error: 'That knowledge base page doesn’t exist.' };
    return { q };
  }

  /** A new question always starts as a draft, whoever writes it. */
  router.post('/quizzes/:key/questions', requireTrainer, (req, res) => {
    const quiz = db.prepare('SELECT * FROM quizzes WHERE key = ?').get(req.params.key);
    if (!quiz) return res.status(404).json({ error: 'No such quiz.' });
    const { q, error } = questionFields(req.body);
    if (error) return res.status(400).json({ error });
    const position = (db.prepare('SELECT MAX(position) AS m FROM quiz_questions WHERE quiz_key = ?').get(quiz.key).m || 0) + 10;
    const { lastInsertRowid } = db.prepare(`INSERT INTO quiz_questions (quiz_key, position, question, options, answer, explanation, kb_slug, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(quiz.key, position, q.question, JSON.stringify(q.options), q.answer, q.explanation, q.kb_slug, req.person.id);
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  /** Changing an approved question sends it back to draft, so it's approved again as it now reads. */
  router.put('/questions/:id', requireTrainer, (req, res) => {
    const existing = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'No such question.' });
    const { q, error } = questionFields(req.body);
    if (error) return res.status(400).json({ error });
    db.prepare(`UPDATE quiz_questions SET question = ?, options = ?, answer = ?, explanation = ?, kb_slug = ?,
      status = CASE status WHEN 'retired' THEN 'retired' ELSE 'draft' END, approved_by = NULL, approved_at = NULL,
      updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(q.question, JSON.stringify(q.options), q.answer, q.explanation, q.kb_slug, req.person.id, existing.id);
    res.json({ ok: true });
  });

  router.post('/questions/:id/status', requireTrainer, (req, res) => {
    const existing = db.prepare('SELECT * FROM quiz_questions WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'No such question.' });
    const status = req.body?.status;
    if (!['approved', 'draft', 'retired'].includes(status)) return res.status(400).json({ error: 'Status is approved, draft or retired.' });
    db.prepare(`UPDATE quiz_questions SET status = ?, approved_by = ?, approved_at = CASE WHEN ? = 'approved' THEN datetime('now') END WHERE id = ?`)
      .run(status, status === 'approved' ? req.person.id : null, status, existing.id);
    audit(db, req.person.id, `question.${status}`, null, { id: existing.id });
    res.json({ ok: true });
  });

  /* ------------------------- the plan itself ----------------------- */

  /** The new starter plan is Shannon's, so only managers change it. */
  router.put('/plan/:key', requireManager, (req, res) => {
    const stage = db.prepare('SELECT * FROM plan_stages WHERE key = ?').get(req.params.key);
    if (!stage) return res.status(404).json({ error: 'No such stage.' });
    const title = text(req.body?.title, 60) || stage.title;
    const expectation = text(req.body?.expectation, 500);
    const fromDay = req.body?.from_day === undefined ? stage.from_day : Number(req.body.from_day);
    const activities = Array.isArray(req.body?.activities)
      ? req.body.activities.map((a) => text(a, 300)).filter(Boolean).join('\n')
      : stage.activities;
    if (!expectation) return res.status(400).json({ error: 'Say what’s expected at this stage.' });
    if (!Number.isInteger(fromDay) || fromDay < 1 || fromDay > 400) {
      return res.status(400).json({ error: 'The working day it starts on must be a whole number from 1.' });
    }
    db.prepare(`UPDATE plan_stages SET title = ?, expectation = ?, from_day = ?, activities = ?, updated_at = datetime('now'), updated_by = ? WHERE key = ?`)
      .run(title, expectation, fromDay, activities, req.person.id, stage.key);
    audit(db, req.person.id, 'plan.changed', null, { stage: stage.key });
    res.json({ ok: true });
  });

  return router;
}
