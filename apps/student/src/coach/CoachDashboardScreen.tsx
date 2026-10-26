import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, InlineError, SearchablePickerField } from '../components/ui';
import { useAuth, useCoachSchoolId, useCoachSchoolIds } from '../auth/AuthContext';
import { useDisciplines } from '../ranks/rankQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, minTouchTarget } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import {
  useGradingBoard,
  useMyGrading,
  useSchoolClasses,
  useSchoolNames,
  useSchoolTimetable,
  useStudentEligibility,
  useStyleRanks,
  type DisciplineResponse,
  type StudentEligibility,
} from './coachQueries';
import { flattenLadder } from './ladder';
import { Muted, Section } from './parts';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';

type Props = NativeStackScreenProps<AppStackParamList, 'CoachDashboard'>;

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const WEEKDAY_KEY: Record<string, TranslationKey> = {
  MONDAY: 'coach.dashboard.weekdays.monday',
  TUESDAY: 'coach.dashboard.weekdays.tuesday',
  WEDNESDAY: 'coach.dashboard.weekdays.wednesday',
  THURSDAY: 'coach.dashboard.weekdays.thursday',
  FRIDAY: 'coach.dashboard.weekdays.friday',
  SATURDAY: 'coach.dashboard.weekdays.saturday',
  SUNDAY: 'coach.dashboard.weekdays.sunday',
};
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * The coach's dashboard in the mobile app (Decision 184), the same as the
 * School Portal's: their grading (the styles they grade, with how many of their
 * students are ready), the classes they teach, their notifications, and their
 * own training when they also train at the School. Instructors and Branch
 * Staff land here (Decisions 184 item 4, 186); the student side is one tap away.
 */
export function CoachDashboardScreen({ navigation }: Props) {
  const t = useT();
  const schoolId = useCoachSchoolId();
  const { claims } = useAuth();
  const me = claims?.sub ?? '';
  const isStudentHere = !!claims?.grants.some((g) => g.role === 'STUDENT' && g.schoolId === schoolId);

  if (!schoolId) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
        <Text style={{ fontSize: fontSize.body, fontWeight: '600' }}>{t('coach.dashboard.notCoachTitle')}</Text>
        <Muted>{t('coach.dashboard.notCoachHint')}</Muted>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      <SchoolSwitcher />
      <GradingSection schoolId={schoolId} onOpenStyle={(style) => navigation.navigate('GradingBoard', { schoolId, disciplineId: style.id, name: style.name })} />
      <ClassesSection schoolId={schoolId} me={me} />
      <NotificationsSection onSeeAll={() => navigation.navigate('Notifications')} />
      {isStudentHere ? <MyTrainingSection schoolId={schoolId} me={me} /> : null}
      <Button title={t('coach.dashboard.studentHome')} variant="secondary" onPress={() => navigation.navigate('Home')} />
    </ScrollView>
  );
}

/** Decision 184 item 4's own named follow-up, resolved: a coach/Branch Staff
 * member with an active grant at more than one School can now pick which one
 * they're acting as. Renders nothing for the common case (one School, or
 * none) — the only screen that needs this, since every other coach screen
 * (GradingBoardScreen, CoachStudentScreen) already receives `schoolId` as a
 * navigation param from here, not from `useCoachSchoolId()` directly. */
function SchoolSwitcher() {
  const t = useT();
  const { setActiveCoachSchoolId } = useAuth();
  const schoolIds = useCoachSchoolIds();
  const activeSchoolId = useCoachSchoolId();
  const names = useSchoolNames(schoolIds);

  if (schoolIds.length < 2) return null;

  return (
    <View style={{ marginBottom: spacing[3] }}>
      <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>{t('coach.dashboard.schoolLabel')}</Text>
      <SearchablePickerField
        options={names.map((s) => ({ code: s.id, name: s.name ?? t('coach.dashboard.schoolLoading') }))}
        value={activeSchoolId ?? ''}
        onSelect={setActiveCoachSchoolId}
        triggerAccessibilityLabel={t('coach.dashboard.switchSchool')}
      />
    </View>
  );
}

function GradingSection({ schoolId, onOpenStyle }: { schoolId: string; onOpenStyle: (style: DisciplineResponse) => void }) {
  const t = useT();
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  return (
    <Section title={t('coach.dashboard.gradingTitle')}>
      {my.isLoading || disciplines.isLoading ? (
        <ActivityIndicator />
      ) : my.error || disciplines.error ? (
        <InlineError message={getApiErrorMessage(my.error ?? disciplines.error, t('coach.dashboard.gradingError'))} />
      ) : styles.length === 0 ? (
        <Muted>{t('coach.dashboard.noStyles')}</Muted>
      ) : (
        styles.map((style) => <StyleSummary key={style.id} schoolId={schoolId} style={style} onPress={() => onOpenStyle(style)} />)
      )}
    </Section>
  );
}

function StyleSummary({ schoolId, style, onPress }: { schoolId: string; style: DisciplineResponse; onPress: () => void }) {
  const t = useT();
  const board = useGradingBoard(schoolId, style.id, false);
  const items = board.data?.items ?? [];
  const ready = items.filter((i) => i.eligibility.boardColumn === 'READY_TO_GRADE').length;
  const gettingThere = items.filter((i) => i.eligibility.boardColumn === 'GETTING_THERE').length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={t('coach.dashboard.openBoard', { style: style.name })}
      onPress={onPress}
      style={{ minHeight: minTouchTarget, paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}
    >
      <Text style={{ fontWeight: '600', color: theme.textAccent }}>{t('coach.dashboard.styleLink', { style: style.name })}</Text>
      {board.isLoading ? (
        <ActivityIndicator />
      ) : board.error ? (
        <InlineError message={getApiErrorMessage(board.error, t('coach.dashboard.boardError'))} />
      ) : (
        <Muted>{t('coach.dashboard.boardSummary', { ready, gettingThere, count: items.length })}</Muted>
      )}
    </Pressable>
  );
}

/** Weekly slots and upcoming classes where they are the instructor. */
function ClassesSection({ schoolId, me }: { schoolId: string; me: string }) {
  const t = useT();
  const classes = useSchoolClasses(schoolId);
  const slots = useSchoolTimetable(schoolId);
  const weekly = useMemo(
    () =>
      (slots.data?.items ?? [])
        .filter((s) => s.instructorId === me && s.status === 'ON')
        .sort((a, b) => WEEKDAYS.indexOf(a.weekday) - WEEKDAYS.indexOf(b.weekday) || a.startTime.localeCompare(b.startTime)),
    [slots.data, me],
  );
  const upcoming = useMemo(() => {
    const now = Date.now();
    return (classes.data?.items ?? [])
      .filter((c) => c.instructorId === me && new Date(c.endDate).getTime() >= now)
      .sort((a, b) => a.startDate.localeCompare(b.startDate))
      .slice(0, 10);
  }, [classes.data, me]);
  const error = classes.error ?? slots.error;
  return (
    <Section title={t('coach.dashboard.classesTitle')}>
      {classes.isLoading || slots.isLoading ? (
        <ActivityIndicator />
      ) : error ? (
        <InlineError message={getApiErrorMessage(error, t('coach.dashboard.classesError'))} />
      ) : weekly.length === 0 && upcoming.length === 0 ? (
        <Muted>{t('coach.dashboard.noClasses')}</Muted>
      ) : (
        <>
          {weekly.length > 0 ? (
            <View style={{ marginBottom: spacing[3] }}>
              <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>{t('coach.dashboard.everyWeek')}</Text>
              {weekly.map((s) => (
                <Text key={s.id}>
                  {t('coach.dashboard.weeklySlot', {
                    day: WEEKDAY_KEY[s.weekday] ? t(WEEKDAY_KEY[s.weekday]!) : s.weekday,
                    start: s.startTime,
                    end: s.endTime,
                    title: s.title,
                  })}
                </Text>
              ))}
            </View>
          ) : null}
          {upcoming.length > 0 ? (
            <View>
              <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>{t('coach.dashboard.comingUp')}</Text>
              {upcoming.map((c) => (
                <Text key={c.id}>{t('coach.dashboard.upcomingClass', { date: shortDate(c.startDate), title: c.title })}</Text>
              ))}
            </View>
          ) : null}
        </>
      )}
    </Section>
  );
}

/** Messages are their notifications for now (Decision 184 item 2). */
function NotificationsSection({ onSeeAll }: { onSeeAll: () => void }) {
  const t = useT();
  const notifications = useNotifications();
  const all = notifications.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = all.filter((n) => !n.read).length;
  return (
    <Section title={t('coach.dashboard.notificationsTitle')}>
      {notifications.isLoading ? (
        <ActivityIndicator />
      ) : notifications.error ? (
        <InlineError message={getApiErrorMessage(notifications.error, t('coach.dashboard.notificationsError'))} />
      ) : all.length === 0 ? (
        <Muted>{t('coach.dashboard.noNotifications')}</Muted>
      ) : (
        all.slice(0, 5).map((n) => (
          <View key={n.id} style={{ marginBottom: spacing[2] }}>
            <Text style={{ fontWeight: n.read ? '400' : '700' }}>{n.title}</Text>
            <Muted>{n.body}</Muted>
          </View>
        ))
      )}
      <Button title={unread > 0 ? t('coach.dashboard.seeAllUnread', { unread }) : t('coach.dashboard.seeAll')} variant="secondary" onPress={onSeeAll} />
    </Section>
  );
}

/** Their own ranks, when they also train here (a coach keeps their student side, Decision 183). */
function MyTrainingSection({ schoolId, me }: { schoolId: string; me: string }) {
  const t = useT();
  const eligibility = useStudentEligibility(me, schoolId);
  const disciplines = useDisciplines(schoolId);
  const items = eligibility.data?.items ?? [];
  return (
    <Section title={t('coach.dashboard.trainingTitle')}>
      {eligibility.isLoading || disciplines.isLoading ? (
        <ActivityIndicator />
      ) : eligibility.error ? (
        <InlineError message={getApiErrorMessage(eligibility.error, t('coach.dashboard.ranksError'))} />
      ) : items.length === 0 ? (
        <Muted>{t('coach.dashboard.noRank')}</Muted>
      ) : (
        items.map((item) => (
          <MyRank key={item.disciplineId} item={item} styleName={disciplines.data?.items.find((d) => d.id === item.disciplineId)?.name ?? t('coach.dashboard.styleFallback')} />
        ))
      )}
    </Section>
  );
}

function MyRank({ item, styleName }: { item: StudentEligibility; styleName: string }) {
  const t = useT();
  const ranks = useStyleRanks(item.disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const rung = ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const e = item.eligibility;
  return (
    <View style={{ marginBottom: spacing[2] }}>
      <Text style={{ fontWeight: '600' }}>{styleName}</Text>
      <Muted>
        {e?.hasNext
          ? t(e.eligible ? 'coach.dashboard.rankProgressReady' : 'coach.dashboard.rankProgress', { rung: rung?.name ?? '—', percent: e.progressPercent ?? 0 })
          : rung?.name ?? '—'}
      </Muted>
    </View>
  );
}
