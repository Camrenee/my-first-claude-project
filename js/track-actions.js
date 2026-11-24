// Applied / Referred actions shared by the Tracker and the details sheet.
import { trackerEntries, setApplied, setReferral } from './store.js';
import { weeklyGoal, WEEKLY_GOAL } from './tracking.js';
import { toast } from './toast.js';

export function appliedMessage() {
  const g = weeklyGoal(trackerEntries());
  return g.met ? `Applied! That's ${g.count} this week. Goal hit.` : `Applied! ${g.count} of ${WEEKLY_GOAL} this week.`;
}

/**
 * Toggles for the details sheet. `onChange(kind, on)` lets the caller react
 * (the feed closes the sheet and moves on when a job is marked applied).
 */
export function trackingFor(job, { onChange } = {}) {
  const current = () => trackerEntries().find((e) => e.id === job.id) ?? {};
  return {
    applied: () => Boolean(current().appliedAt),
    referred: () => Boolean(current().referral),
    toggleApplied() {
      const on = !current().appliedAt;
      setApplied(job, on);
      toast(on ? appliedMessage() : 'No longer marked as applied.');
      onChange?.('applied', on);
      return on;
    },
    toggleReferred() {
      const on = !current().referral;
      setReferral(job, on ? {} : null);
      toast(on ? 'Marked as referred. Add who referred you in the Tracker.' : 'Referral removed.');
      onChange?.('referred', on);
      return on;
    },
  };
}
