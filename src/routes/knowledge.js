/**
 * routes/knowledge.js — the knowledge base, the same for everyone.
 *
 * Every signed-in person reads every page, whatever has been switched on for
 * them in training (decided 28 Oct 2026): once someone is trained, this is
 * where they come back to.
 *
 * Changing a page has two doors, so there is one approved version of every
 * price and policy:
 *   trainers (John, Lucy) suggest a change, which waits for a manager;
 *   managers (Shannon, Poppy) publish, either their own edit or a suggestion.
 * Every publish is kept as a version, and trainers can mark a page as checked
 * once they have read it against how things really work.
 */

import express from 'express';
import { requireSignedIn, requireTrainer, requireManager } from '../auth.js';
import { SERVICES } from '../services.js';
import { audit } from '../db.js';

/** The sections that sit beside the service pages. */
export const SECTIONS = [
  { key: 'scripts', name: 'Scripts', detail: 'A script for each lead type, call guides and the voicemail template' },
  { key: 'objections', name: 'Objection handling', detail: 'What learners say, the lines to use and what to do next' },
  { key: 'rules', name: 'Sales rules and process', detail: 'The sales rules, approach, callbacks, emails and non-sale FAQs' },
  { key: 'tawk', name: 'Tawk answers', detail: 'Ready answers for live chat' },
  { key: 'resources', name: 'Sales resources', detail: 'Websites, magic links, tools, support addresses and discount codes' },
];

const MAX_BODY = 200_000;

const PAGE_LIST = `
  SELECT p.slug, p.title, p.service, p.section, p.position, p.updated_at, p.checked_at,
         c.name AS checked_by_name
    FROM kb_pages p LEFT JOIN people c ON c.id = p.checked_by
   ORDER BY p.position, p.title`;

/** A short piece of text around the first match, for search results. */
function snippet(body, q) {
  const plain = body.replace(/[#>*|`_]/g, ' ').replace(/\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\s+/g, ' ');
  const at = plain.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0) return plain.slice(0, 160);
  const from = Math.max(0, at - 70);
  return (from > 0 ? '…' : '') + plain.slice(from, at + q.length + 90) + '…';
}

export function knowledgeRoutes(db) {
  const router = express.Router();
  router.use(requireSignedIn);

  const pageBySlug = (slug) => db.prepare('SELECT * FROM kb_pages WHERE slug = ?').get(String(slug)) ?? null;

  /** Saves a new published version of a page. */
  function publish(page, { title, body, note, by }) {
    db.prepare("UPDATE kb_pages SET title = ?, body = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?")
      .run(title, body, by, page.id);
    db.prepare('INSERT INTO kb_versions (page_id, title, body, saved_by, note) VALUES (?, ?, ?, ?, ?)')
      .run(page.id, title, body, by, note || null);
  }

  function validBody(body) {
    return typeof body === 'string' && body.trim().length > 0 && body.length <= MAX_BODY;
  }

  router.get('/', (req, res) => {
    res.json({ services: SERVICES, sections: SECTIONS, pages: db.prepare(PAGE_LIST).all() });
  });

  router.get('/search', (req, res) => {
    const q = String(req.query.q || '').trim();
    if (q.length < 2) return res.json({ q, results: [] });
    const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = db
      .prepare(`SELECT slug, title, service, section, body,
                       CASE WHEN title LIKE ? ESCAPE '\\' THEN 0 ELSE 1 END AS rank
                  FROM kb_pages
                 WHERE title LIKE ? ESCAPE '\\' OR body LIKE ? ESCAPE '\\'
                 ORDER BY rank, position LIMIT 30`)
      .all(like, like, like);
    res.json({ q, results: rows.map(({ body, rank, ...r }) => ({ ...r, snippet: snippet(body, q) })) });
  });

  router.get('/pages/:slug', (req, res) => {
    const page = pageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: 'No such page.' });
    const name = (id) => (id ? db.prepare('SELECT name FROM people WHERE id = ?').get(id)?.name : null);
    const pending = db.prepare("SELECT COUNT(*) AS n FROM kb_suggestions WHERE page_id = ? AND status = 'pending'").get(page.id).n;
    res.json({
      page: { ...page, updated_by_name: name(page.updated_by), checked_by_name: name(page.checked_by) },
      pendingSuggestions: pending,
    });
  });

  /* ------------------------- managers publish ------------------------- */

  router.put('/pages/:slug', requireManager, (req, res) => {
    const page = pageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: 'No such page.' });
    const { title = page.title, body, note } = req.body || {};
    if (!validBody(body)) return res.status(400).json({ error: 'The page cannot be empty.' });
    if (!String(title).trim()) return res.status(400).json({ error: 'The page needs a title.' });
    publish(page, { title: String(title).trim(), body, note, by: req.person.id });
    audit(db, req.person.id, 'kb.publish', null, { slug: page.slug });
    res.json({ page: pageBySlug(page.slug) });
  });

  router.get('/suggestions', requireManager, (req, res) => {
    const rows = db
      .prepare(`SELECT s.id, s.body, s.note, s.suggested_at, s.based_on, p.slug, p.title, p.body AS current_body,
                       p.updated_at AS page_updated_at, who.name AS suggested_by_name
                  FROM kb_suggestions s
                  JOIN kb_pages p ON p.id = s.page_id
                  JOIN people who ON who.id = s.suggested_by
                 WHERE s.status = 'pending'
                 ORDER BY s.suggested_at`)
      .all();
    res.json({
      suggestions: rows.map((s) => ({ ...s, pageChangedSince: s.page_updated_at !== s.based_on })),
    });
  });

  router.post('/suggestions/:id/:decision', requireManager, (req, res) => {
    const { decision } = req.params;
    if (!['publish', 'reject'].includes(decision)) return res.status(404).json({ error: 'No such endpoint.' });
    const s = db.prepare("SELECT * FROM kb_suggestions WHERE id = ? AND status = 'pending'").get(Number(req.params.id));
    if (!s) return res.status(404).json({ error: 'That suggestion has already been dealt with.' });
    const page = db.prepare('SELECT * FROM kb_pages WHERE id = ?').get(s.page_id);
    if (decision === 'publish') {
      const who = db.prepare('SELECT name FROM people WHERE id = ?').get(s.suggested_by)?.name;
      publish(page, { title: page.title, body: s.body, note: `Suggested by ${who}${s.note ? `: ${s.note}` : ''}`, by: req.person.id });
    }
    db.prepare("UPDATE kb_suggestions SET status = ?, decided_by = ?, decided_at = datetime('now') WHERE id = ?")
      .run(decision === 'publish' ? 'published' : 'rejected', req.person.id, s.id);
    audit(db, req.person.id, `kb.suggestion.${decision}`, s.suggested_by, { slug: page.slug });
    res.json({ ok: true });
  });

  /* ------------------------- trainers suggest ------------------------- */

  router.post('/pages/:slug/suggestions', requireTrainer, (req, res) => {
    const page = pageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: 'No such page.' });
    const { body, note } = req.body || {};
    if (!validBody(body)) return res.status(400).json({ error: 'The page cannot be empty.' });
    if (body === page.body) return res.status(400).json({ error: 'Nothing has changed on the page.' });
    db.prepare('INSERT INTO kb_suggestions (page_id, body, note, based_on, suggested_by) VALUES (?, ?, ?, ?, ?)')
      .run(page.id, body, note ? String(note).slice(0, 1000) : null, page.updated_at, req.person.id);
    audit(db, req.person.id, 'kb.suggest', null, { slug: page.slug });
    res.status(201).json({ ok: true });
  });

  router.post('/pages/:slug/checked', requireTrainer, (req, res) => {
    const page = pageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: 'No such page.' });
    db.prepare("UPDATE kb_pages SET checked_at = datetime('now'), checked_by = ? WHERE id = ?").run(req.person.id, page.id);
    audit(db, req.person.id, 'kb.checked', null, { slug: page.slug });
    res.json({ ok: true });
  });

  router.get('/pages/:slug/versions', requireTrainer, (req, res) => {
    const page = pageBySlug(req.params.slug);
    if (!page) return res.status(404).json({ error: 'No such page.' });
    const versions = db
      .prepare(`SELECT v.id, v.title, v.body, v.saved_at, v.note, p.name AS saved_by_name
                  FROM kb_versions v LEFT JOIN people p ON p.id = v.saved_by
                 WHERE v.page_id = ? ORDER BY v.id DESC`)
      .all(page.id);
    res.json({ versions });
  });

  return router;
}
