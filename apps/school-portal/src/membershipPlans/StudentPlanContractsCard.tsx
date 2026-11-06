import React, { useState } from 'react';
import { Button, Card, ErrorBanner } from '@ultm8/ui';
import { formatMoney } from '../lib/money';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { useStudentPlanContracts, type PlanContractSignature } from './membershipPlanQueries';

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** Decision 316 item 6: the plan contracts a Student (or their Guardian)
 * signed, each with the exact text signed. Owner only, like the API. */
export function StudentPlanContractsCard({ schoolId, studentId }: { schoolId: string; studentId: string }) {
  const t = useT();
  const contracts = useStudentPlanContracts(schoolId, studentId);
  const rows = contracts.data?.data ?? [];
  if (contracts.isLoading) return null;
  if (!contracts.isError && rows.length === 0) return null;
  return (
    <Card>
      <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 8 }}>
        {t('membershipPlans.contract.studentCardTitle')}
      </h2>
      {contracts.isError ? <ErrorBanner message={t('membershipPlans.contract.loadFailed')} /> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
        {rows.map((c) => (
          <SignedContractRow key={c.id} contract={c} studentId={studentId} />
        ))}
      </ul>
    </Card>
  );
}

function SignedContractRow({ contract: c, studentId }: { contract: PlanContractSignature; studentId: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  return (
    <li style={{ padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <strong>{c.planTitle}</strong>
      <div className="ultm8-field__hint">
        {t('membershipPlans.contract.signedOn', { date: formatDay(c.signedAt), name: c.signerFullName })}
        {c.signedById !== studentId ? ` · ${t('membershipPlans.contract.signedByGuardian')}` : ''}
        {!c.used ? ` · ${t('membershipPlans.contract.notUsed')}` : ''}
      </div>
      {c.minimumTermMonths != null ? (
        <div className="ultm8-field__hint">
          {t('membershipPlans.contract.termsLine', {
            months: c.minimumTermMonths,
            amount: formatMoney(c.earlyExitFee ?? 0, c.currency),
          })}
          {c.endsAfterMinimumTerm ? ` · ${t('membershipPlans.contract.endsAfterTermLine')}` : ''}
        </div>
      ) : null}
      <Button variant="secondary" onClick={() => setOpen((o) => !o)}>
        {open ? t('membershipPlans.contract.hideText') : t('membershipPlans.contract.viewText')}
      </Button>
      {open ? (
        <div style={{ marginTop: 8 }}>
          <p style={{ whiteSpace: 'pre-wrap' }}>{c.contractBody}</p>
          <p className="ultm8-field__hint">{t('membershipPlans.contract.typedSignature', { signature: c.signatureText })}</p>
          {c.signatureImageUrl ? (
            <img src={c.signatureImageUrl} alt={t('membershipPlans.contract.signatureAlt')} style={{ maxWidth: 320, border: '1px solid var(--border)' }} />
          ) : null}
          <p className="ultm8-field__hint" style={{ wordBreak: 'break-all' }}>
            {t('membershipPlans.contract.hash', { hash: c.contractSha256 })}
          </p>
        </div>
      ) : null}
    </li>
  );
}
