/* Signing in through the B2C Sales app. A pretend B2C Sales app stands in
   for the real one: `redeem` is what the training app would have asked it. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp, setCookies, READY } from './helpers.js';
import { COOKIE_NAME, STATE_COOKIE, devLoginEnabled } from '../src/auth.js';

const b2cPerson = (over = {}) => ({ staffId: 7, email: 'sam@example.test', name: 'Sam Test', role: 'staff', scheme: 'exec', status: 'active', ...over });

/** Run /auth/start, then come back to /auth/callback as the B2C Sales app would. */
async function signIn(t, { tamper = null } = {}) {
  const start = await t.call('/auth/start');
  assert.equal(start.status, 302);
  const to = new URL(start.headers.get('location'));
  const state = to.searchParams.get('state');
  const stateCookie = setCookies(start)[STATE_COOKIE];
  const back = await t.call(`/auth/callback?code=one-time&state=${tamper?.state ?? state}`, {
    cookie: `${STATE_COOKIE}=${tamper?.cookie ?? stateCookie}`,
  });
  return { to, back, session: setCookies(back)[COOKIE_NAME] };
}

test('without the B2C Sales app set up, sign-in says so', async () => {
  const t = await startApp();
  try {
    const res = await t.call('/auth/start');
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/#/login?problem=not-set-up');
  } finally { await t.close(); }
});

test('start sends people to the B2C Sales app with a return address', async () => {
  const t = await startApp({ config: READY, redeem: async () => b2cPerson() });
  try {
    const { to } = await signIn(t);
    assert.equal(to.origin, 'https://b2c.example.test');
    assert.equal(to.pathname, '/api/handoff/start');
    assert.equal(to.searchParams.get('return'), 'https://training.example.test/auth/callback');
    assert.match(to.searchParams.get('state'), /^[0-9a-f]{48}$/);
  } finally { await t.close(); }
});

test('a good handoff signs the person in, with a starting role from the B2C Sales app', async () => {
  const seen = [];
  const people = [
    b2cPerson({ staffId: 1, email: 'boss@example.test', name: 'Boss', role: 'admin' }),
    b2cPerson({ staffId: 2, email: 'coach@example.test', name: 'Coach', scheme: 'trainer' }),
    b2cPerson({ staffId: 3, email: 'rep@example.test', name: 'Rep' }),
  ];
  let next = 0;
  const t = await startApp({
    config: READY,
    redeem: async (code, config) => { seen.push({ code, key: config.key }); return people[next++]; },
  });
  try {
    for (const expected of ['manager', 'trainer', 'exec']) {
      const { back, session } = await signIn(t);
      assert.equal(back.headers.get('location'), '/');
      assert.ok(session, 'session cookie set');
      const me = await (await t.call('/api/auth/me', { as: session })).json();
      assert.equal(me.role, expected);
    }
    assert.deepEqual(seen[0], { code: 'one-time', key: 'test-key' });
  } finally { await t.close(); }
});

test('signing in again keeps the role set here, and picks up a new name', async () => {
  let who = b2cPerson();
  const t = await startApp({ config: READY, redeem: async () => who });
  try {
    await signIn(t);
    t.db.prepare("UPDATE people SET role = 'trainer' WHERE b2c_staff_id = 7").run();
    who = b2cPerson({ name: 'Sam Renamed' });
    const { session } = await signIn(t);
    const me = await (await t.call('/api/auth/me', { as: session })).json();
    assert.equal(me.role, 'trainer');
    assert.equal(me.name, 'Sam Renamed');
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM people').get().n, 1);
  } finally { await t.close(); }
});

test('a state that does not match the cookie, or is used twice, is refused', async () => {
  const t = await startApp({ config: READY, redeem: async () => b2cPerson() });
  try {
    const wrong = await signIn(t, { tamper: { cookie: 'somebody-else' } });
    assert.equal(wrong.back.headers.get('location'), '/#/login?problem=expired');
    assert.equal(wrong.session, undefined);

    const start = await t.call('/auth/start');
    const state = new URL(start.headers.get('location')).searchParams.get('state');
    const cookie = `${STATE_COOKIE}=${setCookies(start)[STATE_COOKIE]}`;
    const first = await t.call(`/auth/callback?code=x&state=${state}`, { cookie });
    assert.equal(first.headers.get('location'), '/');
    const again = await t.call(`/auth/callback?code=x&state=${state}`, { cookie });
    assert.equal(again.headers.get('location'), '/#/login?problem=expired');
  } finally { await t.close(); }
});

test('people switched off in either app cannot get in', async () => {
  let who = b2cPerson({ status: 'inactive' });
  const t = await startApp({ config: READY, redeem: async () => who });
  try {
    let { back } = await signIn(t);
    assert.equal(back.headers.get('location'), '/#/login?problem=switched-off');

    who = b2cPerson();
    await signIn(t);
    t.db.prepare("UPDATE people SET status = 'inactive'").run();
    ({ back } = await signIn(t));
    assert.equal(back.headers.get('location'), '/#/login?problem=no-access');
  } finally { await t.close(); }
});

test('if the B2C Sales app refuses the code, nobody is signed in', async () => {
  const t = await startApp({ config: READY, redeem: async () => { throw new Error('401'); } });
  try {
    const { back, session } = await signIn(t);
    assert.equal(back.headers.get('location'), '/#/login?problem=refused');
    assert.equal(session, undefined);
  } finally { await t.close(); }
});

test('test sign-in can never be switched on for a live server', () => {
  assert.equal(devLoginEnabled({}), false);
  assert.equal(devLoginEnabled({ TRAINING_DEV_LOGIN: '1' }), true);
  assert.throws(() => devLoginEnabled({ TRAINING_DEV_LOGIN: '1', NODE_ENV: 'production' }));
  assert.throws(() => devLoginEnabled({ TRAINING_DEV_LOGIN: '1', RENDER: 'true' }));
});

test('test sign-in does not exist unless switched on', async () => {
  const t = await startApp();
  try {
    const p = t.person('Exec A');
    assert.equal((await t.call('/api/auth/dev', { method: 'POST', body: { personId: p.id } })).status, 404);
  } finally { await t.close(); }
});

test('on Render, the app uses the address Render gives it', async () => {
  const { handoffConfig } = await import('../src/auth.js');
  const env = { B2C_URL: 'https://b2c.example.test/', HANDOFF_KEY: 'k', RENDER_EXTERNAL_URL: 'https://training.example.test' };
  assert.deepEqual(handoffConfig(env), { b2cUrl: 'https://b2c.example.test', publicUrl: 'https://training.example.test', key: 'k', ready: true });
  assert.equal(handoffConfig({ ...env, PUBLIC_URL: 'https://other.example.test' }).publicUrl, 'https://other.example.test', 'PUBLIC_URL still wins if set');
});
