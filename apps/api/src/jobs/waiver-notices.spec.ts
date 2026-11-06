import { SERVER_KEY_LOADERS, createEnglishServerTextTranslator, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { waiverNotice } from './waiver-signature-requests.processor';

/**
 * The "please sign this waiver" notice is written in English and translated in
 * the apps by matching its shape (@ultm8/i18n server/translate.ts). Today it
 * names the School that asks. Before #317 (Decision 333) the API put the
 * waiver's title where the sender belongs ("Kids waiver has invited you to sign
 * the following waiver."). Those rows are still stored: they must still be
 * translated, and no reader should see the waiver named as the one inviting.
 */
const NOTICE = { ...waiverNotice('assigned', 'Dojo Lima', 'Kids waiver'), type: 'WAIVER_SIGNATURE_REQUEST' };
const OLD_NOTICE = { title: 'Waiver signature requested', body: 'Kids waiver has invited you to sign the following waiver.', type: 'WAIVER_SIGNATURE_REQUEST' };

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

describe('the waiver signature request notice', () => {
  it('names the School as the one asking, and the waiver as what to sign', () => {
    expect(NOTICE).toMatchObject({ title: 'Waiver signature requested', body: 'Dojo Lima has invited you to sign the waiver "Kids waiver".' });
  });

  it('English: an old row no longer reads as if the waiver had invited the member', () => {
    const english = createEnglishServerTextTranslator('en-GB');
    expect(english.notification(OLD_NOTICE).body).toBe('You\'ve been invited to sign the waiver "Kids waiver".');
    // A parent's copy keeps its prefix.
    expect(english.notification({ ...OLD_NOTICE, body: `For Ana: ${OLD_NOTICE.body}` }).body).toBe('For Ana: You\'ve been invited to sign the waiver "Kids waiver".');
    // Today's notice is shown as the API wrote it.
    expect(english.notification(NOTICE).body).toBe(NOTICE.body);
    expect(translatorFor(serverKeys, 'en').notification(OLD_NOTICE).body).toBe('You\'ve been invited to sign the waiver "Kids waiver".');
  });

  for (const locale of Object.keys(SERVER_KEY_LOADERS)) {
    it(`${locale}: translates today's notice and the old shape`, async () => {
      const keys = await SERVER_KEY_LOADERS[locale]();
      const tr = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...keys.notifications } }, locale);
      const now = tr.notification(NOTICE);
      if (locale !== 'en') {
        expect(now.title).not.toBe(NOTICE.title);
        expect(now.body).not.toBe(NOTICE.body);
      }
      expect(now.body).toContain('Dojo Lima');
      expect(now.body).toContain('Kids waiver');

      const old = tr.notification(OLD_NOTICE);
      expect(old.title).toBe(now.title);
      expect(old.body).not.toContain('server.notifications');
      expect(old.body).not.toContain('invited you');
      expect(old.body).toContain('Kids waiver');
      // The old row never named the School, so neither does its translation.
      expect(old.body).not.toContain('Dojo Lima');
    });
  }
});
