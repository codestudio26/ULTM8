import { BadRequestException } from '@nestjs/common';

/**
 * Decision 442 item 2: whether a School takes card payments from its members.
 *
 * One rule everywhere: the School has a Stripe payment account, it is
 * connected (onboarding started, `stripeConnectedAccountId`), AND Stripe has
 * said it is ready (`stripeAccountReady`: onboarding finished and charges
 * enabled, the same test as the setup checklist, Decision 441 item 6).
 *
 * Until then the School behaves as a School that takes no cards (Decisions
 * 437, 439, 441): members order by cash or bank transfer (Pix in Brazil) and
 * staff confirm it, and a monthly plan's later months go on the member's
 * balance. A card purchase asked for anyway is refused with
 * CARD_PAYMENTS_NOT_READY.
 *
 * The same rule runs in the database for the School's public profile and the
 * card surcharge (school_card_payments() and card_surcharge_bps(), migration
 * 20270312000001_card_payments_need_ready_stripe).
 *
 * Only new card payments follow it. What already exists on Stripe (a card
 * Subscription, a saved card, a payment to refund) keeps being managed through
 * the School's Stripe account whatever this says.
 */
export type CardAccount = { provider: string; stripeConnectedAccountId: string | null; stripeAccountReady: boolean };

/** The PaymentAccount columns takesCards() reads. */
export const CARD_ACCOUNT_SELECT = { provider: true, stripeConnectedAccountId: true, stripeAccountReady: true } as const;

export function takesCards(account: CardAccount | null | undefined): boolean {
  return account?.provider === 'STRIPE' && !!account.stripeConnectedAccountId && account.stripeAccountReady;
}

/** A Stripe payment account that can't take cards yet: onboarding not
 * started or not finished, or Stripe wants more details. */
export function stripeNotReady(account: CardAccount | null | undefined): boolean {
  return account?.provider === 'STRIPE' && !takesCards(account);
}

export const CARD_PAYMENTS_NOT_READY_MESSAGE =
  "This School can't take card payments yet. Pay at the School instead, by cash or bank transfer, and staff confirm it.";

/** The refusal of a card payment at a School whose Stripe account isn't ready. */
export function cardPaymentsNotReady(): BadRequestException {
  return new BadRequestException({ code: 'CARD_PAYMENTS_NOT_READY', message: CARD_PAYMENTS_NOT_READY_MESSAGE });
}
