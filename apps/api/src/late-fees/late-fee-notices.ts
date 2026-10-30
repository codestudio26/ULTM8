import { noticeMoney } from '../charges/charge-ledger';

/**
 * The member's late-fee notices (Decision 413 item 8), in the API's English;
 * @ultm8/i18n's translate.ts matches each shape and shows it in the reader's
 * language. A Guardian gets the usual copy from the notification fanout job.
 * Amounts are "12.50 BRL", as every charge notice writes them.
 */

export const LATE_FEE_ADDED_TITLE = 'Late fee added';
export const LATE_FEE_WAIVED_TITLE = 'Late fee waived';

/** A late fee for an overdue charge. */
export function lateFeeForChargeNotice(fee: number, currency: string, invoiceLabel: string, description: string) {
  return {
    title: LATE_FEE_ADDED_TITLE,
    body: `A late fee of ${noticeMoney(fee, currency)} was added to your balance because invoice ${invoiceLabel} (${description}) is overdue. Pay it in the app or at the front desk.`,
  };
}

/** A late fee for a card renewal Stripe could not collect. */
export function lateFeeForRenewalNotice(fee: number, currency: string, planTitle: string, renewalAmount: number, renewalCurrency: string) {
  return {
    title: LATE_FEE_ADDED_TITLE,
    body: `A late fee of ${noticeMoney(fee, currency)} was added to your balance because your ${planTitle} membership payment of ${noticeMoney(renewalAmount, renewalCurrency)} is overdue. Pay it in the app or at the front desk.`,
  };
}

/** Staff waived a late fee; anything already paid toward it is credit now. */
export function lateFeeWaivedNotice(fee: number, currency: string, paid: number) {
  return {
    title: LATE_FEE_WAIVED_TITLE,
    body:
      `Your late fee of ${noticeMoney(fee, currency)} was waived. Nothing to pay.` +
      (paid > 0 ? ` The ${noticeMoney(paid, currency)} already paid is now credit on your balance.` : ''),
  };
}

/** The late-fee charge's own description, kept on the Charge. The apps show
 * their own translated "Late fee" label from the charge's lateFee details. */
export const lateFeeDescriptionForCharge = (invoiceLabel: string) => `Late fee: invoice ${invoiceLabel}`;
export const lateFeeDescriptionForRenewal = (planTitle: string) => `Late fee: ${planTitle} membership payment`;
