/* Shared helpers: state, API calls and small DOM utilities. The same shapes
   as the B2C Sales app's lib.js, so the two read alike. */

export const state = {
  user: null,
};

/* ---------------------------- API ---------------------------------- */

export async function api(path, options = {}) {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !path.startsWith('/auth')) {
    state.user = null;
    location.hash = '#/login';
    throw new Error('Please sign in again.');
  }

  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { raw: text }; }

  if (!res.ok) {
    const err = new Error(data?.error || `Something went wrong (${res.status}).`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const get = (p) => api(p);
export const post = (p, body) => api(p, { method: 'POST', body });
export const put = (p, body) => api(p, { method: 'PUT', body });

/* ---------------------------- DOM ---------------------------------- */

/**
 * Tagged template that escapes interpolated values. Use `raw()` to opt out.
 * Returns markup already marked safe, so one html`` can sit inside another
 * without being escaped twice; it turns into a plain string wherever one is
 * needed (innerHTML, concatenation).
 */
export function html(strings, ...values) {
  let out = '';
  strings.forEach((s, i) => {
    out += s;
    if (i < values.length) out += renderValue(values[i]);
  });
  return { __raw: true, value: out, toString: () => out };
}

function renderValue(v) {
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(renderValue).join('');
  if (v && v.__raw) return v.value;
  return escapeHtml(String(v));
}

export const raw = (value) => ({ __raw: true, value: value ?? '' });

export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

export const $ = (sel, root = document) => root.querySelector(sel);

/**
 * Wire up every [data-action] / [data-change] / [data-submit] inside `root` to a handler map.
 * Calling bind() again on the same element replaces the handlers rather than
 * stacking a second set on top.
 */
const listening = new WeakSet();
const handlerTable = new WeakMap();

export function bind(root, handlers) {
  handlerTable.set(root, handlers);
  if (listening.has(root)) return;
  listening.add(root);

  const run = (attr, e, { prevent = false } = {}) => {
    const target = e.target.closest(`[data-${attr}]`);
    if (!target || !root.contains(target)) return;
    const fn = handlerTable.get(root)?.[target.dataset[attr]];
    if (!fn) return;
    if (prevent) e.preventDefault();
    fn(target, e);
  };

  root.addEventListener('click', (e) => run('action', e, { prevent: true }));
  root.addEventListener('change', (e) => run('change', e));
  root.addEventListener('submit', (e) => run('submit', e, { prevent: true }));
}

/* ---------------------------- toasts -------------------------------- */

export function toast(message, kind = '') {
  const host = document.getElementById('toasts');
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, kind === 'bad' ? 7000 : 4000);
}

export const notifyError = (err) => toast(err?.message || String(err), 'bad');

/* ---------------------------- roles --------------------------------- */

export const ROLE_LABEL = { exec: 'Sales executive', trainer: 'Trainer', manager: 'Manager' };
export const isManager = () => state.user?.role === 'manager';
export const isTrainer = () => state.user?.role === 'trainer' || isManager();
