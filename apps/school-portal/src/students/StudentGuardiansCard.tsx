import React, { useState } from 'react';
import { Badge, Button, ErrorBanner, Field, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useStudentGuardians } from './studentQueries';
import { useAddGuardian, useRemoveGuardian } from './studentAccessQueries';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * A child's parents and guardians on their page (Decision 371), with their
 * consent status for staff (Decision 430 item 9) and, for the owner,
 * "Remove Guardian" (item 8, never the last one) and "Add another Guardian"
 * (item 6). Shown for a current student with at least one parent. In the
 * new look it sits under Contact in the student page's summary panel.
 */
export function StudentGuardiansCard({ schoolId, studentId, studentName, enabled, isOwner }: { schoolId: string; studentId: string; studentName: string; enabled: boolean; isOwner: boolean }) {
  const t = useT();
  const guardians = useStudentGuardians(schoolId, studentId, enabled);
  const remove = useRemoveGuardian(schoolId, studentId);
  const add = useAddGuardian(schoolId, studentId);
  const [removing, setRemoving] = useState<{ id: string; name: string } | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ firstName: '', surname: '', email: '' });
  const [done, setDone] = useState<string | null>(null);

  const items = guardians.data?.items ?? [];
  if (items.length === 0) return null;
  const consent = guardians.data?.consent;
  const names = items.map((g) => `${g.firstName} ${g.surname}`.trim());
  const filled = form.firstName.trim() && form.surname.trim() && form.email.trim();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!filled) return;
    add.mutate(
      { firstName: form.firstName.trim(), surname: form.surname.trim(), email: form.email.trim() },
      {
        onSuccess: (res) => {
          setDone(
            res.temporaryPasscode
              ? t('students.guardiansCard.createdWithPasscode', { email: res.guardianEmail, code: res.temporaryPasscode })
              : t('students.guardiansCard.invited', { email: res.guardianEmail }),
          );
          setForm({ firstName: '', surname: '', email: '' });
          setAdding(false);
        },
      },
    );
  }

  return (
    <div data-testid="student-guardians">
      <p className="u8sp-panel__text">
        {t('students.guardians', { count: items.length, names: names.join(', ') })}{' '}
        {consent === 'PENDING' || consent === 'WITHDRAWN' ? (
          <Badge variant="warning">{t(consent === 'PENDING' ? 'students.guardiansCard.consentPendingBadge' : 'students.guardiansCard.consentWithdrawnBadge')}</Badge>
        ) : null}
      </p>
      {consent === 'PENDING' ? <p className="u8sp-panel__note">{t('students.guardiansCard.consentPending')}</p> : null}
      {consent === 'WITHDRAWN' ? <p className="u8sp-panel__note">{t('students.guardiansCard.consentWithdrawn')}</p> : null}
      {done ? <div style={{ marginTop: 12 }}><SuccessBanner message={done} /></div> : null}
      {isOwner ? (
        <>
          <div className="u8sp-panel__buttons">
            {items.length > 1
              ? items.map((g, i) => (
                  <Button key={g.id} variant="secondary" onClick={() => { setDone(null); setRemoving({ id: g.id, name: names[i] }); }}>
                    {t('students.guardiansCard.remove', { name: names[i] })}
                  </Button>
                ))
              : null}
            {!adding ? (
              <Button variant="secondary" onClick={() => { setDone(null); setAdding(true); }}>
                {t('students.guardiansCard.add')}
              </Button>
            ) : null}
          </div>
          {adding ? (
            <form onSubmit={submit} className="u8sp-panel__form">
              <p className="u8sp-panel__note" style={{ margin: '0 0 12px' }}>{t('students.guardiansCard.addHint')}</p>
              {add.error ? <ErrorBanner message={errorText(add.error, t('common.tryAgain'))} /> : null}
              <Field label={t('students.guardiansCard.firstName')} htmlFor="add-guardian-first-name">
                <TextField id="add-guardian-first-name" maxLength={100} value={form.firstName} onChange={(e) => setForm({ ...form, firstName: e.target.value })} />
              </Field>
              <Field label={t('students.guardiansCard.surname')} htmlFor="add-guardian-surname">
                <TextField id="add-guardian-surname" maxLength={100} value={form.surname} onChange={(e) => setForm({ ...form, surname: e.target.value })} />
              </Field>
              <Field label={t('students.guardiansCard.email')} htmlFor="add-guardian-email">
                <TextField id="add-guardian-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </Field>
              <div className="u8sp-panel__buttons u8sp-panel__buttons--pair">
                <Button type="submit" disabled={!filled} loading={add.isPending}>
                  {t('students.guardiansCard.submit')}
                </Button>
                <Button type="button" variant="secondary" onClick={() => setAdding(false)}>
                  {t('common.cancel')}
                </Button>
              </div>
            </form>
          ) : null}
        </>
      ) : null}
      {removing ? (
        <ConfirmDeleteModal
          title={t('students.guardiansCard.removeTitle', { name: removing.name })}
          description={t('students.guardiansCard.removeBody', { name: removing.name, child: studentName })}
          confirmLabel={t('students.guardiansCard.removeConfirm')}
          onConfirm={() => remove.mutateAsync(removing.id).then(() => setDone(t('students.guardiansCard.removed', { name: removing.name, child: studentName })))}
          onClose={() => setRemoving(null)}
        />
      ) : null}
    </div>
  );
}
