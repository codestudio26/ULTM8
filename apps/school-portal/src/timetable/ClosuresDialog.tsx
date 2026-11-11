import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, ModalActions, Spinner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { BranchResponse } from '../branches/branchQueries';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { NewLookSelect } from '../layout/NewLookSelect';
import '../classes/classForms.css';
import { useClosures, useCreateClosure, useDeleteClosure, useRecreateClass, useUpdateClosure, type RecreatableClass } from './timetableQueries';

/**
 * Decision 353 (Q8, Decision 319 §3) — the owner's closure dates: the School,
 * or one Branch, is closed (e.g. Christmas). Adding one cancels the classes on
 * those dates under the School's normal cancellation rule, and the students
 * booked are told; removing one doesn't bring cancelled classes back. Freezing
 * memberships for the closure waits on Decision 316's freeze.
 *
 * Decision 432 item 11: the owner can change a closure's dates and reason (an
 * Eid closure after the moon sighting). Newly covered days are cancelled as on
 * adding one; classes it cancelled on released days are offered for a one-tap
 * Recreate. Removing one first warns that cancelled classes stay cancelled.
 */
export function ClosuresDialog({ schoolId, branches, onClose }: { schoolId: string; branches: BranchResponse[]; onClose: () => void }) {
  const t = useT();
  const closures = useClosures(schoolId);
  const createClosure = useCreateClosure(schoolId);
  const deleteClosure = useDeleteClosure(schoolId);
  const updateClosure = useUpdateClosure(schoolId);
  const recreateClass = useRecreateClass(schoolId);
  const [editing, setEditing] = useState<{ id: string; startDate: string; endDate: string; reason: string } | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [recreatable, setRecreatable] = useState<RecreatableClass[]>([]);
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

  async function saveChange() {
    if (!editing) return;
    setError(null);
    setMessage(null);
    try {
      const updated = await updateClosure.mutateAsync({
        id: editing.id,
        body: { startDate: editing.startDate, endDate: editing.endDate || editing.startDate, reason: editing.reason.trim() },
      });
      setMessage(t('timetable.closures.changed', { count: updated.cancelledClasses }));
      setRecreatable(updated.recreatable);
      setEditing(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('timetable.closures.changeFailed'));
    }
  }

  async function recreate(c: RecreatableClass) {
    setError(null);
    setMessage(null);
    try {
      await recreateClass.mutateAsync(c.id);
      setRecreatable((list) => list.filter((x) => x.id !== c.id));
      setMessage(t('timetable.closures.recreated', { title: c.title, date: day(c.date) }));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('timetable.closures.recreateFailed'));
    }
  }

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
      <p className="ultm8-field__hint u8cf-intro">{t('timetable.closures.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {message ? <p role="status">{message}</p> : null}

      {closures.isLoading ? (
        <Spinner />
      ) : (closures.data?.items.length ?? 0) === 0 ? (
        <p>{t('timetable.closures.none')}</p>
      ) : (
        <ul className="u8cf-list">
          {closures.data!.items.map((c) =>
            editing?.id === c.id ? (
              <li key={c.id} aria-label={c.reason} className="u8cf-list__item">
                <div className="u8cf-fields">
                  <Field label={t('timetable.closures.from')} htmlFor={`closure-edit-from-${c.id}`}>
                    <TextField
                      id={`closure-edit-from-${c.id}`}
                      type="date"
                      value={editing.startDate}
                      onChange={(e) => setEditing({ ...editing, startDate: e.target.value })}
                    />
                  </Field>
                  <Field label={t('timetable.closures.to')} htmlFor={`closure-edit-to-${c.id}`}>
                    <TextField
                      id={`closure-edit-to-${c.id}`}
                      type="date"
                      value={editing.endDate}
                      min={editing.startDate || undefined}
                      onChange={(e) => setEditing({ ...editing, endDate: e.target.value })}
                    />
                  </Field>
                  <Field label={t('timetable.closures.reason')} htmlFor={`closure-edit-reason-${c.id}`}>
                    <TextField
                      id={`closure-edit-reason-${c.id}`}
                      value={editing.reason}
                      maxLength={120}
                      onChange={(e) => setEditing({ ...editing, reason: e.target.value })}
                    />
                  </Field>
                </div>
                <div className="u8cf-row-buttons">
                  <Button variant="secondary" onClick={() => setEditing(null)}>
                    {t('timetable.closures.back')}
                  </Button>
                  <Button disabled={!editing.startDate || !editing.reason.trim() || updateClosure.isPending} onClick={() => void saveChange()}>
                    {t('timetable.closures.save')}
                  </Button>
                </div>
              </li>
            ) : (
              <li key={c.id} aria-label={c.reason} className="u8cf-list__item">
                <div className="u8cf-list__line">
                  <span className="u8cf-list__text">
                    <strong>{c.reason}</strong>
                    <span className="u8cf-list__sub">
                      {span(c.startDate, c.endDate)} · {where(c.branchId)}
                    </span>
                  </span>
                  <span className="u8cf-row-buttons">
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setError(null);
                        setMessage(null);
                        setRemoving(null);
                        setEditing({ id: c.id, startDate: c.startDate, endDate: c.endDate, reason: c.reason });
                      }}
                    >
                      {t('timetable.closures.change')}
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setError(null);
                        setMessage(null);
                        setRemoving(c.id);
                      }}
                    >
                      {t('timetable.closures.remove')}
                    </Button>
                  </span>
                </div>
                {removing === c.id ? (
                  <div role="alert" className="u8cf-note">
                    <p>{t('timetable.closures.removeConfirm')}</p>
                    <div className="u8cf-row-buttons">
                      <Button variant="secondary" onClick={() => setRemoving(null)}>
                        {t('timetable.closures.back')}
                      </Button>
                      <Button
                        disabled={deleteClosure.isPending}
                        onClick={() =>
                          deleteClosure.mutate(c.id, {
                            onSuccess: () => setRemoving(null),
                            onError: (err) => setError(err instanceof ApiError ? err.message : t('timetable.closures.removeFailed')),
                          })
                        }
                      >
                        {t('timetable.closures.removeButton')}
                      </Button>
                    </div>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}

      {recreatable.length > 0 ? (
        <section aria-label={t('timetable.closures.recreateTitle')}>
          <h3 className="u8cf-subhead">{t('timetable.closures.recreateTitle')}</h3>
          <ul className="u8cf-list">
            {recreatable.map((rc) => (
              <li key={rc.id} className="u8cf-list__item u8cf-list__line">
                <span className="u8cf-list__text">
                  <strong>{rc.title}</strong>
                  <span className="u8cf-list__sub">
                    {day(rc.date)} · {where(rc.branchId)}
                  </span>
                </span>
                <Button variant="secondary" disabled={recreateClass.isPending} onClick={() => void recreate(rc)}>
                  {t('timetable.closures.recreate')}
                </Button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <h3 className="u8cf-subhead">{t('timetable.closures.addTitle')}</h3>
      <div className="u8cf-fields">
        <Field label={t('timetable.closures.from')} htmlFor="closure-from">
          <TextField id="closure-from" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
        </Field>
        <Field label={t('timetable.closures.to')} htmlFor="closure-to" hint={t('timetable.closures.toHint')}>
          <TextField id="closure-to" type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEndDate(e.target.value)} />
        </Field>
        <div className="u8n-dd-field">
          <NewLookSelect
            id="closure-branch"
            label={t('timetable.closures.where')}
            value={branchId}
            onChange={setBranchId}
            options={[{ value: '', label: t('timetable.closures.wholeSchool') }, ...branches.filter((b) => !b.archivedAt).map((b) => ({ value: b.id, label: b.name }))]}
          />
        </div>
      </div>
      <Field label={t('timetable.closures.reason')} htmlFor="closure-reason" hint={t('timetable.closures.reasonHint')}>
        <TextField id="closure-reason" value={reason} maxLength={120} onChange={(e) => setReason(e.target.value)} />
      </Field>

      {confirming ? (
        <div role="alert" className="u8cf-note">
          <p>{t('timetable.closures.confirm', { dates: span(startDate, endDate || startDate), where: where(branchId || null) })}</p>
        </div>
      ) : null}
      {/* The dialog's own buttons in the band: Close and Add closure, or,
          while the add is being confirmed, Back and Yes. */}
      <ModalActions>
        {confirming ? (
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              {t('timetable.closures.back')}
            </Button>
            <Button onClick={() => void add()} disabled={createClosure.isPending}>
              {t('timetable.closures.confirmButton')}
            </Button>
          </>
        ) : (
          <>
            <Button variant="secondary" onClick={onClose}>
              {t('timetable.closures.close')}
            </Button>
            <Button disabled={!ready} onClick={() => setConfirming(true)}>
              {t('timetable.closures.add')}
            </Button>
          </>
        )}
      </ModalActions>
    </Modal>
  );
}
