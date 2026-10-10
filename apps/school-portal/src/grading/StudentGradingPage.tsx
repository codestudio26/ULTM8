import React, { useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useOwnedSchoolId } from '../auth/AuthContext';
import { useStudents } from '../students/studentQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { useSkills, type SkillResponse } from '../skills/skillQueries';
import { useLessons } from '../curriculum/curriculumQueries';
import { useInstructors } from '../instructors/instructorQueries';
import { flattenLadder, type Rung } from './ladder';
import { BeltChip } from './BeltChip';
import {
  type Eligibility,
  type PromotionEvent,
  type StudentEligibility,
  useCycleSkill,
  useRankHistory,
  useStudentEligibility,
} from './gradingQueries';
import { DowngradeModal, GradeModal, RankDateModal, VerifyRankModal, VoidEntryModal } from './GradingModals';

type Lesson = { id: string; title: string; skillIds: string[] };

/** A date the API stores as the start of a local day, shown as that day.
 * Uses the browser's time zone, like every date on the portal today (see
 * lib/datetime.ts): a viewer in a different time zone from the student's
 * branch can see the neighbouring day. */
function dayOf(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Student grading panel (roadmap Phase 4, item 2): for one student, every
 * style at the School — current rank and since when, progress toward the next
 * rank from the grading engine, the skills for the next rank with sign-off and
 * linked lessons, and the rank history — with the grading actions: grade (or a
 * first rank), move down, correct the rank date, verify a self-declared rank
 * and void a history entry. The API enforces every rule; this screen shows them
 * up front.
 */
export function StudentGradingPage() {
  const { id } = useParams<{ id: string }>();
  const studentId = id ?? null;
  const schoolId = useOwnedSchoolId();
  const { claims } = useAuth();
  const students = useStudents(schoolId);
  const disciplines = useDisciplines(schoolId);
  const eligibility = useStudentEligibility(studentId, schoolId);
  const lessons = useLessons(schoolId);
  const instructors = useInstructors(schoolId);
  const [showVoided, setShowVoided] = useState(false);
  const history = useRankHistory(studentId, schoolId, showVoided);

  const staffNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const i of instructors.data?.items ?? []) names.set(i.userId, `${i.firstName} ${i.surname}`.trim());
    return names;
  }, [instructors.data]);

  if (!schoolId || !studentId) return null;
  if (students.isLoading || disciplines.isLoading || eligibility.isLoading) return <Spinner />;
  const loadError = students.error ?? disciplines.error ?? eligibility.error;
  if (loadError) {
    return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : 'Could not load this student\'s grading.'} />;
  }

  const student = students.data?.items.find((s) => s.id === studentId);
  const styles = disciplines.data?.items ?? [];
  const ranks = eligibility.data?.items ?? [];
  const performerName = (userId: string | null | undefined) =>
    !userId ? 'Former instructor' : userId === claims?.sub ? 'You' : staffNames.get(userId) ?? 'Staff member';

  return (
    <>
      <p style={{ margin: '0 0 8px' }}>
        <Link to="/students">← Students</Link>
      </p>
      <PageHeader
        title={student ? `${student.firstName} ${student.surname}`.trim() : 'Student'}
        subtitle="Ranks, progress toward the next grade, skills and history, for each style at your School."
      />
      {styles.length === 0 ? (
        <Card>
          <EmptyState title="No styles yet" description="Add a style and its ranks on the Disciplines page before grading students." />
        </Card>
      ) : (
        styles.map((discipline) => (
          <DisciplineGradingCard
            key={discipline.id}
            studentId={studentId}
            schoolId={schoolId}
            discipline={discipline}
            studentRank={ranks.find((r) => r.disciplineId === discipline.id) ?? null}
            lessons={(lessons.data?.items ?? []) as Lesson[]}
            history={history.data?.items ?? []}
            historyLoading={history.isLoading}
            performerName={performerName}
          />
        ))
      )}
      <Checkbox label="Show voided history entries" checked={showVoided} onChange={(e) => setShowVoided(e.target.checked)} />
    </>
  );
}

type Dialog = 'grade' | 'downgrade' | 'date' | 'verify' | { voidEventId: string; summary: string } | null;

function DisciplineGradingCard({
  studentId,
  schoolId,
  discipline,
  studentRank,
  lessons,
  history,
  historyLoading,
  performerName,
}: {
  studentId: string;
  schoolId: string;
  discipline: DisciplineResponse;
  studentRank: StudentEligibility | null;
  lessons: Lesson[];
  history: PromotionEvent[];
  historyLoading: boolean;
  performerName: (userId: string | null | undefined) => string;
}) {
  const ranks = useRanks(discipline.id);
  const skills = useSkills(discipline.id);
  const [dialog, setDialog] = useState<Dialog>(null);

  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const current = studentRank ? ladder.find((r) => r.id === studentRank.currentStripeId) ?? null : null;
  const eligibility = (studentRank?.eligibility ?? null) as Eligibility | null;
  const entries = studentRank ? history.filter((h) => h.studentRankId === studentRank.id) : [];
  const rungName = (rungId: string | null | undefined) => ladder.find((r) => r.id === rungId)?.name ?? 'Unknown rank';

  return (
    <section aria-label={discipline.name} style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 18, marginBottom: 8 }}>
              {discipline.name}
            </h2>
            {ranks.isLoading ? (
              <Spinner />
            ) : !studentRank ? (
              <p style={{ margin: 0 }}>No rank in this style yet.</p>
            ) : !current ? (
              <ErrorBanner message="This student's rank isn't on the ladder any more. Give them a rank again to fix it." />
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
                <BeltChip rung={current} />
                <strong>{current.name}</strong>
                <span className="ultm8-field__hint">since {formatDay(studentRank.dateOfCurrentRank)}</span>
                {studentRank.verificationStatus === 'UNVERIFIED' ? <Badge variant="danger">Self-declared — not verified</Badge> : null}
                {eligibility?.hasNext && eligibility.eligible ? <Badge variant="success">Ready to grade</Badge> : null}
              </div>
            )}
          </div>
          {ladder.length > 0 ? (
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {studentRank?.verificationStatus === 'UNVERIFIED' && current ? (
                <Button onClick={() => setDialog('verify')}>Verify rank</Button>
              ) : null}
              <Button onClick={() => setDialog('grade')} disabled={!!studentRank && !current}>
                {studentRank ? 'Grade' : 'Give first rank'}
              </Button>
              {current && current.index > 0 ? (
                <Button variant="secondary" onClick={() => setDialog('downgrade')}>
                  Move down
                </Button>
              ) : null}
              {current ? (
                <Button variant="secondary" onClick={() => setDialog('date')}>
                  Correct date
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {!ranks.isLoading && ladder.length === 0 ? (
          <p className="ultm8-field__hint">
            This style has no ranks yet. <Link to={`/disciplines/${discipline.id}`}>Set up its ladder</Link> first.
          </p>
        ) : null}

        {current && eligibility ? (
          <Progress eligibility={eligibility} nextName={eligibility.hasNext ? rungName(eligibility.nextRungId) : null} />
        ) : null}

        {current && eligibility?.hasNext ? (
          <SkillsForNext
            studentId={studentId}
            eligibility={eligibility}
            statuses={studentRank?.skillStatuses ?? []}
            skills={skills.data?.items ?? []}
            lessons={lessons}
          />
        ) : null}

        {studentRank ? (
          <History
            entries={entries}
            loading={historyLoading}
            rungName={rungName}
            performerName={performerName}
            onVoid={(e, summary) => setDialog({ voidEventId: e.id, summary })}
          />
        ) : null}
      </Card>

      {dialog === 'grade' ? (
        <GradeModal studentId={studentId} discipline={discipline} ladder={ladder} current={current} eligibility={eligibility} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'downgrade' && current ? (
        <DowngradeModal studentId={studentId} discipline={discipline} ladder={ladder} current={current} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'date' && studentRank ? (
        <RankDateModal studentId={studentId} discipline={discipline} currentDay={dayOf(studentRank.dateOfCurrentRank)} onClose={() => setDialog(null)} />
      ) : null}
      {dialog === 'verify' && current ? (
        <VerifyRankModal studentId={studentId} discipline={discipline} ladder={ladder} current={current} onClose={() => setDialog(null)} />
      ) : null}
      {dialog && typeof dialog === 'object' ? (
        <VoidEntryModal studentId={studentId} schoolId={schoolId} eventId={dialog.voidEventId} summary={dialog.summary} onClose={() => setDialog(null)} />
      ) : null}
    </section>
  );
}

function ProgressBar({ percent, label }: { percent: number; label: string }) {
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
      style={{ height: 8, borderRadius: 4, background: 'var(--color-neutral-200)', overflow: 'hidden', margin: '6px 0 12px' }}
    >
      <div style={{ width: `${percent}%`, height: '100%', background: percent >= 100 ? 'var(--color-success)' : 'var(--fill-accent)' }} />
    </div>
  );
}

/** Progress toward the next rank (Decisions 136, 149, 171): classes (or days
 * on a time-only rank), minimum days and skills, each with its own tick. */
function Progress({ eligibility, nextName }: { eligibility: Eligibility; nextName: string | null }) {
  if (!eligibility.hasNext) {
    return (
      <p style={{ marginTop: 16 }}>
        {eligibility.dataError ? 'Progress can\'t be worked out: this rank is not on the ladder.' : 'Top of the ladder: there is no next rank.'}
      </p>
    );
  }
  const tick = (ok: boolean | undefined) => (ok ? '✓' : '○');
  const percent = eligibility.progressPercent ?? 0;
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 4px' }}>
        Toward {nextName} — {percent}%
      </h3>
      <ProgressBar percent={percent} label={`Progress toward ${nextName}`} />
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
        {eligibility.timeOnly ? null : eligibility.byType && eligibility.byType.length > 0 ? (
          eligibility.byType.map((t) => (
            <li key={t.classType}>
              {tick(t.counted >= t.required)} {t.classType}: {t.counted} of {t.required} classes
            </li>
          ))
        ) : (
          <li>
            {tick(eligibility.classesOk)} Classes: {eligibility.countedClasses} of {eligibility.requiredClasses}
          </li>
        )}
        <li>
          {tick(eligibility.daysOk)} Time at this rank:{' '}
          {eligibility.requiredDays ? `${eligibility.elapsedDays} of ${eligibility.requiredDays} days` : `${eligibility.elapsedDays} days (no minimum)`}
        </li>
        {eligibility.timeOnly ? null : (
          <li>
            {tick(eligibility.skillsOk)} Skills: {(eligibility.requiredSkillIds?.length ?? 0) - (eligibility.missingSkillIds?.length ?? 0)} of{' '}
            {eligibility.requiredSkillIds?.length ?? 0} signed off
          </li>
        )}
      </ul>
    </div>
  );
}

const STATUS_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', LEARNING: 'Learning', SIGNED_OFF: 'Signed off' };
const NEXT_STATUS: Record<string, string> = { NOT_STARTED: 'Learning', LEARNING: 'Signed off', SIGNED_OFF: 'Not started' };

/** The skills for the next rank (Decision 127): required, or optional after a
 * time-only rank. Each cycles Not started → Learning → Signed off; lessons
 * linked to the skill are listed with it. */
function SkillsForNext({
  studentId,
  eligibility,
  statuses,
  skills,
  lessons,
}: {
  studentId: string;
  eligibility: Eligibility;
  statuses: Array<{ skillId: string; status: string }>;
  skills: SkillResponse[];
  lessons: Lesson[];
}) {
  const cycle = useCycleSkill(studentId);
  const [error, setError] = useState<string | null>(null);
  const required = eligibility.requiredSkillIds ?? [];
  const optional = eligibility.optionalSkillIds ?? [];
  const ids = [...required, ...optional];
  if (ids.length === 0) return null;

  async function onCycle(skillId: string) {
    setError(null);
    try {
      await cycle.mutateAsync(skillId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not change this skill — please try again.');
    }
  }

  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Skills for the next rank</h3>
      {error ? <ErrorBanner message={error} /> : null}
      <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
        {ids.map((skillId) => {
          const skill = skills.find((s) => s.id === skillId);
          const status = statuses.find((s) => s.skillId === skillId)?.status ?? 'NOT_STARTED';
          const linked = lessons.filter((l) => l.skillIds.includes(skillId));
          const name = skill?.name ?? 'Skill';
          return (
            <li key={skillId} style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <Button
                variant="secondary"
                onClick={() => onCycle(skillId)}
                disabled={cycle.isPending}
                aria-label={`${name}: ${STATUS_LABEL[status]}. Change to ${NEXT_STATUS[status]}`}
              >
                {STATUS_LABEL[status]}
              </Button>
              <span>
                {name}
                {optional.includes(skillId) ? <span className="ultm8-field__hint"> (optional)</span> : null}
              </span>
              {status === 'SIGNED_OFF' ? <Badge variant="success">✓</Badge> : null}
              {linked.length > 0 ? (
                <span className="ultm8-field__hint">
                  Watch:{' '}
                  {linked.map((l, i) => (
                    <React.Fragment key={l.id}>
                      {i > 0 ? ', ' : ''}
                      <Link to="/curriculum">{l.title}</Link>
                    </React.Fragment>
                  ))}
                </span>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

const TYPE_LABEL: Record<string, string> = {
  PROMOTION: 'Promoted',
  BULK_PROMOTION: 'Promoted (bulk)',
  STRIPE_AWARD: 'Stripe awarded',
  BULK_STRIPE_AWARD: 'Stripe awarded (bulk)',
  DOWNGRADE: 'Moved down',
  SELF_DECLARED: 'Self-declared',
  RANK_CORRECTION: 'Rank corrected',
  ADJUSTMENT: 'Adjusted',
};

/** The rank history for this style (Decisions 129, 166): what changed, the
 * grading date, who did it, and the notes; voided entries only on request. */
function History({
  entries,
  loading,
  rungName,
  performerName,
  onVoid,
}: {
  entries: PromotionEvent[];
  loading: boolean;
  rungName: (id: string | null | undefined) => string;
  performerName: (userId: string | null | undefined) => string;
  onVoid: (entry: PromotionEvent, summary: string) => void;
}) {
  return (
    <div style={{ marginTop: 16 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>History</h3>
      {loading ? (
        <Spinner />
      ) : entries.length === 0 ? (
        <p className="ultm8-field__hint">No history yet.</p>
      ) : (
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 12 }}>
          {entries.map((e) => {
            const label = TYPE_LABEL[e.type] ?? e.type;
            const change =
              e.fromStripeTierId && e.fromStripeTierId !== e.toStripeTierId
                ? `${rungName(e.fromStripeTierId)} → ${rungName(e.toStripeTierId)}`
                : rungName(e.toStripeTierId);
            const summary = `${label}: ${change}, ${formatDay(e.effectiveDate)}`;
            return (
              <li key={e.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8, opacity: e.voidedAt ? 0.6 : 1 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>
                    <strong>{label}</strong> {change} · {formatDay(e.effectiveDate)} · by {performerName(e.performedById)}
                    {e.voidedAt ? <Badge variant="danger">Voided</Badge> : null}
                  </span>
                  {e.voidedAt ? null : (
                    <Button variant="secondary" onClick={() => onVoid(e, summary)} aria-label={`Void entry: ${summary}`}>
                      Void
                    </Button>
                  )}
                </div>
                {e.acknowledgedWithoutSkillSignoff ? <div className="ultm8-field__hint">Graded without all skills signed off (acknowledged).</div> : null}
                {e.reason ? <div>Reason: {e.reason}</div> : null}
                {e.systemNote ? <div className="ultm8-field__hint">{e.systemNote}</div> : null}
                {e.note ? <div>Note: {e.note}</div> : null}
                {e.voidedAt ? (
                  <div className="ultm8-field__hint">
                    Voided {formatDay(e.voidedAt)} by {performerName(e.voidedById)}: {e.voidReason}
                  </div>
                ) : null}
              </li>
            );
          })}
        </ol>
      )}
    </div>
  );
}

export type { Rung };
