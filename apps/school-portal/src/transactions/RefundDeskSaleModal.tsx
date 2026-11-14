import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, ModalActions, TextArea } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatMoney } from '../lib/money';
import { MoneyField } from '../lib/MoneyField';
import { useRefundDeskSale } from './transactionQueries';

/**
 * Decision 431 (MON-8): "Refund" for a membership paid at the desk (cash,
 * bank transfer, Pix or the School's card terminal). The owner records money
 * given back by hand, part or all of what is left, with a note (staff only),
 * and chooses whether the membership ends now. Nothing is sent to a card.
 */
export function RefundDeskSaleModal({
  schoolId,
  payment,
  studentName,
  onClose,
}: {
  schoolId: string;
  payment: { id: string; amount: number; refundedAmount: number | null; currency: string | null; planTitle: string; keptJoiningFee?: number };
  studentName: string;
  onClose: () => void;
}) {
  const t = useT();
  const refund = useRefundDeskSale(schoolId);
  // Decision 435 item 5: a non-refundable joining fee is never refunded.
  const kept = payment.keptJoiningFee ?? 0;
  const left = Math.max(0, payment.amount - kept - (payment.refundedAmount ?? 0));
  const [amount, setAmount] = useState<number | null>(left);
  const [amountValid, setAmountValid] = useState(true);
  const [notes, setNotes] = useState('');
  const [endMembership, setEndMembership] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!amountValid || amount == null || amount < 1 || amount > left) {
      setError(t('transactions.refund.amountInvalid', { amount: formatMoney(left, payment.currency) }));
      return;
    }
    if (notes.trim().length === 0) {
      setError(t('transactions.refund.notesRequired'));
      return;
    }
    try {
      await refund.mutateAsync({ id: payment.id, amount, notes: notes.trim(), endMembership });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('transactions.refund.failed'));
    }
  }

  return (
    <Modal title={t('transactions.refund.title')} onClose={onClose}>
      <form onSubmit={confirm} data-testid="refund-desk-sale-form">
        {error ? <ErrorBanner message={error} /> : null}
        <p>
          {t('transactions.refund.body', { student: studentName, plan: payment.planTitle, amount: formatMoney(left, payment.currency) })}
        </p>
        {kept > 0 ? (
          <p data-testid="refund-joining-fee-kept">
            {t('transactions.refund.joiningFeeKept', { fee: formatMoney(kept, payment.currency) })}
          </p>
        ) : null}
        <Field label={t('transactions.refund.amountLabel')} htmlFor="desk-refund-amount">
          <MoneyField
            id="desk-refund-amount"
            value={amount}
            currency={payment.currency}
            onChange={(value, valid) => {
              setAmount(value);
              setAmountValid(valid);
            }}
          />
        </Field>
        <Field label={t('transactions.refund.notesLabel')} htmlFor="desk-refund-notes" hint={t('transactions.refund.notesHint')}>
          <TextArea id="desk-refund-notes" maxLength={500} value={notes} onChange={(e) => setNotes(e.target.value)} />
        </Field>
        <Checkbox label={t('transactions.refund.endMembership')} checked={endMembership} onChange={(e) => setEndMembership(e.target.checked)} />
        <p className="ultm8-field__hint" style={{ margin: '4px 0 0' }}>
          {t('transactions.refund.endMembershipHint')}
        </p>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant="danger" loading={refund.isPending}>
            {t('transactions.refund.confirm')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
