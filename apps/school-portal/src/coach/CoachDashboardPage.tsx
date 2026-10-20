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
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError ? err.message : fallback);
const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
/** Weekday labels are translation keys, resolved at render time. */
const WEEKDAY_LABELS: Record<(typeof WEEKDAYS)[number], TranslationKey> = {
  MONDAY: 'coach.weekdays.monday',
  TUESDAY: 'coach.weekdays.tuesday',
  WEDNESDAY: 'coach.weekdays.wednesday',
  THURSDAY: 'coach.weekdays.thursday',
  FRIDAY: 'coach.weekdays.friday',
  SATURDAY: 'coach.weekdays.saturday',
  SUNDAY: 'coach.weekdays.sunday',
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { weekday: 'short', month: 'short', day: 'numeric' });

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
  const t = useT();
  const schoolId = useCoachSchoolId();
  const { claims } = useAuth();
  const school = useSchool(schoolId);
  const isStudentHere = !!claims?.grants.some((g) => g.role === 'STUDENT' && g.schoolId === schoolId);

  if (!schoolId) {
    return (
      <Card>
        <EmptyState title={t('coach.dashboard.notCoachTitle')} description={t('coach.dashboard.notCoachDescription')} />
      </Card>
    );
  }

  return (
    <>
      <PageHeader title={t('coach.dashboard.title')} subtitle={school.data?.name} />
      <GradingSection schoolId={schoolId} />
      <ClassesSection schoolId={schoolId} me={claims?.sub ?? ''} />
      <NotificationsSection />
      {isStudentHere ? <MyTrainingSection schoolId={schoolId} me={claims?.sub ?? ''} /> : null}
    </>
  );
}

function GradingSection({ schoolId }: { schoolId: string }) {
  const t = useT();
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  return (
    <Section title={t('coach.dashboard.grading')} action={styles.length > 0 ? <Link to="/grading">{t('coach.dashboard.openBoard')}</Link> : undefined}>
      {my.isLoading || disciplines.isLoading ? (
        <Spinner />
      ) : my.error || disciplines.error ? (
        <ErrorBanner message={errorText(my.error ?? disciplines.error, t('coach.dashboard.gradingLoadFailed'))} />
      ) : styles.length === 0 ? (
        <EmptyState title={t('coach.dashboard.noStylesTitle')} description={t('coach.dashboard.noStylesDescription')} />
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
  const t = useT();
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
        <span className="ultm8-field__hint">{errorText(board.error, t('coach.dashboard.boardLoadFailed'))}</span>
      ) : (
        <>
          <Badge variant={ready > 0 ? 'success' : 'default'}>{t('coach.dashboard.readyCount', { count: ready })}</Badge>
          <Badge>{t('coach.dashboard.gettingThereCount', { count: gettingThere })}</Badge>
          <span className="ultm8-field__hint">{t('coach.dashboard.studentsCount', { count: items.length })}</span>
        </>
      )}
    </li>
  );
}

/** Classes and weekly timetable slots where they are the instructor. */
function ClassesSection({ schoolId, me }: { schoolId: string; me: string }) {
  const t = useT();
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
    <Section title={t('coach.dashboard.myClasses')}>
      {loading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={errorText(error, t('coach.dashboard.classesLoadFailed'))} />
      ) : weekly.length === 0 && upcoming.length === 0 ? (
        <EmptyState title={t('coach.dashboard.noClassesTitle')} description={t('coach.dashboard.noClassesDescription')} />
      ) : (
        <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))' }}>
          {weekly.length > 0 ? (
            <div>
              <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('coach.dashboard.everyWeek')}</h3>
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {weekly.map((s) => (
                  <li key={s.id}>
                    {t(WEEKDAY_LABELS[s.weekday])} {s.startTime}–{s.endTime} · {s.title}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {upcoming.length > 0 ? (
            <div>
              <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('coach.dashboard.comingUp')}</h3>
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
  const t = useT();
  const notifications = useNotifications();
  const items = (notifications.data?.items ?? []).slice(0, 5);
  const unread = (notifications.data?.items ?? []).filter((n) => !n.read).length;
  return (
    <Section
      title={t('coach.dashboard.notifications')}
      action={<Link to="/notifications">{unread > 0 ? t('coach.dashboard.seeAllUnread', { count: unread }) : t('coach.dashboard.seeAll')}</Link>}
    >
      {notifications.isLoading ? (
        <Spinner />
      ) : notifications.error ? (
        <ErrorBanner message={errorText(notifications.error, t('coach.dashboard.notificationsLoadFailed'))} />
      ) : items.length === 0 ? (
        <EmptyState title={t('coach.dashboard.noNotifications')} />
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
  const t = useT();
  const eligibility = useStudentEligibility(me, schoolId);
  const disciplines = useDisciplines(schoolId);
  const items = eligibility.data?.items ?? [];
  return (
    <Section title={t('coach.dashboard.myTraining')}>
      {eligibility.isLoading || disciplines.isLoading ? (
        <Spinner />
      ) : eligibility.error ? (
        <ErrorBanner message={errorText(eligibility.error, t('coach.dashboard.ranksLoadFailed'))} />
      ) : items.length === 0 ? (
        <EmptyState title={t('coach.dashboard.noRankTitle')} description={t('coach.dashboard.noRankDescription')} />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {items.map((item) => (
            <MyRank key={item.disciplineId} item={item} styleName={disciplines.data?.items.find((d) => d.id === item.disciplineId)?.name ?? t('coach.dashboard.styleFallback')} />
          ))}
        </ul>
      )}
    </Section>
  );
}

function MyRank({ item, styleName }: { item: StudentEligibility; styleName: string }) {
  const t = useT();
  const ranks = useRanks(item.disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const rung = ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const e = item.eligibility;
  return (
    <li style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <strong style={{ minWidth: 120 }}>{styleName}</strong>
      {rung ? <BeltChip rung={rung} /> : null}
      <span>{rung?.name ?? '—'}</span>
      {e?.hasNext ? <span className="ultm8-field__hint">{t('coach.dashboard.toNextRank', { percent: e.progressPercent ?? 0 })}</span> : null}
      {e?.hasNext && e.eligible ? <Badge variant="success">{t('coach.dashboard.readyToGrade')}</Badge> : null}
    </li>
  );
}
