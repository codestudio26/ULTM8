import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Modal, SelectField, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { useSchoolInstructorBelts, useVerifyInstructorBelt, type InstructorBelt } from './instructorBeltQueries';
import { useT } from '../i18n/I18nProvider';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Instructors' belts (Decisions 108, 188): each instructor chooses their own
 * belt per style on their "My belts" page; the owner verifies it here, or
 * corrects it to the right belt.
 */
export function InstructorBeltsSection({ schoolId }: { schoolId: string }) {
  const t = useT();
  const data = useSchoolInstructorBelts(schoolId);
  const verify = useVerifyInstructorBelt(schoolId);
  const [error, setError] = useState<string | null>(null);
  const [correcting, setCorrecting] = useState<InstructorBelt | null>(null);

  const belts = data.data?.items ?? [];
  const waiting = (data.data?.instructors ?? []).filter((i) => !belts.some((b) => b.userId === i.userId));

  async function verifyAsChosen(b: InstructorBelt) {
    setError(null);
    try {
      await verify.mutateAsync({ userId: b.userId, disciplineId: b.disciplineId });
    } catch (err) {
      setError(errorText(err, t('instructors.belts.verifyFailed')));
    }
  }

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('instructors.belts.heading')}
      </h2>
      <p style={{ marginTop: 0 }}>{t('instructors.belts.intro')}</p>
      {error ? <ErrorBanner message={error} /> : null}
      {data.isLoading ? (
        <Spinner />
      ) : data.error ? (
        <ErrorBanner message={errorText(data.error, t('instructors.belts.loadFailed'))} />
      ) : belts.length === 0 ? (
        <EmptyState title={t('instructors.belts.emptyTitle')} description={t('instructors.belts.emptyDescription')} />
      ) : (
        <Table<InstructorBelt>
          rows={belts}
          columns={[
            { key: 'name', header: t('instructors.belts.columnInstructor'), render: (b) => `${b.firstName} ${b.surname}` },
            { key: 'style', header: t('instructors.belts.columnStyle'), render: (b) => b.disciplineName },
            { key: 'belt', header: t('instructors.belts.columnBelt'), render: (b) => b.beltName },
            {
              key: 'status',
              header: t('instructors.belts.columnStatus'),
              render: (b) => (b.verificationStatus === 'VERIFIED' ? <Badge variant="success">{t('instructors.belts.verified')}</Badge> : <Badge variant="danger">{t('instructors.belts.notVerified')}</Badge>),
            },
            {
              key: 'actions',
              header: '',
              render: (b) => (
                <div style={{ display: 'flex', gap: 8 }}>
                  {b.verificationStatus === 'UNVERIFIED' ? (
                    <Button variant="secondary" onClick={() => verifyAsChosen(b)} aria-label={t('instructors.belts.verifyAria', { name: `${b.firstName} ${b.surname}`, style: b.disciplineName })}>
                      {t('instructors.belts.verify')}
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => setCorrecting(b)} aria-label={t('instructors.belts.correctAria', { name: `${b.firstName} ${b.surname}`, style: b.disciplineName })}>
                    {t('instructors.belts.correct')}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {waiting.length > 0 ? (
        <p className="ultm8-field__hint">{t('instructors.belts.notChosenYet', { names: waiting.map((i) => `${i.firstName} ${i.surname}`).join(', ') })}</p>
      ) : null}
      {correcting ? <CorrectBeltModal schoolId={schoolId} belt={correcting} onClose={() => setCorrecting(null)} /> : null}
    </Card>
  );
}

function CorrectBeltModal({ schoolId, belt, onClose }: { schoolId: string; belt: InstructorBelt; onClose: () => void }) {
  const t = useT();
  const ranks = useRanks(belt.disciplineId);
  const verify = useVerifyInstructorBelt(schoolId);
  const [choice, setChoice] = useState(belt.stripeTierId);
  const [error, setError] = useState<string | null>(null);
  const ladder = flattenLadder(ranks.data?.items ?? []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const rung = ladder.find((r) => r.id === choice);
    if (!rung) return;
    setError(null);
    try {
      await verify.mutateAsync({ userId: belt.userId, disciplineId: belt.disciplineId, rankId: rung.rankId, stripeTierId: rung.id });
      onClose();
    } catch (err) {
      setError(errorText(err, t('instructors.belts.saveFailed')));
    }
  }

  return (
    <Modal title={t('instructors.belts.modalTitle', { name: `${belt.firstName} ${belt.surname}`, style: belt.disciplineName })} onClose={onClose}>
      {error ? <ErrorBanner message={error} /> : null}
      <form onSubmit={save}>
        <Field label={t('instructors.belts.beltLabel')} htmlFor="correct-instructor-belt" hint={t('instructors.belts.beltHint')}>
          <SelectField id="correct-instructor-belt" value={choice} onChange={(e) => setChoice(e.target.value)} options={ladder.map((r) => ({ value: r.id, label: r.name }))} />
        </Field>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button type="submit" loading={verify.isPending} disabled={choice === belt.stripeTierId && belt.verificationStatus === 'VERIFIED'}>
            {t('instructors.belts.saveAndVerify')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
