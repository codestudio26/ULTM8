import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';

/**
 * Decision 431 (MON-9): the notice a MIGRATE price increase sends
 * (PaymentsService.notifyPriceIncrease) is written in English and translated in
 * the apps by matching its shape (@ultm8/i18n server/translate.ts). These are
 * the exact shapes it writes, checked in every language.
 */
const WITH_DAY = { title: 'Membership price going up', body: 'The price of your Monthly membership is going up to 120.00 CAD. The new price applies from 2027-01-15.' };
const NEXT_PAYMENT = { title: 'Membership price going up', body: 'The price of your Monthly membership is going up to 120.00 CAD, from your next payment.' };

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

describe('the price increase notice is translated (Decision 431, MON-9)', () => {
  it('reads the same in English', () => {
    const english = translatorFor(serverKeys, 'en-GB');
    expect(english.notification({ ...WITH_DAY, type: 'MEMBERSHIP_PRICE_CHANGE' }).title).toBe('Membership price going up');
    expect(english.notification({ ...WITH_DAY, type: 'MEMBERSHIP_PRICE_CHANGE' }).body).toMatch(/^The price of your Monthly membership is going up to .*120\.00\. The new price applies from .*2027\.$/);
  });

  for (const locale of Object.keys(SERVER_KEY_LOADERS)) {
    it(`${locale}: both shapes have a title and a body rule`, async () => {
      const keys = await SERVER_KEY_LOADERS[locale]();
      const tr = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }, locale);
      for (const n of [WITH_DAY, NEXT_PAYMENT]) {
        const out = tr.notification({ ...n, type: 'MEMBERSHIP_PRICE_CHANGE' });
        expect(out.title).not.toContain('server.notifications');
        expect(out.body).not.toContain('server.notifications');
        expect(out.body).toContain('Monthly');
        expect(out.body).not.toContain('120.00 CAD');
        expect(out.body).not.toContain('2027-01-15');
      }
    });
  }
});
