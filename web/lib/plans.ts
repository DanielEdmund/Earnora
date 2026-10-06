'use client';

/** Shared plan catalog — must match src/plans/plans.ts on the API. */

export interface PlanDef {
  key: 'beginner' | 'intermediate' | 'extreme';
  name: string;
  /** one-time price in kobo */
  priceKobo: number;
  /** tasks the plan may claim per day (resets midnight WAT) */
  dailyTaskLimit: number;
  /** what each approved task pays */
  taskRewardKobo: number;
  /** flat bonus the referrer earns at THEIR plan's rate */
  referralBonusKobo: number;
}

export const PLANS: PlanDef[] = [
  {
    key: 'beginner',
    name: 'Beginner',
    priceKobo: 300_000,
    dailyTaskLimit: 3,
    taskRewardKobo: 20_000,
    referralBonusKobo: 20_000,
  },
  {
    key: 'intermediate',
    name: 'Intermediate',
    priceKobo: 650_000,
    dailyTaskLimit: 6,
    taskRewardKobo: 30_000,
    referralBonusKobo: 40_000,
  },
  {
    key: 'extreme',
    name: 'Extreme',
    priceKobo: 1_050_000,
    dailyTaskLimit: 10,
    taskRewardKobo: 40_000,
    referralBonusKobo: 60_000,
  },
];

export function planDef(key: string | null | undefined): PlanDef | null {
  if (!key) return null;
  return PLANS.find((p) => p.key === key) ?? null;
}
