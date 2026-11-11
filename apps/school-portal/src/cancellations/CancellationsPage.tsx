import React, { useLayoutEffect, useRef, useState } from 'react';
import { Badge, Button, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { formatMoney } from '../lib/money';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { PAYMENT_METHOD_LABELS } from '../lib/enumLabels';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import './cancellations.css';
import { useOpenCancellations, useResolveCancellation, type OpenCancellation, type ResolveAction } from './cancellationQueries';

type Row = OpenCancellation & { id: string };

/**
 * Decision 291 — Cancellations to resolve: every cancelled booking waiting for
 * a staff decision (the Manual policy, a refund only an Owner/Manager may
 * send, or a Stripe refund that failed), and every cash/bank refund still to
 * be paid back. The Owner/Manager may refund, give the credit back, keep it, or
 * mark a cash refund paid; Branch Staff may only give the credit back or keep
 * it (Spec §8.2) — the API enforces both, this only hides what would 403.
 *
 * New look (Decision 453): the approved design draws no Cancellations screen,
 * so the page keeps its layout, columns and actions and takes the new header,
 * card, table, tags and pill buttons. It is a refund list, so it reuses the
 * Billing pages' pieces (`billing/BillingLook`) rather than a second copy.
 * When the table doesn't fit its card (a phone, a tablet or a narrow window)
 * each row becomes a card: class, student, status, the money lines, then the
 * buttons stacked (Decision 458 item 3). Nothing scrolls sideways.
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

  const header = <NewLookPageHeader title={t('cancellations.title')} subtitle={t('cancellations.subtitle')} />;
  if (isLoading)
    return (
      <BillingPage>
        {header}
        <BillingCard>
          <Spinner />
        </BillingCard>
      </BillingPage>
    );
  if (error)
    return (
      <BillingPage>
        {header}
        <ErrorBanner message={error instanceof ApiError ? error.message : t('cancellations.loadFailed')} />
      </BillingPage>
    );

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
        <Button className="u8b-pill u8b-pill--row u8b-pill--primary" loading={busy} onClick={() => act(row, 'MARK_PAID')}>
          {t('cancellations.markPaid')}
        </Button>
      ) : (
        <span className="ultm8-field__hint">{t('cancellations.ownerPays')}</span>
      );
    }
    return (
      <div className="u8b-row-actions">
        {isOwner ? (
          <Button className="u8b-pill u8b-pill--row u8b-pill--primary" loading={busy} onClick={() => act(row, 'REFUND')}>
            {t('cancellations.refund')}
          </Button>
        ) : null}
        <Button variant="secondary" className="u8b-pill u8b-pill--row" disabled={busy} onClick={() => act(row, 'CREDIT')}>
          {t('cancellations.credit')}
        </Button>
        <Button variant="secondary" className="u8b-pill u8b-pill--row" disabled={busy} onClick={() => act(row, 'KEEP')}>
          {t('cancellations.keep')}
        </Button>
      </div>
    );
  }

  return (
    <BillingPage>
      {header}
      {actionError ? <ErrorBanner message={actionError} /> : null}
      <BillingCard flush testId="cancellations-card">
        {rows.length === 0 ? (
          <EmptyState title={t('cancellations.emptyTitle')} description={t('cancellations.emptyDescription')} />
        ) : (
          // New rows can need a wider table, so a new list measures again.
          <CancellationsList key={rows.map((r) => r.id).join(',')} rows={rows} actions={actions} />
        )}
      </BillingCard>
    </BillingPage>
  );
}

/** The list: a table while it fits its card, a card per row once it doesn't
 * (measured on the card itself, so the side menu and the language are allowed
 * for). Same columns, data and buttons either way; in a row card the column
 * name sits in front of the plan, payment and refund lines. */
function CancellationsList({ rows, actions }: { rows: Row[]; actions: (row: Row) => React.ReactNode }) {
  const t = useT();
  const boxRef = useRef<HTMLDivElement>(null);
  const [cards, setCards] = useState(false);
  // How wide the table needed to be when it last stopped fitting.
  const neededRef = useRef(0);

  useLayoutEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    const check = () => {
      if (!cards) {
        const table = box.querySelector('table');
        if (table && table.scrollWidth > box.clientWidth + 1) {
          neededRef.current = table.scrollWidth;
          setCards(true);
        }
      } else if (box.clientWidth >= neededRef.current) {
        setCards(false);
      }
    };
    check();
    const observer = new ResizeObserver(check);
    observer.observe(box);
    // The table's own width changes too, for example with the language.
    const table = box.querySelector('table');
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, [cards]);

  const label = (text: string) => (
    <span className="u8x-cell-label" aria-hidden="true">
      {text}
    </span>
  );

  return (
    <div ref={boxRef} className="u8x-list" data-layout={cards ? 'cards' : 'table'} data-testid="cancellations-list">
      <table className="ultm8-table">
        <thead>
          <tr>
            <th>{t('cancellations.columnStudent')}</th>
            <th>{t('cancellations.columnClass')}</th>
            <th>{t('cancellations.columnPlan')}</th>
            <th>{t('cancellations.columnMethod')}</th>
            <th>{t('cancellations.columnAmount')}</th>
            <th>{t('cancellations.columnStatus')}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="u8x-student">
                <span className="u8b-name">{`${r.studentName ?? r.studentId.slice(0, 8)}${r.attendeeId ? ` ${t('cancellations.guestSuffix')}` : ''}`}</span>
              </td>
              <td className="u8x-class">
                <div>{r.classTitle ?? '—'}</div>
                <div className="ultm8-field__hint">
                  {r.classStartDate ? new Date(r.classStartDate).toLocaleString(formatLocale()) : ''}
                  {r.classCancelledBySchool ? ` · ${t('cancellations.cancelledBySchool')}` : ''}
                </div>
              </td>
              <td className="u8x-detail">
                {label(t('cancellations.columnPlan'))}
                {r.planTitle ?? '—'}
              </td>
              <td className="u8x-detail">
                {label(t('cancellations.columnMethod'))}
                {r.paymentMethod ? (PAYMENT_METHOD_LABELS[r.paymentMethod] ? t(PAYMENT_METHOD_LABELS[r.paymentMethod]!) : r.paymentMethod) : '—'}
              </td>
              <td className="u8x-detail">
                {label(t('cancellations.columnAmount'))}
                {r.refundAmount ? formatMoney(r.refundAmount, r.currency) : '—'}
              </td>
              <td className="u8x-status">
                {r.resolution === 'REFUND_OWED' ? <Badge variant="danger">{t('cancellations.statusOwed')}</Badge> : <Badge variant="accent">{t('cancellations.statusPending')}</Badge>}
              </td>
              <td className="u8x-actions">{actions(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
