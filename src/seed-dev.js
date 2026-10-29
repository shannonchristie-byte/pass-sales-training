/**
 * seed-dev.js — made-up people for trying the app on this machine.
 *
 *   npm run seed:dev
 *
 * Invented names only. Real people arrive by signing in with their B2C Sales
 * login, so no real names, figures or notes ever need to be in this code.
 */

import { openDb } from './db.js';

const db = openDb();

const PEOPLE = [
  { email: 'manager.one@example.test', name: 'Test Manager', role: 'manager' },
  { email: 'trainer.one@example.test', name: 'Test Trainer', role: 'trainer' },
  { email: 'exec.one@example.test', name: 'Test Exec One', role: 'exec', services: ['pfs'], start: '2026-09-01' },
  { email: 'exec.two@example.test', name: 'Test Exec Two', role: 'exec', services: ['pfs', 'astar'], start: '2026-10-05' },
  { email: 'new.starter@example.test', name: 'Test New Starter', role: 'exec', services: ['pfs'], start: '2026-10-21' },
];

const insert = db.prepare('INSERT OR IGNORE INTO people (email, name, role) VALUES (?, ?, ?)');
const find = db.prepare('SELECT id FROM people WHERE email = ?');
const switchOn = db.prepare('INSERT OR IGNORE INTO person_services (person_id, service) VALUES (?, ?)');
const startOn = db.prepare('UPDATE people SET start_date = ? WHERE id = ? AND start_date IS NULL');

for (const p of PEOPLE) {
  insert.run(p.email, p.name, p.role);
  const { id } = find.get(p.email);
  for (const s of p.services || []) switchOn.run(id, s);
  if (p.start) startOn.run(p.start, id);
}

console.log(`  ${PEOPLE.length} made-up people are in. Start the app with TRAINING_DEV_LOGIN=1 to sign in as them.`);
