import { SERVER_KEY_LOADERS, createServerTextTranslator, serverKeys } from '@ultm8/i18n';
import { refundNotice } from './charge-ledger';

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
  // Step 4: the overdue notice and the member's dispute notices.
  { title: 'Payment overdue', body: 'Invoice #0000012 for Rash guard was due on 2026-11-15. 70.00 BRL is still to pay.' },
  { title: 'Payment due soon', body: 'Invoice #0000012 for Rash guard: 70.00 BRL is due on 2026-11-15.' },
  { title: 'Payment dispute', body: 'Your card payment of 60.00 BRL is being disputed with your bank.' },
  { title: 'Payment dispute', body: 'The dispute on your card payment of 60.00 BRL was decided in your favour. The money goes back to your card.' },
  { title: 'Payment dispute', body: "The dispute on your card payment of 60.00 BRL was decided in the School's favour. The payment stands." },
  // Decision 414 item 4: the refund notice (refundNotice), one body per kind.
  ...(['CARD', 'MONEY_BACK', 'CREDIT', 'STRIPE'] as const).map((kind) => {
    const { title, body } = refundNotice('r1', kind, 2500, 'brl')!;
    return { title, body };
  }),
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
    const [created, paid, cancelled, credit, autoFailed, overdue, dueSoon, opened, lost, won, refundCard, refundBack, refundCredit, refundStripe] = NOTICES.map((n) => pt.notification({ ...n, type: 'CHARGE' }));
    expect(overdue.title).toBe('Pagamento em atraso');
    expect(overdue.body).toMatch(/^A fatura #0000012 de Rash guard venceu em .+\. Ainda falta pagar .*70,00\.$/);
    expect(dueSoon.title).toBe('Pagamento vence em breve');
    expect(dueSoon.body).toMatch(/^A fatura #0000012 de Rash guard: .*70,00 vence em .+\.$/);
    expect(opened).toMatchObject({ title: 'Contestação de pagamento' });
    expect(opened.body).toMatch(/^Seu pagamento com cartão de .*60,00 está sendo contestado/);
    expect(lost.body).toMatch(/a seu favor\. O dinheiro volta para o seu cartão\.$/);
    expect(won.body).toMatch(/a favor da Escola\. O pagamento continua válido\.$/);
    // The owner's own dispute notice on a payment toward charges.
    const ownerNotice = pt.notification({ title: 'Payment dispute lost', body: 'A disputed charge payment of 60.00 BRL was lost — the charge is no longer considered paid.', type: 'PAYMENT_DISPUTE' });
    expect(ownerNotice.body).toContain('pagamento de cobrança');
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
    expect(refundCard.title).toBe('Reembolso');
    expect(refundCard.body).toMatch(/^.*25,00 foi reembolsado no seu cartão\.$/);
    expect(refundStripe.body).toBe(refundCard.body);
    expect(refundBack.body).toMatch(/^.*25,00 foi devolvido a você\.$/);
    expect(refundCredit.body).toMatch(/^.*25,00 foi adicionado ao seu saldo como crédito\.$/);
    const refundForChild = pt.notification({ title: 'Refund', body: 'For Kai: 25.00 BRL was refunded to your card.', type: 'CHARGE' });
    expect(refundForChild.body).toContain('Kai');
    expect(refundForChild.body).toMatch(/25,00 foi reembolsado no seu cartão\.$/);
    // A Guardian's copy.
    const forChild = pt.notification({ title: 'Payment received', body: 'For Kai: Your payment of 20.00 BRL was received.', type: 'CHARGE' });
    expect(forChild.body).toContain('Kai');
    expect(forChild.body).toContain('20,00');
  });
});

describe('the refund notice (Decision 414 item 4)', () => {
  it('names the amount and where it went; a lost dispute has none of its own', () => {
    expect(refundNotice('r1', 'CARD', 2500, 'brl')).toEqual({ key: 'charge-refund-r1', title: 'Refund', body: '25.00 BRL was refunded to your card.' });
    expect(refundNotice('r1', 'STRIPE', 2500, 'brl')?.body).toBe('25.00 BRL was refunded to your card.');
    expect(refundNotice('r1', 'MONEY_BACK', 2500, 'brl')?.body).toBe('25.00 BRL was given back to you.');
    expect(refundNotice('r1', 'CREDIT', 2500, 'brl')?.body).toBe('25.00 BRL was added to your balance as credit.');
    // The member already has the dispute notice ("The money goes back to your card").
    expect(refundNotice('r1', 'DISPUTE_LOST', 2500, 'brl')).toBeNull();
  });
});
