import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { formatMoney } from '../lib/formatMoney';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { useAnswerFee, useGradingOverview, useMyFeeRequests, type FeeRequest, type GradingRung, type GradingStyle } from './myGradingQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'MyGrading'>;

const SKILL_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', LEARNING: 'Learning', SIGNED_OFF: 'Signed off' };

const Muted = ({ children }: { children: React.ReactNode }) => <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;

/**
 * A student's grading, read-only (Decisions 142, 155, 161): for each style at
 * each School, their belt and stripe, their progress toward the next grade
 * (always shown, "Ready to grade" included) with the breakdown per
 * requirement, hours trained (a record only, Decision 306), the skills needed
 * for it, and a link to their history. A guardian opens the same screen for a
 * linked minor (Decision 132). The one thing to answer here is a promotion
 * fee (Decisions 287, 300): accept or decline; nothing is charged by it.
 */
export function MyGradingScreen({ route, navigation }: Props) {
  const { claims } = useAuth();
  const studentId = route.params?.studentId ?? claims?.sub ?? null;
  const overview = useGradingOverview(studentId);
  const fees = useMyFeeRequests(studentId);
  const items = overview.data?.items ?? [];
  // A guardian sees their child's fees: "Ben was graded to …".
  const childName = route.params?.name ?? null;
  const feeItems = (fees.data?.items ?? []).filter((r) => (r.status === 'PENDING' || r.status === 'ACCEPTED') && !r.toDecide);

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
      {feeItems.map((r) => (
        <FeeCard key={r.id} request={r} studentId={studentId} childName={childName} />
      ))}
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
            <Breakdown item={item} />
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

      <HoursTrained item={item} />

      <Button title="History" variant="secondary" onPress={onHistory} />
    </View>
  );
}

const tick = (ok: boolean) => (ok ? '✓' : '·');

/** The same breakdown as the portal's Ranks tab: one line per requirement
 * grading uses, and whether it is in the % (classes; days on a time-only rank). */
function Breakdown({ item }: { item: GradingStyle }) {
  const e = item.eligibility;
  const b = item.progressBreakdown;
  if (!b) return null;
  return (
    <View style={{ marginTop: spacing[2] }}>
      {b.classes ? (
        <>
          <Muted>
            {tick(b.classes.counted >= b.classes.required)} Classes: {b.classes.counted} of {b.classes.required} · {b.classes.percent}% · counts toward the %
          </Muted>
          {b.classes.byType.map((t) => (
            <Muted key={t.classType}>
              {'   '}
              {tick(t.counted >= t.required)} {t.classType}: {t.counted} of {t.required} classes
            </Muted>
          ))}
        </>
      ) : null}
      <Muted>
        {tick(b.days.elapsed >= b.days.required)} Days at this rank: {b.days.required > 0 ? `${b.days.elapsed} of ${b.days.required}` : `${b.days.elapsed} (no minimum)`} · {b.days.percent}%
        {b.classes ? (b.days.required > 0 ? ' · needed too, not in the %' : '') : ' · counts toward the %'}
      </Muted>
      {b.skills && b.skills.required > 0 ? (
        <Muted>
          {tick(b.skills.signedOff >= b.skills.required)} Skills signed off: {b.skills.signedOff} of {b.skills.required} · {b.skills.percent}% · needed too, not in the %
        </Muted>
      ) : null}
      <Muted>{e.timeOnly ? 'The % is days at this rank out of days required.' : 'The % is classes out of classes required.'}</Muted>
    </View>
  );
}

/** Minutes as hours, at most one decimal (90 → "1.5"). */
function hours(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10);
}

function HoursTrained({ item }: { item: GradingStyle }) {
  if (!item.hoursTrained) return null;
  return (
    <View accessibilityLabel="Hours trained" style={{ marginTop: spacing[3], borderTopWidth: 1, borderTopColor: theme.border, paddingTop: spacing[2] }}>
      <Text style={{ fontWeight: '600' }}>Hours trained</Text>
      <Text>
        {hours(item.hoursTrained.sinceCurrentRankMinutes)} h at this rank · {hours(item.hoursTrained.totalMinutes)} h in all
      </Text>
      <Muted>A record of your time on the mat. Grading doesn't use it.</Muted>
    </View>
  );
}

/** A promotion fee to answer (Decisions 287, 300): the grade, the price and
 * Accept / Decline (Decline asks again). Accepting charges nothing by itself:
 * the School takes the payment, and the promotion goes through once it is paid. */
function FeeCard({ request: r, studentId, childName }: { request: FeeRequest; studentId: string | null; childName: string | null }) {
  const answer = useAnswerFee(studentId);
  const [open, setOpen] = useState(false);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const amount = formatMoney(r.amountMinor, r.currency);
  const who = childName ? `${childName} was` : 'You were';
  const graded = r.gradingDate ? formatDate(r.gradingDate) : formatDate(r.createdAt);
  const send = (a: 'accept' | 'decline') => answer.mutate({ id: r.id, answer: a }, { onSuccess: () => setConfirmingDecline(false) });

  return (
    <View
      accessibilityLabel={`Promotion fee: ${r.toRungName}`}
      style={{ marginBottom: spacing[4], backgroundColor: theme.bgWarning, borderRadius: radius.button, padding: spacing[4] }}
    >
      <Text accessibilityRole="header" style={{ fontWeight: '600', color: theme.textWarning }}>
        Promotion fee
      </Text>
      <Text style={{ fontWeight: '600', marginTop: spacing[1] }}>
        {who} graded to {r.toRungName}
      </Text>
      <Muted>
        {[r.disciplineName, r.schoolName].filter(Boolean).join(' at ')} · {amount}
      </Muted>
      {answer.error ? <ErrorBanner message={getApiErrorMessage(answer.error, 'Could not send your answer — please try again.')} /> : null}
      {r.status === 'ACCEPTED' ? (
        <Muted>
          You accepted the fee. The promotion to {r.toRungName} goes through once it is paid. Pay at the desk or as the School asks.
        </Muted>
      ) : !open ? (
        <Button title="See and answer" variant="secondary" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ marginTop: spacing[2] }}>
          <Text>Graded on {graded}.</Text>
          <Text style={{ marginTop: spacing[1] }}>
            Nothing is charged until you accept it. {childName ? `${childName}'s` : 'Your'} promotion goes through once the fee is accepted and paid.
          </Text>
          {confirmingDecline ? (
            <>
              <Text style={{ color: theme.textDanger, marginTop: spacing[2] }}>
                Decline the {amount} fee? The School is told, and the promotion to {r.toRungName} doesn't go ahead.
              </Text>
              <Button title="Yes, decline" variant="destructive" loading={answer.isPending} onPress={() => send('decline')} />
              <Button title="Keep it" variant="secondary" onPress={() => setConfirmingDecline(false)} />
            </>
          ) : (
            <>
              <Button title={`Accept ${amount}`} loading={answer.isPending} onPress={() => send('accept')} />
              <Button title="Decline" variant="secondary" onPress={() => setConfirmingDecline(true)} />
            </>
          )}
        </View>
      )}
    </View>
  );
}
