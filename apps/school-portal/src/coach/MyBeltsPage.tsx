import React, { useRef, useState } from 'react';
import { Button, EmptyState, ErrorBanner, Field, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useCoachSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { flattenLadder } from '../grading/ladder';
import { RankPicker } from '../grading/RankPicker';
import { useDeclareMyBelt, useMyBelts, type InstructorBelt } from '../instructors/instructorBeltQueries';
import { useT } from '../i18n/I18nProvider';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { TeamCard } from '../team/TeamParts';
import '../team/teamLook.css';
import '../profile/settingsForms.css';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);

/**
 * "My belts" (Decisions 108, 188): an instructor chooses their own belt and
 * stripe in each of the School's styles. It shows "Not verified" until the
 * School Owner verifies it or corrects it; choosing another belt makes it
 * unverified again.
 *
 * In the new look (Decision 460 item 17): one white card per style, its
 * "Verified" / "Not verified" tag beside the name, and the belt chosen from
 * the grading screens' own drop-down with belt pictures (DESIGN.md →
 * "Drop-downs": "… and the coach's My belts").
 */
export function MyBeltsPage() {
  const t = useT();
  const schoolId = useCoachSchoolId();
  const disciplines = useDisciplines(schoolId);
  const mine = useMyBelts(schoolId);

  if (!schoolId) return null;
  const header = <NewLookPageHeader title={t('coach.myBelts.title')} subtitle={t('coach.myBelts.subtitle')} />;
  if (disciplines.isLoading || mine.isLoading) {
    return (
      <>
        {header}
        <NewLookPage>
          <Spinner />
        </NewLookPage>
      </>
    );
  }
  if (disciplines.error || mine.error) {
    return (
      <>
        {header}
        <NewLookPage>
          <ErrorBanner message={errorText(disciplines.error ?? mine.error, t('coach.myBelts.loadFailed'))} />
        </NewLookPage>
      </>
    );
  }
  const styles = disciplines.data?.items ?? [];
  const belts = mine.data?.items ?? [];

  return (
    <>
      {header}
      <NewLookPage>
        <div className="u8t-stack u8me-belts">
          {styles.length === 0 ? (
            <section className="u8t-card">
              <div className="u8t-state">
                <EmptyState title={t('coach.myBelts.noStylesTitle')} description={t('coach.myBelts.noStylesDescription')} />
              </div>
            </section>
          ) : (
            styles.map((style) => <StyleBelt key={style.id} schoolId={schoolId} style={style} current={belts.find((b) => b.disciplineId === style.id) ?? null} />)
          )}
        </div>
      </NewLookPage>
    </>
  );
}

function StyleBelt({ schoolId, style, current }: { schoolId: string; style: DisciplineResponse; current: InstructorBelt | null }) {
  const t = useT();
  const ranks = useRanks(style.id);
  const declare = useDeclareMyBelt(schoolId);
  const [choice, setChoice] = useState(current?.stripeTierId ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const ladder = flattenLadder(ranks.data?.items ?? []);
  const fieldId = `my-belt-${style.id}`;
  const pickerRef = useRef<HTMLDivElement>(null);

  // A pick counts as an edit, as the browser <select> it replaces did (its
  // change fired an `input` event).
  function pick(rungId: string) {
    if (rungId === choice) return;
    setChoice(rungId);
    pickerRef.current?.dispatchEvent(new Event('input', { bubbles: true }));
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    const rung = ladder.find((r) => r.id === choice);
    if (!rung) {
      setError(t('coach.myBelts.chooseBelt'));
      return;
    }
    try {
      await declare.mutateAsync({ disciplineId: style.id, rankId: rung.rankId, stripeTierId: rung.id });
      setSaved(true);
    } catch (err) {
      setError(errorText(err, t('coach.myBelts.saveFailed')));
    }
  }

  return (
    <TeamCard
      title={style.name}
      action={
        current ? (
          current.verificationStatus === 'VERIFIED' ? (
            <span className="u8t-tag u8t-tag--ok">{t('coach.myBelts.verified')}</span>
          ) : (
            <span className="u8t-tag u8t-tag--bad">{t('coach.myBelts.notVerified')}</span>
          )
        ) : undefined
      }
    >
      <div className="u8t-card__body">
        {error ? <ErrorBanner message={error} /> : null}
        {saved ? <SuccessBanner message={t('coach.myBelts.saved')} /> : null}
        {ranks.isLoading ? (
          <Spinner />
        ) : ladder.length === 0 ? (
          <p className="u8me-quiet">{t('coach.myBelts.noBelts')}</p>
        ) : (
          <form onSubmit={save} className="u8me-belt-form">
            <div className="u8me-belt-pick" ref={pickerRef}>
              <Field label={t('coach.myBelts.beltLabel', { style: style.name })} htmlFor={fieldId}>
                <RankPicker id={fieldId} value={choice} onChange={pick} options={ladder} placeholder={t('coach.myBelts.beltPlaceholder')} />
              </Field>
            </div>
            <Button type="submit" loading={declare.isPending} disabled={!choice || choice === current?.stripeTierId}>
              {t('common.save')}
            </Button>
          </form>
        )}
      </div>
    </TeamCard>
  );
}
