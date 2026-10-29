/**
 * content.js — the knowledge base's starting pages.
 *
 * The first version of every page lives in content/<service>/*.md, moved
 * across from the Google Docs. On start-up any page not yet in the database is
 * added from its file. A page that is already there is never touched again,
 * because from then on the database copy is the real one: it is what managers
 * edit, and overwriting it from a file would quietly undo their changes.
 *
 * Each file starts with a few `key: value` lines, then a line of three dashes,
 * then the page in markdown:
 *
 *   slug: pfs-prices
 *   title: Prices
 *   service: pfs
 *   position: 60
 *   source: PFS sales process and policies (Google Doc), 28 Oct 2026
 *   ---
 *   ## Prices ...
 */

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const CONTENT_DIR = resolve(here, '..', 'content');

export function parsePageFile(text) {
  const split = text.indexOf('\n---');
  if (split < 0) throw new Error('No --- line between the details and the page.');
  const meta = {};
  for (const line of text.slice(0, split).split('\n')) {
    const m = line.match(/^([a-z]+):\s*(.*)$/);
    if (m) meta[m[1]] = m[2].trim();
  }
  if (!meta.slug || !meta.title) throw new Error('A page needs a slug and a title.');
  return {
    slug: meta.slug,
    title: meta.title,
    service: meta.service || null,
    section: meta.section || null,
    position: Number(meta.position) || 0,
    source: meta.source || null,
    body: text.slice(split + 4).replace(/^\r?\n/, '').trimEnd() + '\n',
  };
}

export function contentFiles(dir = CONTENT_DIR) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...contentFiles(path));
    else if (entry.name.endsWith('.md')) out.push(path);
  }
  return out.sort();
}

/** Add any page that is not in the database yet. Returns how many were added. */
export function loadNewPages(db, dir = CONTENT_DIR) {
  const exists = db.prepare('SELECT 1 FROM kb_pages WHERE slug = ?');
  const insert = db.prepare(
    'INSERT INTO kb_pages (slug, service, section, title, position, body, source) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const version = db.prepare("INSERT INTO kb_versions (page_id, title, body, note) VALUES (?, ?, ?, 'Moved across from the Google Doc')");
  let added = 0;
  for (const file of contentFiles(dir)) {
    const page = parsePageFile(readFileSync(file, 'utf8').replace(/\r\n/g, '\n'));
    if (exists.get(page.slug)) continue;
    const { lastInsertRowid } = insert.run(page.slug, page.service, page.section, page.title, page.position, page.body, page.source);
    version.run(lastInsertRowid, page.title, page.body);
    added++;
  }
  return added;
}
