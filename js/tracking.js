// US4 tracking rules: which tracker entries belong in which tab, and the weekly goal.
// Pure functions (no storage, no DOM) so they can be unit-tested.

export const WEEKLY_GOAL = 2;
export const REFERRAL_STATUSES = [
  { id: 'in_progress', label: 'In progress' },
  { id: 'completed', label: 'Completed' },
  { id: 'rejected', label: 'Rejected' },
];
export const TABS = [
  { id: 'to_apply', label: 'To apply' },
  { id: 'all', label: 'All' },
  { id: 'applied', label: 'Applied' },
  { id: 'referred', label: 'Referred' },
];

/** Monday 00:00 local time of the week containing `t`. Weeks run Monday–Sunday. */
export function weekStart(t = Date.now()) {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  const daysSinceMonday = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - daysSinceMonday);
  return d.getTime();
}

function nextWeek(start) {
  const d = new Date(start);
  d.setDate(d.getDate() + 7); // setDate handles daylight-saving changes
  return d.getTime();
}

function prevWeek(start) {
  const d = new Date(start);
  d.setDate(d.getDate() - 7);
  return d.getTime();
}

/** Applications sent in the week that starts at `start`. */
export function appliedInWeek(entries, start) {
  const end = nextWeek(start);
  return entries.filter((e) => {
    const t = Date.parse(e.appliedAt);
    return t >= start && t < end;
  }).length;
}

/**
 * Weekly goal card numbers.
 * streak = consecutive weeks hitting the goal, counting this week only once it's hit.
 */
export function weeklyGoal(entries, now = Date.now(), goal = WEEKLY_GOAL) {
  const start = weekStart(now);
  const thisWeek = appliedInWeek(entries, start);
  let streak = 0;
  let w = thisWeek >= goal ? start : prevWeek(start);
  while (appliedInWeek(entries, w) >= goal) {
    streak++;
    w = prevWeek(w);
  }
  return { count: thisWeek, goal, met: thisWeek >= goal, streak, weekStart: start, weekEnd: nextWeek(start) - 1 };
}

/** Does a tracker entry belong in a tab? */
export function inTab(entry, tab) {
  const queued = Boolean(entry.queuedAt) && !entry.removedAt;
  switch (tab) {
    case 'to_apply':
      return queued && !entry.appliedAt;
    case 'applied':
      return Boolean(entry.appliedAt);
    case 'referred':
      return Boolean(entry.referral);
    case 'all':
      return queued || Boolean(entry.appliedAt) || Boolean(entry.referral);
    default:
      return false;
  }
}

/** Most recent activity on an entry, for sorting. */
export function lastActivity(e) {
  return Math.max(...[e.queuedAt, e.appliedAt, e.referral?.updatedAt, e.referral?.at].map((t) => Date.parse(t) || 0));
}

/** Entries for a tab, in a useful order. To apply: oldest first (it's a queue). Others: newest first. */
export function entriesForTab(entries, tab) {
  const list = entries.filter((e) => inTab(e, tab));
  if (tab === 'to_apply') return list.sort((a, b) => Date.parse(a.queuedAt) - Date.parse(b.queuedAt));
  if (tab === 'applied') return list.sort((a, b) => Date.parse(b.appliedAt) - Date.parse(a.appliedAt));
  if (tab === 'referred') return list.sort((a, b) => Date.parse(b.referral.at) - Date.parse(a.referral.at));
  return list.sort((a, b) => lastActivity(b) - lastActivity(a));
}

export function shortDate(iso) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function weekLabel(start, end) {
  const f = (t) => new Date(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  return `${f(start)} – ${f(end)}`;
}
