import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { useGradingOverview, type GradingRung, type GradingStyle } from './myGradingQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'MyGrading'>;

const SKILL_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', LEARNING: 'Learning', SIGNED_OFF: 'Signed off' };

const Muted = ({ children }: { children: React.ReactNode }) => <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;

/**
 * A student's grading, read-only (Decisions 142, 155, 161): for each style at
 * each School, their belt and stripe, their progress toward the next grade
 * (always shown, "Ready to grade" included), the skills needed for it, and a
 * link to their history. A guardian opens the same screen for a linked minor
 * (Decision 132). Nothing here changes anything.
 */
export function MyGradingScreen({ route, navigation }: Props) {
  const { claims } = useAuth();
  const studentId = route.params?.studentId ?? claims?.sub ?? null;
  const overview = useGradingOverview(studentId);
  const items = overview.data?.items ?? [];

  if (overview.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (overview.error && !overview.data) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(overview.error, 'Could not load the grading — please try again.')} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {items.length === 0 ? <Muted>No rank yet. Ranks show here once the School grades you, or you declare your belt when joining.</Muted> : null}
      {items.map((item) => (
        <StyleCard
          key={`${item.schoolId}-${item.disciplineId}`}
          item={item}
          onHistory={() =>
            navigation.navigate('GradingHistory', { studentId: studentId!, schoolId: item.schoolId, title: `${item.disciplineName} history` })
          }
        />
      ))}
    </ScrollView>
  );
}

export function BeltSwatch({ rung }: { rung: GradingRung }) {
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: 36,
        height: 14,
        borderRadius: 3,
        backgroundColor: rung.primaryColour,
        borderWidth: 1,
        borderColor: rung.secondaryColour ?? theme.borderStrong,
        marginRight: spacing[2],
      }}
    />
  );
}

function StyleCard({ item, onHistory }: { item: GradingStyle; onHistory: () => void }) {
  const current = item.ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const next = item.eligibility.hasNext ? item.ladder.find((r) => r.id === item.eligibility.nextRungId) ?? null : null;
  const e = item.eligibility;
  const tick = (ok: boolean | undefined) => (ok ? '✓' : '·');
  return (
    <View
      accessibilityLabel={`${item.disciplineName} at ${item.schoolName}`}
      style={{ marginBottom: spacing[6], backgroundColor: theme.surface1, borderRadius: radius.button, padding: spacing[4], borderWidth: 1, borderColor: theme.border }}
    >
      <Text accessibilityRole="header" style={{ fontSize: fontSize.headingSm, fontWeight: '600', color: theme.textPrimary }}>
        {item.disciplineName}
      </Text>
      <Muted>{item.schoolName}</Muted>

      <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: spacing[3] }}>
        {current ? <BeltSwatch rung={current} /> : null}
        <Text style={{ fontWeight: '600', flex: 1 }}>{current?.name ?? '—'}</Text>
      </View>
      <Muted>Since {formatDate(item.dateOfCurrentRank)}</Muted>
      {item.verificationStatus === 'UNVERIFIED' ? <Muted>Waiting for the School to verify this belt.</Muted> : null}

      <View style={{ marginTop: spacing[3] }}>
        {!e.hasNext ? (
          <Muted>Top of the ladder.</Muted>
        ) : (
          <>
            <Text style={{ fontWeight: '600' }}>Next: {next?.name ?? '—'}</Text>
            <Text>{e.progressPercent ?? 0}% of the way</Text>
            {e.eligible ? (
              <Text accessibilityLabel="Ready to grade" style={{ color: theme.textSuccess, fontWeight: '600' }}>
                Ready to grade
              </Text>
            ) : null}
            {e.timeOnly ? null : e.byType && e.byType.length > 0 ? (
              e.byType.map((t) => (
                <Muted key={t.classType}>
                  {tick(t.counted >= t.required)} {t.classType}: {t.counted} of {t.required} classes
                </Muted>
              ))
            ) : (
              <Muted>
                {tick(e.classesOk)} Classes: {e.countedClasses ?? 0} of {e.requiredClasses ?? 0}
              </Muted>
            )}
            <Muted>
              {tick(e.daysOk)} Days: {e.elapsedDays ?? 0} of {e.requiredDays ?? 0}
            </Muted>
          </>
        )}
      </View>

      {item.skills.length > 0 ? (
        <View style={{ marginTop: spacing[3] }}>
          <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>{e.timeOnly ? 'Skills (optional)' : 'Skills for the next grade'}</Text>
          {item.skills.map((s) => (
            <View
              key={s.id}
              accessibilityLabel={`${s.name}: ${SKILL_LABEL[s.status] ?? s.status}`}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[1] }}
            >
              <Text style={{ flex: 1 }}>{s.name}</Text>
              <Text style={{ color: s.status === 'SIGNED_OFF' ? theme.textSuccess : theme.textSecondary }}>{SKILL_LABEL[s.status] ?? s.status}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <Button title="History" variant="secondary" onPress={onHistory} />
    </View>
  );
}
