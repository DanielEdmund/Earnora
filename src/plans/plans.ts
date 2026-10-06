/**
 * The product's earning plans — the single source of truth for pricing,
 * daily task quotas, per-task rewards and the flat per-referral bonus.
 * Purchasing a plan is a one-time payment (no expiry) and unlocks the
 * task feed and withdrawals.
 */
export type PlanKey = 'beginner' | 'intermediate' | 'extreme';

export interface PlanDef {
  key: PlanKey;
  name: string;
  /** one-time price in kobo (₦1 = 100 kobo) */
  priceKobo: number;
  /** how many tasks the plan may claim per day (resets at midnight WAT) */
  dailyTaskLimit: number;
  /** what each approved task pays, regardless of the task's own listed reward */
  taskRewardKobo: number;
  /** flat bonus paid to the REFERRER (at their plan's rate) when someone they invited buys a plan */
  referralBonusKobo: number;
}

export const PLANS: Record<PlanKey, PlanDef> = {
  beginner: {
    key: 'beginner',
    name: 'Beginner',
    priceKobo: 300_000,
    dailyTaskLimit: 3,
    taskRewardKobo: 20_000,
    referralBonusKobo: 20_000,
  },
  intermediate: {
    key: 'intermediate',
    name: 'Intermediate',
    priceKobo: 650_000,
    dailyTaskLimit: 6,
    taskRewardKobo: 30_000,
    referralBonusKobo: 40_000,
  },
  extreme: {
    key: 'extreme',
    name: 'Extreme',
    priceKobo: 1_050_000,
    dailyTaskLimit: 10,
    taskRewardKobo: 40_000,
    referralBonusKobo: 60_000,
  },
};

export const PLAN_KEYS = Object.keys(PLANS) as PlanKey[];
export const PLAN_LIST: PlanDef[] = PLAN_KEYS.map((k) => PLANS[k]);

/** Highest per-task payout any plan produces — advertiser budgets must cover it. */
export const MAX_PLAN_REWARD_KOBO = Math.max(...PLAN_LIST.map((p) => p.taskRewardKobo));

export function planDef(key: string | null | undefined): PlanDef | null {
  if (!key) return null;
  return (PLANS as Record<string, PlanDef>)[key] ?? null;
}

/** SQL fragment: start of "today" in Africa/Lagos (daily quota reset). */
export const LAGOS_DAY_START_SQL = `date_trunc('day', now() AT TIME ZONE 'Africa/Lagos') AT TIME ZONE 'Africa/Lagos'`;

/** Claim states that count toward the daily task quota. */
export const COUNTED_CLAIM_STATES = `('claimed','submitted','queued_review','approved')`;
