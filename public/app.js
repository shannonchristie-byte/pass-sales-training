/* App shell: sign in, navigation and routing across both parts of the app. */

import {
  state, get, post, put, html, raw, bind, $, toast, notifyError,
  ROLE_LABEL, isManager, isTrainer,
} from './lib.js';
import { icon } from './icons.js';
import { renderMarkdown } from './markdown.js';

/* ---------------------------- routes -------------------------------- */

/**
 * Each path carries its part of the app, so the sidebar knows which half to
 * show and a pasted link lands where it should. `trainer` and `manager` hide a
 * screen from the menu; the server refuses the data either way.
 */
const ROUTES = {
  '/kb': { part: 'kb', title: 'Knowledge base', view: kbHome },
  '/kb/s': { part: 'kb', title: 'Knowledge base', view: kbService },
  '/kb/p': { part: 'kb', title: 'Knowledge base', view: kbArticle },
  '/kb/search': { part: 'kb', title: 'Search', view: kbSearch },
  '/kb/ask': { part: 'kb', title: 'Ask a question', view: kbAsk },
  '/kb/edit': { part: 'kb', title: 'Edit page', view: kbEdit, trainer: true },
  '/kb/new': { part: 'kb', title: 'Add a section', view: kbNew, trainer: true },
  '/kb/history': { part: 'kb', title: 'Page history', view: kbHistory, trainer: true },
  '/kb/suggestions': { part: 'kb', title: 'Suggested changes', view: kbSuggestions, manager: true },
  '/training': { part: 'training', title: 'My training', view: myTraining },
  '/training/quiz': { part: 'training', title: 'Quiz', view: takeQuiz },
  '/training/course': { part: 'training', title: 'Course', view: takeCourse },
  '/training/team': { part: 'training', title: 'Team', view: team, trainer: true },
  '/training/person': { part: 'training', title: 'Training record', view: personTraining, trainer: true },
  '/training/tracker': { part: 'training', title: 'Tracker', view: tracker, trainer: true },
  '/training/help': { part: 'training', title: 'Help requests', view: helpRequests, trainer: true },
  '/training/questions': { part: 'training', title: 'Quiz questions', view: manageQuestions, trainer: true },
  '/training/resources': { part: 'training', title: 'Training resources', view: manageResources, trainer: true },
  '/training/plan': { part: 'training', title: 'New starter plan', view: managePlan, manager: true },
  '/manage/people': { part: 'training', title: 'People and access', view: managePeople, manager: true },
};

function parseHash() {
  const [path, query = ''] = (location.hash.slice(1) || '/kb').split('?');
  return { path, params: new URLSearchParams(query) };
}

/* ---------------------------- start --------------------------------- */

async function start() {
  try {
    state.user = await get('/auth/me');
  } catch {
    state.user = null;
  }
  window.addEventListener('hashchange', route);
  route();
}

/** The list of services, sections and pages, for the sidebar. Kept until a page changes. */
async function kbIndex({ fresh = false } = {}) {
  if (!state.kb || fresh) state.kb = await get('/knowledge');
  return state.kb;
}

async function route() {
  const { path, params } = parseHash();
  if (!state.user || path === '/login') return loginScreen(params);
  try { await kbIndex(); } catch { /* the view will say what went wrong */ }

  const match = Object.keys(ROUTES)
    .filter((p) => path === p || path.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0];
  const r = ROUTES[match] || ROUTES['/kb'];
  if ((r.manager && !isManager()) || (r.trainer && !isTrainer())) {
    location.hash = '#/kb';
    return;
  }
  shell(r, path);
  document.title = `${r.title} · Sales training`;
  const main = $('#main');
  main.innerHTML = '<p class="muted">Loading…</p>';
  r.view(main, { path, params }).catch((err) => {
    main.innerHTML = html`<div class="card"><p>${err.message}</p></div>`;
  });
}

/* ---------------------------- sign in ------------------------------- */

const PROBLEMS = {
  'not-set-up': 'Signing in through the B2C Sales app is not set up yet.',
  expired: 'That sign-in took too long or was started in another window. Please try again.',
  refused: 'The B2C Sales app did not confirm your sign-in. Please try again.',
  'switched-off': 'Your B2C Sales account is switched off, so you cannot sign in here.',
  'no-access': 'Your access to the training app is switched off. Ask Shannon or Poppy.',
};

async function loginScreen(params) {
  const root = $('#root');
  let options = { handoffReady: false, devLogin: false };
  try { options = await get('/auth/options'); } catch { /* shown as not set up */ }
  const problem = PROBLEMS[params.get('problem')];

  root.innerHTML = html`
    <div class="login-wrap">
      <div class="card login-card">
        <img class="wordmark" src="/logo/pass-wordmark.svg" alt="Pass">
        <h1>Sales training</h1>
        <p class="muted">The knowledge base and your training, in one place.</p>
        ${problem ? html`<p class="notice bad">${problem}</p>` : ''}
        ${options.handoffReady
          ? html`<a class="btn primary wide" href="/auth/start">Sign in with your B2C Sales login</a>`
          : html`<p class="notice">Sign-in through the B2C Sales app is not set up on this copy yet.</p>`}
        ${options.devLogin ? html`
          <div class="dev-login">
            <h3>Test sign-in</h3>
            <p class="muted small">Made-up people, on this machine only.</p>
            ${(options.devPeople || []).length
              ? options.devPeople.map((p) => html`
                  <button class="btn wide" data-action="dev" data-id="${p.id}">
                    ${p.name} <span class="muted">· ${ROLE_LABEL[p.role]}</span>
                  </button>`)
              : html`<p class="muted small">None yet. Run npm run seed:dev.</p>`}
          </div>` : ''}
      </div>
    </div>`;

  bind(root, {
    dev: async (el) => {
      try {
        await post('/auth/dev', { personId: Number(el.dataset.id) });
        state.user = await get('/auth/me');
        location.hash = '#/kb';
        route();
      } catch (err) { notifyError(err); }
    },
  });
}

/* ---------------------------- shell --------------------------------- */

function navLink(href, label, iconName, current) {
  const active = current === href || current.startsWith(`${href}/`);
  return html`<a class="nav-link ${active ? 'active' : ''}" href="#${href}">${raw(icon(iconName))}<span>${label}</span></a>`;
}

function shell(r, path) {
  const root = $('#root');
  const u = state.user;
  const part = r.part;

  root.innerHTML = html`
    <div class="layout">
      <aside class="sidebar">
        <div class="brand">
          <img class="wordmark" src="/logo/pass-wordmark.svg" alt="Pass">
          <div class="brand-sub">Sales training</div>
        </div>
        <div class="parts" role="tablist">
          <a class="part ${part === 'kb' ? 'active' : ''}" href="#/kb">${raw(icon('book-open', { size: 'sm' }))} Knowledge base</a>
          <a class="part ${part === 'training' ? 'active' : ''}" href="#/training">${raw(icon('graduation-cap', { size: 'sm' }))} Training</a>
        </div>
        <nav>
          ${part === 'kb' ? html`
            <form class="search" data-submit="search" role="search">
              <input type="search" name="q" placeholder="Search everything" aria-label="Search the knowledge base" value="${path === '/kb/search' ? parseHash().params.get('q') || '' : ''}">
            </form>
            ${navLink('/kb', 'Home', 'home', path === '/kb' ? path : '')}
            ${navLink('/kb/ask', 'Ask a question', 'message-circle', path)}
            <div class="nav-heading">Services</div>
            ${(state.kb?.services || []).map((s) => {
              const here = path.startsWith('/kb/') && (parseHash().params.get('key') === s.key || state.kb.pages.find((p) => p.slug === parseHash().params.get('slug'))?.service === s.key);
              return html`<a class="nav-link ${here ? 'active' : ''}" href="#/kb/s?key=${s.key}"><span>${s.name}</span></a>`;
            })}
            <div class="nav-heading">For every service</div>
            ${(state.kb?.sections || []).map((s) => {
              const here = path.startsWith('/kb/') && (parseHash().params.get('key') === s.key || state.kb.pages.find((p) => p.slug === parseHash().params.get('slug'))?.section === s.key);
              return html`<a class="nav-link ${here ? 'active' : ''}" href="#/kb/s?key=${s.key}"><span>${s.name}</span></a>`;
            })}
            ${isManager() ? html`<div class="nav-heading">Manage</div>${navLink('/kb/suggestions', 'Suggested changes', 'message-circle', path)}` : ''}
          ` : html`
            ${navLink('/training', 'My training', 'user', path === '/training' || path === '/training/quiz' ? '/training' : '')}
            ${isTrainer() ? html`
              ${navLink('/training/team', 'Team', 'users', path === '/training/person' ? '/training/team' : path)}
              ${navLink('/training/tracker', 'Tracker', 'chart-bar', path)}
              <a class="nav-link ${path === '/training/help' ? 'active' : ''}" href="#/training/help">${raw(icon('message-circle'))}<span>Help requests</span><span class="count" id="help-count" hidden></span></a>
              <div class="nav-heading">Training content</div>
              ${navLink('/training/questions', 'Quiz questions', 'clipboard-list', path)}
              ${navLink('/training/resources', 'Resources', 'book-open', path)}` : ''}
            ${isManager() ? html`<div class="nav-heading">Manage</div>
              ${navLink('/training/plan', 'New starter plan', 'calendar', path)}
              ${navLink('/manage/people', 'People and access', 'settings', path)}` : ''}
          `}
        </nav>
        <div class="me">
          <div class="me-name">${u.name}</div>
          <div class="muted small">${ROLE_LABEL[u.role]}</div>
          <button class="btn small" data-action="logout">Sign out</button>
        </div>
      </aside>
      <main id="main" class="main"></main>
    </div>`;

  /* How many help requests are waiting, beside the menu item. Filled in after
     the page draws so it never holds the page up. */
  if (part === 'training' && isTrainer()) refreshHelpCount();

  bind(root, {
    search: (form) => {
      const q = new FormData(form).get('q').trim();
      if (q) location.hash = `#/kb/search?q=${encodeURIComponent(q)}`;
    },
    logout: async () => {
      try { await post('/auth/logout'); } catch { /* signed out either way */ }
      state.user = null;
      location.hash = '#/login';
    },
  });
}

function refreshHelpCount() {
  get('/coaching/help/count').then(({ open }) => {
    const el = $('#help-count');
    if (!el) return;
    el.textContent = open;
    el.hidden = !open;
  }).catch(() => {});
}

/* ---------------------------- knowledge base ------------------------ */

const fmtDate = (sql) => (sql ? new Date(`${sql.replace(' ', 'T')}Z`).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '');

const pagesFor = (kb, field, key) => kb.pages.filter((p) => p[field] === key);

function checkedBadge(p) {
  return p.checked_at
    ? html`<span class="badge ok" title="Checked by ${p.checked_by_name} on ${fmtDate(p.checked_at)}">Checked</span>`
    : html`<span class="badge warn">Not checked yet</span>`;
}

async function kbHome(main) {
  const kb = await kbIndex();
  bind(main, {
    'ask-home': (form) => {
      const q = new FormData(form).get('q').trim();
      if (q) location.hash = `#/kb/ask?q=${encodeURIComponent(q)}`;
    },
  });
  const tile = (href, title, detail, count, logo) => html`
    <a class="tile ${count ? '' : 'soon'}" href="${href}">
      ${logo ? html`<img class="tile-logo" src="${logo}" alt="" loading="lazy">` : ''}
      <div class="tile-title">${title}</div>
      <div class="muted small">${count ? `${count} page${count === 1 ? '' : 's'}` : 'Coming soon'}${detail ? ` · ${detail}` : ''}</div>
    </a>`;
  main.innerHTML = html`
    <h1>Knowledge base</h1>
    <p class="lead">Everything on every service, the same for everyone. Come back here any time to check a price, a policy or a script.</p>
    <form class="card ask-box" data-submit="ask-home">
      <label for="ask-home-q"><strong>Ask a question</strong> <span class="muted small">Answers come from these pages, as they are now.</span></label>
      <div class="ask-row"><input id="ask-home-q" name="q" placeholder="For example: can I offer a discount on a PFS exam?" maxlength="1000" required>
      <button class="btn primary" type="submit">Ask</button></div>
    </form>
    <h2>Services</h2>
    <div class="tiles">
      ${kb.services.map((s) => tile(`#/kb/s?key=${s.key}`, s.name, s.detail || '', pagesFor(kb, 'service', s.key).length, s.logo))}
    </div>
    <h2>For every service</h2>
    <div class="tiles">
      ${kb.sections.map((s) => tile(`#/kb/s?key=${s.key}`, s.name, s.detail, pagesFor(kb, 'section', s.key).length))}
    </div>`;
}

/**
 * A whole service (or section) on one page: a jump list at the top, then
 * every part in order. Each part keeps its own Edit, History and "checked"
 * mark, because underneath it's still a page of its own.
 */
async function kbService(main, { params }) {
  const key = params.get('key');
  const { item, pages } = await get(`/knowledge/all/${encodeURIComponent(key)}`);
  const at = params.get('at');

  main.innerHTML = html`
    <p class="crumbs"><a href="#/kb">Knowledge base</a></p>
    ${item.logo ? html`<img class="service-logo" src="${item.logo}" alt="${item.name} logo">` : ''}
    <h1 id="kb-top">${item.name}</h1>
    ${item.detail ? html`<p class="lead">${item.detail}</p>` : ''}
    ${pages.length ? html`
      <nav class="card jump-list" aria-label="On this page">
        <div class="muted small">Jump to</div>
        <ol>${pages.map((p) => html`
          <li><a href="#/kb/s?key=${key}&at=${p.slug}" data-action="jump" data-slug="${p.slug}">${p.title}</a>${p.checked_at ? '' : html` <span class="badge warn">Not checked</span>`}</li>`)}
        </ol>
      </nav>
      ${pages.map((p) => html`
        <section class="kb-part" id="part-${p.slug}">
          <div class="page-head">
            <h2>${p.title}</h2>
            <div class="page-actions">
              ${isTrainer() ? html`<a class="btn small" href="#/kb/edit?slug=${p.slug}">${raw(icon('file-text', { size: 'sm' }))} Edit</a>` : ''}
              ${isTrainer() ? html`<button class="btn small" data-action="checked" data-slug="${p.slug}">${raw(icon('check-circle', { size: 'sm' }))} Mark as checked</button>` : ''}
            </div>
          </div>
          <p class="page-meta muted small">
            ${p.checked_at ? html`Checked by ${p.checked_by_name} on ${fmtDate(p.checked_at)}.` : html`<span class="badge warn">Not checked yet</span> John or Lucy to check against how things work now.`}
            Last changed ${fmtDate(p.updated_at)}${p.updated_by_name ? html` by ${p.updated_by_name}` : ''}.
            ${isTrainer() ? html`<a href="#/kb/history?slug=${p.slug}">History</a>` : ''}
            ${isManager() && p.pending_suggestions ? html` · <a href="#/kb/suggestions">${p.pending_suggestions} suggested change${p.pending_suggestions === 1 ? '' : 's'} waiting</a>` : ''}
          </p>
          <article class="prose">${raw(renderMarkdown(p.body))}</article>
          ${p.source ? html`<p class="muted small source">Moved across from: ${p.source}</p>` : ''}
          <p class="to-top small"><a href="#/kb/s?key=${key}" data-action="top">Back to the top</a></p>
        </section>`)}` : html`<div class="card empty"><p>Nothing here yet.</p></div>`}
    ${isTrainer() ? html`<p class="add-part"><a class="btn" href="#/kb/new?key=${key}">${raw(icon('plus', { size: 'sm' }))} Add a section</a></p>` : ''}`;

  /* Jumping moves down the page without redrawing it, and keeps the address
     pointing at the part, so a copied link or a refresh lands in the same place. */
  const goTo = (slug) => {
    const el = document.getElementById(`part-${slug}`);
    if (!el) return;
    el.scrollIntoView({ block: 'start' });
    history.replaceState(null, '', `#/kb/s?key=${key}&at=${slug}`);
  };
  /* Straight away rather than on the next frame: a page in a background tab
     doesn't get frames, and would be left where the last page was scrolled. */
  if (at) goTo(at);
  else window.scrollTo(0, 0);

  bind(main, {
    jump: (el) => goTo(el.dataset.slug),
    top: () => {
      document.getElementById('kb-top')?.scrollIntoView({ block: 'start' });
      history.replaceState(null, '', `#/kb/s?key=${key}`);
    },
    checked: async (el) => {
      try {
        await post(`/knowledge/pages/${el.dataset.slug}/checked`);
        await kbIndex({ fresh: true });
        toast('Marked as checked.');
        kbService(main, { params: new URLSearchParams(`key=${key}&at=${el.dataset.slug}`) }).catch(notifyError);
      } catch (err) { notifyError(err); }
    },
  });
}

/**
 * A single page's address (from search, a link inside another page, or an
 * old bookmark) opens its service's page at that part.
 */
async function kbArticle(main, { params }) {
  const kb = await kbIndex();
  const page = kb.pages.find((p) => p.slug === params.get('slug'));
  if (page) {
    location.replace(`#/kb/s?key=${page.service || page.section}&at=${page.slug}`);
    return;
  }
  return kbArticleAlone(main, { params });
}

async function kbArticleAlone(main, { params }) {
  const kb = await kbIndex();
  const { page, pendingSuggestions } = await get(`/knowledge/pages/${encodeURIComponent(params.get('slug'))}`);
  const parent = kb.services.find((s) => s.key === page.service) || kb.sections.find((s) => s.key === page.section);
  const siblings = kb.pages.filter((p) => (page.service ? p.service === page.service : p.section === page.section));
  const at = siblings.findIndex((p) => p.slug === page.slug);
  const prev = siblings[at - 1];
  const next = siblings[at + 1];

  main.innerHTML = html`
    <p class="crumbs"><a href="#/kb">Knowledge base</a>${parent ? html` / <a href="#/kb/s?key=${parent.key}">${parent.name}</a>` : ''}</p>
    <div class="page-head">
      <h1>${page.title}</h1>
      <div class="page-actions">
        ${isTrainer() ? html`<a class="btn small" href="#/kb/edit?slug=${page.slug}">${raw(icon('file-text', { size: 'sm' }))} Edit</a>` : ''}
        ${isTrainer() ? html`<button class="btn small" data-action="checked">${raw(icon('check-circle', { size: 'sm' }))} Mark as checked</button>` : ''}
      </div>
    </div>
    <p class="page-meta muted small">
      ${page.checked_at ? html`Checked by ${page.checked_by_name} on ${fmtDate(page.checked_at)}.` : html`<span class="badge warn">Not checked yet</span> John or Lucy to check against how things work now.`}
      Last changed ${fmtDate(page.updated_at)}${page.updated_by_name ? html` by ${page.updated_by_name}` : ''}.
      ${isTrainer() ? html`<a href="#/kb/history?slug=${page.slug}">History</a>` : ''}
      ${isManager() && pendingSuggestions ? html` · <a href="#/kb/suggestions">${pendingSuggestions} suggested change${pendingSuggestions === 1 ? '' : 's'} waiting</a>` : ''}
    </p>
    <article class="prose">${raw(renderMarkdown(page.body))}</article>
    ${page.source ? html`<p class="muted small source">Moved across from: ${page.source}</p>` : ''}
    <nav class="pager">
      ${prev ? html`<a href="#/kb/p?slug=${prev.slug}">← ${prev.title}</a>` : html`<span></span>`}
      ${next ? html`<a href="#/kb/p?slug=${next.slug}">${next.title} →</a>` : ''}
    </nav>`;

  bind(main, {
    checked: async () => {
      try {
        await post(`/knowledge/pages/${page.slug}/checked`);
        await kbIndex({ fresh: true });
        toast('Marked as checked.');
        route();
      } catch (err) { notifyError(err); }
    },
  });
}

/**
 * Ask a question. The conversation lives only on this page: nothing is kept.
 * Each answer comes back with the pages it used, so the person can check it.
 */
const chat = { turns: [] };

async function kbAsk(main, { params }) {
  const first = params.get('q');
  if (first) history.replaceState(null, '', '#/kb/ask');

  const draw = () => {
    main.innerHTML = html`
      <h1>Ask a question</h1>
      <p class="lead">Ask anything about our services, prices, policies or scripts. Answers come only from the knowledge base as it is right now, with links to the pages they used.</p>
      <p class="muted small">Don't type learners' names or details. If an answer looks wrong, tell John or Lucy so the page gets fixed.</p>
      <div class="chat">
        ${chat.turns.map((t) => html`
          <div class="chat-q"><div class="bubble">${t.q}</div></div>
          <div class="chat-a">
            ${t.pending ? html`<div class="bubble muted">Looking that up…</div>` : chatAnswer(t)}
          </div>`)}
      </div>
      <form class="ask-box sticky" data-submit="ask">
        <div class="ask-row">
          <input name="q" placeholder="${chat.turns.length ? 'Ask a follow-up' : 'Type your question'}" maxlength="1000" required autocomplete="off">
          <button class="btn primary" type="submit">Ask</button>
        </div>
        ${chat.turns.length ? html`<button class="btn small" data-action="clear">Start again</button>` : ''}
      </form>`;
    main.querySelector('input[name="q"]')?.focus();
    const last = main.querySelector('.chat-a:last-of-type');
    if (last) last.scrollIntoView({ block: 'nearest' });
  };

  const ask = async (q) => {
    const turn = { q, pending: true };
    const history = chat.turns.filter((t) => t.answer).slice(-3).map((t) => ({ q: t.q, a: t.answer }));
    chat.turns.push(turn);
    draw();
    try {
      Object.assign(turn, await post('/knowledge/ask', { question: q, history }), { pending: false });
    } catch (err) {
      Object.assign(turn, { pending: false, error: err.message, sources: [], parts: [] });
    }
    draw();
  };

  bind(main, {
    ask: (form) => {
      const q = new FormData(form).get('q').trim();
      if (q) ask(q);
    },
    clear: () => { chat.turns = []; draw(); },
  });

  draw();
  if (first) ask(first);
}

function chatAnswer(t) {
  const pageLink = (s) => html`<a class="chip" href="#/kb/p?slug=${s.slug}">${s.title}</a>`;
  if (t.answer) {
    return html`<div class="bubble"><article class="prose">${raw(renderMarkdown(t.answer))}</article></div>
      ${t.sources?.length ? html`<div class="chat-sources"><span class="muted small">Pages it looked at:</span> ${t.sources.map(pageLink)}</div>` : ''}`;
  }
  return html`<div class="bubble">
    ${t.error ? html`<p class="notice bad small">${t.error}</p>` : ''}
    ${t.parts?.length ? html`
      <p class="small muted">The parts of the knowledge base that best match your question:</p>
      ${t.parts.map((p) => html`
        <div class="chat-part">
          <div><a href="#/kb/p?slug=${p.slug}"><strong>${p.title}</strong></a>${p.heading ? html` <span class="muted small">· ${p.heading}</span>` : ''}</div>
          <article class="prose">${raw(renderMarkdown(p.text.replace(/^## .*\n?/, '')))}</article>
        </div>`)}`
      : html`<p>Nothing in the knowledge base matches that. Try other words, or ask John or Lucy.</p>`}
  </div>`;
}

async function kbSearch(main, { params }) {
  const q = params.get('q') || '';
  const { results } = await get(`/knowledge/search?q=${encodeURIComponent(q)}`);
  main.innerHTML = html`
    <h1>Search</h1>
    <p class="muted">${results.length ? `${results.length} page${results.length === 1 ? '' : 's'} mention` : 'No pages mention'} “${q}”.</p>
    <div class="page-list">
      ${results.map((r) => html`
        <a class="page-row result" href="#/kb/p?slug=${r.slug}">
          <span class="page-title">${r.title}</span>
          <span class="muted small">${r.snippet}</span>
        </a>`)}
    </div>`;
}

/** A new section at the end of a service or section, written and published in one go. */
async function kbNew(main, { params }) {
  const key = params.get('key');
  const kb = await kbIndex();
  const item = kb.services.find((x) => x.key === key) || kb.sections.find((x) => x.key === key);
  if (!item) throw new Error('No such service.');
  main.innerHTML = html`
    <p class="crumbs"><a href="#/kb/s?key=${key}">${item.name}</a></p>
    <h1>Add a section to ${item.name}</h1>
    <p class="muted">It goes at the end of the page and in the jump list, live for everyone when you publish. You can change it any time, and every version is kept.</p>
    <form class="editor" data-submit="add">
      <label>Title <input name="title" required maxlength="120" placeholder="For example: Learner FAQs"></label>
      <div class="editor-panes">
        <label>Section <span class="muted small">## heading, - bullet, | table |, **bold**, [link](https://…), > a line to say</span>
          <textarea name="body" rows="24" required></textarea>
        </label>
        <div><div class="muted small">Preview</div><article class="prose preview"></article></div>
      </div>
      <div class="form-actions">
        <button class="btn primary" type="submit">Publish</button>
        <a class="btn" href="#/kb/s?key=${key}">Cancel</a>
      </div>
    </form>`;

  const textarea = main.querySelector('textarea');
  textarea.addEventListener('input', () => {
    main.querySelector('.preview').innerHTML = renderMarkdown(textarea.value);
  });

  bind(main, {
    add: async (form) => {
      const d = Object.fromEntries(new FormData(form));
      try {
        const { page } = await post('/knowledge/pages', { key, title: d.title, body: d.body });
        await kbIndex({ fresh: true });
        toast('Published.');
        location.hash = `#/kb/s?key=${key}&at=${page.slug}`;
      } catch (err) { notifyError(err); }
    },
  });
}

/** John, Lucy, Shannon and Poppy edit and publish. */
async function kbEdit(main, { params }) {
  const { page } = await get(`/knowledge/pages/${encodeURIComponent(params.get('slug'))}`);
  const publishing = isTrainer();
  document.title = `${publishing ? 'Edit page' : 'Suggest a change'} · Sales training`;
  main.innerHTML = html`
    <p class="crumbs"><a href="#/kb/p?slug=${page.slug}">${page.title}</a></p>
    <h1>${publishing ? 'Edit page' : 'Suggest a change'}</h1>
    <p class="muted">${publishing
      ? 'Your changes go live for everyone when you publish. The old version is kept in the page history.'
      : 'Shannon or Poppy will see your suggestion and publish it, or not. Nothing changes until they do.'}</p>
    <form class="editor" data-submit="save">
      ${publishing ? html`<label>Title <input name="title" value="${page.title}" required></label>` : ''}
      <div class="editor-panes">
        <label>Page <span class="muted small">## heading, - bullet, | table |, **bold**, [link](https://…), > note</span>
          <textarea name="body" rows="28">${page.body}</textarea>
        </label>
        <div><div class="muted small">Preview</div><article class="prose preview">${raw(renderMarkdown(page.body))}</article></div>
      </div>
      <label>${publishing ? 'What changed (optional)' : 'Why, for Shannon and Poppy (optional)'} <input name="note" maxlength="300"></label>
      <div class="form-actions">
        <button class="btn primary" type="submit">${publishing ? 'Publish' : 'Send suggestion'}</button>
        <a class="btn" href="#/kb/p?slug=${page.slug}">Cancel</a>
      </div>
    </form>`;

  const textarea = main.querySelector('textarea');
  textarea.addEventListener('input', () => {
    main.querySelector('.preview').innerHTML = renderMarkdown(textarea.value);
  });

  bind(main, {
    save: async (form) => {
      const data = Object.fromEntries(new FormData(form));
      try {
        if (publishing) {
          await put(`/knowledge/pages/${page.slug}`, { title: data.title, body: data.body, note: data.note });
          toast('Published.');
        } else {
          await post(`/knowledge/pages/${page.slug}/suggestions`, { body: data.body, note: data.note });
          toast('Suggestion sent to Shannon and Poppy.');
        }
        await kbIndex({ fresh: true });
        location.hash = `#/kb/p?slug=${page.slug}`;
      } catch (err) { notifyError(err); }
    },
  });
}

async function kbHistory(main, { params }) {
  const slug = params.get('slug');
  const [{ page }, { versions }] = await Promise.all([
    get(`/knowledge/pages/${encodeURIComponent(slug)}`),
    get(`/knowledge/pages/${encodeURIComponent(slug)}/versions`),
  ]);
  main.innerHTML = html`
    <p class="crumbs"><a href="#/kb/p?slug=${page.slug}">${page.title}</a></p>
    <h1>Page history</h1>
    <p class="muted">Every published version, newest first.</p>
    ${versions.map((v, i) => html`
      <details class="card version" ${i === 0 ? raw('open') : ''}>
        <summary><strong>${fmtDate(v.saved_at)}</strong> · ${v.saved_by_name || 'Moved across'}${v.note ? html` · ${v.note}` : ''}${i === 0 ? html` <span class="badge ok">Current</span>` : ''}</summary>
        <article class="prose">${raw(renderMarkdown(v.body))}</article>
      </details>`)}`;
}

async function kbSuggestions(main) {
  const { suggestions } = await get('/knowledge/suggestions');
  main.innerHTML = html`
    <h1>Suggested changes</h1>
    <p class="lead">Changes John and Lucy have suggested. Publishing one makes it live for everyone.</p>
    ${suggestions.length ? suggestions.map((s) => html`
      <div class="card suggestion">
        <div class="suggestion-head">
          <div>
            <h3><a href="#/kb/p?slug=${s.slug}">${s.title}</a></h3>
            <div class="muted small">From ${s.suggested_by_name}, ${fmtDate(s.suggested_at)}${s.note ? html` · “${s.note}”` : ''}</div>
            ${s.pageChangedSince ? html`<p class="notice small">The page has changed since this was suggested. Publishing it replaces those changes.</p>` : ''}
          </div>
          <div class="page-actions">
            <button class="btn primary small" data-action="publish" data-id="${s.id}">Publish</button>
            <button class="btn small" data-action="reject" data-id="${s.id}">Don't publish</button>
          </div>
        </div>
        <div class="compare">
          <div><div class="muted small">Now</div><article class="prose">${raw(renderMarkdown(s.current_body))}</article></div>
          <div><div class="muted small">Suggested</div><article class="prose">${raw(renderMarkdown(s.body))}</article></div>
        </div>
      </div>`) : html`<div class="card empty"><p>Nothing waiting.</p></div>`}`;

  const decide = (decision) => async (el) => {
    try {
      await post(`/knowledge/suggestions/${el.dataset.id}/${decision}`);
      await kbIndex({ fresh: true });
      toast(decision === 'publish' ? 'Published.' : 'Not published.');
      kbSuggestions(main).catch(notifyError);
    } catch (err) { notifyError(err); }
  };
  bind(main, { publish: decide('publish'), reject: decide('reject') });
}

/* ---------------------------- training ------------------------------ */

const KIND_LABEL = {
  proprofs: 'ProProfs course', doc: 'Document', slides: 'Slides', demo: 'Walkthrough',
  recording: 'Call recording', web: 'Website', kb: 'Knowledge base',
};

const isoToUk = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'Europe/London' }) : '');

/** A link that opens a knowledge base page in the app, and anything else in a new tab. */
const resourceLink = (r) => (r.url.startsWith('#/')
  ? html`<a href="${r.url}">${r.title}</a>`
  : html`<a href="${r.url}" target="_blank" rel="noopener">${r.title}</a>`);

/**
 * The new starter plan as a flow chart, day 1 to month 3. The stage the person
 * is on is highlighted, and each stage shows whether John or Lucy has signed it off.
 */
function flowChart(rec, { canSign = false } = {}) {
  const at = rec.plan.findIndex((s) => s.key === rec.stage);
  return html`
    <ol class="flow" aria-label="New starter plan">
      ${rec.plan.map((s, i) => html`
        <li class="flow-step ${i === at ? 'current' : ''} ${at >= 0 && i < at ? 'past' : ''} ${s.signedOff ? 'signed' : ''}">
          <div class="flow-when">${s.title}${i === at ? html` <span class="badge here">Now</span>` : ''}</div>
          <div class="flow-what">${s.expectation}</div>
          ${s.signedOff ? html`<div class="flow-signed">${raw(icon('check-circle', { size: 'sm' }))} Signed off by ${s.signedOff.by_name || 'a trainer'}, ${fmtDate(s.signedOff.at)}</div>` : ''}
          ${canSign ? (s.signedOff
            ? html`<button class="btn small" data-action="unsign" data-key="${s.key}">Undo sign-off</button>`
            : html`<button class="btn small" data-action="sign" data-key="${s.key}">${raw(icon('check', { size: 'sm' }))} Sign off</button>`) : ''}
        </li>`)}
    </ol>`;
}

/** Where somebody is on the plan, in words, with what this stage asks of them. */
function whereNow(rec, self) {
  const stage = rec.plan.find((s) => s.key === rec.stage);
  if (!rec.person.start_date) {
    return html`<p class="notice">${self ? 'Your' : 'Their'} start date isn't set yet, so ${self ? 'you' : 'they'} aren't placed on the plan. Shannon or Poppy add it on People and access.</p>`;
  }
  if (!stage) return html`<p class="notice">${self ? 'You start' : 'They start'} on ${isoToUk(rec.person.start_date)}.</p>`;
  return html`
    <div class="card now">
      <div class="muted small">Started ${isoToUk(rec.person.start_date)} · working day ${rec.day}</div>
      <h3>${stage.title}: ${stage.expectation}</h3>
      ${stage.activities.length ? html`<ul>${stage.activities.map((a) => html`<li>${a}</li>`)}</ul>` : ''}
    </div>`;
}

/** One resource with its tick box. */
const resourceRow = (r, personId) => html`
  <div class="res-row ${r.done ? 'done' : ''}">
    <label class="res-tick" title="${r.done ? `Done ${fmtDate(r.done.at)}${r.done.by_name ? `, ticked by ${r.done.by_name}` : ''}` : 'Tick when done'}">
      <input type="checkbox" data-change="done" data-id="${r.id}" ${personId ? raw(`data-person="${personId}"`) : ''} ${r.done ? raw('checked') : ''} aria-label="Done: ${r.title}">
    </label>
    <div class="res-body">
      <div>${resourceLink(r)} <span class="badge kind">${KIND_LABEL[r.kind]}</span></div>
      ${r.note ? html`<div class="muted small">${r.note}</div>` : ''}
    </div>
  </div>`;

/**
 * Training courses: the ones built into the app first, then the ones still
 * on ProProfs until they move across.
 */
function coursesCard(rec, courses, { self, personId = null } = {}) {
  const proprofs = rec.resources.filter((r) => r.kind === 'proprofs');
  const svcName = (key) => (key ? rec.services.find((x) => x.key === key)?.short : 'Everyone');
  return html`
    <h2>Training courses</h2>
    ${courses.length ? html`
      <div class="course-cards">${courses.map((c) => html`
        <div class="card course-card ${c.passedAt ? 'passed' : ''}">
          <div class="muted small">${svcName(c.service)} · ${c.sections} section${c.sections === 1 ? '' : 's'}, ${c.questions} question${c.questions === 1 ? '' : 's'}</div>
          <h3>${c.title}</h3>
          ${c.description ? html`<p class="small">${c.description}</p>` : ''}
          <div class="small">${c.passedAt
            ? html`<span class="badge ok">Passed ${fmtDate(c.passedAt)}</span>${c.best ? html` <span class="muted">best ${c.best.score} / ${c.best.total}</span>` : ''}`
            : c.best ? html`<span class="badge warn">Not passed yet</span> <span class="muted">best ${c.best.score} / ${c.best.total}, pass mark ${c.pass_mark}%</span>`
            : c.inProgress ? html`<span class="badge">In progress</span>` : html`<span class="muted">Not started</span>`}</div>
          ${self ? html`<a class="btn small ${c.passedAt ? '' : 'primary'}" href="#/training/course?key=${c.key}">${c.inProgress ? 'Carry on' : c.best ? 'Take it again' : 'Start'}</a>` : ''}
        </div>`)}
      </div>` : html`<p class="muted small">No courses in the app for ${self ? 'your' : 'their'} services yet.</p>`}
    ${proprofs.length ? html`
      <h3 class="group-head">Still on ProProfs</h3>
      <div class="res-list">${proprofs.map((r) => resourceRow(r, personId))}</div>` : ''}`;
}

function resourcesCard(rec, { personId = null } = {}) {
  const groups = [{ key: null, name: 'For everyone' }, ...rec.services.filter((s) => s.on)];
  rec = { ...rec, resources: rec.resources.filter((r) => r.kind !== 'proprofs') };
  const total = rec.resources.length;
  const done = rec.resources.filter((r) => r.done).length;
  return html`
    <h2>Training resources <span class="muted small">${done} of ${total} done</span></h2>
    ${groups.map((g) => {
      const list = rec.resources.filter((r) => r.service === g.key);
      if (!list.length) return '';
      return html`
        <h3 class="group-head">${g.name}</h3>
        <div class="res-list">
          ${list.map((r) => resourceRow(r, personId))}
        </div>`;
    })}
    ${rec.services.some((s) => s.on) ? '' : html`<p class="muted small">Resources for each service appear once Shannon or Poppy switch the service on.</p>`}`;
}

function quizzesCard(rec, { self }) {
  return html`
    <h2>Quizzes</h2>
    ${rec.quizzes.length ? html`
      <div class="res-list">
        ${rec.quizzes.map((q) => html`
          <div class="res-row">
            <div class="res-body">
              <div><strong>${q.title}</strong> <span class="muted small">${q.questions} question${q.questions === 1 ? '' : 's'} · pass mark ${q.pass_mark}%</span></div>
              <div class="small">${q.best
                ? html`Best: ${q.best.score} out of ${q.best.total} ${q.best.passed ? html`<span class="badge ok">Passed</span>` : html`<span class="badge warn">Not passed yet</span>`} · ${q.attempts} attempt${q.attempts === 1 ? '' : 's'}`
                : html`<span class="muted">Not taken yet</span>`}</div>
            </div>
            ${self ? html`<a class="btn small ${q.best?.passed ? '' : 'primary'}" href="#/training/quiz?key=${q.key}">${q.best ? 'Take again' : 'Take quiz'}</a>` : ''}
          </div>`)}
      </div>` : html`<p class="muted">Quizzes appear here once John or Lucy have approved the questions${self ? ' for your services' : ''}.</p>`}`;
}

async function myTraining(main) {
  const rec = await get('/training/me');
  const [{ sessions }, { requests }, { courses }] = await Promise.all([
    get(`/coaching/person/${rec.person.id}/sessions`),
    get('/coaching/help'),
    get('/courses'),
  ]);
  const mine = requests.filter((h) => h.person_id === rec.person.id);
  const on = rec.services.filter((s) => s.on);
  main.innerHTML = html`
    <h1>My training</h1>
    <p class="lead">Your new starter plan, the resources and quizzes for the services you're training on, and what you've done so far.</p>
    ${rec.person.on_plan ? html`${whereNow(rec, true)}<h2>Your plan</h2>${flowChart(rec)}` : ''}
    <h2>Services you're training on</h2>
    ${on.length
      ? html`<div class="chips">${on.map((s) => html`<span class="chip on">${s.name}</span>`)}</div>`
      : html`<p class="muted">None switched on yet. Shannon or Poppy switch each service on when your training on it starts.</p>`}
    ${sessionsCard(sessions, { self: true })}
    ${coursesCard(rec, courses, { self: true })}
    ${resourcesCard(rec)}
    ${quizzesCard(rec, { self: true })}
    <h2 id="help">Ask John or Lucy for help</h2>
    <form class="card help-form" data-submit="ask">
      <div class="form-grid">
        <label>About
          <select name="service"><option value="">Anything</option>${on.map((s) => html`<option value="${s.key}">${s.name}</option>`)}</select>
        </label>
        <label class="full">What would you like help with? <textarea name="body" rows="3" required maxlength="2000" placeholder="For example: I keep losing calls when the price comes up."></textarea></label>
      </div>
      <div class="form-actions"><button class="btn primary" type="submit">Send to John and Lucy</button></div>
    </form>
    ${helpList(mine, { self: true })}`;

  const redraw = () => myTraining(main).catch(notifyError);
  bind(main, {
    done: async (el) => {
      try { await post(`/training/resources/${el.dataset.id}/done`, { done: el.checked }); }
      catch (err) { notifyError(err); }
      redraw();
    },
    ack: async (el) => {
      try { await post(`/coaching/sessions/${el.dataset.id}/acknowledge`); toast('Thanks.'); }
      catch (err) { notifyError(err); }
      redraw();
    },
    ask: async (form) => {
      const d = Object.fromEntries(new FormData(form));
      try { await post('/coaching/help', { body: d.body, service: d.service || null }); toast('Sent. John or Lucy will get back to you.'); redraw(); }
      catch (err) { notifyError(err); }
    },
    close: async (el) => {
      try { await post(`/coaching/help/${el.dataset.id}/close`); toast('Closed.'); refreshHelpCount(); }
      catch (err) { notifyError(err); }
      redraw();
    },
  });
}

const serviceLabel = (key) => (key ? state.kb?.services.find((s) => s.key === key)?.name || key : '');

/**
 * Sessions with John or Lucy. The person sees what was done, when, with whom
 * and the note written to them; trainers and managers also see the private
 * note, which the server never sends to the person.
 */
function sessionsCard(sessions, { self, editable = false, editing = null, kinds = [], services = [] } = {}) {
  const planned = sessions.filter((s) => s.status === 'planned');
  const done = sessions.filter((s) => s.status === 'done');
  const unread = self ? done.filter((s) => s.shared_note && !s.acknowledged_at).length : 0;
  const row = (s) => (s.id === editing ? sessionForm(s, kinds, services) : html`
    <div class="session ${s.status}">
      <div class="session-head">
        <strong>${isoToUk(s.session_date)}</strong> · ${s.kind}${s.service ? html` · ${serviceLabel(s.service)}` : ''}
        <span class="muted small">with ${s.trainer_name || 'a trainer'}</span>
        ${s.status === 'planned' ? html`<span class="badge">Booked</span>` : ''}
        ${self && s.status === 'done' && s.shared_note && !s.acknowledged_at ? html`<span class="badge here">New</span>` : ''}
        ${!self && s.status === 'done' && s.shared_note ? (s.acknowledged_at ? html`<span class="badge ok">Read ${fmtDate(s.acknowledged_at)}</span>` : html`<span class="badge warn">Not read yet</span>`) : ''}
      </div>
      ${s.shared_note ? html`<div class="note shared"><div class="muted small">${self ? 'Feedback for you' : 'Shared with them'}</div>${s.shared_note}</div>` : ''}
      ${!self && s.private_note ? html`<div class="note private"><div class="muted small">Private: trainers and managers only</div>${s.private_note}</div>` : ''}
      <div class="form-actions">
        ${self && s.status === 'done' && s.shared_note && !s.acknowledged_at ? html`<button class="btn small primary" data-action="ack" data-id="${s.id}">Got it</button>` : ''}
        ${editable ? html`<a class="btn small" href="#/training/person?id=${s.person_id}&edit=${s.id}">Change</a>` : ''}
      </div>
    </div>`);
  return html`
    <h2>${self ? 'Your sessions' : 'Sessions'}${unread ? html` <span class="badge here">${unread} new</span>` : ''}</h2>
    ${planned.length ? html`<h3 class="group-head">Booked</h3><div class="sessions">${planned.map(row)}</div>` : ''}
    ${done.length ? html`<h3 class="group-head">Done</h3><div class="sessions">${done.map(row)}</div>` : ''}
    ${sessions.length ? '' : html`<p class="muted">${self ? 'Feedback from your sessions with John and Lucy will appear here.' : 'No sessions logged yet.'}</p>`}`;
}

function sessionForm(s, kinds, services) {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Europe/London' });
  return html`
    <form class="session editing" data-submit="${s ? 'save-session' : 'add-session'}" ${s ? raw(`data-id="${s.id}"`) : ''}>
      <div class="form-grid">
        <label>Date <input type="date" name="session_date" value="${s?.session_date || today}" required></label>
        <label>Kind
          <select name="kind">${kinds.map((k) => html`<option ${s?.kind === k ? raw('selected') : ''}>${k}</option>`)}</select>
        </label>
        <label>Service
          <select name="service"><option value="">Not one service</option>${services.map((x) => html`<option value="${x.key}" ${s?.service === x.key ? raw('selected') : ''}>${x.name}</option>`)}</select>
        </label>
        <label>Status
          <select name="status">
            <option value="done" ${s?.status !== 'planned' ? raw('selected') : ''}>Done</option>
            <option value="planned" ${s?.status === 'planned' ? raw('selected') : ''}>Booked for later</option>
          </select>
        </label>
        <label class="full">Feedback for them <span class="muted small">(they see this)</span>
          <textarea name="shared_note" rows="3" maxlength="5000">${s?.shared_note || ''}</textarea></label>
        <label class="full">Private note <span class="muted small">(trainers and managers only, never shown to them)</span>
          <textarea name="private_note" rows="3" maxlength="5000">${s?.private_note || ''}</textarea></label>
      </div>
      <div class="form-actions">
        <button class="btn primary" type="submit">${s ? 'Save' : 'Add session'}</button>
        ${s ? html`<a class="btn" href="#/training/person?id=${s.person_id}">Cancel</a>` : ''}
      </div>
    </form>`;
}

const HELP_STATUS = {
  open: html`<span class="badge warn">Waiting</span>`,
  answered: html`<span class="badge ok">Answered</span>`,
  closed: html`<span class="badge">Closed</span>`,
};

/** Help requests. `self` is the person's own list; otherwise trainers answer. */
function helpList(requests, { self = false, showName = false } = {}) {
  if (!requests.length) return self ? '' : html`<p class="muted">No help requests.</p>`;
  return html`
    ${self ? html`<h3 class="group-head">Your requests</h3>` : ''}
    <div class="sessions">
      ${requests.map((h) => html`
        <div class="session help ${h.status}">
          <div class="session-head">
            ${showName ? html`<a href="#/training/person?id=${h.person_id}"><strong>${h.person_name}</strong></a> · ` : ''}
            <span class="muted small">${fmtDate(h.created_at)}${h.service ? ` · ${serviceLabel(h.service)}` : ''}</span>
            ${HELP_STATUS[h.status]}
          </div>
          <div>${h.body}</div>
          ${h.answer ? html`<div class="note shared"><div class="muted small">${h.answered_by_name || 'Trainer'}, ${fmtDate(h.answered_at)}</div>${h.answer}</div>` : ''}
          ${!self && h.status !== 'closed' ? html`
            <form class="answer" data-submit="answer" data-id="${h.id}">
              <textarea name="answer" rows="2" maxlength="4000" placeholder="${h.answer ? 'Add to your answer' : 'Answer, or say when you’ll go through it with them'}" required></textarea>
              <div class="form-actions">
                <button class="btn small primary" type="submit">${h.answer ? 'Answer again' : 'Answer'}</button>
                <button class="btn small" data-action="close" data-id="${h.id}">Close</button>
              </div>
            </form>` : ''}
          ${self && h.status !== 'closed' ? html`<div class="form-actions"><button class="btn small" data-action="close" data-id="${h.id}">It's sorted</button></div>` : ''}
        </div>`)}
    </div>`;
}

/** One person's record, for John, Lucy, Shannon and Poppy, with sign-offs. */
async function personTraining(main, { params }) {
  const id = Number(params.get('id'));
  const editing = Number(params.get('edit')) || null;
  const [rec, { attempts }, { sessions }, { requests }, { kinds }, manager, { courses }] = await Promise.all([
    get(`/training/person/${id}`),
    get(`/training/person/${id}/attempts`),
    get(`/coaching/person/${id}/sessions`),
    get(`/coaching/help?person=${id}`),
    get('/coaching/kinds'),
    isManager()
      ? Promise.all([get(`/coaching/person/${id}/notes`), get(`/coaching/person/${id}/setup`)]).then(([n, s]) => ({ notes: n.notes, setup: s.items }))
      : null,
    get(`/courses/person/${id}`),
  ]);
  const services = state.kb?.services || [];
  document.title = `${rec.person.name} · Sales training`;
  main.innerHTML = html`
    <p class="crumbs"><a href="#/training/team">Team</a></p>
    <h1>${rec.person.name}</h1>
    ${whereNow(rec, false)}
    <p class="jump small"><a href="#" data-action="jump" data-to="sessions">Sessions</a> · <a href="#" data-action="jump" data-to="help">Help requests</a>${manager ? html` · <a href="#" data-action="jump" data-to="manager">Manager notes and set-up</a>` : ''}</p>
    ${rec.person.on_plan ? html`
      <h2>New starter plan</h2>
      <p class="muted small">Sign off each stage once they've done what it asks.</p>
      ${flowChart(rec, { canSign: true })}` : html`<p class="muted small">Not on the new starter plan. Shannon or Poppy can switch it on in People and access.</p>`}
    <h2>Services</h2>
    <p class="muted small">Put in the date they finished their training on a service. It shows on the tracker.</p>
    <div class="table-wrap"><table class="svc">
      <thead><tr><th>Service</th><th>Training</th><th>Trained on</th></tr></thead>
      <tbody>${rec.services.map((s) => html`<tr>
        <td>${s.name}</td>
        <td>${s.on ? html`<span class="badge ok">On</span> <span class="muted small">since ${fmtDate(s.since)}</span>` : html`<span class="muted small">Off</span>`}</td>
        <td><input type="date" data-change="trained" data-service="${s.key}" value="${s.trained_on || ''}" aria-label="Date ${rec.person.name} finished training on ${s.name}"></td>
      </tr>`)}</tbody>
    </table></div>
    ${coursesCard(rec, courses, { self: false, personId: id })}
    ${resourcesCard(rec, { personId: id })}
    ${quizzesCard(rec, { self: false })}
    ${attempts.length ? html`
      <h3 class="group-head">Every attempt</h3>
      <div class="table-wrap"><table>
        <thead><tr><th>Quiz</th><th>Score</th><th>Result</th><th>When</th></tr></thead>
        <tbody>${attempts.map((a) => html`<tr>
          <td>${a.title}</td><td>${a.score} / ${a.total}</td>
          <td>${a.passed ? html`<span class="badge ok">Passed</span>` : html`<span class="badge warn">Not passed</span>`}</td>
          <td>${fmtDate(a.taken_at)}</td>
        </tr>`)}</tbody>
      </table></div>` : ''}
    <div id="sessions">${sessionsCard(sessions, { self: false, editable: true, editing, kinds, services })}</div>
    <details class="card add" ${sessions.length ? '' : raw('open')}>
      <summary><strong>${raw(icon('plus', { size: 'sm' }))} Log or book a session</strong></summary>
      ${sessionForm(null, kinds, services)}
    </details>
    <h2 id="help">Help requests</h2>
    ${helpList(requests, { self: false })}
    ${manager ? html`
      <h2 id="manager">Manager notes <span class="muted small">Shannon and Poppy only</span></h2>
      <form class="card" data-submit="note">
        <div class="form-grid"><label class="full">Add a note <textarea name="body" rows="2" maxlength="5000" required></textarea></label></div>
        <div class="form-actions"><button class="btn small primary" type="submit">Add note</button></div>
      </form>
      ${manager.notes.length ? html`<div class="sessions">${manager.notes.map((n) => html`
        <div class="session"><div class="muted small">${n.author_name || 'Manager'}, ${fmtDate(n.created_at)}</div><div class="pre">${n.body}</div></div>`)}</div>` : ''}
      <h2>Set-up checklist <span class="muted small">${manager.setup.filter((i) => i.done).length} of ${manager.setup.length} done</span></h2>
      <p class="muted small">Whether each thing is in place. Sign-in details never go in this app.</p>
      <div class="res-list">${manager.setup.map((i) => html`
        <div class="res-row ${i.done ? 'done' : ''}">
          <label class="res-tick"><input type="checkbox" data-change="setup" data-id="${i.id}" ${i.done ? raw('checked') : ''} aria-label="${i.title}"></label>
          <div class="res-body"><div>${i.title}</div>${i.done ? html`<div class="muted small">Done ${fmtDate(i.done.at)}${i.done.by_name ? `, ${i.done.by_name}` : ''}</div>` : ''}</div>
        </div>`)}</div>` : ''}`;

  if (editing) main.querySelector(`form[data-id="${editing}"]`)?.scrollIntoView({ block: 'center' });

  const redraw = () => {
    const target = `#/training/person?id=${id}`;
    if (location.hash !== target) location.hash = target;
    else personTraining(main, { params: new URLSearchParams(`id=${id}`) }).catch(notifyError);
  };
  const sessionBody = (form) => Object.fromEntries(new FormData(form));
  bind(main, {
    jump: (el) => document.getElementById(el.dataset.to)?.scrollIntoView({ behavior: 'smooth' }),
    'add-session': async (form) => {
      try { await post(`/coaching/person/${id}/sessions`, sessionBody(form)); toast('Session saved.'); redraw(); }
      catch (err) { notifyError(err); }
    },
    'save-session': async (form) => {
      try { await put(`/coaching/sessions/${form.dataset.id}`, sessionBody(form)); toast('Saved.'); redraw(); }
      catch (err) { notifyError(err); }
    },
    answer: async (form) => {
      try { await post(`/coaching/help/${form.dataset.id}/answer`, { answer: new FormData(form).get('answer') }); toast('Answer sent.'); refreshHelpCount(); redraw(); }
      catch (err) { notifyError(err); }
    },
    close: async (el) => {
      try { await post(`/coaching/help/${el.dataset.id}/close`); toast('Closed.'); refreshHelpCount(); }
      catch (err) { notifyError(err); }
      redraw();
    },
    note: async (form) => {
      try { await post(`/coaching/person/${id}/notes`, { body: new FormData(form).get('body') }); toast('Note added.'); redraw(); }
      catch (err) { notifyError(err); }
    },
    setup: async (el) => {
      try { await post(`/coaching/person/${id}/setup/${el.dataset.id}`, { done: el.checked }); }
      catch (err) { notifyError(err); }
      redraw();
    },
    sign: async (el) => {
      try { await post(`/training/person/${id}/stages/${el.dataset.key}`, { done: true }); toast('Stage signed off.'); }
      catch (err) { notifyError(err); }
      redraw();
    },
    unsign: async (el) => {
      try { await post(`/training/person/${id}/stages/${el.dataset.key}`, { done: false }); toast('Sign-off taken back.'); }
      catch (err) { notifyError(err); }
      redraw();
    },
    done: async (el) => {
      try { await post(`/training/resources/${el.dataset.id}/done`, { personId: id, done: el.checked }); }
      catch (err) { notifyError(err); }
      redraw();
    },
    trained: async (el) => {
      try {
        await put(`/training/person/${id}/services/${el.dataset.service}/trained`, { date: el.value || null });
        toast(el.value ? 'Training date saved.' : 'Training date cleared.');
      } catch (err) { notifyError(err); }
      redraw();
    },
  });
}

/**
 * Working through a course: each section, then each question. An answer is
 * checked on the server as it's given and the feedback shows straight away;
 * the end shows the score and every question's feedback again.
 */
async function takeCourse(main, { params }) {
  const key = params.get('key');
  const [{ course, items }, start] = await Promise.all([
    get(`/courses/${encodeURIComponent(key)}`),
    post(`/courses/${encodeURIComponent(key)}/start`, {}),
  ]);
  const checked = new Map(start.answered.map((a) => [a.id, a]));
  const firstOpen = items.findIndex((it) => it.kind === 'question' && !checked.has(it.id));
  const st = { at: checked.size && firstOpen > 0 ? firstOpen : 0, attemptId: start.attemptId, result: null };
  document.title = `${course.title} · Sales training`;

  const draw = () => {
    if (st.result) return drawResult();
    const it = items[st.at];
    const fb = it.kind === 'question' ? checked.get(it.id) : null;
    const last = st.at === items.length - 1;
    main.innerHTML = html`
      <p class="crumbs"><a href="#/training">My training</a></p>
      <h1>${course.title}</h1>
      <div class="course-progress" aria-label="Step ${st.at + 1} of ${items.length}">
        <span style="width:${Math.round(((st.at + 1) / items.length) * 100)}%"></span>
      </div>
      <p class="muted small">Step ${st.at + 1} of ${items.length} · ${it.kind === 'section' ? 'Read' : 'Question'}</p>
      ${it.kind === 'section' ? html`
        <div class="card course-step">
          <h2>${it.title}</h2>
          <article class="prose">${raw(renderMarkdown(it.body))}</article>
        </div>` : html`
        <form class="card course-step" data-submit="answer">
          ${it.title ? html`<div class="muted small">${it.title}</div>` : ''}
          <h2 class="course-q">${it.question}</h2>
          <div class="course-opts">${it.options.map((o, j) => html`
            <label class="opt ${fb ? (j === fb.answer ? 'answer' : j === fb.chosen ? 'chosen' : '') : ''}">
              <input type="radio" name="opt" value="${j}" ${fb ? raw('disabled') : raw('required')} ${fb && j === fb.chosen ? raw('checked') : ''}>
              <span>${o}</span>
            </label>`)}</div>
          ${fb ? html`
            <div class="course-feedback ${fb.right ? 'right' : 'wrong'}">
              <strong>${fb.right ? 'Correct.' : 'Not quite.'}</strong>
              ${fb.feedback ? html`<div>${raw(renderMarkdown(fb.feedback))}</div>` : ''}
            </div>` : html`<div class="form-actions"><button class="btn primary" type="submit">Check my answer</button></div>`}
        </form>`}
      <div class="form-actions course-nav">
        ${st.at > 0 ? html`<button class="btn" data-action="back">Back</button>` : ''}
        ${it.kind === 'question' && !fb ? '' : last
          ? html`<button class="btn primary" data-action="finish">Finish and see my score</button>`
          : html`<button class="btn primary" data-action="next">Next</button>`}
      </div>`;
    window.scrollTo(0, 0);
  };

  const drawResult = () => {
    const r = st.result;
    main.innerHTML = html`
      <p class="crumbs"><a href="#/training">My training</a></p>
      <h1>${course.title}</h1>
      <div class="card score ${r.passed ? 'pass' : 'fail'}">
        <div class="score-big">${r.score} out of ${r.total}</div>
        <div>${r.passed ? 'Passed. Well done: it’s on your training record.' : `Not passed yet. You need ${r.pass_mark}%. Go back over the sections and try again.`}</div>
      </div>
      <h2>Your answers</h2>
      ${r.results.map((q, i) => html`
        <div class="card marked ${q.right ? 'right' : 'wrong'}">
          <div class="marked-head"><span class="muted">${i + 1}.</span> ${q.question}
            ${q.right ? html`<span class="badge ok">Right</span>` : html`<span class="badge warn">${q.chosen === null ? 'Not answered' : 'Not quite'}</span>`}</div>
          <ul class="opts">${q.options.map((o, j) => html`
            <li class="${j === q.answer ? 'answer' : ''} ${j === q.chosen && !q.right ? 'chosen' : ''}">${j === q.answer ? raw(icon('check', { size: 'sm' })) : ''}${o}${j === q.chosen ? html` <span class="muted small">(your answer)</span>` : ''}</li>`)}</ul>
          ${q.feedback ? html`<div class="small">${raw(renderMarkdown(q.feedback))}</div>` : ''}
        </div>`)}
      <div class="form-actions">
        <button class="btn" data-action="again">Take it again</button>
        <a class="btn primary" href="#/training">Back to my training</a>
      </div>`;
    window.scrollTo(0, 0);
  };

  bind(main, {
    next: () => { st.at = Math.min(items.length - 1, st.at + 1); draw(); },
    back: () => { st.at = Math.max(0, st.at - 1); draw(); },
    answer: async (form) => {
      const picked = form.querySelector('input[name="opt"]:checked');
      if (!picked) return;
      try {
        const res = await post(`/courses/${encodeURIComponent(key)}/answer`, { attemptId: st.attemptId, itemId: items[st.at].id, chosen: Number(picked.value) });
        checked.set(res.id, res);
        draw();
      } catch (err) { notifyError(err); }
    },
    finish: async () => {
      const open = items.filter((it) => it.kind === 'question' && !checked.has(it.id)).length;
      if (open && !confirm(`${open} question${open === 1 ? ' isn’t' : 's aren’t'} answered yet and will count as wrong. Finish anyway?`)) return;
      try {
        st.result = await post(`/courses/${encodeURIComponent(key)}/finish`, { attemptId: st.attemptId });
        drawResult();
      } catch (err) { notifyError(err); }
    },
    again: async () => {
      try {
        const fresh = await post(`/courses/${encodeURIComponent(key)}/start`, { fresh: true });
        Object.assign(st, { at: 0, attemptId: fresh.attemptId, result: null });
        checked.clear();
        draw();
      } catch (err) { notifyError(err); }
    },
  });
  draw();
}

/**
 * Taking a quiz. The page never has the answers: they come back from the
 * server with the marking, along with why, and the page to read.
 */
async function takeQuiz(main, { params }) {
  const key = params.get('key');
  const preview = params.get('preview') === '1';
  const data = await get(`/training/quizzes/${encodeURIComponent(key)}/take${preview ? '?preview=1' : ''}`);
  document.title = `${data.quiz.title} quiz · Sales training`;
  main.innerHTML = html`
    <p class="crumbs"><a href="#${preview ? '/training/questions' : '/training'}">${preview ? 'Quiz questions' : 'My training'}</a></p>
    <h1>${data.quiz.title} quiz</h1>
    ${preview ? html`<p class="notice">Preview with draft questions included. This isn't saved as an attempt.</p>` : ''}
    <p class="muted">${data.questions.length} questions. You need ${data.quiz.pass_mark}% to pass. Take it as many times as you like.</p>
    <form class="quiz" data-submit="hand-in">
      ${data.questions.map((q, i) => html`
        <fieldset class="quiz-q">
          <legend><span class="muted">${i + 1}.</span> ${q.question}${q.draft ? html` <span class="badge warn">Draft</span>` : ''}</legend>
          ${q.options.map((o, j) => html`
            <label class="opt"><input type="radio" name="q${q.id}" value="${j}" required> <span>${o}</span></label>`)}
        </fieldset>`)}
      <div class="form-actions"><button class="btn primary" type="submit">Hand in</button></div>
    </form>`;

  bind(main, {
    'hand-in': async (form) => {
      const answers = {};
      for (const q of data.questions) {
        const picked = form.querySelector(`input[name="q${q.id}"]:checked`);
        if (picked) answers[q.id] = Number(picked.value);
      }
      try {
        const marked = await post(`/training/quizzes/${encodeURIComponent(key)}/attempts`, { answers, preview });
        quizResult(main, data, marked, preview);
      } catch (err) { notifyError(err); }
    },
  });
}

function quizResult(main, data, m, preview) {
  const pageTitle = (slug) => state.kb?.pages.find((p) => p.slug === slug)?.title || 'the knowledge base page';
  main.innerHTML = html`
    <p class="crumbs"><a href="#${preview ? '/training/questions' : '/training'}">${preview ? 'Quiz questions' : 'My training'}</a></p>
    <h1>${data.quiz.title} quiz</h1>
    <div class="card score ${m.passed ? 'pass' : 'fail'}">
      <div class="score-big">${m.score} out of ${m.total}</div>
      <div>${m.passed ? 'Passed. Well done.' : `Not passed yet. You need ${m.pass_mark}%: read the pages below and try again.`}</div>
    </div>
    ${m.results.map((r, i) => html`
      <div class="card marked ${r.right ? 'right' : 'wrong'}">
        <div class="marked-head"><span class="muted">${i + 1}.</span> ${r.question}
          ${r.right ? html`<span class="badge ok">Right</span>` : html`<span class="badge warn">${r.chosen === null ? 'Not answered' : 'Not quite'}</span>`}</div>
        <ul class="opts">${r.options.map((o, j) => html`
          <li class="${j === r.answer ? 'answer' : ''} ${j === r.chosen && !r.right ? 'chosen' : ''}">
            ${j === r.answer ? raw(icon('check', { size: 'sm' })) : ''}${o}${j === r.chosen ? html` <span class="muted small">(your answer)</span>` : ''}
          </li>`)}</ul>
        ${r.explanation ? html`<p class="small">${r.explanation}</p>` : ''}
        ${r.kb_slug ? html`<p class="small"><a href="#/kb/p?slug=${r.kb_slug}">Read: ${pageTitle(r.kb_slug)}</a></p>` : ''}
      </div>`)}
    <div class="form-actions">
      <a class="btn primary" href="#/training/quiz?key=${data.quiz.key}${preview ? '&preview=1' : ''}" data-action="again">Try again</a>
      <a class="btn" href="#${preview ? '/training/questions' : '/training'}">Back</a>
    </div>`;
  bind(main, { again: () => route() });
  window.scrollTo(0, 0);
}

async function team(main, { params }) {
  const month = /^\d{4}-\d{2}$/.test(params.get('month') || '') ? params.get('month') : null;
  const [{ people }, perf] = await Promise.all([
    get('/training/team'),
    get(`/performance${month ? `?month=${month}` : ''}`).catch((err) => ({ error: err.message })),
  ]);

  /* Everything that says someone needs a look, in one list: this app's own
     signals, then stars against what their stage of the plan expects. */
  const look = new Map(people.filter((p) => p.needsLook.length).map((p) => [`p${p.id}`, { id: p.id, name: p.name, reasons: [...p.needsLook] }]));
  for (const f of perf.focus || []) {
    const key = f.personId ? `p${f.personId}` : `n${f.name}`;
    if (!look.has(key)) look.set(key, { id: f.personId, name: f.name, reasons: [] });
    look.get(key).reasons.push(f.reason);
  }
  const flagged = [...look.values()];

  main.innerHTML = html`
    <h1>Team</h1>
    <p class="lead">Where each sales executive is on the new starter plan, what they've done, how the teams are doing, and who needs a look. Open someone to log a session or sign off a stage.</p>
    ${flagged.length ? html`
      <div class="card look">
        <h3>${raw(icon('lightbulb', { size: 'sm' }))} Needs a look</h3>
        <ul>${flagged.map((p) => html`<li>${p.id ? html`<a href="#/training/person?id=${p.id}">${p.name}</a>` : p.name}: ${p.reasons.join('; ')}</li>`)}</ul>
        <p class="muted small">From help requests, sign-offs, quizzes, sessions and stars against what their stage of the plan expects.</p>
      </div>` : ''}
    ${performanceSection(perf)}
    <h2>Training</h2>
    ${people.length ? html`
      <div class="table-wrap"><table>
        <thead><tr>
          <th>Name</th><th>Plan</th><th>Signed off</th><th>Resources</th><th>Quizzes passed</th><th>Needs a look</th>
        </tr></thead>
        <tbody>
          ${people.map((p) => html`<tr>
            <td><a href="#/training/person?id=${p.id}">${p.name}</a></td>
            <td>${!p.on_plan ? html`<span class="muted small">Not on the plan</span>` : p.stage ? html`${p.stage} <span class="muted small">· day ${p.day}</span>` : html`<span class="muted small">${p.start_date ? `Starts ${isoToUk(p.start_date)}` : 'No start date'}</span>`}</td>
            <td>${p.stagesSignedOff} / ${p.stagesTotal}</td>
            <td>${p.resourcesDone} / ${p.resourcesTotal}</td>
            <td>${p.quizzesTotal ? `${p.quizzesPassed} / ${p.quizzesTotal}` : html`<span class="muted small">None yet</span>`}</td>
            <td>${p.needsLook.length ? html`<span class="badge warn" title="${p.needsLook.join('; ')}">${p.needsLook.length}</span>` : html`<span class="muted small">No</span>`}</td>
          </tr>`)}
        </tbody>
      </table></div>` : html`<p class="muted">Nobody yet. Sales executives appear here once they've signed in.</p>`}`;
}

const monthLabel = (m) => new Date(`${m}-01T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'Europe/London' });
const shiftMonthKey = (m, by) => {
  const d = new Date(`${m}-01T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + by);
  return d.toISOString().slice(0, 7);
};
const stars = (n) => (n == null ? '–' : (Math.round(n * 100) / 100).toString());

/**
 * John's and Lucy's teams side by side, from the B2C Sales app: the same
 * figures as its "The two teams" page, with no pay. Each person's bar is their
 * stars a day against target 1.
 */
function performanceSection(perf) {
  if (perf.error) return html`<h2>Team performance</h2><p class="notice bad">${perf.error}</p>`;
  if (!perf.connected) {
    return html`<h2>Team performance</h2><p class="notice">Team stars come from the B2C Sales app. They appear here once the two apps are linked on Render.</p>`;
  }
  const nav = html`<span class="month-nav small">
    <a href="#/training/team?month=${shiftMonthKey(perf.month, -1)}">← ${monthLabel(shiftMonthKey(perf.month, -1))}</a>
    <a href="#/training/team">This month</a></span>`;
  if (perf.notOut) return html`<h2>Team performance · ${monthLabel(perf.month)} ${nav}</h2><p class="muted">${monthLabel(perf.month)} isn't out yet in the B2C Sales app.</p>`;
  const nameCell = (p) => (p.personId ? html`<a href="#/training/person?id=${p.personId}">${p.name}</a>` : p.name);
  return html`
    <h2>Team performance · ${monthLabel(perf.month)} ${nav}</h2>
    <p class="muted small">Stars per day sold, from the B2C Sales app. Target 1 this month is ${stars(perf.target1PerDay)} a day${perf.teamAverage != null ? `; the two teams average ${stars(perf.teamAverage)}` : ''}. New starters count towards their team from their 21st working day.</p>
    <div class="teams">
      ${perf.teams.map((t) => html`
        <div class="card team-card">
          <div class="team-head">
            <h3>${t.trainer ? `${t.trainer}'s team` : `${t.half[0].toUpperCase()}${t.half.slice(1)}'s team`}</h3>
            <div class="team-avg"><strong>${stars(t.average)}</strong> <span class="muted small">a day${t.vsTarget != null ? ` · ${t.vsTarget}% of target 1` : ''}</span></div>
          </div>
          <div class="perf-list">${t.people.map((p) => html`
            <div class="perf-row ${p.counted ? '' : 'uncounted'}">
              <div class="perf-name">${nameCell(p)}${p.stage ? html` <span class="muted small">${p.stage}</span>` : ''}</div>
              <div class="perf-bar" title="${p.vsTarget != null ? `${p.vsTarget}% of target 1` : ''}"><span style="width:${Math.min(100, p.vsTarget || 0)}%" class="${p.vsTarget >= 100 ? 'hit' : ''}"></span></div>
              <div class="perf-num">${stars(p.starsPerDay)}</div>
            </div>
            ${p.counted ? '' : html`<div class="muted small perf-note">Not in the team average: ${p.reason || 'not counted yet'}</div>`}`)}
          </div>
        </div>`)}
    </div>`;
}

/**
 * Who is trained on what: each sales executive against each service, with
 * when it was switched on, resources done and the quiz, then their last
 * session and the next one booked.
 */
async function tracker(main) {
  const { services, people } = await get('/coaching/tracker');
  const cell = (s) => {
    if (!s.on) return html`<td class="off"><span class="muted small">Off</span></td>`;
    return html`<td>
      ${s.trainedOn ? html`<div class="small"><span class="badge ok">Trained ${isoToUk(s.trainedOn)}</span></div>` : html`<div class="small">Since ${fmtDate(s.since)}</div>`}
      <div class="small">${s.resourcesDone} / ${s.resourcesTotal} resources</div>
      <div class="small">${!s.quiz ? html`<span class="muted">No quiz yet</span>`
        : s.quiz.pct === null ? html`<span class="muted">Quiz not taken</span>`
        : s.quiz.passed ? html`<span class="badge ok">Quiz passed</span>` : html`<span class="badge warn">Quiz ${s.quiz.pct}%</span>`}</div>
    </td>`;
  };
  main.innerHTML = html`
    <h1>Tracker</h1>
    <p class="lead">Who is trained on what, and what's next. A service shows once Shannon or Poppy switch it on for someone.</p>
    ${people.length ? html`
      <div class="table-wrap"><table class="tracker">
        <thead><tr><th>Name</th>${services.map((s) => html`<th>${s.short}</th>`)}<th>Last session</th><th>Next booked</th></tr></thead>
        <tbody>${people.map((p) => html`<tr>
          <td><a href="#/training/person?id=${p.id}">${p.name}</a></td>
          ${p.services.map(cell)}
          <td class="small">${p.lastSession ? html`${isoToUk(p.lastSession.session_date)}<div class="muted">${p.lastSession.kind}</div>` : html`<span class="muted">None yet</span>`}</td>
          <td class="small">${p.nextSession ? html`${isoToUk(p.nextSession.session_date)}<div class="muted">${p.nextSession.kind}${p.nextSession.trainer_name ? `, ${p.nextSession.trainer_name}` : ''}</div>` : html`<span class="muted">Nothing booked</span>`}</td>
        </tr>`)}</tbody>
      </table></div>` : html`<p class="muted">Nobody yet. Sales executives appear here once they've signed in.</p>`}`;
}

async function helpRequests(main, { params }) {
  const show = params.get('show') || 'waiting';
  const { requests } = await get('/coaching/help');
  const list = show === 'all' ? requests : requests.filter((h) => h.status === 'open');
  main.innerHTML = html`
    <h1>Help requests</h1>
    <p class="lead">What sales executives have asked John or Lucy for help with. Answer here, or say when you'll go through it with them, then close it once it's sorted.</p>
    <p class="chips">
      <a class="chip ${show === 'waiting' ? 'on' : ''}" href="#/training/help">Waiting (${requests.filter((h) => h.status === 'open').length})</a>
      <a class="chip ${show === 'all' ? 'on' : ''}" href="#/training/help?show=all">All (${requests.length})</a>
    </p>
    ${list.length ? helpList(list, { showName: true }) : html`<div class="card empty"><p>${show === 'all' ? 'No help requests yet.' : 'Nothing waiting.'}</p></div>`}`;

  const redraw = () => helpRequests(main, { params }).catch(notifyError);
  bind(main, {
    answer: async (form) => {
      try { await post(`/coaching/help/${form.dataset.id}/answer`, { answer: new FormData(form).get('answer') }); toast('Answer sent.'); refreshHelpCount(); }
      catch (err) { notifyError(err); return; }
      redraw();
    },
    close: async (el) => {
      try { await post(`/coaching/help/${el.dataset.id}/close`); toast('Closed.'); refreshHelpCount(); }
      catch (err) { notifyError(err); }
      redraw();
    },
  });
}

/* ---------------------------- training content ---------------------- */

const STATUS_BADGE = {
  approved: html`<span class="badge ok">Approved</span>`,
  draft: html`<span class="badge warn">Draft</span>`,
  retired: html`<span class="badge">Retired</span>`,
};

/** The fields for writing or changing a quiz question. */
function questionForm(q, kb) {
  const options = [...(q?.options || []), '', '', '', '', ''].slice(0, 5);
  return html`
    <div class="form-grid">
      <label class="full">Question <textarea name="question" rows="2" required>${q?.question || ''}</textarea></label>
      ${options.map((o, i) => html`<label>Answer ${i + 1}${i < 2 ? '' : html` <span class="muted small">(optional)</span>`} <input name="option${i}" value="${o}" ${i < 2 ? raw('required') : ''}></label>`)}
      <label>Right answer
        <select name="answer">${[0, 1, 2, 3, 4].map((i) => html`<option value="${i}" ${q?.answer === i ? raw('selected') : ''}>Answer ${i + 1}</option>`)}</select>
      </label>
      <label class="full">Why it's right, shown after marking <textarea name="explanation" rows="2">${q?.explanation || ''}</textarea></label>
      <label class="full">Page to read
        <select name="kb_slug"><option value="">None</option>${kb.pages.map((p) => html`<option value="${p.slug}" ${q?.kb_slug === p.slug ? raw('selected') : ''}>${p.title} (${p.service || p.section})</option>`)}</select>
      </label>
    </div>`;
}

const questionBody = (form) => {
  const d = new FormData(form);
  const options = [0, 1, 2, 3, 4].map((i) => (d.get(`option${i}`) || '').trim());
  const answer = Number(d.get('answer'));
  if (!options[answer]) throw new Error('The right answer is one you haven’t filled in.');
  const kept = options.map((o, i) => [o, i]).filter(([o]) => o);
  return {
    question: d.get('question'),
    options: kept.map(([o]) => o),
    answer: kept.findIndex(([, i]) => i === answer),
    explanation: d.get('explanation'),
    kb_slug: d.get('kb_slug') || null,
  };
};

async function manageQuestions(main, { params }) {
  const [{ quizzes }, kb] = await Promise.all([get('/training/quizzes'), kbIndex()]);
  const editing = Number(params.get('edit')) || null;
  const open = params.get('quiz');
  main.innerHTML = html`
    <h1>Quiz questions</h1>
    <p class="lead">Sales executives only ever see approved questions. Check each draft against how things really work, then approve it, change it or retire it. Changing an approved question sends it back to draft.</p>
    ${quizzes.map((quiz) => {
      const count = (s) => quiz.questions.filter((x) => x.status === s).length;
      return html`
        <details class="card quiz-admin" ${open === quiz.key || quiz.questions.some((x) => x.id === editing) ? raw('open') : ''}>
          <summary>
            <strong>${quiz.title}</strong>
            <span class="muted small">${count('approved')} approved · ${count('draft')} draft${count('retired') ? ` · ${count('retired')} retired` : ''} · pass mark ${quiz.pass_mark}%</span>
          </summary>
          <p><a class="btn small" href="#/training/quiz?key=${quiz.key}&preview=1">${raw(icon('play', { size: 'sm' }))} Try it, drafts included</a></p>
          ${quiz.questions.map((q, i) => (q.id === editing ? html`
            <form class="q-card editing" data-submit="save" data-id="${q.id}">
              ${questionForm(q, kb)}
              <div class="form-actions">
                <button class="btn primary" type="submit">Save as draft</button>
                <a class="btn" href="#/training/questions?quiz=${quiz.key}">Cancel</a>
              </div>
            </form>` : html`
            <div class="q-card ${q.status}">
              <div class="q-head"><span class="muted">${i + 1}.</span> ${q.question} ${STATUS_BADGE[q.status]}</div>
              <ul class="opts">${q.options.map((o, j) => html`<li class="${j === q.answer ? 'answer' : ''}">${j === q.answer ? raw(icon('check', { size: 'sm' })) : ''}${o}</li>`)}</ul>
              ${q.explanation ? html`<p class="small muted">${q.explanation}</p>` : ''}
              <div class="q-foot">
                ${q.kb_slug ? html`<a class="small" href="#/kb/p?slug=${q.kb_slug}">Page: ${kb.pages.find((p) => p.slug === q.kb_slug)?.title || q.kb_slug}</a>` : html`<span></span>`}
                <span class="page-actions">
                  ${q.status === 'approved' ? html`<span class="muted small">Approved by ${q.approved_by_name || 'a trainer'}, ${fmtDate(q.approved_at)}</span>` : ''}
                  ${q.status !== 'approved' ? html`<button class="btn small primary" data-action="status" data-id="${q.id}" data-status="approved">Approve</button>` : ''}
                  <a class="btn small" href="#/training/questions?edit=${q.id}">Change</a>
                  ${q.status === 'approved' ? html`<button class="btn small" data-action="status" data-id="${q.id}" data-status="draft">Back to draft</button>` : ''}
                  ${q.status !== 'retired' ? html`<button class="btn small" data-action="status" data-id="${q.id}" data-status="retired">Retire</button>`
                    : html`<button class="btn small" data-action="status" data-id="${q.id}" data-status="draft">Bring back</button>`}
                </span>
              </div>
            </div>`))}
          <details class="add">
            <summary class="btn small">${raw(icon('plus', { size: 'sm' }))} Add a question</summary>
            <form class="q-card editing" data-submit="add" data-quiz="${quiz.key}">
              ${questionForm(null, kb)}
              <div class="form-actions"><button class="btn primary" type="submit">Add as draft</button></div>
            </form>
          </details>
        </details>`;
    })}`;

  const redraw = (quizKey) => {
    const target = `#/training/questions?quiz=${quizKey}`;
    if (location.hash !== target) location.hash = target;
    else manageQuestions(main, { params: new URLSearchParams(`quiz=${quizKey}`) }).catch(notifyError);
  };
  const quizOf = (id) => quizzes.find((z) => z.questions.some((x) => x.id === Number(id)))?.key;
  bind(main, {
    status: async (el) => {
      try {
        await post(`/training/questions/${el.dataset.id}/status`, { status: el.dataset.status });
        toast({ approved: 'Approved. It’s live for everyone on that service.', draft: 'Back to draft.', retired: 'Retired.' }[el.dataset.status]);
      } catch (err) { notifyError(err); }
      redraw(quizOf(el.dataset.id));
    },
    save: async (form) => {
      try {
        await put(`/training/questions/${form.dataset.id}`, questionBody(form));
        toast('Saved as a draft. Approve it when it’s right.');
        redraw(quizOf(form.dataset.id));
      } catch (err) { notifyError(err); }
    },
    add: async (form) => {
      try {
        await post(`/training/quizzes/${form.dataset.quiz}/questions`, questionBody(form));
        toast('Added as a draft.');
        redraw(form.dataset.quiz);
      } catch (err) { notifyError(err); }
    },
  });
}

function resourceForm(r, services) {
  return html`
    <div class="form-grid">
      <label class="full">Title <input name="title" value="${r?.title || ''}" required maxlength="200"></label>
      <label class="full">Link <input name="url" value="${r?.url || ''}" required placeholder="https://… or #/kb/p?slug=…"></label>
      <label>Kind
        <select name="kind">${Object.entries(KIND_LABEL).map(([k, v]) => html`<option value="${k}" ${r?.kind === k ? raw('selected') : ''}>${v}</option>`)}</select>
      </label>
      <label>Who sees it
        <select name="service"><option value="">Everyone</option>${services.map((s) => html`<option value="${s.key}" ${r?.service === s.key ? raw('selected') : ''}>${s.name} only</option>`)}</select>
      </label>
      <label class="full">Note <span class="muted small">(optional)</span> <input name="note" value="${r?.note || ''}" maxlength="500"></label>
    </div>`;
}

async function manageResources(main, { params }) {
  const [{ resources }, kb] = await Promise.all([get('/training/resources'), kbIndex()]);
  const editing = Number(params.get('edit')) || null;
  const serviceName = (key) => (key ? kb.services.find((s) => s.key === key)?.name : 'Everyone');
  main.innerHTML = html`
    <h1>Training resources</h1>
    <p class="lead">The links people work through: ProProfs courses, docs, walkthroughs, call recordings and knowledge base pages. A resource for one service only shows once that service is switched on for someone. Never put sign-in details here.</p>
    <details class="card add">
      <summary><strong>${raw(icon('plus', { size: 'sm' }))} Add a resource</strong></summary>
      <form data-submit="add">${resourceForm(null, kb.services)}<div class="form-actions"><button class="btn primary" type="submit">Add</button></div></form>
    </details>
    <div class="res-list admin">
      ${resources.map((r) => (r.id === editing ? html`
        <form class="res-row editing" data-submit="save" data-id="${r.id}">
          ${resourceForm(r, kb.services)}
          <div class="form-actions"><button class="btn primary" type="submit">Save</button><a class="btn" href="#/training/resources">Cancel</a></div>
        </form>` : html`
        <div class="res-row ${r.archived ? 'archived' : ''}">
          <div class="res-body">
            <div>${resourceLink(r)} <span class="badge kind">${KIND_LABEL[r.kind]}</span> <span class="muted small">· ${serviceName(r.service)}</span>${r.archived ? html` <span class="badge">Archived</span>` : ''}</div>
            ${r.note ? html`<div class="muted small">${r.note}</div>` : ''}
          </div>
          <span class="page-actions">
            <a class="btn small" href="#/training/resources?edit=${r.id}">Change</a>
            <button class="btn small" data-action="archive" data-id="${r.id}" data-archived="${r.archived ? 0 : 1}">${r.archived ? 'Bring back' : 'Archive'}</button>
          </span>
        </div>`))}
    </div>`;

  const body = (form) => Object.fromEntries(new FormData(form));
  const back = () => {
    if (location.hash !== '#/training/resources') location.hash = '#/training/resources';
    else manageResources(main, { params: new URLSearchParams() }).catch(notifyError);
  };
  bind(main, {
    add: async (form) => {
      try { await post('/training/resources', body(form)); toast('Added.'); back(); }
      catch (err) { notifyError(err); }
    },
    save: async (form) => {
      try { await put(`/training/resources/${form.dataset.id}`, body(form)); toast('Saved.'); back(); }
      catch (err) { notifyError(err); }
    },
    archive: async (el) => {
      try { await put(`/training/resources/${el.dataset.id}`, { archived: el.dataset.archived === '1' }); toast(el.dataset.archived === '1' ? 'Archived. Ticks already made are kept.' : 'Brought back.'); }
      catch (err) { notifyError(err); }
      back();
    },
  });
}

async function managePlan(main) {
  const [rec, { items }] = await Promise.all([get('/training/me'), get('/coaching/setup-items')]);
  main.innerHTML = html`
    <h1>New starter plan</h1>
    <p class="lead">What you expect at each stage, from day 1 to month 3. Everyone sees this as their flow chart. Working days count Monday to Friday from each person's start date.</p>
    ${flowChart({ ...rec, stage: null })}
    <h2>Change a stage</h2>
    ${rec.plan.map((s) => html`
      <form class="card stage-form" data-submit="save" data-key="${s.key}">
        <div class="form-grid">
          <label>Stage <input name="title" value="${s.title}" maxlength="60" required></label>
          <label>Starts on working day <input name="from_day" type="number" min="1" max="400" value="${s.from_day}" required></label>
          <label class="full">What's expected <input name="expectation" value="${s.expectation}" maxlength="500" required></label>
          <label class="full">What they do <span class="muted small">(one per line)</span> <textarea name="activities" rows="3">${s.activities.join('\n')}</textarea></label>
        </div>
        <div class="form-actions"><button class="btn small primary" type="submit">Save ${s.title}</button></div>
      </form>`)}
    <h2>New starter set-up checklist</h2>
    <p class="muted">What has to be in place for each new starter. You tick these off on each person's page. Only whether each thing is done is kept: never sign-in details.</p>
    <div class="res-list admin">${items.map((i) => html`
      <form class="res-row ${i.archived ? 'archived' : ''}" data-submit="item" data-id="${i.id}">
        <div class="res-body"><input class="inline-input" name="title" value="${i.title}" maxlength="200" aria-label="Checklist item" required></div>
        <span class="page-actions">
          <button class="btn small" type="submit">Save</button>
          <button class="btn small" data-action="archive-item" data-id="${i.id}" data-archived="${i.archived ? 0 : 1}">${i.archived ? 'Bring back' : 'Remove'}</button>
        </span>
      </form>`)}</div>
    <form class="form-actions add-item" data-submit="add-item">
      <input class="inline-input" name="title" maxlength="200" placeholder="Something else to set up" required>
      <button class="btn small primary" type="submit">Add</button>
    </form>`;

  const redraw = () => managePlan(main).catch(notifyError);
  bind(main, {
    item: async (form) => {
      try { await put(`/coaching/setup-items/${form.dataset.id}`, { title: new FormData(form).get('title') }); toast('Saved.'); }
      catch (err) { notifyError(err); }
    },
    'archive-item': async (el) => {
      try { await put(`/coaching/setup-items/${el.dataset.id}`, { archived: el.dataset.archived === '1' }); }
      catch (err) { notifyError(err); }
      redraw();
    },
    'add-item': async (form) => {
      try { await post('/coaching/setup-items', { title: new FormData(form).get('title') }); toast('Added.'); redraw(); }
      catch (err) { notifyError(err); }
    },
    save: async (form) => {
      const d = Object.fromEntries(new FormData(form));
      try {
        await put(`/training/plan/${form.dataset.key}`, {
          title: d.title, expectation: d.expectation, from_day: Number(d.from_day), activities: d.activities.split('\n'),
        });
        toast('Saved.');
        managePlan(main).catch(notifyError);
      } catch (err) { notifyError(err); }
    },
  });
}

/* ---------------------------- manage -------------------------------- */

async function managePeople(main) {
  const [{ people }, { services }] = await Promise.all([get('/people'), get('/knowledge')]);
  main.innerHTML = html`
    <h1>People and access</h1>
    <p class="lead">Everyone on John's and Lucy's teams can be brought in from the B2C Sales app, before they've signed in. Set each person's role and start date, whether they follow the new starter plan, and switch on each service as their training on it starts.</p>
    <p><button class="btn" data-action="import">${raw(icon('users', { size: 'sm' }))} Bring in the team from the B2C Sales app</button>
      <span class="muted small">Adds anybody not here yet. Nobody already here is changed.</span></p>
    <div class="table-wrap"><table class="people">
      <thead><tr>
        <th>Name</th><th>Role</th><th>Access</th><th title="First day on the sales team. It places them on the new starter plan.">Start date</th><th title="Whether they see the new starter plan">New starter plan</th>
        ${services.map((s) => html`<th title="${s.name}">${s.short}</th>`)}
      </tr></thead>
      <tbody>
        ${people.map((p) => html`<tr class="${p.status === 'inactive' ? 'off' : ''}">
          <td><div>${p.name}</div><div class="muted small">${p.signedIn ? p.email : 'Not signed in yet'}</div></td>
          <td>
            <select data-change="role" data-id="${p.id}" aria-label="Role for ${p.name}">
              ${Object.entries(ROLE_LABEL).map(([k, v]) => html`<option value="${k}" ${p.role === k ? raw('selected') : ''}>${v}</option>`)}
            </select>
          </td>
          <td>
            <label class="switch"><input type="checkbox" data-change="status" data-id="${p.id}" ${p.status === 'active' ? raw('checked') : ''}> <span>${p.status === 'active' ? 'On' : 'Off'}</span></label>
          </td>
          <td><input type="date" data-change="start" data-id="${p.id}" value="${p.start_date || ''}" aria-label="Start date for ${p.name}"></td>
          <td><input type="checkbox" data-change="plan" data-id="${p.id}" aria-label="New starter plan for ${p.name}" ${p.on_plan ? raw('checked') : ''}></td>
          ${services.map((s) => html`<td>
            <input type="checkbox" data-change="service" data-id="${p.id}" data-service="${s.key}" aria-label="${s.name} for ${p.name}" ${p.services.includes(s.key) ? raw('checked') : ''}>
          </td>`)}
        </tr>`)}
      </tbody>
    </table></div>`;

  const redraw = () => managePeople(main).catch(notifyError);
  bind(main, {
    role: async (el) => {
      try { await put(`/people/${el.dataset.id}/role`, { role: el.value }); toast('Role saved.'); }
      catch (err) { notifyError(err); }
      redraw();
    },
    status: async (el) => {
      try { await put(`/people/${el.dataset.id}/status`, { status: el.checked ? 'active' : 'inactive' }); toast(el.checked ? 'Access switched on.' : 'Access switched off.'); }
      catch (err) { notifyError(err); }
      redraw();
    },
    service: async (el) => {
      try { await put(`/people/${el.dataset.id}/services/${el.dataset.service}`, { on: el.checked }); }
      catch (err) { notifyError(err); redraw(); }
    },
    start: async (el) => {
      try { await put(`/people/${el.dataset.id}/start-date`, { date: el.value || null }); toast(el.value ? 'Start date saved.' : 'Start date cleared.'); }
      catch (err) { notifyError(err); redraw(); }
    },
    plan: async (el) => {
      try { await put(`/people/${el.dataset.id}/plan`, { on: el.checked }); toast(el.checked ? 'On the new starter plan.' : 'Off the new starter plan.'); }
      catch (err) { notifyError(err); redraw(); }
    },
    import: async (el) => {
      el.disabled = true;
      try {
        const { added } = await post('/people/import-from-b2c');
        toast(added ? `${added} brought in from the B2C Sales app.` : 'Everyone is already here.');
      } catch (err) { notifyError(err); }
      redraw();
    },
  });
}

start();
