import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import type { Transaction } from '@prisma/client';
import { offSessionPurchaseNotices, savedCardPaymentConfirmedBody } from './off-session-purchase';

/**
 * Decision 449 item 11: the late "Payment confirmed" for a saved-card purchase
 * (settled by Stripe's webhook or the stale-attempt sweep, after the purchase
 * screen may already have shown success) says it is the same payment and only
 * one charge was made. Its own text, not the cash notice's, with the cash
 * notice's title, keys and audience (the member, or the Guardians of a
 * linked minor), translated in every language by its shape (@ultm8/i18n
 * server/translate.ts). Decision 450 item 8: its own type,
 * CARD_PAYMENT_CONFIRMED (was the cash notice's CASH_PAYMENT), and its own
 * School switch, on by default.
 */
const CASH_MEMBER = 'Your payment of 30.00 USD for Gold was confirmed. Your membership is now active.';
const CASH_GUARDIAN = "Sam Lee's payment of 30.00 USD for Gold was confirmed. The membership is now active.";

const row = { id: 'tx-1', studentId: 'student-1', schoolId: 'school-1', membershipPlanId: 'plan-1', planSwitchFromMembershipId: null, amount: 2910, surchargeAmount: 90, currency: 'USD' } as unknown as Transaction;

function db(guardianIds: string[], school: { chargeNoticeCardConfirmed: boolean } | null = null) {
  return {
    membership: { findUnique: jest.fn() },
    membershipPlan: { findUnique: jest.fn().mockResolvedValue({ title: 'Gold' }) },
    school: { findUnique: jest.fn().mockResolvedValue(school) },
    user: { findUnique: jest.fn().mockResolvedValue({ firstName: 'Sam', surname: 'Lee' }) },
    guardianLink: { findMany: jest.fn().mockResolvedValue(guardianIds.map((guardianId) => ({ guardianId }))) },
  } as never;
}

function lookup(tree: unknown, key: string): string | undefined {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree) as string | undefined;
}

function translatorFor(server: unknown, locale: string) {
  const t = (key: string, vars?: Record<string, string | number>) => {
    const template = lookup({ server }, key) ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
  };
  return createServerTextTranslator(t, locale, undefined);
}

describe('the late "Payment confirmed" for a saved-card purchase (Decision 449 item 11)', () => {
  it('the member: its own text, saying it is the same payment and charged once', async () => {
    const notices = await offSessionPurchaseNotices(db([]), row, 'paid');
    expect(notices).toEqual([
      {
        notificationId: 'cash-payment-confirmed-tx-1-student-1',
        userId: 'student-1',
        title: 'Payment confirmed',
        body: 'Your payment of 30.00 USD for Gold is complete. This is the same payment you made when you bought it, not a new one: you have been charged only once. Your membership is now active.',
        type: 'CARD_PAYMENT_CONFIRMED',
        schoolId: 'school-1',
        targetType: 'PAYMENT',
      },
    ]);
    expect(notices[0].body).not.toBe(CASH_MEMBER);
  });

  it('its own School switch: on by default, and off sends nothing (Decision 450 item 8)', async () => {
    expect(await offSessionPurchaseNotices(db([], { chargeNoticeCardConfirmed: true }), row, 'paid')).toHaveLength(1);
    expect(await offSessionPurchaseNotices(db([]), row, 'paid')).toHaveLength(1);
    expect(await offSessionPurchaseNotices(db([], { chargeNoticeCardConfirmed: false }), row, 'paid')).toEqual([]);
    expect(await offSessionPurchaseNotices(db(['g-1'], { chargeNoticeCardConfirmed: false }), row, 'paid')).toEqual([]);
  });

  it("a linked minor's purchase: each Guardian, never the minor, with the Guardian's text", async () => {
    const notices = await offSessionPurchaseNotices(db(['g-1', 'g-2']), row, 'paid');
    expect(notices.map((n) => [n.userId, n.notificationId])).toEqual([
      ['g-1', 'cash-payment-confirmed-tx-1-g-1'],
      ['g-2', 'cash-payment-confirmed-tx-1-g-2'],
    ]);
    for (const n of notices) {
      expect(n.body).toBe(
        "Sam Lee's payment of 30.00 USD for Gold is complete. This is the same payment made when it was bought, not a new one: only one charge was made. The membership is now active.",
      );
      expect(n.body).not.toBe(CASH_GUARDIAN);
    }
  });

  const MEMBER = { title: 'Payment confirmed', body: savedCardPaymentConfirmedBody('30.00 USD', 'Gold'), type: 'CARD_PAYMENT_CONFIRMED' };
  const GUARDIAN = { title: 'Payment confirmed', body: savedCardPaymentConfirmedBody('30.00 USD', 'Gold', 'Sam Lee'), type: 'CARD_PAYMENT_CONFIRMED' };

  it('reads the same in English, amount formatted', () => {
    const english = translatorFor(serverKeys, 'en-GB');
    expect(english.notification(MEMBER).body).toMatch(/^Your payment of .*30\.00 for Gold is complete\. This is the same payment you made when you bought it, not a new one: you have been charged only once\. Your membership is now active\.$/);
    expect(english.notification(GUARDIAN).body).toMatch(/^Sam Lee's payment of .*30\.00 for Gold is complete\. .*only one charge was made\. The membership is now active\.$/);
  });

  for (const locale of Object.keys(SERVER_KEY_LOADERS)) {
    it(`${locale}: both texts have their own rule, apart from the cash notice's`, async () => {
      const keys = await SERVER_KEY_LOADERS[locale]();
      expect(keys.notifications?.paymentConfirmedOnceBody).toBeTruthy();
      expect(keys.notifications?.childPaymentConfirmedOnceBody).toBeTruthy();
      const tr = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }, locale);
      const cash = tr.notification({ title: 'Payment confirmed', body: CASH_MEMBER, type: 'CASH_PAYMENT' }).body;
      const cashGuardian = tr.notification({ title: 'Payment confirmed', body: CASH_GUARDIAN, type: 'CASH_PAYMENT' }).body;
      const member = tr.notification(MEMBER);
      const guardian = tr.notification(GUARDIAN);
      for (const out of [member, guardian]) {
        expect(out.title).not.toContain('server.notifications');
        expect(out.body).not.toContain('server.notifications');
        expect(out.body).toContain('Gold');
        expect(out.body).not.toContain('30.00 USD');
      }
      expect(guardian.body).toContain('Sam Lee');
      expect(member.body).not.toBe(cash);
      expect(guardian.body).not.toBe(cashGuardian);
      if (!locale.startsWith('en')) expect(member.body).not.toBe(MEMBER.body);
    });
  }
});
