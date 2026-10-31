import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { membershipExpiryNotice } from './membership-expiry-reminder.processor';
import { absenceAlertNotice } from './student-absence-alert.processor';

/**
 * Decision 317 item 7: the expiry reminder and the absence alert are written
 * in English and translated in the apps by matching their shape (@ultm8/i18n
 * server/translate.ts). A reworded notice that no longer matches would show
 * in English.
 */
function lookup(tree: unknown, key: string): string | undefined {
  return key.split('.').reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as Record<string, unknown>)[part] : undefined), tree) as string | undefined;
}

function translatorFor(server: unknown) {
  const t = (key: string, vars?: Record<string, string | number>) => {
    const template = lookup({ server }, key) ?? key;
    return template.replace(/\{(\w+)\}/g, (_m, name: string) => String(vars?.[name] ?? `{${name}}`));
  };
  return createServerTextTranslator(t, 'pt-BR', undefined);
}

describe('reminder notices are translated (Decision 317 item 7)', () => {
  const expiry = membershipExpiryNotice('Monthly Unlimited', '2026-11-15');
  const absent = absenceAlertNotice('Ana Souza', '2026-10-01');
  const never = absenceAlertNotice('Ana Souza', null);

  it('writes the English shapes', () => {
    expect(expiry).toEqual({ title: 'Membership ending soon', body: 'Your Monthly Unlimited membership ends on 2026-11-15.' });
    expect(absent).toEqual({ title: 'Member absent', body: "Ana Souza hasn't checked in since 2026-10-01." });
    expect(never).toEqual({ title: 'Member absent', body: "Ana Souza hasn't checked in yet." });
  });

  it('every shape has a title and a body rule', async () => {
    const ptKeys = await SERVER_KEY_LOADERS['pt-BR']();
    const pt = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...ptKeys.notifications } });
    const out = [expiry, absent, never].map((n) => pt.notification({ ...n, type: 'X' }));
    expect(out[0].title).toBe('Plano termina em breve');
    expect(out[0].body).toMatch(/^Seu plano Monthly Unlimited termina em .*2026.*\.$/);
    expect(out[1].title).toBe('Membro ausente');
    expect(out[1].body).toMatch(/^Ana Souza não faz check-in desde .*2026.*\.$/);
    expect(out[2].body).toBe('Ana Souza ainda não fez check-in.');
    // A Guardian's copy (notification-fanout's "For {name}: ").
    const copy = pt.notification({ title: expiry.title, body: `For Kid: ${expiry.body}`, type: 'X' });
    expect(copy.body).toMatch(/^Para Kid: Seu plano Monthly Unlimited termina em /);
  });
});
