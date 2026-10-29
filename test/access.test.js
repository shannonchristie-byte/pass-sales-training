/* Who may see what. Every rule here is checked on the server, so a sales
   executive typing an address cannot reach trainer or manager data. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';

test('nothing but the sign-in options without signing in', async () => {
  const t = await startApp();
  try {
    for (const path of ['/api/auth/me', '/api/knowledge', '/api/training/me', '/api/training/team', '/api/people']) {
      assert.equal((await t.call(path)).status, 401, path);
    }
    assert.equal((await t.call('/api/auth/options')).status, 200);
    assert.equal((await t.call('/api/health')).status, 200);
  } finally { await t.close(); }
});

test('a sales executive sees the knowledge base and only their own training', async () => {
  const t = await startApp();
  try {
    const me = t.person('Exec A');
    const other = t.person('Exec B');

    const kb = await t.call('/api/knowledge', { as: me.token });
    assert.equal(kb.status, 200);
    assert.equal((await kb.json()).services.length, 6);

    assert.equal((await t.call('/api/training/me', { as: me.token })).status, 200);
    assert.equal((await t.call(`/api/training/person/${me.id}`, { as: me.token })).status, 200);
    assert.equal((await t.call(`/api/training/person/${other.id}`, { as: me.token })).status, 403);
    assert.equal((await t.call('/api/training/team', { as: me.token })).status, 403);
    assert.equal((await t.call('/api/people', { as: me.token })).status, 403);
    const sw = await t.call(`/api/people/${me.id}/services/pfs`, { as: me.token, method: 'PUT', body: { on: true } });
    assert.equal(sw.status, 403, 'cannot switch on their own service');
  } finally { await t.close(); }
});

test('a trainer sees everybody’s training but cannot change roles or access', async () => {
  const t = await startApp();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const exec = t.person('Exec A');

    const team = await t.call('/api/training/team', { as: trainer.token });
    assert.equal(team.status, 200);
    assert.deepEqual((await team.json()).people.map((p) => p.name), ['Exec A']);
    assert.equal((await t.call(`/api/training/person/${exec.id}`, { as: trainer.token })).status, 200);

    assert.equal((await t.call('/api/people', { as: trainer.token })).status, 403);
    const role = await t.call(`/api/people/${trainer.id}/role`, { as: trainer.token, method: 'PUT', body: { role: 'manager' } });
    assert.equal(role.status, 403, 'cannot make themselves a manager');
  } finally { await t.close(); }
});

test('a manager sets roles and switches services on and off', async () => {
  const t = await startApp();
  try {
    const mgr = t.person('Manager A', 'manager');
    const exec = t.person('Exec A');

    let res = await t.call(`/api/people/${exec.id}/services/pfs`, { as: mgr.token, method: 'PUT', body: { on: true } });
    assert.equal(res.status, 200);
    let me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(me.services.find((s) => s.key === 'pfs').on, true);

    res = await t.call(`/api/people/${exec.id}/services/pfs`, { as: mgr.token, method: 'PUT', body: { on: false } });
    me = await (await t.call('/api/training/me', { as: exec.token })).json();
    assert.equal(me.services.find((s) => s.key === 'pfs').on, false);

    res = await t.call(`/api/people/${exec.id}/services/mme`, { as: mgr.token, method: 'PUT', body: { on: true } });
    assert.equal(res.status, 400, 'MME is not a service here');

    res = await t.call(`/api/people/${exec.id}/role`, { as: mgr.token, method: 'PUT', body: { role: 'trainer' } });
    assert.equal(res.status, 200);
    assert.equal((await t.call('/api/training/team', { as: exec.token })).status, 200, 'now a trainer');

    res = await t.call(`/api/people/${exec.id}/role`, { as: mgr.token, method: 'PUT', body: { role: 'boss' } });
    assert.equal(res.status, 400);

    const audit = t.db.prepare('SELECT action FROM audit_log ORDER BY id').all().map((r) => r.action);
    assert.deepEqual(audit, ['service.on', 'service.off', 'person.role'], 'refused changes leave no trail');
  } finally { await t.close(); }
});

test('switching somebody off signs them out straight away', async () => {
  const t = await startApp();
  try {
    const mgr = t.person('Manager A', 'manager');
    const exec = t.person('Exec A');
    assert.equal((await t.call('/api/training/me', { as: exec.token })).status, 200);

    const res = await t.call(`/api/people/${exec.id}/status`, { as: mgr.token, method: 'PUT', body: { status: 'inactive' } });
    assert.equal(res.status, 200);
    assert.equal((await t.call('/api/training/me', { as: exec.token })).status, 401);
  } finally { await t.close(); }
});

test('the last manager cannot be demoted or switched off', async () => {
  const t = await startApp();
  try {
    const mgr = t.person('Manager A', 'manager');
    let res = await t.call(`/api/people/${mgr.id}/role`, { as: mgr.token, method: 'PUT', body: { role: 'exec' } });
    assert.equal(res.status, 409);
    res = await t.call(`/api/people/${mgr.id}/status`, { as: mgr.token, method: 'PUT', body: { status: 'inactive' } });
    assert.equal(res.status, 409);

    const second = t.person('Manager B', 'manager');
    res = await t.call(`/api/people/${mgr.id}/role`, { as: second.token, method: 'PUT', body: { role: 'exec' } });
    assert.equal(res.status, 200, 'fine once there is another manager');
  } finally { await t.close(); }
});
