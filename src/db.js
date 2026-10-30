/**
 * db.js — the training app's own database.
 *
 * Built the same way as the B2C Sales app: node:sqlite, which ships inside
 * Node, so there is nothing to compile, and the whole system is one file on
 * disk (data/training.db) that can be copied as a backup.
 *
 * What lives here is the training app's own record of people: their role in
 * this app, the services switched on for them, and later their training,
 * feedback and notes. Who somebody IS comes from the B2C Sales app at sign-in
 * (b2c_staff_id); their stars and team come from it too, read when needed and
 * never copied in. No pay of any kind is stored here.
 *
 * openDb() rather than a module-level connection so the tests can each have a
 * fresh in-memory database.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

export const DEFAULT_DB_PATH = process.env.TRAINING_DB || resolve(here, '..', 'data', 'training.db');

export const ROLES = ['exec', 'trainer', 'manager'];

export const ROLE_LABEL = {
  exec: 'Sales executive',
  trainer: 'Trainer',
  manager: 'Manager',
};

const SCHEMA = `
CREATE TABLE IF NOT EXISTS people (
  id              INTEGER PRIMARY KEY,
  b2c_staff_id    INTEGER UNIQUE,                 -- the person's id in the B2C Sales app
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name            TEXT NOT NULL,
  role            TEXT NOT NULL DEFAULT 'exec' CHECK (role IN ('exec', 'trainer', 'manager')),
  status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_seen_at    TEXT
);

CREATE TABLE IF NOT EXISTS person_services (
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  service         TEXT NOT NULL,
  switched_on_at  TEXT NOT NULL DEFAULT (datetime('now')),
  switched_on_by  INTEGER REFERENCES people(id),
  PRIMARY KEY (person_id, service)
);

CREATE TABLE IF NOT EXISTS sessions (
  token           TEXT PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  expires_at      TEXT NOT NULL
);

-- A sign-in that has been sent to the B2C Sales app and not come back yet.
CREATE TABLE IF NOT EXISTS handoff_states (
  state           TEXT PRIMARY KEY,
  expires_at      TEXT NOT NULL
);

-- Knowledge base. One row per page; every published change is a version, so
-- nothing anybody wrote is ever lost. Trainers suggest, managers publish.
CREATE TABLE IF NOT EXISTS kb_pages (
  id              INTEGER PRIMARY KEY,
  slug            TEXT NOT NULL UNIQUE,
  service         TEXT,                           -- a key from services.js, or NULL
  section         TEXT,                           -- a key from knowledge.js SECTIONS, or NULL
  title           TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  body            TEXT NOT NULL,                  -- markdown
  source          TEXT,                           -- where it was moved from
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      INTEGER REFERENCES people(id),
  checked_at      TEXT,
  checked_by      INTEGER REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS kb_versions (
  id              INTEGER PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES kb_pages(id) ON DELETE CASCADE,
  title           TEXT NOT NULL,
  body            TEXT NOT NULL,
  saved_at        TEXT NOT NULL DEFAULT (datetime('now')),
  saved_by        INTEGER REFERENCES people(id),
  note            TEXT
);

CREATE TABLE IF NOT EXISTS kb_suggestions (
  id              INTEGER PRIMARY KEY,
  page_id         INTEGER NOT NULL REFERENCES kb_pages(id) ON DELETE CASCADE,
  body            TEXT NOT NULL,
  note            TEXT,
  based_on        TEXT NOT NULL,                  -- the page's updated_at when the suggestion was started
  suggested_by    INTEGER NOT NULL REFERENCES people(id),
  suggested_at    TEXT NOT NULL DEFAULT (datetime('now')),
  status          TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'published', 'rejected')),
  decided_by      INTEGER REFERENCES people(id),
  decided_at      TEXT
);

-- Training and development. The new starter plan, the resources John and Lucy
-- point people to, and quizzes. Like the knowledge base, each starts from a
-- file in training/ and is never overwritten from it once it's in here.
CREATE TABLE IF NOT EXISTS plan_stages (
  key             TEXT PRIMARY KEY,
  position        INTEGER NOT NULL,
  title           TEXT NOT NULL,                  -- "Day 1", "Week 2"
  from_day        INTEGER NOT NULL,               -- the working day it starts on; 1 is the first day
  expectation     TEXT NOT NULL,                  -- what Shannon expects by then
  activities      TEXT NOT NULL DEFAULT '',       -- one per line
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      INTEGER REFERENCES people(id)
);

-- A trainer or manager saying somebody has done a stage of the plan.
CREATE TABLE IF NOT EXISTS stage_signoffs (
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  stage_key       TEXT NOT NULL REFERENCES plan_stages(key) ON DELETE CASCADE,
  signed_by       INTEGER REFERENCES people(id),
  signed_at       TEXT NOT NULL DEFAULT (datetime('now')),
  note            TEXT,
  PRIMARY KEY (person_id, stage_key)
);

CREATE TABLE IF NOT EXISTS training_resources (
  id              INTEGER PRIMARY KEY,
  key             TEXT UNIQUE,                    -- set for ones that came from training/resources.json
  title           TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('proprofs', 'doc', 'slides', 'demo', 'recording', 'web', 'kb')),
  url             TEXT NOT NULL,
  service         TEXT,                           -- a key from services.js; NULL is for everyone
  note            TEXT,
  position        INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      INTEGER REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS resource_done (
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  resource_id     INTEGER NOT NULL REFERENCES training_resources(id) ON DELETE CASCADE,
  done_at         TEXT NOT NULL DEFAULT (datetime('now')),
  marked_by       INTEGER REFERENCES people(id),
  PRIMARY KEY (person_id, resource_id)
);

CREATE TABLE IF NOT EXISTS quizzes (
  key             TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  service         TEXT,                           -- NULL is for everyone
  pass_mark       INTEGER NOT NULL DEFAULT 80,    -- per cent
  position        INTEGER NOT NULL DEFAULT 0
);

-- Questions start as drafts. Execs only ever see approved ones, and John or
-- Lucy approve each one, because they know how things are really done.
CREATE TABLE IF NOT EXISTS quiz_questions (
  id              INTEGER PRIMARY KEY,
  key             TEXT UNIQUE,                    -- set for ones that came from training/quizzes
  quiz_key        TEXT NOT NULL REFERENCES quizzes(key) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  question        TEXT NOT NULL,
  options         TEXT NOT NULL,                  -- JSON array of 2 to 5 answers
  answer          INTEGER NOT NULL,               -- index into options
  explanation     TEXT NOT NULL DEFAULT '',       -- shown after marking
  kb_slug         TEXT,                           -- the page to read for it
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'retired')),
  approved_by     INTEGER REFERENCES people(id),
  approved_at     TEXT,
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      INTEGER REFERENCES people(id)
);

CREATE TABLE IF NOT EXISTS quiz_attempts (
  id              INTEGER PRIMARY KEY,
  quiz_key        TEXT NOT NULL REFERENCES quizzes(key) ON DELETE CASCADE,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  score           INTEGER NOT NULL,
  total           INTEGER NOT NULL,
  passed          INTEGER NOT NULL,
  answers         TEXT NOT NULL,                  -- JSON: [{ id, chosen, right }]
  taken_at        TEXT NOT NULL DEFAULT (datetime('now'))
);

-- A training session with somebody: call listening, a breakout, a workshop.
-- Two notes on purpose. shared_note is written to the person and they see it;
-- private_note is for John, Lucy, Shannon and Poppy only and never leaves the
-- server in anything the person can open. A session can be booked ahead
-- (planned) and filled in once it's happened (done).
CREATE TABLE IF NOT EXISTS sessions_log (
  id              INTEGER PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  trainer_id      INTEGER REFERENCES people(id),
  session_date    TEXT NOT NULL,                  -- YYYY-MM-DD
  kind            TEXT NOT NULL,
  service         TEXT,                           -- a key from services.js, or NULL
  status          TEXT NOT NULL DEFAULT 'done' CHECK (status IN ('planned', 'done')),
  shared_note     TEXT NOT NULL DEFAULT '',
  private_note    TEXT NOT NULL DEFAULT '',
  acknowledged_at TEXT,                           -- when the person said they'd read it
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
  updated_by      INTEGER REFERENCES people(id)
);

-- Somebody asking John or Lucy for help with something.
CREATE TABLE IF NOT EXISTS help_requests (
  id              INTEGER PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  service         TEXT,                           -- what it's about, or NULL for general
  body            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'closed')),
  answer          TEXT,
  answered_by     INTEGER REFERENCES people(id),
  answered_at     TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  closed_at       TEXT
);

-- Shannon's and Poppy's own notes on somebody. Managers only.
CREATE TABLE IF NOT EXISTS manager_notes (
  id              INTEGER PRIMARY KEY,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  author_id       INTEGER REFERENCES people(id),
  body            TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

-- The new starter set-up checklist: what has to be in place for somebody
-- (accounts, tools, Slack). Only whether each thing is done lives here, never
-- the sign-in details themselves.
CREATE TABLE IF NOT EXISTS setup_items (
  id              INTEGER PRIMARY KEY,
  key             TEXT UNIQUE,                    -- set for ones that came from training/setup.json
  title           TEXT NOT NULL,
  position        INTEGER NOT NULL DEFAULT 0,
  archived        INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS setup_done (
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  item_id         INTEGER NOT NULL REFERENCES setup_items(id) ON DELETE CASCADE,
  done_at         TEXT NOT NULL DEFAULT (datetime('now')),
  done_by         INTEGER REFERENCES people(id),
  PRIMARY KEY (person_id, item_id)
);

-- Training courses built in the app, to replace ProProfs (Shannon, 30 Oct
-- 2026). A course is information sections, then multiple-choice questions
-- with feedback after each answer. Content starts from training/courses/.
CREATE TABLE IF NOT EXISTS courses (
  key             TEXT PRIMARY KEY,
  title           TEXT NOT NULL,
  service         TEXT,                           -- a key from services.js; NULL is for everyone
  description     TEXT NOT NULL DEFAULT '',
  pass_mark       INTEGER NOT NULL DEFAULT 80,    -- per cent
  position        INTEGER NOT NULL DEFAULT 0,
  source          TEXT
);

CREATE TABLE IF NOT EXISTS course_items (
  id              INTEGER PRIMARY KEY,
  key             TEXT UNIQUE,                    -- set for ones that came from training/courses
  course_key      TEXT NOT NULL REFERENCES courses(key) ON DELETE CASCADE,
  position        INTEGER NOT NULL DEFAULT 0,
  kind            TEXT NOT NULL CHECK (kind IN ('section', 'question')),
  title           TEXT NOT NULL DEFAULT '',
  body            TEXT NOT NULL DEFAULT '',       -- a section's text, markdown
  question        TEXT,
  options         TEXT,                           -- JSON array
  answer          INTEGER,                        -- index into options
  feedback        TEXT NOT NULL DEFAULT ''        -- shown after answering, right or wrong
);

-- One row per go at a course. Answers are checked one at a time on the
-- server, so the right answers never reach the page before they're given.
CREATE TABLE IF NOT EXISTS course_attempts (
  id              INTEGER PRIMARY KEY,
  course_key      TEXT NOT NULL REFERENCES courses(key) ON DELETE CASCADE,
  person_id       INTEGER NOT NULL REFERENCES people(id) ON DELETE CASCADE,
  started_at      TEXT NOT NULL DEFAULT (datetime('now')),
  finished_at     TEXT,
  answers         TEXT NOT NULL DEFAULT '{}',     -- JSON: { itemId: chosen }
  score           INTEGER,
  total           INTEGER,
  passed          INTEGER
);

CREATE TABLE IF NOT EXISTS audit_log (
  id              INTEGER PRIMARY KEY,
  at              TEXT NOT NULL DEFAULT (datetime('now')),
  actor_id        INTEGER REFERENCES people(id),
  action          TEXT NOT NULL,
  person_id       INTEGER REFERENCES people(id),
  detail          TEXT
);
`;

export function openDb(path = DEFAULT_DB_PATH) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  if (path !== ':memory:') db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(SCHEMA);
  addColumn(db, 'people', 'start_date', 'TEXT'); // first day on the sales team, YYYY-MM-DD
  /* Whether they see the new starter plan. Everybody already on the team when
     the app started doesn't need it (Shannon, 30 Oct 2026); new starters do. */
  addColumn(db, 'people', 'on_plan', 'INTEGER NOT NULL DEFAULT 1');
  /* When somebody finished their training on a service. */
  addColumn(db, 'person_services', 'trained_on', 'TEXT');
  return db;
}

/** Columns added after a table was first made. CREATE TABLE IF NOT EXISTS won't add them. */
function addColumn(db, table, column, type) {
  const has = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!has) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type}`);
}

/* ---------------------------- people -------------------------------- */

export function personById(db, id) {
  return db.prepare('SELECT * FROM people WHERE id = ?').get(Number(id)) ?? null;
}

export function servicesFor(db, personId) {
  return db
    .prepare('SELECT service FROM person_services WHERE person_id = ? ORDER BY service')
    .all(Number(personId))
    .map((r) => r.service);
}

/** Everyone, with their switched-on services, for the People screen. */
export function allPeople(db) {
  const people = db.prepare('SELECT * FROM people ORDER BY status, name COLLATE NOCASE').all();
  const services = db.prepare('SELECT person_id, service, trained_on FROM person_services').all();
  return people.map((p) => ({
    ...p,
    services: services.filter((s) => s.person_id === p.id).map((s) => s.service),
    trained: Object.fromEntries(services.filter((s) => s.person_id === p.id && s.trained_on).map((s) => [s.service, s.trained_on])),
    signedIn: !!p.last_seen_at,
  }));
}

export function activeManagerCount(db) {
  return db.prepare("SELECT COUNT(*) AS n FROM people WHERE role = 'manager' AND status = 'active'").get().n;
}

export function audit(db, actorId, action, personId = null, detail = null) {
  db.prepare('INSERT INTO audit_log (actor_id, action, person_id, detail) VALUES (?, ?, ?, ?)')
    .run(actorId ?? null, action, personId ?? null, detail == null ? null : JSON.stringify(detail));
}
