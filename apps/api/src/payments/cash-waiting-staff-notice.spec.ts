import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';

/**
 * Decision 442 item 4: the Branch Staff's copy of the "Cash payment waiting"
 * notice (PaymentsService.notifyCashPayment) points them to the student's
 * Payments card instead of the Transactions page. It is written in English
 * and translated in the apps by matching its shape (@ultm8/i18n
 * server/translate.ts). These are the exact shapes it writes, checked in
 * every language.
 */
const OWNER = { title: 'Cash payment waiting', body: 'Sam Lee chose to pay 150.00 BRL for Mensal by cash or bank transfer. Mark it as paid on the Transactions page once the money arrives.' };
const STAFF = { title: 'Cash payment waiting', body: 'Sam Lee chose to pay 150.00 BRL for Mensal by cash or bank transfer. Mark it as paid on their Payments card once the money arrives.' };

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

describe("the staff's cash-waiting notice is translated (Decision 442 item 4)", () => {
  it('reads the same in English, and differs from the owner\'s', () => {
    const english = translatorFor(serverKeys, 'en-GB');
    const staff = english.notification({ ...STAFF, type: 'CASH_PAYMENT' });
    expect(staff.title).toBe('Cash payment waiting');
    expect(staff.body).toMatch(/^Sam Lee chose to pay .*150\.00 for Mensal by cash or bank transfer\. Mark it as paid on their Payments card once the money arrives\.$/);
    expect(english.notification({ ...OWNER, type: 'CASH_PAYMENT' }).body).toContain('Transactions page');
  });

  for (const locale of Object.keys(SERVER_KEY_LOADERS)) {
    it(`${locale}: the staff's copy has its own rule`, async () => {
      const keys = await SERVER_KEY_LOADERS[locale]();
      const tr = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }, locale);
      const out = tr.notification({ ...STAFF, type: 'CASH_PAYMENT' });
      expect(out.title).not.toContain('server.notifications');
      expect(out.body).not.toContain('server.notifications');
      expect(out.body).toContain('Sam Lee');
      expect(out.body).toContain('Mensal');
      expect(out.body).not.toContain('150.00 BRL');
      if (!locale.startsWith('en')) expect(out.body).not.toBe(tr.notification({ ...OWNER, type: 'CASH_PAYMENT' }).body);
    });
  }
});
