import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, TextArea } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { formatMoney } from '../lib/money';
import { useCancelTransaction } from './transactionQueries';

/**
 * "Cancel payment" for a membership's Pending cash or bank-transfer payment,
 * from the Transactions page or the student's Payments card. It follows the
 * charge rule (Decision 338 item 1): a reason is always asked for, and is
 * required unless the School made it optional; it is for staff only. The
 * payment stays on record as Cancelled and no membership is created.
 */
export function CancelPaymentModal({
  schoolId,
  payment,
  studentName,
  reasonRequired,
  onClose,
}: {
  schoolId: string;
  payment: { id: string; amount: number; currency: string | null; planTitle: string };
  studentName: string;
  reasonRequired: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const cancel = useCancelTransaction(schoolId);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function confirm(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (reasonRequired && reason.trim().length === 0) {
      setError(t('transactions.cancelReasonRequired'));
      return;
    }
    try {
      await cancel.mutateAsync({ id: payment.id, reason: reason.trim() });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('transactions.settleFailed'));
    }
  }

  return (
    <Modal title={t('transactions.cancelTitle')} onClose={onClose}>
      <form onSubmit={confirm} data-testid="cancel-payment-form">
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ margin: '0 0 16px' }}>
          {t('transactions.cancelBody', { student: studentName, plan: payment.planTitle, amount: formatMoney(payment.amount, payment.currency) })}
        </p>
        <Field label={reasonRequired ? t('charges.cancelDialog.reasonLabel') : t('charges.cancelDialog.reasonOptional')} htmlFor="payment-cancel-reason">
          <TextArea id="payment-cancel-reason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('transactions.back')}
          </Button>
          <Button type="submit" variant="danger" loading={cancel.isPending}>
            {t('transactions.cancelPayment')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
