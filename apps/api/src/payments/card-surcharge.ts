import { Prisma } from '@prisma/client';

/** Decision 406: a School's card surcharge is at most 3%, kept in basis points. */
export const CARD_SURCHARGE_MAX_BPS = 300;

/** The plan types a member pays by card, where the surcharge applies: the
 * one-off ones, and a Subscription's first payment and renewals (its own
 * recurring line on the Stripe Subscription, stripe-subscription-surcharge.ts).
 * A Friend Pass is never sold. */
export const CARD_SURCHARGE_PLAN_TYPES = ['CLASS_PACK', 'WEEKLY_PASS', 'TRIAL_MEMBERSHIP', 'SUBSCRIPTION'] as const;

/**
 * The surcharge on `price` (minor units) at `bps` basis points, in the same
 * minor units, rounded half up once. Integer arithmetic only, so no
 * floating-point drift: 2.5% of 1999 is 49.975, charged as 50.
 */
export function cardSurchargeAmount(price: number, bps: number): number {
  if (!Number.isInteger(price) || !Number.isInteger(bps) || price <= 0 || bps <= 0) return 0;
  return Math.floor((price * bps + 5000) / 10000);
}

/** The surcharge for one plan, or 0 where it never applies (see CARD_SURCHARGE_PLAN_TYPES). */
export function planCardSurcharge(plan: { type: string; price: number }, bps: number): number {
  return (CARD_SURCHARGE_PLAN_TYPES as readonly string[]).includes(plan.type) ? cardSurchargeAmount(plan.price, bps) : 0;
}

/**
 * The rate that applies to a School's card payments now, in basis points
 * (0 = none): the School switched it on, its country is on the Platform
 * Admin allow-list, and it takes card payments. Read through the
 * card_surcharge_bps() database function (migration
 * 20270105000000_card_surcharge), so the purchase and the School's public
 * profile apply one rule whichever connection asks.
 */
export async function readCardSurchargeBps(
  client: { $queryRaw: (query: Prisma.Sql) => Promise<unknown> },
  schoolId: string,
): Promise<number> {
  const rows = (await client.$queryRaw(Prisma.sql`SELECT "card_surcharge_bps"(${schoolId}) AS bps`)) as Array<{ bps: number | null }>;
  return Number(rows[0]?.bps ?? 0);
}
