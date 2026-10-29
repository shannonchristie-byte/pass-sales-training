/**
 * training-content.js — the training side's starting content.
 *
 * Works like content.js does for the knowledge base. The first version of the
 * new starter plan, the training resources and the quiz questions live in
 * training/. On start-up anything not yet in the database is added from those
 * files; anything already there is never touched again, because from then on
 * John, Lucy, Shannon and Poppy edit it in the app.
 *
 *   training/plan.json        the new starter plan, stage by stage
 *   training/resources.json   links to ProProfs, docs, demos and recordings
 *   training/quizzes/*.json   one quiz per file, its questions as drafts
 *   training/setup.json       the new starter set-up checklist
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const TRAINING_DIR = resolve(here, '..', 'training');

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

export function quizFiles(dir = TRAINING_DIR) {
  const qdir = join(dir, 'quizzes');
  if (!existsSync(qdir)) return [];
  return readdirSync(qdir).filter((f) => f.endsWith('.json')).sort().map((f) => join(qdir, f));
}

/** Add whatever isn't in the database yet. Returns how many of each were added. */
export function loadTrainingContent(db, dir = TRAINING_DIR) {
  const added = { stages: 0, resources: 0, quizzes: 0, questions: 0, setup: 0 };

  const setupFile = join(dir, 'setup.json');
  if (existsSync(setupFile)) {
    const insert = db.prepare('INSERT OR IGNORE INTO setup_items (key, title, position) VALUES (?, ?, ?)');
    readJson(setupFile).items.forEach((s, i) => {
      added.setup += insert.run(s.key, s.title, (i + 1) * 10).changes;
    });
  }

  const planFile = join(dir, 'plan.json');
  if (existsSync(planFile)) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO plan_stages (key, position, title, from_day, expectation, activities) VALUES (?, ?, ?, ?, ?, ?)'
    );
    readJson(planFile).stages.forEach((s, i) => {
      added.stages += insert.run(s.key, (i + 1) * 10, s.title, s.fromDay, s.expectation, (s.activities || []).join('\n')).changes;
    });
  }

  const resourceFile = join(dir, 'resources.json');
  if (existsSync(resourceFile)) {
    const insert = db.prepare(
      'INSERT OR IGNORE INTO training_resources (key, title, kind, url, service, note, position) VALUES (?, ?, ?, ?, ?, ?, ?)'
    );
    readJson(resourceFile).resources.forEach((r, i) => {
      added.resources += insert.run(r.key, r.title, r.kind, r.url, r.service || null, r.note || null, (i + 1) * 10).changes;
    });
  }

  const insertQuiz = db.prepare('INSERT OR IGNORE INTO quizzes (key, title, service, pass_mark, position) VALUES (?, ?, ?, ?, ?)');
  const insertQuestion = db.prepare(
    'INSERT OR IGNORE INTO quiz_questions (key, quiz_key, position, question, options, answer, explanation, kb_slug) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
  );
  quizFiles(dir).forEach((file, qi) => {
    const quiz = readJson(file);
    added.quizzes += insertQuiz.run(quiz.key, quiz.title, quiz.service || null, quiz.passMark ?? 80, (qi + 1) * 10).changes;
    quiz.questions.forEach((q, i) => {
      added.questions += insertQuestion.run(
        `${quiz.key}-${q.key}`, quiz.key, (i + 1) * 10, q.question, JSON.stringify(q.options), q.answer, q.explanation || '', q.page || null
      ).changes;
    });
  });

  return added;
}
