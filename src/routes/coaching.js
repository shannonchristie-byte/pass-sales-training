/**
 * routes/coaching.js — session feedback, help requests, the tracker, and
 * Shannon's and Poppy's own notes and set-up checklist.
 *
 * Who sees what (plan doc, "Who sees what"):
 *   - Session feedback: a sales executive sees their own sessions and the
 *     note written to them. John, Lucy, Shannon and Poppy see everyone's,
 *     including the private note, which is never sent to the person.
 *   - Help requests: people raise their own; trainers and managers see and
 *     answer them all.
 *   - Tracker: trainers and managers, everyone.
 *   - Manager notes and the set-up checklist: Shannon and Poppy only.
 */

import express from 'express';
import { requireSignedIn, requireTrainer, requireManager, canSeePerson, isTrainer } from '../auth.js';
import { personById, audit } from '../db.js';
import { SERVICES, isService } from '../services.js';
import { isIsoDate, ukToday } from '../plan.js';

export const SESSION_KINDS = [
  'Initial training', 'Call listening', 'Shadowing', 'Breakout', 'Workshop', 'Coaching', 'Quiz review', 'Other',
];

const text = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');

export function coachingRoutes(db) {
  const router = express.Router();

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

  /* ------------------------- session feedback ---------------------- */

  /** What the person may see of a session: never the private note. */
  const forPerson = ({ private_note, ...s }) => s;

  const sessionsOf = (personId) => db.prepare(`
    SELECT s.*, t.name AS trainer_name FROM sessions_log s LEFT JOIN people t ON t.id = s.trainer_id
    WHERE s.person_id = ? ORDER BY s.session_date DESC, s.id DESC`).all(personId);

  router.get('/kinds', requireSignedIn, (req, res) => {
    res.json({ kinds: SESSION_KINDS });
  });

  router.get('/person/:id/sessions', requireSignedIn, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const rows = sessionsOf(person.id);
    res.json({ sessions: isTrainer(req.person) ? rows : rows.map(forPerson) });
  });

  function sessionFields(body) {
    const s = {
      session_date: body?.session_date,
      kind: text(body?.kind, 40),
      service: body?.service || null,
      status: body?.status === 'planned' ? 'planned' : 'done',
      shared_note: text(body?.shared_note, 5000),
      private_note: text(body?.private_note, 5000),
      trainer_id: body?.trainer_id ? Number(body.trainer_id) : null,
    };
    if (!isIsoDate(s.session_date)) return { error: 'Pick the date of the session.' };
    if (!SESSION_KINDS.includes(s.kind)) return { error: 'Pick what kind of session it was.' };
    if (s.service && !isService(s.service)) return { error: 'Not a service this app knows.' };
    if (s.trainer_id) {
      const t = personById(db, s.trainer_id);
      if (!t || !['trainer', 'manager'].includes(t.role)) return { error: 'The session has to be with a trainer or manager.' };
    }
    return { s };
  }

  router.post('/person/:id/sessions', requireTrainer, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const { s, error } = sessionFields(req.body);
    if (error) return res.status(400).json({ error });
    const { lastInsertRowid } = db.prepare(`INSERT INTO sessions_log
      (person_id, trainer_id, session_date, kind, service, status, shared_note, private_note, updated_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(person.id, s.trainer_id || req.person.id, s.session_date, s.kind, s.service, s.status, s.shared_note, s.private_note, req.person.id);
    audit(db, req.person.id, 'session.added', person.id, { id: Number(lastInsertRowid), status: s.status });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  /** Changing the shared note asks the person to read it again. */
  router.put('/sessions/:id', requireTrainer, (req, res) => {
    const existing = db.prepare('SELECT * FROM sessions_log WHERE id = ?').get(Number(req.params.id));
    if (!existing) return res.status(404).json({ error: 'No such session.' });
    const { s, error } = sessionFields({ ...existing, ...req.body });
    if (error) return res.status(400).json({ error });
    const reread = s.shared_note !== existing.shared_note;
    db.prepare(`UPDATE sessions_log SET trainer_id = ?, session_date = ?, kind = ?, service = ?, status = ?,
      shared_note = ?, private_note = ?, acknowledged_at = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(s.trainer_id || existing.trainer_id, s.session_date, s.kind, s.service, s.status, s.shared_note, s.private_note,
        reread ? null : existing.acknowledged_at, req.person.id, existing.id);
    audit(db, req.person.id, 'session.changed', existing.person_id, { id: existing.id });
    res.json({ ok: true });
  });

  /** The person saying they've read the feedback. Only they can. */
  router.post('/sessions/:id/acknowledge', requireSignedIn, (req, res) => {
    const s = db.prepare('SELECT * FROM sessions_log WHERE id = ?').get(Number(req.params.id));
    if (!s || s.person_id !== req.person.id) return res.status(404).json({ error: 'No such session for you.' });
    db.prepare("UPDATE sessions_log SET acknowledged_at = datetime('now') WHERE id = ?").run(s.id);
    res.json({ ok: true });
  });

  /* ------------------------- help requests ------------------------- */

  const helpRows = (where, ...args) => db.prepare(`
    SELECT h.*, p.name AS person_name, a.name AS answered_by_name FROM help_requests h
    JOIN people p ON p.id = h.person_id LEFT JOIN people a ON a.id = h.answered_by
    WHERE ${where} ORDER BY CASE h.status WHEN 'open' THEN 0 WHEN 'answered' THEN 1 ELSE 2 END, h.created_at DESC, h.id DESC`).all(...args);

  /** Trainers and managers get everybody's; everyone else their own. */
  router.get('/help', requireSignedIn, (req, res) => {
    if (isTrainer(req.person)) {
      const personId = Number(req.query.person) || null;
      return res.json({ requests: personId ? helpRows('h.person_id = ?', personId) : helpRows('1 = 1') });
    }
    res.json({ requests: helpRows('h.person_id = ?', req.person.id) });
  });

  router.get('/help/count', requireTrainer, (req, res) => {
    res.json({ open: db.prepare("SELECT COUNT(*) AS n FROM help_requests WHERE status = 'open'").get().n });
  });

  router.post('/help', requireSignedIn, (req, res) => {
    const body = text(req.body?.body, 2000);
    const service = req.body?.service || null;
    if (!body) return res.status(400).json({ error: 'Say what you’d like help with.' });
    if (service && !isService(service)) return res.status(400).json({ error: 'Not a service this app knows.' });
    const { lastInsertRowid } = db.prepare('INSERT INTO help_requests (person_id, service, body) VALUES (?, ?, ?)')
      .run(req.person.id, service, body);
    audit(db, req.person.id, 'help.asked', req.person.id, { id: Number(lastInsertRowid) });
    res.status(201).json({ id: Number(lastInsertRowid) });
  });

  router.post('/help/:id/answer', requireTrainer, (req, res) => {
    const h = db.prepare('SELECT * FROM help_requests WHERE id = ?').get(Number(req.params.id));
    if (!h) return res.status(404).json({ error: 'No such request.' });
    const answer = text(req.body?.answer, 4000);
    if (!answer) return res.status(400).json({ error: 'Write an answer, or say when you’ll go through it with them.' });
    db.prepare(`UPDATE help_requests SET status = 'answered', answer = ?, answered_by = ?, answered_at = datetime('now') WHERE id = ?`)
      .run(answer, req.person.id, h.id);
    audit(db, req.person.id, 'help.answered', h.person_id, { id: h.id });
    res.json({ ok: true });
  });

  /** Closed by the person once it's sorted, or by a trainer. */
  router.post('/help/:id/close', requireSignedIn, (req, res) => {
    const h = db.prepare('SELECT * FROM help_requests WHERE id = ?').get(Number(req.params.id));
    if (!h || (h.person_id !== req.person.id && !isTrainer(req.person))) return res.status(404).json({ error: 'No such request.' });
    db.prepare("UPDATE help_requests SET status = 'closed', closed_at = datetime('now') WHERE id = ?").run(h.id);
    res.json({ ok: true });
  });

  /* ------------------------- tracker ------------------------------- */

  /**
   * Who is trained on what: for each sales executive and each service,
   * whether it's switched on and since when, resources done, and the best
   * quiz score; plus their last session and the next one booked.
   */
  router.get('/tracker', requireTrainer, (req, res) => {
    const people = db.prepare("SELECT * FROM people WHERE status = 'active' AND role = 'exec' ORDER BY name COLLATE NOCASE").all();
    const today = ukToday();
    const resources = db.prepare('SELECT id, service FROM training_resources WHERE archived = 0 AND service IS NOT NULL').all();
    const quizzes = db.prepare("SELECT DISTINCT q.key, q.service FROM quizzes q JOIN quiz_questions qq ON qq.quiz_key = q.key AND qq.status = 'approved' WHERE q.service IS NOT NULL").all();

    res.json({
      services: SERVICES,
      people: people.map((p) => {
        const on = db.prepare('SELECT service, switched_on_at FROM person_services WHERE person_id = ?').all(p.id);
        const done = new Set(db.prepare('SELECT resource_id FROM resource_done WHERE person_id = ?').all(p.id).map((r) => r.resource_id));
        const best = db.prepare('SELECT quiz_key, MAX(score * 100 / total) AS pct, MAX(passed) AS passed FROM quiz_attempts WHERE person_id = ? GROUP BY quiz_key').all(p.id);
        const last = db.prepare(`SELECT session_date, kind FROM sessions_log WHERE person_id = ? AND status = 'done' ORDER BY session_date DESC, id DESC LIMIT 1`).get(p.id);
        const next = db.prepare(`SELECT s.session_date, s.kind, t.name AS trainer_name FROM sessions_log s LEFT JOIN people t ON t.id = s.trainer_id
          WHERE s.person_id = ? AND s.status = 'planned' AND s.session_date >= ? ORDER BY s.session_date, s.id LIMIT 1`).get(p.id, today);
        return {
          id: p.id,
          name: p.name,
          lastSession: last || null,
          nextSession: next || null,
          services: SERVICES.map((s) => {
            const sw = on.find((x) => x.service === s.key);
            const mine = resources.filter((r) => r.service === s.key);
            const quiz = quizzes.find((q) => q.service === s.key);
            const b = quiz && best.find((x) => x.quiz_key === quiz.key);
            return {
              key: s.key,
              on: !!sw,
              since: sw?.switched_on_at ?? null,
              resourcesDone: mine.filter((r) => done.has(r.id)).length,
              resourcesTotal: mine.length,
              quiz: quiz ? (b ? { pct: b.pct, passed: !!b.passed } : { pct: null, passed: false }) : null,
            };
          }),
        };
      }),
    });
  });

  /* ------------------------- managers only ------------------------- */

  router.get('/person/:id/notes', requireManager, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    res.json({
      notes: db.prepare(`SELECT n.*, a.name AS author_name FROM manager_notes n LEFT JOIN people a ON a.id = n.author_id
        WHERE n.person_id = ? ORDER BY n.created_at DESC, n.id DESC`).all(person.id),
    });
  });

  router.post('/person/:id/notes', requireManager, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const body = text(req.body?.body, 5000);
    if (!body) return res.status(400).json({ error: 'Write the note.' });
    db.prepare('INSERT INTO manager_notes (person_id, author_id, body) VALUES (?, ?, ?)').run(person.id, req.person.id, body);
    audit(db, req.person.id, 'note.added', person.id);
    res.status(201).json({ ok: true });
  });

  router.get('/setup-items', requireManager, (req, res) => {
    res.json({ items: db.prepare('SELECT * FROM setup_items ORDER BY archived, position, id').all() });
  });

  router.post('/setup-items', requireManager, (req, res) => {
    const title = text(req.body?.title, 200);
    if (!title) return res.status(400).json({ error: 'Say what needs setting up.' });
    const position = (db.prepare('SELECT MAX(position) AS m FROM setup_items').get().m || 0) + 10;
    db.prepare('INSERT INTO setup_items (title, position) VALUES (?, ?)').run(title, position);
    res.status(201).json({ ok: true });
  });

  router.put('/setup-items/:id', requireManager, (req, res) => {
    const item = db.prepare('SELECT * FROM setup_items WHERE id = ?').get(Number(req.params.id));
    if (!item) return res.status(404).json({ error: 'No such item.' });
    const title = req.body?.title === undefined ? item.title : text(req.body.title, 200);
    if (!title) return res.status(400).json({ error: 'Say what needs setting up.' });
    const archived = req.body?.archived === undefined ? item.archived : req.body.archived ? 1 : 0;
    db.prepare('UPDATE setup_items SET title = ?, archived = ? WHERE id = ?').run(title, archived, item.id);
    res.json({ ok: true });
  });

  router.get('/person/:id/setup', requireManager, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const done = db.prepare(`SELECT d.*, p.name AS by_name FROM setup_done d LEFT JOIN people p ON p.id = d.done_by WHERE d.person_id = ?`).all(person.id);
    res.json({
      items: db.prepare('SELECT * FROM setup_items WHERE archived = 0 ORDER BY position, id').all().map((i) => {
        const d = done.find((x) => x.item_id === i.id);
        return { id: i.id, title: i.title, done: d ? { at: d.done_at, by_name: d.by_name } : null };
      }),
    });
  });

  router.post('/person/:id/setup/:item', requireManager, (req, res) => {
    const person = subject(req, res, req.params.id);
    if (!person) return;
    const item = db.prepare('SELECT * FROM setup_items WHERE id = ? AND archived = 0').get(Number(req.params.item));
    if (!item) return res.status(404).json({ error: 'No such item.' });
    if (req.body?.done === false) {
      db.prepare('DELETE FROM setup_done WHERE person_id = ? AND item_id = ?').run(person.id, item.id);
    } else {
      db.prepare('INSERT OR IGNORE INTO setup_done (person_id, item_id, done_by) VALUES (?, ?, ?)').run(person.id, item.id, req.person.id);
    }
    res.json({ ok: true });
  });

  return router;
}

