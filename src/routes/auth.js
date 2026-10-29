/**
 * routes/auth.js — signing in through the B2C Sales app, and signing out.
 *
 * Two kinds of route. /auth/start and /auth/callback are full-page
 * redirects, because the person's browser has to travel to the B2C Sales app
 * and back. /api/auth/* are the usual JSON calls the screens make.
 */

import express from 'express';
import {
  startHandoff, takeState, personFromB2C, createSession, destroySession,
  setSessionCookie, clearSessionCookie, readCookie, STATE_COOKIE,
} from '../auth.js';
import { personById, servicesFor, audit } from '../db.js';

/** Where a failed sign-in lands; the sign-in screen explains each code. */
const fail = (res, code) => res.redirect(`/#/login?problem=${code}`);

export function handoffRoutes(db, { config, redeem }) {
  const router = express.Router();

  router.get('/start', (req, res) => {
    if (!config.ready) return fail(res, 'not-set-up');
    res.redirect(startHandoff(db, res, config));
  });

  router.get('/callback', async (req, res) => {
    const { code, state } = req.query;
    if (!takeState(db, String(state || ''), readCookie(req, STATE_COOKIE))) return fail(res, 'expired');
    if (!code) return fail(res, 'refused');

    let b2c;
    try {
      b2c = await redeem(String(code), config);
    } catch (err) {
      console.warn('  Sign-in handoff failed:', err.message);
      return fail(res, 'refused');
    }

    const { person, reason } = personFromB2C(db, b2c);
    if (!person) {
      console.warn(`  Sign-in turned away: ${reason}`);
      return fail(res, b2c?.status && b2c.status !== 'active' ? 'switched-off' : 'no-access');
    }

    const { token, expires } = createSession(db, person.id);
    setSessionCookie(res, token, expires);
    audit(db, person.id, 'signed-in', person.id);
    res.redirect('/');
  });

  return router;
}

export function authApi(db, { config, devLogin }) {
  const router = express.Router();

  /** What the sign-in screen should offer. */
  router.get('/options', (req, res) => {
    const options = { handoffReady: config.ready, devLogin };
    if (devLogin) {
      options.devPeople = db
        .prepare("SELECT id, name, role FROM people WHERE status = 'active' ORDER BY role DESC, name")
        .all();
    }
    res.json(options);
  });

  router.get('/me', (req, res) => {
    if (!req.person) return res.status(401).json({ error: 'Please sign in.' });
    const p = req.person;
    res.json({ id: p.id, name: p.name, email: p.email, role: p.role, services: servicesFor(db, p.id) });
  });

  router.post('/logout', (req, res) => {
    destroySession(db, req.sessionToken);
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  /* Local testing only — see devLoginEnabled() in auth.js. */
  if (devLogin) {
    router.post('/dev', (req, res) => {
      const person = personById(db, req.body?.personId);
      if (!person || person.status !== 'active') return res.status(404).json({ error: 'No such person.' });
      const { token, expires } = createSession(db, person.id);
      setSessionCookie(res, token, expires);
      res.json({ ok: true });
    });
  }

  return router;
}
