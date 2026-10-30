/**
 * routes/people.js — roles and service switches. Shannon and Poppy only.
 *
 * People appear the first time they sign in with their B2C Sales login, or
 * when Shannon or Poppy bring the whole team in from the B2C Sales app's team
 * figures, so the tracker shows everyone before they've signed in. Somebody
 * brought in has a placeholder email until they first sign in; their B2C
 * staff id is what joins the two up then. What can be changed here is this
 * app's own record: role, access, start date, whether they see the new
 * starter plan, and which services' training is switched on.
 */

import express from 'express';
import { requireManager } from '../auth.js';
import { ROLES, allPeople, personById, activeManagerCount, audit } from '../db.js';
import { isService } from '../services.js';
import { isIsoDate, ukToday } from '../plan.js';

export const PLACEHOLDER_DOMAIN = 'not-signed-in.invalid';

export function peopleRoutes(db, { feed } = {}) {
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

  /**
   * Everybody on John's and Lucy's teams this month, from the B2C Sales app,
   * added if they aren't here yet. Sales executives come in off the new
   * starter plan, except anybody the B2C Sales app says is still inside their
   * first four weeks. Nobody already here is changed.
   */
  router.post('/import-from-b2c', async (req, res) => {
    if (!feed) return res.status(503).json({ error: 'The link to the B2C Sales app is not set up.' });
    let data;
    try {
      data = await feed(ukToday().slice(0, 7));
    } catch (err) {
      return res.status(502).json({ error: err.message });
    }
    if (!data || data.notOut) return res.status(503).json({ error: 'The B2C Sales app had no team figures to read.' });

    const found = db.prepare('SELECT id FROM people WHERE b2c_staff_id = ?');
    const insert = db.prepare(
      'INSERT INTO people (b2c_staff_id, email, name, role, on_plan) VALUES (?, ?, ?, ?, ?)'
    );
    const added = [];
    const add = (staffId, name, role, onPlan) => {
      if (!staffId || !name || found.get(staffId)) return;
      insert.run(staffId, `b2c-staff-${staffId}@${PLACEHOLDER_DOMAIN}`, name, role, onPlan ? 1 : 0);
      added.push(name);
    };
    for (const team of data.teams || []) {
      add(team.trainerStaffId, team.trainerName, 'trainer', false);
      for (const p of team.people || []) add(p.staffId, p.name, 'exec', p.counted === false && /first four weeks/i.test(p.reason || ''));
    }
    audit(db, req.person.id, 'people.imported', null, { count: added.length });
    res.json({ added: added.length });
  });

  router.put('/:id/plan', (req, res) => {
    const person = personById(db, req.params.id);
    if (!person) return res.status(404).json({ error: 'No such person.' });
    const on = req.body?.on === true;
    db.prepare('UPDATE people SET on_plan = ? WHERE id = ?').run(on ? 1 : 0, person.id);
    audit(db, req.person.id, 'person.plan', person.id, { on });
    res.json({ ok: true });
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
