# Linking to the B2C Sales app

The training app has no passwords of its own. People sign in with their B2C
Sales login, and the training app reads teams and stars from the B2C Sales
app. Both need small additions to the B2C Sales app
([bonus-app](https://github.com/shannonchristie-byte/bonus-app)). This page is
the spec for them.

**Status (29 Oct 2026):** built and tested on Shannon's computer only, in a
separate copy at `C:\dev\bonus-app-training-link`, branch `training-link`,
not committed, not on GitHub, not on Render. The code is
`src/core/routes/training-link.js` (mounted in `src/app.js`), the sign-in
screen's carry-on in `public/app.js` (`pendingHandoff`), tests in
`test/training-link.test.js`, and the two settings in `HOSTING.md`. All 503
bonus-app tests pass. Codes are stored as a hash only. The feed refuses a
month that isn't out for the team yet, and has `half`, `trainerName` and each
person's `name` as well as the fields below.

Both apps hold the same secret, `HANDOFF_KEY`, set by hand in Render's
Environment tab for each service. It is never written in either repo.

## 1. Sign-in handoff

```
Training app                     Person's browser                  B2C Sales app
------------                     ----------------                  -------------
/auth/start
  makes a random state,
  sets it in a cookie  ───────►  goes to
                                 /api/handoff/start
                                   ?app=training&state=…&return=…  ───────►  signed in? if not, sign-in page first
                                                                             makes a one-time code (60 seconds, single use)
                                 comes back to                     ◄───────  redirects to return?code=…&state=…
/auth/callback  ◄──────────────  /auth/callback?code=…&state=…
  checks state = cookie
  POST /api/handoff/redeem  ─────────────────────────────────────────────►  checks HANDOFF_KEY, swaps code
  (server to server, with HANDOFF_KEY)                             ◄───────  { staffId, email, name, role, scheme, status }
  signs the person in
```

### What the B2C Sales app adds

**`GET /api/handoff/start?app=training&state=…&return=…`**

- `return` must equal the `TRAINING_RETURN_URL` environment value exactly,
  otherwise 400. This stops the code being sent anywhere else.
- `state` is passed back untouched.
- Not signed in: show the normal sign-in, then carry on to the step below.
- Signed in and active: make a code (32 random bytes, hex), store it with the
  staff id, `app`, and an expiry 60 seconds away, then redirect to
  `return?code=…&state=…`.

**`POST /api/handoff/redeem`**, body `{ "code": "…", "app": "training" }`

- `Authorization: Bearer <HANDOFF_KEY>`, compared with `timingSafeEqual`;
  wrong or missing gives 401.
- Unknown, used or expired code gives 400. A code works once and is deleted
  when redeemed.
- Answers `{ staffId, email, name, role, scheme, status }` from the staff
  table. Nothing about pay.

**Tests to add in bonus-app:** wrong return address refused; code works once;
code expires; wrong key refused; a switched-off person gets no code.

## 2. Read-only figures (phase 4)

**`GET /api/training-feed/teams?month=YYYY-MM`**, same `Authorization` header.

Answers what "The two teams" page shows, and nothing else:

```json
{
  "month": "2026-10",
  "target1PerDay": 8.02,
  "teams": [
    {
      "trainerStaffId": 0,
      "average": 10.9,
      "people": [
        { "staffId": 0, "starsPerDay": 0, "daysSold": 0, "counted": true, "countsFrom": "2026-10-05" }
      ]
    }
  ]
}
```

No bonus amounts, tier prizes, pot bands or overtime. It reuses the B2C Sales
app's own half averages and new-starter rule, so the two apps can never
disagree.

## Environment

| Where | Name | What |
| --- | --- | --- |
| Training app | `B2C_URL` | `https://b2c-sales.onrender.com` (set in `render.yaml`) |
| Training app | `PUBLIC_URL` | Not needed on Render: the app uses `RENDER_EXTERNAL_URL`, which Render sets |
| Training app | `HANDOFF_KEY` | The shared secret. Render makes it (`generateValue` in `render.yaml`) |
| B2C Sales app | `TRAINING_RETURN_URL` | `<PUBLIC_URL>/auth/callback` |
| B2C Sales app | `HANDOFF_KEY` | The same shared secret |
