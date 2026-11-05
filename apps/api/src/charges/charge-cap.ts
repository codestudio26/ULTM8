import { BadRequestException } from '@nestjs/common';
import { MAX_CHARGE_MINOR } from './charge-maths';

/**
 * The cap on one charge, payment, refund, credit or late fee (MAX_CHARGE_MINOR,
 * 999,999.99 in hundredths: ¥999,999 in yen). Decision 430 (MON-11): the cap
 * stays, but going over it answers a code and a message the apps translate,
 * instead of the request validator's raw "amount must not be greater than
 * 99999999". Checked in the service, before anything is written.
 */
export function assertWithinChargeCap(amount: number | null | undefined): void {
  if (amount === null || amount === undefined) return;
  if (amount > MAX_CHARGE_MINOR) {
    throw new BadRequestException({ code: 'CHARGE_AMOUNT_TOO_BIG', message: 'This amount is more than a charge can be.' });
  }
}
