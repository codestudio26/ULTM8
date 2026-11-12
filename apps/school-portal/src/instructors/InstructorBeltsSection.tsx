import React, { useRef, useState } from 'react';
import { Button, EmptyState, ErrorBanner, Field, Modal, ModalActions, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { RankPicker } from '../grading/RankPicker';
import { useSchoolInstructorBelts, useVerifyInstructorBelt, type InstructorBelt } from './instructorBeltQueries';
import { useT } from '../i18n/I18nProvider';
import { BeltPicture, BeltStatus, OpenFullPageLink, TeamAvatar, TeamCard, pickRow, showPanel } from '../team/TeamParts';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * Instructors' belts (Decisions 108, 188): each instructor chooses their own
 * belt per style on their "My belts" page; the owner verifies it here, or
 * corrects it to the right belt. In the new look (Decision 453) each row has
 * the belt picture and "Open full page ›", and picking a row shows that
 * person in the Instructors page's right-hand panel.
 */
export function InstructorBeltsSection({
  schoolId,
  selectedUserId = null,
  onPick,
  profileOf,
}: {
  schoolId: string;
  /** The person in the page's right-hand panel; their rows are marked. */
  selectedUserId?: string | null;
  /** Clicking a row shows that person in the panel. */
  onPick?: (userId: string) => void;
  /** Their Instructor profile, for the photo and "Open full page ›". */
  profileOf?: (userId: string) => { id: string; photoUrl?: string | null } | null;
}) {
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
    <TeamCard title={t('instructors.team.belts')} intro={t('instructors.belts.intro')}>
      {error ? (
        <div className="u8t-banners">
          <ErrorBanner message={error} />
        </div>
      ) : null}
      {data.isLoading ? (
        <div className="u8t-state">
          <Spinner />
        </div>
      ) : data.error ? (
        <div className="u8t-state">
          <ErrorBanner message={errorText(data.error, t('instructors.belts.loadFailed'))} />
        </div>
      ) : belts.length === 0 ? (
        <div className="u8t-state">
          <EmptyState title={t('instructors.belts.emptyTitle')} description={t('instructors.belts.emptyDescription')} />
        </div>
      ) : (
        <table className="u8t-table">
          <thead>
            <tr>
              <th scope="col">{t('instructors.belts.columnInstructor')}</th>
              <th scope="col">{t('instructors.belts.columnStyle')}</th>
              <th scope="col">{t('instructors.belts.columnBelt')}</th>
              <th scope="col">{t('instructors.belts.columnStatus')}</th>
              <th scope="col" />
            </tr>
          </thead>
          <tbody>
            {belts.map((b) => {
              const name = `${b.firstName} ${b.surname}`;
              const profile = profileOf?.(b.userId) ?? null;
              const row = onPick ? pickRow(selectedUserId === b.userId, () => onPick(b.userId)) : {};
              return (
                <tr key={b.id} {...row}>
                  <td className="u8t-c-main">
                    <div className="u8t-who">
                      <TeamAvatar firstName={b.firstName} surname={b.surname} photoUrl={profile?.photoUrl ?? null} />
                      <div className="u8t-who__text">
                        {onPick ? (
                          <button type="button" className="u8t-name" onClick={() => { onPick(b.userId); showPanel(); }}>
                            {name}
                          </button>
                        ) : (
                          <span>{name}</span>
                        )}
                        {profile ? (
                          <div>
                            <OpenFullPageLink to={`/instructors/${profile.id}`} name={name} />
                          </div>
                        ) : null}
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className="u8t-k">{t('instructors.belts.columnStyle')}: </span>
                    {b.disciplineName}
                  </td>
                  <td>
                    <span className="u8t-belt">
                      <BeltPicture disciplineId={b.disciplineId} stripeTierId={b.stripeTierId} />
                      <span>{b.beltName}</span>
                    </span>
                  </td>
                  <td className="u8t-c-end">
                    <BeltStatus verified={b.verificationStatus === 'VERIFIED'} />
                  </td>
                  <td className="u8t-c-act">
                    <div className="u8t-actions">
                      {b.verificationStatus === 'UNVERIFIED' ? (
                        <button type="button" className="u8t-pill u8t-pill--go u8t-pill--sm" onClick={() => verifyAsChosen(b)} aria-label={t('instructors.belts.verifyAria', { name, style: b.disciplineName })}>
                          {t('instructors.belts.verify')}
                        </button>
                      ) : null}
                      <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => setCorrecting(b)} aria-label={t('instructors.belts.correctAria', { name, style: b.disciplineName })}>
                        {t('instructors.belts.correct')}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {waiting.length > 0 ? <p className="u8t-note">{t('instructors.belts.notChosenYet', { names: waiting.map((i) => `${i.firstName} ${i.surname}`).join(', ') })}</p> : null}
      {correcting ? <CorrectBeltModal schoolId={schoolId} belt={correcting} onClose={() => setCorrecting(null)} /> : null}
    </TeamCard>
  );
}

function CorrectBeltModal({ schoolId, belt, onClose }: { schoolId: string; belt: InstructorBelt; onClose: () => void }) {
  const t = useT();
  const ranks = useRanks(belt.disciplineId);
  const verify = useVerifyInstructorBelt(schoolId);
  const [choice, setChoice] = useState(belt.stripeTierId);
  const [error, setError] = useState<string | null>(null);
  const ladder = flattenLadder(ranks.data?.items ?? []);
  const pickerRef = useRef<HTMLDivElement>(null);

  // A pick counts as an edit, as the browser <select> it replaces did (its
  // change fired an `input` event): the dialog then keeps it on an outside
  // click or Escape (Modal's unsaved-changes guard).
  function pick(rungId: string) {
    if (rungId === choice) return;
    setChoice(rungId);
    pickerRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }

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
        {/* Every drop-down of ranks shows the belt picture (DESIGN.md →
            "Drop-downs"): the grading screens' own rank picker. */}
        <div className="u8t-belt-pick" ref={pickerRef}>
          <Field label={t('instructors.belts.beltLabel')} htmlFor="correct-instructor-belt" hint={t('instructors.belts.beltHint')}>
            <RankPicker id="correct-instructor-belt" value={choice} onChange={pick} options={ladder} />
          </Field>
        </div>
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={verify.isPending} disabled={choice === belt.stripeTierId && belt.verificationStatus === 'VERIFIED'}>
            {t('instructors.belts.saveAndVerify')}
          </Button>
        </ModalActions>
      </form>
    </Modal>
  );
}
