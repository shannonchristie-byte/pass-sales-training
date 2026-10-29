# Pass sales training and knowledge base

The B2C sales team's training and knowledge base app, for Shannon Christie
(Head of Sales). Plan, decisions and phases:
https://claude.ai/artifact/MhDmGiZi4caHFUHA8PC4ho (objection handling draft is
its second tab).

## Status

- Decided 28 Oct 2026: a separate web app on Render (Pass Team workspace),
  built like the B2C Sales app (Node 24, Express 5, node:sqlite on a Render
  disk). Two parts: a knowledge base (the same for everyone) and training and
  development (personal to each person). Three roles: exec, trainer (John,
  Lucy), manager (Shannon, Poppy). People sign in with their B2C Sales login
  through a handoff; stars, teams and target 1 come from the B2C Sales app by
  a read-only link (phase 4). MME left out; chatbot later.
- **Phase 0 built 28 Oct 2026, on this computer only:** sign-in handoff (the
  training side), sessions, roles, service switches, the People and access
  screen, and empty shells of both parts. 15 tests pass. Not committed, not on
  GitHub, not on Render.
- **Not done yet:** the B2C Sales app's side of the handoff and the figures
  link (spec in `docs\HANDOFF.md`). Don't change bonus-app
  (github.com/shannonchristie-byte/bonus-app, Shannon's) without her say-so.
- **Phase 1 started 29 Oct 2026:** knowledge base pages with search, version
  history, trainer suggestions, manager publishing and "checked" marks. 73
  pages moved across on 29 Oct: services (`content\pfs`, `astar`, `pmg`,
  `alevel`, `access`, and `exams` from Alex's online exams sales guide,
  https://claude.ai/artifact/5QZQ5fvYE1ReAeCj6DekFS) and sections (`objections`, `rules`, `scripts`,
  `tawk`, `resources`), with "To check" notes where a doc contradicts itself.
  In pages, "> **To check:** …" is a flag for John or Lucy; any other "> "
  quote is a line to say on a call or paste into a chat. Pay (star values,
  bonus tiers, stars per discount) is left out; pages link to the B2C Sales
  app's "What a sale is worth" for stars. Tawk answers come from the Tawk
  response hint sheet (its customer sign-in and test card lines left out);
  sales resources and discount codes from the B2C Sales app's Sales
  resources page (MME left out; that page still exists in bonus-app). 27
  tests pass.
- Phase 1 content is complete.
- **Phase 2 built 29 Oct 2026:** training and development. The new starter
  plan (Shannon's day 1 to month 3, 9 stages, `training\plan.json`) shows as
  a flow chart placed by each person's start date (working days Monday to
  Friday; managers set start dates on People and access). Trainers sign off
  stages. 37 training resources (`training\resources.json`, from the PASS
  independent training day doc, the presentation and ProProfs) show per
  switched-on service, and people tick them off. 7 quizzes, 58 questions
  (`training\quizzes\`), all drafts: sales executives only see questions
  John or Lucy approve, answers stay on the server until handed in, and
  changing an approved question sends it back to draft. Managers edit the
  plan. 40 tests pass. ProProfs course links for Pre-Interview, Courses 6
  and 7 and Access go to "My trainings" (no direct links found).
- **Phase 3 built 29 Oct 2026:** session feedback (`sessions_log`: a note
  shared with the person and a private note the server never sends to them;
  sessions can be booked ahead; people mark feedback read), help requests
  (people raise their own, trainers and managers answer and close), the
  Tracker (each exec against each service, last and next session), a "Needs
  a look" list on Team (open help, unsigned stages, quizzes not passed, no
  session in 14 days), and for managers only, private notes and a new starter
  set-up checklist (`training\setup.json`, a starting list to match against
  Poppy's set-up doc; never sign-in details). Routes in
  `src\routes\coaching.js`. 46 tests pass.
- **Phase 4 built 29 Oct 2026, on this computer only:** the bonus-app side of
  the link (sign-in handoff and read-only figures feed) is in a separate copy,
  `C:\dev\bonus-app-training-link`, branch `training-link`, uncommitted (see
  `docs\HANDOFF.md`). Shannon's own copy in `Documents\bonus-app` is untouched.
  The training app reads the feed (`src\b2c-feed.js`, `src\routes\performance.js`):
  both teams side by side on Team, and stars against what each stage of the
  plan expects join "Needs a look". Tested together locally with made-up
  people. 51 tests pass here, 503 in bonus-app.
- **Phase 5 (going live), planned 29 Oct 2026** in the plan doc. Decided:
  this repo goes on GitHub as a public repo, like bonus-app; Shannon creates
  the Render service once Alex OKs the cost; it opens to the whole team from
  day one; Render work happens on a weekday evening after 8:30pm. Stage 1 done
  29 Oct: Render makes HANDOFF_KEY (`generateValue`) and the app uses
  `RENDER_EXTERNAL_URL` for its own address; both repos committed locally
  (this one on `main`, bonus-app on `training-link`). Stage 2 done 29 Oct:
  this repo is public at github.com/shannonchristie-byte/pass-sales-training,
  and bonus-app's `training-link` branch is on GitHub, not merged (its `main`
  was then unchanged). Stage 3 done 29 Oct at 4:27pm (Shannon chose to go
  ahead in opening hours): `training-link` merged into bonus-app's main
  (f327025) and Render redeployed it; offline for under a minute, back at
  4:28pm, health check fine, and the link answers "not set up" as it should
  until stage 4. Next: stage 4, once Alex OKs the cost: Shannon creates this
  service from `render.yaml` in Pass Team, then adds HANDOFF_KEY (copied from
  this service's Environment tab) and TRAINING_RETURN_URL to the B2C Sales app.
  Content added to `content\` or `training\` after a database exists only reaches it if new;
  additions to existing pages (such as the online exams links added to the
  Pass GCSE and A Level "at a glance" pages) need making in the app.
  Source docs are listed under "Sales team" in
  `C:\dev\pass-hq\context\learned.md`. Pages in `content\` only seed new pages:
  once a page is in the database, edits happen in the app.

## Working on it

- `npm run try` (or `Try sales training.bat`) runs it at http://localhost:3100
  with made-up people; `npm test` runs the tests. Keep the tests passing and
  add tests for every new role rule.
- In this session's preview, the `sales-training` entry in
  `C:\dev\pass-hq\.claude\launch.json` starts it.

## Pass knowledge

Pass knowledge lives in `C:\dev\pass-hq`. Read what's relevant from there
(start with `context\learned.md`, then `context\company\README.md`) and follow
the ground rules in `C:\dev\pass-hq\CLAUDE.md`. Add durable facts about Pass to
`C:\dev\pass-hq\context\learned.md`, not to this folder.

## Rules for this project

- No pay of any kind stored or shown in this app.
- Every role check on the server, never only hidden on screen.
- Knowledge base content is for the whole sales team: no staff names, hours,
  rota or figures about named staff in it.
- No learner or customer details in the app or its sample data; test data uses
  invented names.
- No credentials anywhere in this folder. Secrets go in Render's Environment
  tab, set by Shannon.
- UK English, sentence case, no emoji in anything written for Pass.
- Ask Shannon before anything that costs money, gives someone else access,
  publishes the app or changes the B2C Sales app.

## Where things are

| What | Where |
|---|---|
| How it works, how to try it | `README.md` |
| Linking to the B2C Sales app | `docs\HANDOFF.md` |
| Server code | `src\` (sign-in and roles in `src\auth.js`) |
| Screens | `public\app.js` |
| Tests | `test\` |
| Hosting (not deployed) | `render.yaml` |
