import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, InlineError } from '../components/ui';
import { useAuth, useCoachSchoolId } from '../auth/AuthContext';
import { useDisciplines } from '../ranks/rankQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, minTouchTarget } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import {
  useGradingBoard,
  useMyGrading,
  useSchoolClasses,
  useSchoolTimetable,
  useStudentEligibility,
  useStyleRanks,
  type DisciplineResponse,
  type StudentEligibility,
} from './coachQueries';
import { flattenLadder } from './ladder';
import { Muted, Section } from './parts';

type Props = NativeStackScreenProps<AppStackParamList, 'CoachDashboard'>;

const WEEKDAYS = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'] as const;
const dayLabel = (d: string) => d.charAt(0) + d.slice(1).toLowerCase();
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });

/**
 * The coach's dashboard in the mobile app (Decision 184), the same as the
 * School Portal's: their grading (the styles they grade, with how many of their
 * students are ready), the classes they teach, their notifications, and their
 * own training when they also train at the School. Instructors and Branch
 * Staff land here (Decisions 184 item 4, 186); the student side is one tap away.
 */
export function CoachDashboardScreen({ navigation }: Props) {
  const schoolId = useCoachSchoolId();
  const { claims } = useAuth();
  const me = claims?.sub ?? '';
  const isStudentHere = !!claims?.grants.some((g) => g.role === 'STUDENT' && g.schoolId === schoolId);

  if (!schoolId) {
    return (
      <ScrollView contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
        <Text style={{ fontSize: fontSize.body, fontWeight: '600' }}>You're not a coach at a School yet</Text>
        <Muted>Open the invite link the School sent you to get started.</Muted>
      </ScrollView>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      <GradingSection schoolId={schoolId} onOpenStyle={(style) => navigation.navigate('GradingBoard', { schoolId, disciplineId: style.id, name: style.name })} />
      <ClassesSection schoolId={schoolId} me={me} />
      <NotificationsSection onSeeAll={() => navigation.navigate('Notifications')} />
      {isStudentHere ? <MyTrainingSection schoolId={schoolId} me={me} /> : null}
      <Button title="Student home" variant="secondary" onPress={() => navigation.navigate('Home')} />
    </ScrollView>
  );
}

function GradingSection({ schoolId, onOpenStyle }: { schoolId: string; onOpenStyle: (style: DisciplineResponse) => void }) {
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const styles = (disciplines.data?.items ?? []).filter((d) => my.mayGradeStyle(d.id));
  return (
    <Section title="Grading">
      {my.isLoading || disciplines.isLoading ? (
        <ActivityIndicator />
      ) : my.error || disciplines.error ? (
        <InlineError message={getApiErrorMessage(my.error ?? disciplines.error, 'Could not load your grading.')} />
      ) : styles.length === 0 ? (
        <Muted>No styles to grade yet. The School owner hasn't given you grading in any style.</Muted>
      ) : (
        styles.map((style) => <StyleSummary key={style.id} schoolId={schoolId} style={style} onPress={() => onOpenStyle(style)} />)
      )}
    </Section>
  );
}

function StyleSummary({ schoolId, style, onPress }: { schoolId: string; style: DisciplineResponse; onPress: () => void }) {
  const board = useGradingBoard(schoolId, style.id, false);
  const items = board.data?.items ?? [];
  const ready = items.filter((i) => i.eligibility.boardColumn === 'READY_TO_GRADE').length;
  const gettingThere = items.filter((i) => i.eligibility.boardColumn === 'GETTING_THERE').length;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open the Grading Board for ${style.name}`}
      onPress={onPress}
      style={{ minHeight: minTouchTarget, paddingVertical: spacing[2], borderBottomWidth: 1, borderBottomColor: theme.border }}
    >
      <Text style={{ fontWeight: '600', color: theme.textAccent }}>{style.name} ›</Text>
      {board.isLoading ? (
        <ActivityIndicator />
      ) : board.error ? (
        <InlineError message={getApiErrorMessage(board.error, 'Could not load this board.')} />
      ) : (
        <Muted>
          {ready} ready to grade · {gettingThere} getting there · {items.length} students
        </Muted>
      )}
    </Pressable>
  );
}

/** Weekly slots and upcoming classes where they are the instructor. */
function ClassesSection({ schoolId, me }: { schoolId: string; me: string }) {
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
    <Section title="My classes">
      {classes.isLoading || slots.isLoading ? (
        <ActivityIndicator />
      ) : error ? (
        <InlineError message={getApiErrorMessage(error, 'Could not load your classes.')} />
      ) : weekly.length === 0 && upcoming.length === 0 ? (
        <Muted>No classes yet. Classes the School assigns to you will show here.</Muted>
      ) : (
        <>
          {weekly.length > 0 ? (
            <View style={{ marginBottom: spacing[3] }}>
              <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>Every week</Text>
              {weekly.map((s) => (
                <Text key={s.id}>
                  {dayLabel(s.weekday)} {s.startTime}–{s.endTime} · {s.title}
                </Text>
              ))}
            </View>
          ) : null}
          {upcoming.length > 0 ? (
            <View>
              <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>Coming up</Text>
              {upcoming.map((c) => (
                <Text key={c.id}>
                  {shortDate(c.startDate)} · {c.title}
                </Text>
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
  const notifications = useNotifications();
  const all = notifications.data?.pages.flatMap((p) => p.items) ?? [];
  const unread = all.filter((n) => !n.read).length;
  return (
    <Section title="Notifications">
      {notifications.isLoading ? (
        <ActivityIndicator />
      ) : notifications.error ? (
        <InlineError message={getApiErrorMessage(notifications.error, 'Could not load notifications.')} />
      ) : all.length === 0 ? (
        <Muted>No notifications.</Muted>
      ) : (
        all.slice(0, 5).map((n) => (
          <View key={n.id} style={{ marginBottom: spacing[2] }}>
            <Text style={{ fontWeight: n.read ? '400' : '700' }}>{n.title}</Text>
            <Muted>{n.body}</Muted>
          </View>
        ))
      )}
      <Button title={unread > 0 ? `See all (${unread} unread)` : 'See all'} variant="secondary" onPress={onSeeAll} />
    </Section>
  );
}

/** Their own ranks, when they also train here (a coach keeps their student side, Decision 183). */
function MyTrainingSection({ schoolId, me }: { schoolId: string; me: string }) {
  const eligibility = useStudentEligibility(me, schoolId);
  const disciplines = useDisciplines(schoolId);
  const items = eligibility.data?.items ?? [];
  return (
    <Section title="My training">
      {eligibility.isLoading || disciplines.isLoading ? (
        <ActivityIndicator />
      ) : eligibility.error ? (
        <InlineError message={getApiErrorMessage(eligibility.error, 'Could not load your ranks.')} />
      ) : items.length === 0 ? (
        <Muted>No rank yet. Your ranks will show here once you're graded.</Muted>
      ) : (
        items.map((item) => (
          <MyRank key={item.disciplineId} item={item} styleName={disciplines.data?.items.find((d) => d.id === item.disciplineId)?.name ?? 'Style'} />
        ))
      )}
    </Section>
  );
}

function MyRank({ item, styleName }: { item: StudentEligibility; styleName: string }) {
  const ranks = useStyleRanks(item.disciplineId);
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const rung = ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const e = item.eligibility;
  return (
    <View style={{ marginBottom: spacing[2] }}>
      <Text style={{ fontWeight: '600' }}>{styleName}</Text>
      <Muted>
        {rung?.name ?? '—'}
        {e?.hasNext ? ` · ${e.progressPercent ?? 0}% to next rank` : ''}
        {e?.hasNext && e.eligible ? ' · Ready to grade' : ''}
      </Muted>
    </View>
  );
}
