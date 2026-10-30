/**
 * routes/courses.js — training courses in the app, replacing ProProfs.
 *
 * A course is a run of information sections, then multiple-choice questions.
 * Each answer is checked on the server as it's given, and the feedback comes
 * straight back, so the right answers never reach the page early. Finishing
 * gives a score; a pass is recorded with its date, and shows to John, Lucy,
 * Shannon and Poppy.
 *
 * People see the courses for the services switched on for them, and any
 * course for everyone. Trainers and managers see every course.
 */

import express from 'express';
import { requireSignedIn, isTrainer, canSeePerson } from '../auth.js';
import { servicesFor, audit } from '../db.js';

export function courseRoutes(db) {
  const router = express.Router();
  router.use(requireSignedIn);

  const courseByKey = (key) => db.prepare('SELECT * FROM courses WHERE key = ?').get(String(key)) ?? null;
  const items = (key) => db.prepare('SELECT * FROM course_items WHERE course_key = ? ORDER BY position, id').all(key);
  const opens = (person, course) => isTrainer(person) || course.service == null || servicesFor(db, person.id).includes(course.service);

  /** What a person has done on each course: their best finished go, and any go in progress. */
  function standing(personId, key) {
    const finished = db.prepare(`SELECT * FROM course_attempts WHERE person_id = ? AND course_key = ? AND finished_at IS NOT NULL
      ORDER BY passed DESC, score * 1.0 / total DESC, finished_at DESC LIMIT 1`).get(personId, key);
    const passed = db.prepare(`SELECT MIN(finished_at) AS at FROM course_attempts WHERE person_id = ? AND course_key = ? AND passed = 1`).get(personId, key).at;
    const open = db.prepare('SELECT id FROM course_attempts WHERE person_id = ? AND course_key = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1').get(personId, key);
    return {
      best: finished ? { score: finished.score, total: finished.total, passed: !!finished.passed, finished_at: finished.finished_at } : null,
      passedAt: passed,
      inProgress: !!open,
    };
  }

  function listFor(person, viewer = person) {
    return db.prepare('SELECT * FROM courses ORDER BY position, key').all()
      .filter((c) => (viewer === person ? opens(person, c) : c.service == null || servicesFor(db, person.id).includes(c.service)))
      .map((c) => {
        const its = items(c.key);
        return {
          key: c.key, title: c.title, service: c.service, description: c.description, pass_mark: c.pass_mark,
          sections: its.filter((i) => i.kind === 'section').length,
          questions: its.filter((i) => i.kind === 'question').length,
          ...standing(person.id, c.key),
        };
      });
  }

  router.get('/', (req, res) => {
    res.json({ courses: listFor(req.person) });
  });

  /** One person's courses and results, for themselves or their trainer. */
  router.get('/person/:id', (req, res) => {
    if (!canSeePerson(req.person, req.params.id)) return res.status(403).json({ error: 'That is somebody else’s training record.' });
    const person = db.prepare('SELECT * FROM people WHERE id = ?').get(Number(req.params.id));
    if (!person) return res.status(404).json({ error: 'No such person.' });
    res.json({ courses: listFor(person, req.person) });
  });

  function courseFor(req, res) {
    const course = courseByKey(req.params.key);
    if (!course) {
      res.status(404).json({ error: 'No such course.' });
      return null;
    }
    if (!opens(req.person, course)) {
      res.status(403).json({ error: 'This course opens when that service is switched on for you.' });
      return null;
    }
    return course;
  }

  /** The course to work through: sections whole, questions without their answers. */
  router.get('/:key', (req, res) => {
    const course = courseFor(req, res);
    if (!course) return;
    res.json({
      course: { key: course.key, title: course.title, service: course.service, description: course.description, pass_mark: course.pass_mark },
      items: items(course.key).map((i) => (i.kind === 'section'
        ? { id: i.id, kind: 'section', title: i.title, body: i.body }
        : { id: i.id, kind: 'question', title: i.title, question: i.question, options: JSON.parse(i.options || '[]') })),
    });
  });

  function attemptFor(req, res, course) {
    const attempt = db.prepare('SELECT * FROM course_attempts WHERE id = ? AND person_id = ? AND course_key = ?')
      .get(Number(req.body?.attemptId), req.person.id, course.key);
    if (!attempt) {
      res.status(404).json({ error: 'Start the course first.' });
      return null;
    }
    if (attempt.finished_at) {
      res.status(409).json({ error: 'That go at the course is finished. Start it again to have another go.' });
      return null;
    }
    return attempt;
  }

  const checked = (item, chosen) => ({
    id: item.id, chosen, answer: item.answer, right: chosen === item.answer, feedback: item.feedback,
  });

  /**
   * Starts a go, or carries on the one in progress, with the feedback for any
   * questions already answered in it. `fresh` always starts a new go.
   */
  router.post('/:key/start', (req, res) => {
    const course = courseFor(req, res);
    if (!course) return;
    let attempt = req.body?.fresh ? null
      : db.prepare('SELECT * FROM course_attempts WHERE person_id = ? AND course_key = ? AND finished_at IS NULL ORDER BY id DESC LIMIT 1').get(req.person.id, course.key);
    if (!attempt) {
      const { lastInsertRowid } = db.prepare('INSERT INTO course_attempts (course_key, person_id) VALUES (?, ?)').run(course.key, req.person.id);
      attempt = db.prepare('SELECT * FROM course_attempts WHERE id = ?').get(lastInsertRowid);
    }
    const given = JSON.parse(attempt.answers);
    const answered = items(course.key).filter((i) => i.kind === 'question' && given[i.id] !== undefined).map((i) => checked(i, given[i.id]));
    res.json({ attemptId: attempt.id, answered });
  });

  /** One answer, checked now. An answer can't be changed once its feedback is shown. */
  router.post('/:key/answer', (req, res) => {
    const course = courseFor(req, res);
    if (!course) return;
    const attempt = attemptFor(req, res, course);
    if (!attempt) return;
    const item = db.prepare("SELECT * FROM course_items WHERE id = ? AND course_key = ? AND kind = 'question'").get(Number(req.body?.itemId), course.key);
    if (!item) return res.status(404).json({ error: 'No such question.' });
    const options = JSON.parse(item.options || '[]');
    const chosen = Number(req.body?.chosen);
    if (!Number.isInteger(chosen) || chosen < 0 || chosen >= options.length) return res.status(400).json({ error: 'Pick an answer.' });

    const given = JSON.parse(attempt.answers);
    if (given[item.id] === undefined) {
      given[item.id] = chosen;
      db.prepare('UPDATE course_attempts SET answers = ? WHERE id = ?').run(JSON.stringify(given), attempt.id);
    }
    res.json(checked(item, given[item.id]));
  });

  /** The score, with every question's feedback. Unanswered questions count as wrong. */
  router.post('/:key/finish', (req, res) => {
    const course = courseFor(req, res);
    if (!course) return;
    const attempt = attemptFor(req, res, course);
    if (!attempt) return;
    const given = JSON.parse(attempt.answers);
    const questions = items(course.key).filter((i) => i.kind === 'question');
    const results = questions.map((q) => ({
      ...checked(q, given[q.id] ?? null), question: q.question, options: JSON.parse(q.options || '[]'),
    }));
    const score = results.filter((r) => r.right).length;
    const total = results.length;
    const passed = total > 0 && score * 100 >= course.pass_mark * total;
    db.prepare("UPDATE course_attempts SET finished_at = datetime('now'), score = ?, total = ?, passed = ? WHERE id = ?")
      .run(score, total, passed ? 1 : 0, attempt.id);
    audit(db, req.person.id, 'course.finished', req.person.id, { course: course.key, score, total, passed });
    res.json({ score, total, passed, pass_mark: course.pass_mark, results });
  });

  return router;
}
