import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { useClosures, useCreateClosure, useDeleteClosure } from './timetableQueries';

/**
 * Decision 353 (Q8, Decision 319 §3) — the owner's closure dates: the School,
 * or one Branch, is closed (e.g. Christmas). Adding one cancels the classes on
 * those dates under the School's normal cancellation rule, and the students
 * booked are told; removing one doesn't bring cancelled classes back. Freezing
 * memberships for the closure waits on Decision 316's freeze.
 */
export function ClosuresDialog({ schoolId, branches, onClose }: { schoolId: string; branches: BranchResponse[]; onClose: () => void }) {
  const t = useT();
  const closures = useClosures(schoolId);
  const createClosure = useCreateClosure(schoolId);
  const deleteClosure = useDeleteClosure(schoolId);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [branchId, setBranchId] = useState('');
  const [reason, setReason] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const day = (date: string) => new Date(`${date}T00:00:00`).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  const span = (from: string, to: string) => (from === to ? day(from) : `${day(from)} – ${day(to)}`);
  const where = (id: string | null) => (id ? branches.find((b) => b.id === id)?.name ?? id : t('timetable.closures.wholeSchool'));
  const ready = !!startDate && !!reason.trim();

  async function add() {
    setError(null);
    setMessage(null);
    try {
      const created = await createClosure.mutateAsync({ startDate, endDate: endDate || startDate, reason: reason.trim(), ...(branchId ? { branchId } : {}) });
      setMessage(t('timetable.closures.added', { count: created.cancelledClasses }));
      setStartDate('');
      setEndDate('');
      setReason('');
      setBranchId('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('timetable.closures.addFailed'));
    } finally {
      setConfirming(false);
    }
  }

  return (
    <Modal title={t('timetable.closures.title')} onClose={onClose} wide>
      <p style={{ marginTop: 0, color: 'var(--text-secondary)' }}>{t('timetable.closures.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {message ? <p role="status">{message}</p> : null}

      {closures.isLoading ? (
        <Spinner />
      ) : (closures.data?.items.length ?? 0) === 0 ? (
        <p>{t('timetable.closures.none')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {closures.data!.items.map((c) => (
            <li key={c.id} aria-label={c.reason} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span>
                <strong>{c.reason}</strong> · {span(c.startDate, c.endDate)} · {where(c.branchId)}
              </span>
              <Button
                variant="secondary"
                disabled={deleteClosure.isPending}
                onClick={() => {
                  setError(null);
                  setMessage(null);
                  deleteClosure.mutate(c.id, { onError: (err) => setError(err instanceof ApiError ? err.message : t('timetable.closures.removeFailed')) });
                }}
              >
                {t('timetable.closures.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}

      <h3 style={{ fontSize: 15 }}>{t('timetable.closures.addTitle')}</h3>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <Field label={t('timetable.closures.from')} htmlFor="closure-from">
          <TextField id="closure-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label={t('timetable.closures.to')} htmlFor="closure-to" hint={t('timetable.closures.toHint')}>
          <TextField id="closure-to" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <Field label={t('timetable.closures.where')} htmlFor="closure-branch">
          <SelectField
            id="closure-branch"
            value={branchId}
            onChange={(e) => setBranchId(e.target.value)}
            options={[{ value: '', label: t('timetable.closures.wholeSchool') }, ...branches.filter((b) => !b.archivedAt).map((b) => ({ value: b.id, label: b.name }))]}
          />
        </Field>
      </div>
      <Field label={t('timetable.closures.reason')} htmlFor="closure-reason" hint={t('timetable.closures.reasonHint')}>
        <TextField id="closure-reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
      </Field>

      {confirming ? (
        <div role="alert" style={{ marginTop: 12 }}>
          <p>{t('timetable.closures.confirm', { dates: span(startDate, endDate || startDate), where: where(branchId || null) })}</p>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('timetable.closures.back')}
            </Button>
            <Button onClick={() => void add()} disabled={createClosure.isPending}>
              {t('timetable.closures.confirmButton')}
            </Button>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
          <Button variant="secondary" onClick={onClose}>
            {t('timetable.closures.close')}
          </Button>
          <Button disabled={!ready} onClick={() => setConfirming(true)}>
            {t('timetable.closures.add')}
          </Button>
        </div>
      )}
    </Modal>
  );
}
