import React, { useState } from 'react';
import { Button, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { useDisciplines } from '../disciplines/disciplineQueries';
import { errorText } from './frontDeskQueries';
import { useStartOpenMat } from './openMatQueries';

const LENGTHS = [30, 45, 60, 90, 120];

function hhmm(d: Date): string {
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/**
 * "+ Open mat session" (Decision 304 item 1, built as Decision 386): style,
 * start time (today) and length, default 60 minutes. It becomes a one-off
 * class at the Branch, and the students who train there are told in the app.
 */
export function OpenMatDialog({
  schoolId,
  branches,
  branchId: initialBranchId,
  onClose,
  onStarted,
}: {
  schoolId: string;
  /** The Branches the caller can start one at (empty: the School has none). */
  branches: Array<{ id: string; name: string }>;
  branchId: string;
  onClose: () => void;
  onStarted: (notified: number) => void;
}) {
  const t = useT();
  const styles = (useDisciplines(schoolId).data?.items ?? []).filter((d) => !d.archivedAt);
  const startOpenMat = useStartOpenMat(schoolId);
  const [branchId, setBranchId] = useState(branches.some((b) => b.id === initialBranchId) ? initialBranchId : (branches[0]?.id ?? ''));
  const [disciplineId, setDisciplineId] = useState('');
  const [time, setTime] = useState(() => hhmm(new Date()));
  const [minutes, setMinutes] = useState(60);
  const [error, setError] = useState<string | null>(null);
  const style = disciplineId || styles[0]?.id || '';

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const [h, m] = time.split(':').map(Number);
    const startsAt = new Date();
    startsAt.setHours(h, m, 0, 0);
    startOpenMat.mutate(
      { branchId: branchId || null, disciplineId: style || null, startsAt: startsAt.toISOString(), minutes },
      { onSuccess: (r) => onStarted(r.notified), onError: (err) => setError(errorText(err, t('frontDesk.openMat.failed'))) },
    );
  }

  return (
    <Modal title={t('frontDesk.openMat.title')} onClose={onClose}>
      <form onSubmit={submit} data-testid="open-mat-form">
        <p style={{ marginTop: 0 }}>{t('frontDesk.openMat.intro')}</p>
        {error ? <ErrorBanner message={error} /> : null}
        {branches.length > 0 ? (
          <Field label={t('frontDesk.page.branch')} htmlFor="om-branch">
            <SelectField id="om-branch" value={branchId} onChange={(e) => setBranchId(e.target.value)} options={branches.map((b) => ({ value: b.id, label: b.name }))} />
          </Field>
        ) : null}
        {styles.length > 0 ? (
          <Field label={t('frontDesk.openMat.style')} htmlFor="om-style">
            <SelectField id="om-style" value={style} onChange={(e) => setDisciplineId(e.target.value)} options={styles.map((d) => ({ value: d.id, label: d.name }))} />
          </Field>
        ) : null}
        <Field label={t('frontDesk.openMat.start')} htmlFor="om-start">
          <TextField id="om-start" type="time" value={time} onChange={(e) => setTime(e.target.value)} required />
        </Field>
        <Field label={t('frontDesk.openMat.length')} htmlFor="om-length">
          <SelectField
            id="om-length"
            value={String(minutes)}
            onChange={(e) => setMinutes(Number(e.target.value))}
            options={LENGTHS.map((n) => ({ value: String(n), label: t('frontDesk.openMat.minutes', { count: n }) }))}
          />
        </Field>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 16 }}>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={startOpenMat.isPending || !time}>
            {t('frontDesk.openMat.submit')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
