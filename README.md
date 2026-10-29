# Sales training

The B2C sales team's training and knowledge base. Two parts:

- **Knowledge base:** the same for everyone. Every service's pages, prices,
  scripts, objection handling, sales rules and resources.
- **Training and development:** personal to each person. Their training plan,
  the courses switched on for them, feedback from sessions with John and Lucy,
  and help requests, with a team view for trainers and managers.

Three roles: **sales executive**, **trainer** (John, Lucy) and **manager**
(Shannon, Poppy). People sign in with their B2C Sales login. See
[docs/HANDOFF.md](docs/HANDOFF.md) for how the two apps link.

The plan, decisions and phases are in the
[plan doc](https://claude.ai/artifact/MhDmGiZi4caHFUHA8PC4ho).

## Trying it on this computer

Double-click **`Try sales training.bat`**. It opens http://localhost:3100 with
made-up people to sign in as (a manager, a trainer and three sales
executives). Nothing real is in it, and test sign-in refuses to run on Render.

From a terminal: `npm run try`. Tests: `npm test`.

## Where things are

| What | Where |
| --- | --- |
| Starts the app | `server.js` |
| Routes and screens' data | `src/routes/` |
| Sign-in, sessions and role checks | `src/auth.js` |
| Database tables | `src/db.js` |
| The list of services | `src/services.js` |
| Knowledge base starting pages (one markdown file each) | `content/<service>/` |
| How they load (new pages only, never over an edit) | `src/content.js` |
| Training starting content: the new starter plan, resources, quiz questions | `training/` |
| How it loads (the same rule: new only, never over an edit) | `src/training-content.js` |
| Working days and where someone is on the plan | `src/plan.js` |
| Screens | `public/app.js` |
| Look (Pass design system, copied from the B2C Sales app) | `public/pass.css`, `public/styles.css`, `public/icons.js` |
| Hosting (not deployed yet) | `render.yaml` |

## Rules this code keeps

- **No pay of any kind** is stored or shown. Stars and teams come from the
  B2C Sales app when they're needed, not copied in.
- **Every role check is on the server.** Hiding a menu item is never the
  protection.
- **No passwords, keys or real staff data in the repo.** Secrets live in
  Render's Environment tab, and test data uses invented names.
- **Quiz answers stay on the server** until a quiz is handed in, and sales
  executives only see questions John or Lucy have approved.
