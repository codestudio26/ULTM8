import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { planSwitchEndedNotice, planSwitchNotice, planSwitchedNotice } from './plan-switch.processor';

/**
 * Decision 435 item 9: the plan-switch job's notices are written in English
 * (the same text goes to push, email and the in-app list) and translated in
 * the apps by matching their shape (@ultm8/i18n server/translate.ts). Since
 * 6 Nov 2026 (Decision 436 item 8) the notice 7 days before also says that a
 * full next plan ends the membership with nothing charged. These are the exact
 * shapes the job writes, checked in every language.
 */
const NOTICE = planSwitchNotice('Intro week', '2027-01-15', 'Ten classes', '60.00 GBP');
/** The notice as sent before 6 Nov 2026: still translated. */
const OLD_NOTICE = {
  title: 'Your plan is about to change',
  body: 'Your Intro week ends on 2027-01-15. Then Ten classes starts and 60.00 GBP is charged to your saved card. Without a saved card, it simply ends.',
};
const SWITCHED = planSwitchedNotice('Intro week', 'Ten classes', '60.00 GBP');
const ENDED = planSwitchEndedNotice('Intro week', 'Ten classes');

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

describe('the plan-switch notices are translated (Decision 435 item 9, Decision 436 item 8)', () => {
  it('says, 7 days before, that a full next plan ends it with nothing charged', () => {
    expect(NOTICE.body).toBe(
      'Your Intro week ends on 2027-01-15. Then Ten classes starts and 60.00 GBP is charged to your saved card. Without a saved card, or if Ten classes is full, it simply ends and nothing is charged.',
    );
    const english = translatorFor(serverKeys, 'en-GB');
    const out = english.notification({ ...NOTICE, type: 'MEMBERSHIP_EXPIRY' });
    expect(out.title).toBe('Your plan is about to change');
    expect(out.body).toMatch(/^Your Intro week ends on .*2027\. Then Ten classes starts and .*60\.00 is charged to your saved card\. Without a saved card, or if Ten classes is full, it simply ends and nothing is charged\.$/);
  });

  for (const locale of Object.keys(SERVER_KEY_LOADERS)) {
    it(`${locale}: every shape has a title and a body rule`, async () => {
      const keys = await SERVER_KEY_LOADERS[locale]();
      const tr = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }, locale);
      for (const n of [NOTICE, OLD_NOTICE, SWITCHED, ENDED]) {
        const out = tr.notification({ ...n, type: 'MEMBERSHIP_EXPIRY' });
        expect(out.title).not.toContain('server.notifications');
        expect(out.body).not.toContain('server.notifications');
        expect(out.body).toContain('Intro week');
        expect(out.body).toContain('Ten classes');
        expect(out.body).not.toContain('60.00 GBP');
        expect(out.body).not.toContain('2027-01-15');
        if (locale !== 'en') expect(out.body).not.toBe(n.body);
      }
      // The new sentence names the next plan twice: once as starting, once as full.
      expect(tr.notification({ ...NOTICE, type: 'MEMBERSHIP_EXPIRY' }).body.split('Ten classes')).toHaveLength(3);
    });
  }
});
