/**
 * auth.js — sign-in, sessions and who may see what.
 *
 * Nobody has a password in this app. People sign in with their B2C Sales
 * login, on the B2C Sales app's own sign-in page, and are handed back here
 * with a one-time code (decided 28 Oct 2026: one password for both apps). The
 * training app swaps that code for who the person is, server to server, using
 * a key both apps hold. The password is only ever typed into the B2C Sales
 * app, and never crosses to this one. docs/HANDOFF.md has both halves.
 *
 * Why a handoff and not a shared cookie: both apps live on onrender.com
 * addresses, and browsers will not share a cookie between two of those.
 *
 * Sessions here are short (12 hours). Signing in again is one click while the
 * B2C Sales session lasts, and a short session means somebody switched off
 * in the B2C Sales app is out of this one by the next day at the latest.
 *
 * Three roles, checked on the server for every request, never only hidden on
 * screen:
 *   exec     — the knowledge base, and their own training and development
 *   trainer  — John and Lucy: everybody's training and development
 *   manager  — Shannon and Poppy: all of that, plus roles and service switches
 */

import { randomBytes } from 'node:crypto';
import { personById, audit } from './db.js';

export const COOKIE_NAME = 'pst_session';
export const STATE_COOKIE = 'pst_handoff';
const SESSION_HOURS = 12;
const STATE_MINUTES = 10;

/* ---------------------------- configuration ------------------------- */

/**
 * Everything the handoff needs, from the environment. Missing values mean
 * sign-in through the B2C Sales app is not set up yet — the app still starts,
 * and the sign-in page says so rather than failing somewhere confusing.
 */
export function handoffConfig(env = process.env) {
  const b2cUrl = (env.B2C_URL || '').replace(/\/+$/, '');
  /* Render tells every service its own address, so PUBLIC_URL only needs
     setting if the app is ever given a different one. */
  const publicUrl = (env.PUBLIC_URL || env.RENDER_EXTERNAL_URL || '').replace(/\/+$/, '');
  const key = env.HANDOFF_KEY || '';
  return { b2cUrl, publicUrl, key, ready: !!(b2cUrl && publicUrl && key) };
}

/**
 * Local testing only: sign in as a made-up person without the B2C Sales app.
 * Refuses outright on Render, so it cannot be left switched on by mistake.
 */
export function devLoginEnabled(env = process.env) {
  if (env.TRAINING_DEV_LOGIN !== '1') return false;
  if (env.NODE_ENV === 'production' || env.RENDER) {
    throw new Error('TRAINING_DEV_LOGIN cannot be used on a live server. Remove it from the environment.');
  }
  return true;
}

/* ---------------------------- sessions ------------------------------ */

export function createSession(db, personId) {
  const token = randomBytes(32).toString('hex');
  const expires = new Date(Date.now() + SESSION_HOURS * 3600000).toISOString();
  db.prepare('INSERT INTO sessions (token, person_id, expires_at) VALUES (?, ?, ?)').run(token, personId, expires);
  db.prepare("UPDATE people SET last_seen_at = datetime('now') WHERE id = ?").run(personId);
  return { token, expires };
}

export function destroySession(db, token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function personForToken(db, token) {
  if (!token) return null;
  const row = db
    .prepare('SELECT s.expires_at, p.* FROM sessions s JOIN people p ON p.id = s.person_id WHERE s.token = ?')
    .get(token);
  if (!row) return null;
  if (Date.parse(row.expires_at) < Date.now()) {
    destroySession(db, token);
    return null;
  }
  if (row.status !== 'active') return null;
  const { expires_at, ...person } = row;
  return person;
}

export function purgeExpired(db) {
  const now = new Date().toISOString();
  db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
  db.prepare('DELETE FROM handoff_states WHERE expires_at < ?').run(now);
}

/* ---------------------------- cookies ------------------------------- */

export function readCookie(req, name) {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function cookie(name, value, { expires = null, maxAge = null } = {}) {
  const secure = process.env.SECURE_COOKIE === '1' ? '; Secure' : '';
  const life = maxAge !== null ? `; Max-Age=${maxAge}` : expires ? `; Expires=${new Date(expires).toUTCString()}` : '';
  return `${name}=${value}; HttpOnly; Path=/; SameSite=Lax${life}${secure}`;
}

export function setSessionCookie(res, token, expires) {
  res.append('Set-Cookie', cookie(COOKIE_NAME, token, { expires }));
}

export function clearSessionCookie(res) {
  res.append('Set-Cookie', cookie(COOKIE_NAME, '', { maxAge: 0 }));
}

/* ---------------------------- the handoff --------------------------- */

/**
 * Step one: remember a random state, put it in a cookie too, and send the
 * person to the B2C Sales app. The state coming back must match both, which
 * stops somebody else's half-finished sign-in being finished in your browser.
 */
export function startHandoff(db, res, config) {
  const state = randomBytes(24).toString('hex');
  const expires = new Date(Date.now() + STATE_MINUTES * 60000).toISOString();
  db.prepare('INSERT INTO handoff_states (state, expires_at) VALUES (?, ?)').run(state, expires);
  res.append('Set-Cookie', cookie(STATE_COOKIE, state, { maxAge: STATE_MINUTES * 60 }));
  const returnTo = `${config.publicUrl}/auth/callback`;
  return `${config.b2cUrl}/api/handoff/start?app=training&state=${state}&return=${encodeURIComponent(returnTo)}`;
}

/** True once, for a state this app issued, still in date, matching the cookie. */
export function takeState(db, state, cookieState) {
  if (!state || !cookieState || state !== cookieState) return false;
  const row = db.prepare('SELECT expires_at FROM handoff_states WHERE state = ?').get(state);
  if (!row) return false;
  db.prepare('DELETE FROM handoff_states WHERE state = ?').run(state);
  return Date.parse(row.expires_at) >= Date.now();
}

/**
 * Step two, server to server: swap the one-time code for who the person is.
 * The B2C Sales app answers { staffId, email, name, role, scheme, status }.
 */
export async function redeemWithB2C(code, config) {
  const res = await fetch(`${config.b2cUrl}/api/handoff/redeem`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${config.key}` },
    body: JSON.stringify({ code, app: 'training' }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`The B2C Sales app refused the sign-in (${res.status}).`);
  return res.json();
}

/**
 * The role somebody starts with the first time they sign in, read from the
 * B2C Sales app: its admins (Shannon, Poppy) are managers here, its Sales
 * Trainers (John, Lucy) are trainers, and everybody else is a sales
 * executive. After that the training app's own record wins, so Shannon or
 * Poppy can change it here without touching anybody's bonus set-up.
 */
export function startingRole(b2c) {
  if (b2c.role === 'admin') return 'manager';
  if (b2c.scheme === 'trainer') return 'trainer';
  return 'exec';
}

/**
 * Find or create the person behind a redeemed sign-in. Returns null, with a
 * reason, for anybody who should not get in.
 */
export function personFromB2C(db, b2c) {
  if (!b2c || !b2c.staffId || !b2c.email) return { person: null, reason: 'The B2C Sales app did not say who you are.' };
  if (b2c.status && b2c.status !== 'active') {
    return { person: null, reason: 'Your B2C Sales account is switched off.' };
  }

  let person = db.prepare('SELECT * FROM people WHERE b2c_staff_id = ?').get(Number(b2c.staffId))
    ?? db.prepare('SELECT * FROM people WHERE email = ?').get(String(b2c.email));

  if (!person) {
    const role = startingRole(b2c);
    const { lastInsertRowid } = db
      .prepare('INSERT INTO people (b2c_staff_id, email, name, role) VALUES (?, ?, ?, ?)')
      .run(Number(b2c.staffId), String(b2c.email), String(b2c.name || b2c.email), role);
    person = personById(db, lastInsertRowid);
    audit(db, person.id, 'person.created', person.id, { role, from: 'b2c-sign-in' });
  } else {
    /* Keep the name, email and link in step with the B2C Sales app, which is
       where they are maintained. The role and status are this app's own. */
    db.prepare('UPDATE people SET b2c_staff_id = ?, email = ?, name = ? WHERE id = ?')
      .run(Number(b2c.staffId), String(b2c.email), String(b2c.name || person.name), person.id);
    person = personById(db, person.id);
  }

  if (person.status !== 'active') return { person: null, reason: 'Your access to the training app is switched off. Ask Shannon or Poppy.' };
  return { person, reason: null };
}

/* ---------------------------- middleware ---------------------------- */

export function attachPerson(db) {
  return (req, res, next) => {
    req.sessionToken = readCookie(req, COOKIE_NAME);
    req.person = personForToken(db, req.sessionToken);
    next();
  };
}

export const isManager = (p) => !!p && p.role === 'manager';
export const isTrainer = (p) => !!p && (p.role === 'trainer' || p.role === 'manager');

export function requireSignedIn(req, res, next) {
  if (!req.person) return res.status(401).json({ error: 'Please sign in.' });
  next();
}

export function requireTrainer(req, res, next) {
  if (!req.person) return res.status(401).json({ error: 'Please sign in.' });
  if (!isTrainer(req.person)) return res.status(403).json({ error: 'Only trainers and managers can see that.' });
  next();
}

export function requireManager(req, res, next) {
  if (!req.person) return res.status(401).json({ error: 'Please sign in.' });
  if (!isManager(req.person)) return res.status(403).json({ error: 'Only Shannon or Poppy can do that.' });
  next();
}

/** A sales executive may load their own record and nobody else's. */
export function canSeePerson(viewer, personId) {
  if (!viewer) return false;
  if (isTrainer(viewer)) return true;
  return Number(viewer.id) === Number(personId);
}
