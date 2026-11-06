import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { deletionRequestedNotice, memberLeftNotice } from './account-deletion-notices';

/**
 * "Delete my account" rule 6: the member's and the School's notices are
 * written in English and translated in the apps by their shape
 * (@ultm8/i18n server/translate.ts). These are the exact shapes the API writes.
 */
const DUE = new Date('2026-12-06T14:30:00.000Z');
const NOTICES = [
  { notice: { ...deletionRequestedNotice(DUE, []), type: 'ACCOUNT_DELETION' }, keep: [] as string[] },
  { notice: { ...deletionRequestedNotice(DUE, ['Ana Silva', 'Leo Silva']), type: 'ACCOUNT_DELETION' }, keep: ['Ana Silva, Leo Silva'] },
  { notice: { ...memberLeftNotice, type: 'MEMBER_LEFT' }, keep: ['Erased User'] },
];

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

describe('"Delete my account" notices', () => {
  it('writes the date in machine form, and names the children deleted with the account', () => {
    expect(deletionRequestedNotice(DUE, []).body).toBe(
      'Your ULTM8 account will be deleted on 2026-12-06 14:30 UTC. Until then it is locked. To keep it, sign in again before then.',
    );
    expect(deletionRequestedNotice(DUE, ['Ana Silva']).body).toContain("These children's accounts will be deleted with it: Ana Silva.");
    // The School's notice never names the member: their details are gone.
    expect(memberLeftNotice.body).not.toMatch(/Ana|Silva/);
  });

  it('every language translates each title and body', async () => {
    for (const [locale, load] of Object.entries(SERVER_KEY_LOADERS)) {
      const keys = await load();
      const translator = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }, locale);
      for (const { notice, keep } of NOTICES) {
        const out = translator.notification(notice);
        expect([locale, out.title]).not.toEqual([locale, notice.title]);
        expect([locale, out.body]).not.toEqual([locale, notice.body]);
        for (const text of keep) expect([locale, out.body.includes(text)]).toEqual([locale, true]);
        expect(out.body).not.toContain('{');
      }
    }
  });
});
