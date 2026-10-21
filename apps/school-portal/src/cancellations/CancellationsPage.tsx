import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { formatMoney } from '../lib/money';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import { useOpenCancellations, useResolveCancellation, type OpenCancellation, type ResolveAction } from './cancellationQueries';

type Row = OpenCancellation & { id: string };

/**
 * Decision 279 — Cancellations to resolve: every cancelled booking waiting for
 * a staff decision (the Manual policy, a refund only an Owner/Manager may
 * send, or a Stripe refund that failed), and every cash/bank refund still to
 * be paid back. The Owner/Manager may refund, give the credit back, keep it, or
 * mark a cash refund paid; Branch Staff may only give the credit back or keep
 * it (Spec §8.2) — the API enforces both, this only hides what would 403.
 */
export function CancellationsPage() {
  const t = useT();
  const ownedSchoolId = useOwnedSchoolId();
  const coachSchoolId = useCoachSchoolId();
  const schoolId = ownedSchoolId ?? coachSchoolId;
  const isOwner = !!ownedSchoolId;
  const { data, isLoading, error } = useOpenCancellations(schoolId);
  const resolve = useResolveCancellation(schoolId);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('cancellations.loadFailed')} />;

  const rows: Row[] = (data ?? []).map((r) => ({ ...r, id: r.attendeeId ?? r.bookingId }));

  async function act(row: Row, action: ResolveAction) {
    setActionError(null);
    setBusyId(row.id);
    try {
      await resolve.mutateAsync({ bookingId: row.bookingId, attendeeId: row.attendeeId ?? null, action });
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setBusyId(null);
    }
  }

  function actions(row: Row) {
    const busy = busyId === row.id;
    if (row.resolution === 'REFUND_OWED') {
      return isOwner ? (
        <Button loading={busy} onClick={() => act(row, 'MARK_PAID')}>
          {t('cancellations.markPaid')}
        </Button>
      ) : (
        <span style={{ color: 'var(--text-muted)' }}>{t('cancellations.ownerPays')}</span>
      );
    }
    return (
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {isOwner ? (
          <Button loading={busy} onClick={() => act(row, 'REFUND')}>
            {t('cancellations.refund')}
          </Button>
        ) : null}
        <Button variant="secondary" disabled={busy} onClick={() => act(row, 'CREDIT')}>
          {t('cancellations.credit')}
        </Button>
        <Button variant="secondary" disabled={busy} onClick={() => act(row, 'KEEP')}>
          {t('cancellations.keep')}
        </Button>
      </div>
    );
  }

  return (
    <>
      <PageHeader title={t('cancellations.title')} subtitle={t('cancellations.subtitle')} />
      {actionError ? <ErrorBanner message={actionError} /> : null}
      <Card>
        {rows.length === 0 ? (
          <EmptyState title={t('cancellations.emptyTitle')} description={t('cancellations.emptyDescription')} />
        ) : (
          <Table<Row>
            rows={rows}
            columns={[
              { key: 'student', header: t('cancellations.columnStudent'), render: (r) => `${r.studentName ?? r.studentId.slice(0, 8)}${r.attendeeId ? ` ${t('cancellations.guestSuffix')}` : ''}` },
              {
                key: 'class',
                header: t('cancellations.columnClass'),
                render: (r) => (
                  <div>
                    <div>{r.classTitle ?? '—'}</div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                      {r.classStartDate ? new Date(r.classStartDate).toLocaleString(formatLocale()) : ''}
                      {r.classCancelledBySchool ? ` · ${t('cancellations.cancelledBySchool')}` : ''}
                    </div>
                  </div>
                ),
              },
              { key: 'plan', header: t('cancellations.columnPlan'), render: (r) => r.planTitle ?? '—' },
              {
                key: 'method',
                header: t('cancellations.columnMethod'),
                render: (r) => (r.paymentMethod ? (PAYMENT_METHOD_LABELS[r.paymentMethod] ? t(PAYMENT_METHOD_LABELS[r.paymentMethod]!) : r.paymentMethod) : '—'),
              },
              { key: 'amount', header: t('cancellations.columnAmount'), render: (r) => (r.refundAmount ? formatMoney(r.refundAmount, r.currency) : '—') },
              {
                key: 'status',
                header: t('cancellations.columnStatus'),
                render: (r) => (r.resolution === 'REFUND_OWED' ? <Badge variant="danger">{t('cancellations.statusOwed')}</Badge> : <Badge variant="accent">{t('cancellations.statusPending')}</Badge>),
              },
              { key: 'actions', header: '', render: actions },
            ]}
          />
        )}
      </Card>
    </>
  );
}
