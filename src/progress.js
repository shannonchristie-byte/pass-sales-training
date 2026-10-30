/**
 * progress.js — who needs a look from John or Lucy, and why.
 *
 * Plain signals from this app only: an open help request, a plan stage left
 * behind without a sign-off, a quiz not passed, or no session logged for a
 * while. Stars and target 1 join these when the B2C Sales app's figures link
 * arrives (phase 4). Each reason is a short sentence for the Team screen.
 */

import { ukToday } from './plan.js';

export const QUIET_DAYS = 14;

const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86400000);

/**
 * `record` is the training record from routes/training.js: plan with
 * sign-offs, the current stage, and quizzes with each one's best attempt.
 */
export function needsLook(db, person, record, today = ukToday()) {
  const reasons = [];

  const openHelp = db.prepare("SELECT COUNT(*) AS n FROM help_requests WHERE person_id = ? AND status = 'open'").get(person.id).n;
  if (openHelp) reasons.push(`${openHelp} help request${openHelp === 1 ? '' : 's'} waiting`);

  /* The plan and the quiet-spell check are for new starters on the plan only. */
  const onPlan = person.on_plan === undefined ? true : !!person.on_plan;
  const at = record.plan.findIndex((s) => s.key === record.stage);
  const behind = onPlan ? record.plan.slice(0, Math.max(at, 0)).find((s) => !s.signedOff) : null;
  if (behind) reasons.push(`${behind.title} not signed off`);

  for (const q of record.quizzes) {
    if (q.attempts && !q.best?.passed) reasons.push(`${q.title} quiz not passed yet`);
  }

  if (onPlan && person.start_date && record.day >= 1) {
    const last = db.prepare("SELECT MAX(session_date) AS d FROM sessions_log WHERE person_id = ? AND status = 'done'").get(person.id).d;
    const since = last || person.start_date;
    if (daysBetween(since, today) >= QUIET_DAYS) reasons.push(last ? `No session logged since ${last}` : 'No session logged yet');
  }

  return reasons;
}
