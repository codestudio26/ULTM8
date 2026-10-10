import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useAuth, useCoachSchoolId } from '../auth/AuthContext';
import { useSchool } from '../schools/schoolQueries';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useRanks } from '../ranks/rankQueries';
import { useClasses, type ClassResponse } from '../classes/classQueries';
import { useTimetableSlots, type TimetableSlotResponse } from '../timetable/timetableQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { useGradingBoard, useMyGrading, useStudentEligibility, type StudentEligibility } from '../grading/gradingQueries';
import { flattenLadder } from '../grading/ladder';
import { BeltChip } from '../grading/BeltChip';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const dayLabel = (d: string) => d.charAt(0) + d.slice(1).toLowerCase();
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

function Section({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section aria-label={title} style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 18, margin: 0 }}>
            {title}
          </h2>
          {action}
        </div>
        {children}
      </Card>
    </section>
  );
}

/**
 * The coach's dashboard on the web portal (Decision 184): their grading (the
 * styles they grade in, with how many students are ready), the classes they
 * teach, their notifications, and, when they also train here, their own
 * ranks and progress. Everything comes from what the API already lets a coach
 * read; it shows students of the coach's own branches only (Decision 168).
 */
export function CoachDashboardPage() {
  const schoolId = useCoachSchoolId();
  const { claims } = useAuth();
  const school = useSchool(schoolId);
  const isStudentHere = !!claims?.grants.some((g) => g.role === 'STUDENT' && g.schoolId === schoolId);

  if (!schoolId) {
    return (
      <Card>
        <EmptyState title="You're not a coach at a School yet" description="Open the invite link the School sent you to get started." />
      </Card>
    );
  }

  return (
    <>
      <PageHeader title="Coach dashboard" subtitle={school.data?.name} />
      <GradingSection schoolId={schoolId} />
      <ClassesSection schoolId={schoolId} me={claims?.sub ?? ''} />
      <NotificationsSection />
      {isStudentHere ? <MyTrainingSection schoolId={schoolId} me={claims?.sub ?? ''} /> : null}
    </>
  );
}

function GradingSection({ schoolId }: { schoolId: string }) {
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  return (
    <Section title="Grading" action={styles.length > 0 ? <Link to="/grading">Open the Grading Board</Link> : undefined}>
      {my.isLoading || disciplines.isLoading ? (
        <Spinner />
      ) : my.error || disciplines.error ? (
        <ErrorBanner message={errorText(my.error ?? disciplines.error, 'Could not load your grading.')} />
      ) : styles.length === 0 ? (
        <EmptyState title="No styles to grade yet" description="The School owner hasn't given you grading in any style yet." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {styles.map((style) => (
            <StyleSummary key={style.id} schoolId={schoolId} style={style} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function StyleSummary({ schoolId, style }: { schoolId: string; style: DisciplineResponse }) {
  const board = useGradingBoard(schoolId, style.id, false);
  const items = board.data?.items ?? [];
  const ready = items.filter((i) => i.eligibility.boardColumn === 'READY_TO_GRADE').length;
  const gettingThere = items.filter((i) => i.eligibility.boardColumn === 'GETTING_THERE').length;
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong style={{ minWidth: 120 }}>{style.name}</strong>
      {board.isLoading ? (
        <Spinner />
      ) : board.error ? (
        <span className="ultm8-field__hint">{errorText(board.error, 'Could not load this board.')}</span>
      ) : (
        <>
          <Badge variant={ready > 0 ? 'success' : 'default'}>{ready} ready to grade</Badge>
          <Badge>{gettingThere} getting there</Badge>
          <span className="ultm8-field__hint">{items.length} students</span>
        </>
      )}
    </li>
  );
}

/** Classes and weekly timetable slots where they are the instructor. */
function ClassesSection({ schoolId, me }: { schoolId: string; me: string }) {
  const classes = useClasses(schoolId);
  const slots = useTimetableSlots(schoolId);
  const now = Date.now();
  const weekly = useMemo(
    () =>
      (slots.data?.items ?? [])
        .filter((s: TimetableSlotResponse) => s.instructorId === me && s.status === 'ON')
        .sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.startTime.localeCompare(b.startTime)),
    [slots.data, me],
  );
  const upcoming = useMemo(
    () =>
      (classes.data?.items ?? [])
        .filter((c: ClassResponse) => c.instructorId === me && new Date(c.endDate).getTime() >= now)
        .sort((a, b) => a.startDate.localeCompare(b.startDate))
        .slice(0, 10),
    [classes.data, me, now],
  );
  const loading = classes.isLoading || slots.isLoading;
  const error = classes.error ?? slots.error;
  return (
    <Section title="My classes">
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={errorText(error, 'Could not load your classes.')} />
      ) : weekly.length === 0 && upcoming.length === 0 ? (
        <EmptyState title="No classes yet" description="Classes the School assigns to you will show here." />
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {weekly.length > 0 ? (
            <div>
              <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Every week</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {weekly.map((s) => (
                  <li key={s.id}>
                    {dayLabel(s.weekday)} {s.startTime}–{s.endTime} · {s.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {upcoming.length > 0 ? (
            <div>
              <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>Coming up</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {upcoming.map((c) => (
                  <li key={c.id}>
                    {shortDate(c.startDate)} · {c.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}

function NotificationsSection() {
  const notifications = useNotifications();
  const items = (notifications.data?.items ?? []).slice(0, 5);
  const unread = (notifications.data?.items ?? []).filter((n) => !n.read).length;
  return (
    <Section title="Notifications" action={<Link to="/notifications">See all{unread > 0 ? ` (${unread} unread)` : ''}</Link>}>
      {notifications.isLoading ? (
        <Spinner />
      ) : notifications.error ? (
        <ErrorBanner message={errorText(notifications.error, 'Could not load notifications.')} />
      ) : items.length === 0 ? (
        <EmptyState title="No notifications" />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {items.map((n) => (
            <li key={n.id} style={{ fontWeight: n.read ? 400 : 700 }}>
              {n.title}
              <div className="ultm8-field__hint" style={{ fontWeight: 400 }}>
                {n.body}
              </div>
            </li>
          ))}
        </ul>
      )}
    </Section>
  );
}

/** Their own ranks, when they also train at this School (Decision 184: a
 * coach keeps their student side). */
function MyTrainingSection({ schoolId, me }: { schoolId: string; me: string }) {
  const eligibility = useStudentEligibility(me, schoolId);
  const disciplines = useDisciplines(schoolId);
  const items = eligibility.data?.items ?? [];
  return (
    <Section title="My training">
      {eligibility.isLoading || disciplines.isLoading ? (
        <Spinner />
      ) : eligibility.error ? (
        <ErrorBanner message={errorText(eligibility.error, 'Could not load your ranks.')} />
      ) : items.length === 0 ? (
        <EmptyState title="No rank yet" description="Your ranks will show here once you're graded." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {items.map((item) => (
            <MyRank key={item.disciplineId} item={item} styleName={disciplines.data?.items.find((d) => d.id === item.disciplineId)?.name ?? 'Style'} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function MyRank({ item, styleName }: { item: StudentEligibility; styleName: string }) {
  const ranks = useRanks(item.disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const rung = ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const e = item.eligibility;
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong style={{ minWidth: 120 }}>{styleName}</strong>
      {rung ? <BeltChip rung={rung} /> : null}
      <span>{rung?.name ?? '—'}</span>
      {e?.hasNext ? <span className="ultm8-field__hint">{e.progressPercent ?? 0}% to next rank</span> : null}
      {e?.hasNext && e.eligible ? <Badge variant="success">Ready to grade</Badge> : null}
    </li>
  );
}
