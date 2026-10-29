/**
 * markdown.js — turns a knowledge base page into HTML.
 *
 * Only the small set of markdown the pages use: headings, paragraphs, bullet
 * and numbered lists (one level of nesting), tables, "> " quotes and "To check"
 * callouts, bold and
 * links. Everything is escaped first and only those patterns are turned back
 * into tags, so whatever somebody types into a page can never run as code.
 * Links are only followed to http(s), mailto and the app's own #/ addresses.
 */

import { escapeHtml } from './lib.js';

function inline(text) {
  let s = escapeHtml(text);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (all, label, href) => {
    const url = href.replace(/&amp;/g, '&');
    if (!/^(https?:\/\/|mailto:|#\/)/i.test(url)) return label;
    const external = /^https?:/i.test(url);
    return `<a href="${escapeHtml(url)}"${external ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return s;
}

export function headingId(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const LIST_ITEM = /^(\s*)([-*]|\d+\.)\s+(.*)$/;

export function renderMarkdown(md) {
  const lines = String(md || '').replace(/\r\n/g, '\n').split('\n');
  const out = [];
  let para = [];

  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join(' '))}</p>`);
    para = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!line.trim()) { flushPara(); continue; }

    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      flushPara();
      const level = Math.max(2, h[1].length);
      out.push(`<h${level} id="${headingId(h[2])}">${inline(h[2])}</h${level}>`);
      continue;
    }

    if (line.startsWith('>')) {
      flushPara();
      const quote = [];
      while (i < lines.length && lines[i].startsWith('>')) quote.push(lines[i++].replace(/^>\s?/, ''));
      i--;
      /* "> **To check:** …" is a flag for John or Lucy; any other quote is
         something to say on a call. They look different on purpose. */
      const kind = /^\*\*To check/i.test(quote[0] || '') ? 'callout' : 'quote';
      out.push(`<div class="${kind}">${renderMarkdown(quote.join('\n'))}</div>`);
      continue;
    }

    if (line.trim().startsWith('|')) {
      flushPara();
      const rows = [];
      while (i < lines.length && lines[i].trim().startsWith('|')) rows.push(lines[i++].trim());
      i--;
      const cells = (row) => row.replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const isRule = (row) => /^\|?\s*:?-{2,}/.test(row);
      const [head, ...rest] = rows;
      const body = rest.filter((r) => !isRule(r));
      out.push(
        '<div class="table-wrap"><table><thead><tr>' +
        cells(head).map((c) => `<th>${inline(c)}</th>`).join('') +
        '</tr></thead><tbody>' +
        body.map((r) => `<tr>${cells(r).map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`).join('') +
        '</tbody></table></div>'
      );
      continue;
    }

    if (LIST_ITEM.test(line)) {
      flushPara();
      const items = [];
      while (i < lines.length && LIST_ITEM.test(lines[i])) {
        const [, indent, marker, text] = lines[i++].match(LIST_ITEM);
        items.push({ nested: indent.length >= 2, ordered: /\d/.test(marker), text });
      }
      i--;
      out.push(renderList(items));
      continue;
    }

    para.push(line.trim());
  }
  flushPara();
  return out.join('\n');
}

/** A list, with any indented items folded under the item above them. */
function renderList(items) {
  const tag = items[0]?.ordered ? 'ol' : 'ul';
  let html = `<${tag}>`;
  for (let i = 0; i < items.length; i++) {
    if (items[i].nested) continue;
    html += `<li>${inline(items[i].text)}`;
    const kids = [];
    while (items[i + 1]?.nested) kids.push(items[++i]);
    if (kids.length) {
      const kidTag = kids[0].ordered ? 'ol' : 'ul';
      html += `<${kidTag}>${kids.map((k) => `<li>${inline(k.text)}</li>`).join('')}</${kidTag}>`;
    }
    html += '</li>';
  }
  return `${html}</${tag}>`;
}
