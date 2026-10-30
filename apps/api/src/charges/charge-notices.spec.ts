import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';

/**
 * The charge notices (ChargesService.notify) are written in English and
 * translated in the apps by matching their shape (@ultm8/i18n
 * server/translate.ts). These are the exact shapes the service writes; a
 * reworded notice that no longer matches would show in English.
 */
const NOTICES = [
  { title: 'New invoice', body: 'Invoice #0000012 for Rash guard: 120.00 BRL, due 2026-11-15.' },
  { title: 'Payment received', body: 'Your payment of 20.00 BRL was received.' },
  { title: 'Charge cancelled', body: "Your charge 'Rash guard, 120.00 BRL' was cancelled. Nothing to pay." },
  { title: 'Charge cancelled', body: "Your charge 'Rash guard, 120.00 BRL' was cancelled. Nothing to pay. The 30.00 BRL already paid is now credit on your balance." },
  // Step 2: the daily charge-auto-pay job's notice when the saved card is declined.
  { title: 'Automatic payment failed', body: "We couldn't charge your saved card for invoice #0000012 (Rash guard, 120.00 BRL). Pay it in the app or at the front desk." },
];

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

describe('charge notices are translated (Decisions 303, 338)', () => {
  it('every notice shape has a title and a body rule', async () => {
    const english = translatorFor(serverKeys);
    for (const n of NOTICES) {
      const out = english.notification({ ...n, type: 'CHARGE' });
      expect(out.title).toBe(n.title);
      // English keys give the same English back, with the amount formatted.
      expect(out.body).not.toContain('server.notifications');
    }

    const ptKeys = await SERVER_KEY_LOADERS['pt-BR']();
    const pt = translatorFor({ ...serverKeys, notifications: { ...serverKeys.notifications, ...ptKeys.notifications } });
    const [created, paid, cancelled, credit, autoFailed] = NOTICES.map((n) => pt.notification({ ...n, type: 'CHARGE' }));
    expect(autoFailed.title).toBe('Pagamento automático falhou');
    expect(autoFailed.body).toMatch(/^Não conseguimos cobrar no seu cartão salvo a fatura #0000012 \(Rash guard, .*120,00\)\. Pague no app ou na recepção\.$/);
    expect(created.title).toBe('Nova fatura');
    expect(created.body).toContain('#0000012');
    expect(created.body).toContain('Rash guard');
    expect(created.body).toMatch(/^Fatura /);
    expect(paid).toMatchObject({ title: 'Pagamento recebido' });
    expect(paid.body).toMatch(/^Seu pagamento de .*20,00.* foi recebido\.$/);
    expect(cancelled.body).toMatch(/^Sua cobrança 'Rash guard, .*120,00.*' foi cancelada\. Nada a pagar\.$/);
    expect(credit.body).toContain('30,00');
    // A Guardian's copy.
    const forChild = pt.notification({ title: 'Payment received', body: 'For Kai: Your payment of 20.00 BRL was received.', type: 'CHARGE' });
    expect(forChild.body).toContain('Kai');
    expect(forChild.body).toContain('20,00');
  });
});
