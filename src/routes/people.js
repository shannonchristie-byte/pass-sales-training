/**
 * routes/people.js — roles and service switches. Shannon and Poppy only.
 *
 * People are not added here: they appear the first time they sign in with
 * their B2C Sales login, with a starting role read from that app. What can be
 * changed here is this app's own record — their role, whether they can get in
 * at all, and which services' training is switched on for them.
 */

import express from 'express';
import { requireManager } from '../auth.js';
import { ROLES, allPeople, personById, activeManagerCount, audit } from '../db.js';
import { isService } from '../services.js';
import { isIsoDate } from '../plan.js';

export function peopleRoutes(db) {
  const router = express.Router();
  router.use(requireManager);

  router.get('/', (req, res) => {
    res.json({ people: allPeople(db) });
  });

  /** The app must always have somebody who can change roles. */
  function wouldLeaveNoManager(person, change) {
    if (person.role !== 'manager' || person.status !== 'active') return false;
    const stillManager = (change.role ?? person.role) === 'manager' && (change.status ?? person.status) === 'active';
    return !stillManager && activeManagerCount(db) <= 1;
  }

  router.put('/:id/role', (req, res) => {
    const person = personById(db, req.params.id);
    if (!person) return res.status(404).json({ error: 'No such person.' });
    const role = req.body?.role;
    if (!ROLES.includes(role)) return res.status(400).json({ error: 'Not a role this app knows.' });
    if (wouldLeaveNoManager(person, { role })) {
      return res.status(409).json({ error: 'There has to be at least one manager. Make somebody else a manager first.' });
    }
    db.prepare('UPDATE people SET role = ? WHERE id = ?').run(role, person.id);
    audit(db, req.person.id, 'person.role', person.id, { from: person.role, to: role });
    res.json({ person: personById(db, person.id) });
  });

  router.put('/:id/status', (req, res) => {
    const person = personById(db, req.params.id);
    if (!person) return res.status(404).json({ error: 'No such person.' });
    const status = req.body?.status;
    if (!['active', 'inactive'].includes(status)) return res.status(400).json({ error: 'Status is active or inactive.' });
    if (wouldLeaveNoManager(person, { status })) {
      return res.status(409).json({ error: 'There has to be at least one manager who can get in.' });
    }
    db.prepare('UPDATE people SET status = ? WHERE id = ?').run(status, person.id);
    /* Switching somebody off takes effect now, not when their session runs out. */
    if (status === 'inactive') db.prepare('DELETE FROM sessions WHERE person_id = ?').run(person.id);
    audit(db, req.person.id, 'person.status', person.id, { from: person.status, to: status });
    res.json({ person: personById(db, person.id) });
  });

  /** The first day on the sales team, which places them on the new starter plan. Empty clears it. */
  router.put('/:id/start-date', (req, res) => {
    const person = personById(db, req.params.id);
    if (!person) return res.status(404).json({ error: 'No such person.' });
    const date = req.body?.date || null;
    if (date !== null && !isIsoDate(date)) return res.status(400).json({ error: 'That isn’t a date.' });
    db.prepare('UPDATE people SET start_date = ? WHERE id = ?').run(date, person.id);
    audit(db, req.person.id, 'person.start_date', person.id, { from: person.start_date, to: date });
    res.json({ person: personById(db, person.id) });
  });

  router.put('/:id/services/:service', (req, res) => {
    const person = personById(db, req.params.id);
    if (!person) return res.status(404).json({ error: 'No such person.' });
    const { service } = req.params;
    if (!isService(service)) return res.status(400).json({ error: 'Not a service this app knows.' });
    const on = req.body?.on === true;
    if (on) {
      db.prepare('INSERT OR IGNORE INTO person_services (person_id, service, switched_on_by) VALUES (?, ?, ?)')
        .run(person.id, service, req.person.id);
    } else {
      db.prepare('DELETE FROM person_services WHERE person_id = ? AND service = ?').run(person.id, service);
    }
    audit(db, req.person.id, on ? 'service.on' : 'service.off', person.id, { service });
    res.json({ ok: true });
  });

  return router;
}
