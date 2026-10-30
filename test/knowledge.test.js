/* The knowledge base: everyone reads, trainers suggest, managers publish,
   and nothing written is ever lost. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startApp } from './helpers.js';
import { loadNewPages, contentFiles, parsePageFile } from '../src/content.js';
import { readFileSync } from 'node:fs';
import { renderMarkdown } from '../public/markdown.js';

async function withPages() {
  const t = await startApp();
  loadNewPages(t.db);
  return t;
}

test('every content file is a valid page with a unique slug', () => {
  const files = contentFiles();
  assert.ok(files.length >= 11, 'the PFS pages are there');
  const slugs = files.map((f) => parsePageFile(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')).slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test('every page belongs to a known service or section', async () => {
  const { SERVICE_KEYS } = await import('../src/services.js');
  const { SECTIONS } = await import('../src/routes/knowledge.js');
  const sections = SECTIONS.map((s) => s.key);
  for (const f of contentFiles()) {
    const p = parsePageFile(readFileSync(f, 'utf8').replace(/\r\n/g, '\n'));
    assert.ok(SERVICE_KEYS.includes(p.service) !== sections.includes(p.section), `${p.slug} needs exactly one of service or section`);
  }
});

test('every link between pages points at a page that exists', () => {
  const pages = contentFiles().map((f) => parsePageFile(readFileSync(f, 'utf8').replace(/\r\n/g, '\n')));
  const slugs = new Set(pages.map((p) => p.slug));
  for (const p of pages) {
    for (const [, slug] of p.body.matchAll(/\(#\/kb\/p\?slug=([a-z0-9-]+)\)/g)) {
      assert.ok(slugs.has(slug), `${p.slug} links to missing page ${slug}`);
    }
  }
});

test('no content file holds a password or login', () => {
  for (const f of contentFiles()) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /password|passcode|login details/i, f);
  }
});

test('loading pages twice adds them once, and never undoes an edit', async () => {
  const t = await withPages();
  try {
    const count = t.db.prepare('SELECT COUNT(*) AS n FROM kb_pages').get().n;
    t.db.prepare("UPDATE kb_pages SET body = 'Edited' WHERE slug = 'pfs-prices'").run();
    assert.equal(loadNewPages(t.db), 0);
    assert.equal(t.db.prepare('SELECT COUNT(*) AS n FROM kb_pages').get().n, count);
    assert.equal(t.db.prepare("SELECT body FROM kb_pages WHERE slug = 'pfs-prices'").get().body, 'Edited');
  } finally { await t.close(); }
});

test('everyone reads every page and can search', async () => {
  const t = await withPages();
  try {
    const exec = t.person('Exec A');
    const index = await (await t.call('/api/knowledge', { as: exec.token })).json();
    assert.ok(index.pages.some((p) => p.slug === 'pfs-prices' && p.service === 'pfs'));

    const page = await t.call('/api/knowledge/pages/pfs-prices', { as: exec.token });
    assert.equal(page.status, 200);
    assert.match((await page.json()).page.body, /£499\.20/);

    const found = await (await t.call('/api/knowledge/search?q=payl8r', { as: exec.token })).json();
    assert.ok(found.results.some((r) => r.slug === 'pfs-payment'));
    assert.ok(found.results.every((r) => typeof r.snippet === 'string' && !('body' in r)));

    const odd = await (await t.call('/api/knowledge/search?q=100%25', { as: exec.token })).json();
    assert.ok(Array.isArray(odd.results), 'a % in the search is taken literally');
  } finally { await t.close(); }
});

test('a sales executive cannot edit, suggest or mark pages checked', async () => {
  const t = await withPages();
  try {
    const exec = t.person('Exec A');
    const tries = [
      ['PUT', '/api/knowledge/pages/pfs-prices', { body: 'x' }],
      ['POST', '/api/knowledge/pages/pfs-prices/suggestions', { body: 'x' }],
      ['POST', '/api/knowledge/pages/pfs-prices/checked'],
      ['GET', '/api/knowledge/pages/pfs-prices/versions'],
      ['GET', '/api/knowledge/suggestions'],
    ];
    for (const [method, path, body] of tries) {
      assert.equal((await t.call(path, { as: exec.token, method, body })).status, 403, `${method} ${path}`);
    }
  } finally { await t.close(); }
});

test('a trainer suggests, and only a manager publishes', async () => {
  const t = await withPages();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const mgr = t.person('Manager A', 'manager');
    const before = (await (await t.call('/api/knowledge/pages/pfs-discounts', { as: trainer.token })).json()).page.body;

    assert.equal((await t.call('/api/knowledge/pages/pfs-discounts', { as: trainer.token, method: 'PUT', body: { body: 'Mine' } })).status, 403);

    let res = await t.call('/api/knowledge/pages/pfs-discounts/suggestions', { as: trainer.token, method: 'POST', body: { body: `${before}\nNew line.`, note: 'Added a line' } });
    assert.equal(res.status, 201);
    res = await t.call('/api/knowledge/pages/pfs-discounts/suggestions', { as: trainer.token, method: 'POST', body: { body: before } });
    assert.equal(res.status, 400, 'a suggestion that changes nothing is refused');

    const page = await (await t.call('/api/knowledge/pages/pfs-discounts', { as: trainer.token })).json();
    assert.equal(page.page.body, before, 'nothing changes until a manager publishes');

    const { suggestions } = await (await t.call('/api/knowledge/suggestions', { as: mgr.token })).json();
    assert.equal(suggestions.length, 1);
    assert.equal(suggestions[0].suggested_by_name, 'Trainer A');
    assert.equal(suggestions[0].pageChangedSince, false);

    res = await t.call(`/api/knowledge/suggestions/${suggestions[0].id}/publish`, { as: mgr.token, method: 'POST' });
    assert.equal(res.status, 200);
    const after = await (await t.call('/api/knowledge/pages/pfs-discounts', { as: trainer.token })).json();
    assert.match(after.page.body, /New line\.$/m);

    res = await t.call(`/api/knowledge/suggestions/${suggestions[0].id}/publish`, { as: mgr.token, method: 'POST' });
    assert.equal(res.status, 404, 'a suggestion is dealt with once');

    const { versions } = await (await t.call('/api/knowledge/pages/pfs-discounts/versions', { as: trainer.token })).json();
    assert.equal(versions.length, 2, 'the original is kept');
    assert.match(versions[0].note, /Suggested by Trainer A: Added a line/);
  } finally { await t.close(); }
});

test('a rejected suggestion changes nothing, and a stale one is flagged', async () => {
  const t = await withPages();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const mgr = t.person('Manager A', 'manager');
    await t.call('/api/knowledge/pages/pfs-demos/suggestions', { as: trainer.token, method: 'POST', body: { body: 'Shorter' } });
    await t.call('/api/knowledge/pages/pfs-demos', { as: mgr.token, method: 'PUT', body: { body: 'Manager edit', note: 'tidy' } });
    t.db.prepare("UPDATE kb_pages SET updated_at = datetime('now', '+1 minute') WHERE slug = 'pfs-demos'").run();

    const { suggestions } = await (await t.call('/api/knowledge/suggestions', { as: mgr.token })).json();
    assert.equal(suggestions[0].pageChangedSince, true);

    await t.call(`/api/knowledge/suggestions/${suggestions[0].id}/reject`, { as: mgr.token, method: 'POST' });
    const page = await (await t.call('/api/knowledge/pages/pfs-demos', { as: mgr.token })).json();
    assert.equal(page.page.body, 'Manager edit');
    assert.equal((await (await t.call('/api/knowledge/suggestions', { as: mgr.token })).json()).suggestions.length, 0);
  } finally { await t.close(); }
});

test('a manager cannot publish an empty page, and trainers mark pages checked', async () => {
  const t = await withPages();
  try {
    const trainer = t.person('Trainer A', 'trainer');
    const mgr = t.person('Manager A', 'manager');
    assert.equal((await t.call('/api/knowledge/pages/pfs-prices', { as: mgr.token, method: 'PUT', body: { body: '   ' } })).status, 400);

    assert.equal((await t.call('/api/knowledge/pages/pfs-prices/checked', { as: trainer.token, method: 'POST' })).status, 200);
    const { page } = await (await t.call('/api/knowledge/pages/pfs-prices', { as: mgr.token })).json();
    assert.equal(page.checked_by_name, 'Trainer A');
    assert.ok(page.checked_at);
  } finally { await t.close(); }
});

test('page text can never run as code', () => {
  const out = renderMarkdown('<script>alert(1)</script>\n\n[bad](javascript:alert(1)) [good](https://example.test) **bold**\n\n| a | b |\n| --- | --- |\n| <img src=x onerror=1> | x |');
  assert.doesNotMatch(out, /<script|<img|href="javascript/i);
  assert.match(out, /&lt;script&gt;/);
  assert.match(out, /<a href="https:\/\/example\.test"/);
  assert.match(out, /<strong>bold<\/strong>/);
  assert.match(out, /<table>/);
});

test('markdown lists nest one level and callouts render', () => {
  const out = renderMarkdown('1. One\n    - Sub\n2. Two\n\n> **To check:** this');
  assert.match(out, /<ol><li>One<ul><li>Sub<\/li><\/ul><\/li><li>Two<\/li><\/ol>/);
  assert.match(out, /<div class="callout"><p><strong>To check:<\/strong> this<\/p><\/div>/);
  assert.match(renderMarkdown('> "Hi, is that Sam?"'), /<div class="quote">/, 'a line to say on a call is a quote, not a warning');
});

test('a whole service comes back as one page, in order, for everyone', async () => {
  const t = await withPages();
  try {
    const exec = t.person('Exec A');
    const res = await t.call('/api/knowledge/all/pfs', { as: exec.token });
    assert.equal(res.status, 200);
    const { item, pages } = await res.json();
    assert.equal(item.key, 'pfs');
    assert.ok(pages.length >= 11);
    assert.ok(pages.every((p) => p.service === 'pfs' && typeof p.body === 'string'));
    const positions = pages.map((p) => p.position);
    assert.deepEqual(positions, [...positions].sort((a, b) => a - b), 'in page order');

    const section = await (await t.call('/api/knowledge/all/objections', { as: exec.token })).json();
    assert.ok(section.pages.length >= 9, 'sections work the same way');
    assert.equal((await t.call('/api/knowledge/all/mme', { as: exec.token })).status, 404);
    assert.equal((await t.call('/api/knowledge/all/pfs')).status, 401, 'signed in only');
  } finally { await t.close(); }
});
