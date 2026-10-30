/* "Ask a question": answers come from the knowledge base as it is now, with
   the pages they used; without an API key the matching parts are the answer.
   A pretend Claude stands in for the real one. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { loadNewPages } from '../src/content.js';
import { claudeAnswer, CHAT_MODEL } from '../src/kb-chat.js';

test('without an API key, the best matching parts come back', async () => {
  const t = await startApp({ askModel: async () => null });
  try {
    loadNewPages(t.db);
    const exec = t.person('Exec A');
    assert.equal((await t.call('/api/knowledge/ask', { method: 'POST', body: { question: 'payl8r' } })).status, 401);
    assert.equal((await t.call('/api/knowledge/ask', { as: exec.token, method: 'POST', body: { question: '  ' } })).status, 400);

    const res = await (await t.call('/api/knowledge/ask', { as: exec.token, method: 'POST', body: { question: 'Can I offer Payl8r?' } })).json();
    assert.equal(res.mode, 'search');
    assert.equal(res.answer, null);
    assert.equal(res.parts[0].slug, 'pfs-payment');
    assert.ok(res.sources.some((s) => s.slug === 'pfs-payment'));
  } finally { await t.close(); }
});

test('answers use the pages as they are now, so an edit shows straight away', async () => {
  const seen = [];
  const askModel = async (question, parts, history) => {
    seen.push({ question, parts, history });
    return `Answer to: ${question}`;
  };
  const t = await startApp({ askModel });
  try {
    loadNewPages(t.db);
    const exec = t.person('Exec A');
    const trainer = t.person('Trainer A', 'trainer');

    await t.call('/api/knowledge/pages/pfs-demos', { as: trainer.token, method: 'PUT', body: { body: '## Demos\nThe zebra demo runs on Fridays.' } });
    const res = await (await t.call('/api/knowledge/ask', { as: exec.token, method: 'POST', body: { question: 'When is the zebra demo?' } })).json();
    assert.equal(res.mode, 'ai');
    assert.equal(res.answer, 'Answer to: When is the zebra demo?');
    assert.match(seen[0].parts[0].text, /zebra demo runs on Fridays/);
    assert.deepEqual(res.parts, [], 'with an answer, the raw parts aren’t sent');

    await t.call('/api/knowledge/ask', { as: exec.token, method: 'POST', body: { question: 'And on Mondays?', history: [{ q: 'When is the zebra demo?', a: 'Fridays.' }] } });
    assert.deepEqual(seen[1].history, [{ q: 'When is the zebra demo?', a: 'Fridays.' }]);
    assert.match(seen[1].parts[0].text, /zebra/, 'a follow-up finds pages through the question before it');
  } finally { await t.close(); }
});

test('if Claude fails, the person still gets the matching parts and a plain message', async () => {
  const t = await startApp({ askModel: async () => { throw new Error('down'); } });
  try {
    loadNewPages(t.db);
    const exec = t.person('Exec A');
    const res = await (await t.call('/api/knowledge/ask', { as: exec.token, method: 'POST', body: { question: 'payl8r' } })).json();
    assert.equal(res.mode, 'search');
    assert.match(res.error, /couldn’t answer/);
    assert.ok(res.parts.length);
  } finally { await t.close(); }
});

test('the request to Claude: Haiku, cached instructions, the extracts, and refusals handled', async () => {
  const calls = [];
  const fake = (reply) => ({ messages: { create: async (req) => { calls.push(req); return reply; } } });
  const parts = [{ slug: 'pfs-payment', title: 'Payment options', heading: 'Payl8r', text: '## Payl8r\nOnly say it is an option.' }];

  const answer = await claudeAnswer('Payl8r?', parts, [{ q: 'Hi', a: 'Hello' }], {
    client: fake({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'Only say it’s an option.' }] }),
  });
  assert.equal(answer, 'Only say it’s an option.');
  const req = calls[0];
  assert.equal(req.model, CHAT_MODEL);
  assert.equal(req.system[0].cache_control.type, 'ephemeral');
  assert.equal(req.model, 'claude-haiku-5-5');
  assert.equal(req.messages.length, 3, 'one earlier question and answer, then this one');
  assert.match(req.messages[2].content, /slug="pfs-payment"/);
  assert.match(req.messages[2].content, /Question: Payl8r\?/);

  const refused = await claudeAnswer('x', parts, [], { client: fake({ stop_reason: 'refusal', content: [] }) });
  assert.match(refused, /can’t answer/);
});
