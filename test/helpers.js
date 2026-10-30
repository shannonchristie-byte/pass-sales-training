/* Test helpers: a fresh app on an in-memory database, listening on a spare
   port, and a quick way to be somebody. */

import { openDb } from '../src/db.js';
import { createApp } from '../src/app.js';
import { createSession, COOKIE_NAME } from '../src/auth.js';

export const READY = { b2cUrl: 'https://b2c.example.test', publicUrl: 'https://training.example.test', key: 'test-key', ready: true };
export const NOT_READY = { b2cUrl: '', publicUrl: '', key: '', ready: false };

export async function startApp({ config = NOT_READY, devLogin = false, redeem, feed, askModel } = {}) {
  const db = openDb(':memory:');
  const app = createApp({ db, config, devLogin, redeem, feed, askModel, quiet: true });
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${server.address().port}`;

  /** fetch against the app, optionally as somebody (a session cookie). */
  const call = (path, { as = null, method = 'GET', body, cookie } = {}) =>
    fetch(base + path, {
      method,
      redirect: 'manual',
      headers: {
        'Content-Type': 'application/json',
        ...(as || cookie ? { Cookie: [as && `${COOKIE_NAME}=${as}`, cookie].filter(Boolean).join('; ') } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

  /** Add a person and sign them in; returns { id, token }. */
  const person = (name, role = 'exec', status = 'active') => {
    const email = `${name.toLowerCase().replace(/\s+/g, '.')}@example.test`;
    const { lastInsertRowid } = db
      .prepare('INSERT INTO people (email, name, role, status) VALUES (?, ?, ?, ?)')
      .run(email, name, role, status);
    const id = Number(lastInsertRowid);
    const { token } = createSession(db, id);
    return { id, token };
  };

  return { db, base, call, person, close: () => new Promise((r) => server.close(r)) };
}

/** The name=value pairs a response asked the browser to set. */
export function setCookies(res) {
  const out = {};
  for (const line of res.headers.getSetCookie()) {
    const [pair] = line.split(';');
    const [k, ...v] = pair.split('=');
    out[k.trim()] = v.join('=');
  }
  return out;
}
