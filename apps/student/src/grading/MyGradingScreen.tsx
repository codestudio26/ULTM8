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
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';
import { useAnswerFee, useGradingOverview, useMyCorrections, useMyFeeRequests, type FeeRequest, type GradingStyle, type RankCorrection } from './myGradingQueries';
import { CorrectionCard } from './CorrectionCard';
import { BeltSwatch } from './BeltSwatch';

type Props = NativeStackScreenProps<AppStackParamList, 'MyGrading'>;

const SKILL_LABEL: Record<string, TranslationKey> = {
  NOT_STARTED: 'grading.skillStatus.notStarted',
  LEARNING: 'grading.skillStatus.learning',
  SIGNED_OFF: 'grading.skillStatus.signedOff',
};

const Muted = ({ children }: { children: React.ReactNode }) => <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;

/**
 * A student's grading, read-only (Decisions 142, 155, 161): for each style at
 * each School, their belt and stripe, their progress toward the next grade
 * (always shown, "Ready to grade" included) with the breakdown per
 * requirement, hours trained (a record only, Decision 306), the skills needed
 * for it, and a link to their history. A guardian opens the same screen for a
 * linked minor (Decision 132). The one thing to answer here is a promotion
 * fee (Decisions 287, 300): accept or decline; nothing is charged by it. A
 * student can also ask the School to correct a wrong belt (backlog 3.13).
 */
export function MyGradingScreen({ route, navigation }: Props) {
  const { claims } = useAuth();
  const t = useT();
  const studentId = route.params?.studentId ?? claims?.sub ?? null;
  // Only the student asks for their own belt to be corrected (Decision 286), not a guardian.
  const isSelf = !!studentId && studentId === claims?.sub;
  const overview = useGradingOverview(studentId);
  const corrections = useMyCorrections(isSelf);
  const latestCorrection = (disciplineId: string): RankCorrection | null => (corrections.data?.items ?? []).find((c) => c.disciplineId === disciplineId) ?? null;
  const fees = useMyFeeRequests(studentId);
  const items = overview.data?.items ?? [];
  // A guardian sees their child's fees: "Ben was graded to …".
  const childName = route.params?.name ?? null;
  const feeItems = (fees.data?.items ?? []).filter((r) => (r.status === 'PENDING' || r.status === 'ACCEPTED') && !r.toDecide);

  if (overview.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (overview.error && !overview.data) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(overview.error, t('grading.myGrading.loadError'))} />
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {feeItems.map((r) => (
        <FeeCard key={r.id} request={r} studentId={studentId} childName={childName} initiallyOpen={r.id === route.params?.openFeeId} />
      ))}
      {items.length === 0 ? <Muted>{t('grading.myGrading.noRank')}</Muted> : null}
      {items.map((item) => (
        <StyleCard
          key={`${item.schoolId}-${item.disciplineId}`}
          item={item}
          correction={isSelf && item.verificationStatus === 'VERIFIED' && !item.archived ? { latest: latestCorrection(item.disciplineId) } : null}
          onHistory={() =>
            navigation.navigate('GradingHistory', { studentId: studentId!, schoolId: item.schoolId, title: t('grading.myGrading.historyTitle', { style: item.disciplineName }) })
          }
        />
      ))}
    </ScrollView>
  );
}

export { BeltSwatch };

function StyleCard({ item, correction, onHistory }: { item: GradingStyle; correction: { latest: RankCorrection | null } | null; onHistory: () => void }) {
  const t = useT();
  const current = item.ladder.find((r) => r.id === item.currentStripeId) ?? null;
  const next = item.eligibility.hasNext ? item.ladder.find((r) => r.id === item.eligibility.nextRungId) ?? null : null;
  const e = item.eligibility;
  const skillLabel = (status: string) => (SKILL_LABEL[status] ? t(SKILL_LABEL[status]!) : status);
  return (
    <View
      accessibilityLabel={t('grading.myGrading.styleAtSchool', { style: item.disciplineName, school: item.schoolName })}
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
      <Muted>{t('grading.myGrading.since', { date: formatDate(item.dateOfCurrentRank) })}</Muted>
      {item.verificationStatus === 'UNVERIFIED' ? <Muted>{t('grading.myGrading.unverified')}</Muted> : null}

      <View style={{ marginTop: spacing[3] }}>
        {item.archived ? (
          // The School no longer teaches this style (Decisions 309, 310): the
          // belt and history stay, with nothing left to work toward.
          <Muted>{t('grading.myGrading.noLongerTaught')}</Muted>
        ) : !e.hasNext ? (
          <Muted>{t('grading.myGrading.topOfLadder')}</Muted>
        ) : (
          <>
            <Text style={{ fontWeight: '600' }}>{t('grading.myGrading.next', { rank: next?.name ?? '—' })}</Text>
            <Text>{t('grading.myGrading.progress', { percent: e.progressPercent ?? 0 })}</Text>
            {e.eligible ? (
              <Text accessibilityLabel={t('grading.myGrading.readyToGrade')} style={{ color: theme.textSuccess, fontWeight: '600' }}>
                {t('grading.myGrading.readyToGrade')}
              </Text>
            ) : null}
            <Breakdown item={item} />
          </>
        )}
      </View>

      {item.skills.length > 0 ? (
        <View style={{ marginTop: spacing[3] }}>
          <Text style={{ fontWeight: '600', marginBottom: spacing[1] }}>{e.timeOnly ? t('grading.myGrading.skillsOptional') : t('grading.myGrading.skillsForNextGrade')}</Text>
          {item.skills.map((s) => (
            <View
              key={s.id}
              accessibilityLabel={t('grading.myGrading.skillStatus', { name: s.name, status: skillLabel(s.status) })}
              style={{ flexDirection: 'row', justifyContent: 'space-between', paddingVertical: spacing[1] }}
            >
              <Text style={{ flex: 1 }}>{s.name}</Text>
              <Text style={{ color: s.status === 'SIGNED_OFF' ? theme.textSuccess : theme.textSecondary }}>{skillLabel(s.status)}</Text>
            </View>
          ))}
        </View>
      ) : null}

      <HoursTrained item={item} />

      {correction ? <CorrectionCard item={item} latest={correction.latest} /> : null}

      <Button title={t('grading.myGrading.history')} variant="secondary" onPress={onHistory} />
    </View>
  );
}

const tick = (ok: boolean) => (ok ? '✓' : '·');

/** The same breakdown as the portal's Ranks tab: one line per requirement
 * grading uses, and whether it is in the % (classes; days on a time-only rank). */
function Breakdown({ item }: { item: GradingStyle }) {
  const t = useT();
  const e = item.eligibility;
  const b = item.progressBreakdown;
  if (!b) return null;
  return (
    <View style={{ marginTop: spacing[2] }}>
      {b.classes ? (
        <>
          <Muted>
            {t('grading.breakdown.classes', {
              tick: tick(b.classes.counted >= b.classes.required),
              counted: b.classes.counted,
              required: b.classes.required,
              percent: b.classes.percent,
            })}
          </Muted>
          {b.classes.byType.map((bt) => (
            <Muted key={bt.classType}>
              {'   '}
              {t('grading.breakdown.classType', { tick: tick(bt.counted >= bt.required), classType: bt.classType, counted: bt.counted, count: bt.required })}
            </Muted>
          ))}
        </>
      ) : null}
      <Muted>
        {t(
          b.classes
            ? b.days.required > 0
              ? 'grading.breakdown.daysNeededToo'
              : 'grading.breakdown.daysNoMinimum'
            : b.days.required > 0
              ? 'grading.breakdown.daysCounts'
              : 'grading.breakdown.daysNoMinimumCounts',
          { tick: tick(b.days.elapsed >= b.days.required), elapsed: b.days.elapsed, required: b.days.required, percent: b.days.percent },
        )}
      </Muted>
      {b.skills && b.skills.required > 0 ? (
        <Muted>
          {t('grading.breakdown.skills', {
            tick: tick(b.skills.signedOff >= b.skills.required),
            signedOff: b.skills.signedOff,
            required: b.skills.required,
            percent: b.skills.percent,
          })}
        </Muted>
      ) : null}
      <Muted>{e.timeOnly ? t('grading.breakdown.timeOnlyNote') : t('grading.breakdown.classesNote')}</Muted>
    </View>
  );
}

/** Minutes as hours, at most one decimal (90 → "1.5"). */
function hours(minutes: number): string {
  return String(Math.round((minutes / 60) * 10) / 10);
}

function HoursTrained({ item }: { item: GradingStyle }) {
  const t = useT();
  if (!item.hoursTrained) return null;
  return (
    <View accessibilityLabel={t('grading.hours.title')} style={{ marginTop: spacing[3], borderTopWidth: 1, borderTopColor: theme.border, paddingTop: spacing[2] }}>
      <Text style={{ fontWeight: '600' }}>{t('grading.hours.title')}</Text>
      <Text>{t('grading.hours.summary', { atRank: hours(item.hoursTrained.sinceCurrentRankMinutes), total: hours(item.hoursTrained.totalMinutes) })}</Text>
      <Muted>{t('grading.hours.note')}</Muted>
    </View>
  );
}

/** A promotion fee to answer (Decisions 287, 300): the grade, the price and
 * Accept / Decline (Decline asks again). Accepting charges nothing by itself:
 * the School takes the payment, and the promotion goes through once it is paid. */
function FeeCard({
  request: r,
  studentId,
  childName,
  initiallyOpen = false,
}: {
  request: FeeRequest;
  studentId: string | null;
  childName: string | null;
  initiallyOpen?: boolean;
}) {
  const t = useT();
  const answer = useAnswerFee(studentId);
  const [open, setOpen] = useState(initiallyOpen);
  const [confirmingDecline, setConfirmingDecline] = useState(false);
  const amount = formatMoney(r.amountMinor, r.currency);
  const graded = r.gradingDate ? formatDate(r.gradingDate) : formatDate(r.createdAt);
  const send = (a: 'accept' | 'decline') => answer.mutate({ id: r.id, answer: a }, { onSuccess: () => setConfirmingDecline(false) });

  return (
    <View
      accessibilityLabel={t('grading.fee.a11yLabel', { rank: r.toRungName })}
      style={{ marginBottom: spacing[4], backgroundColor: theme.bgWarning, borderRadius: radius.button, padding: spacing[4] }}
    >
      <Text accessibilityRole="header" style={{ fontWeight: '600', color: theme.textWarning }}>
        {t('grading.fee.title')}
      </Text>
      <Text style={{ fontWeight: '600', marginTop: spacing[1] }}>
        {childName ? t('grading.fee.gradedChild', { name: childName, rank: r.toRungName }) : t('grading.fee.gradedSelf', { rank: r.toRungName })}
      </Text>
      <Muted>
        {r.disciplineName && r.schoolName
          ? t('grading.fee.styleAtSchoolAmount', { style: r.disciplineName, school: r.schoolName, amount })
          : t('grading.fee.placeAmount', { place: r.disciplineName || r.schoolName || '', amount })}
      </Muted>
      {answer.error ? <ErrorBanner message={getApiErrorMessage(answer.error, t('grading.fee.answerError'))} /> : null}
      {r.status === 'ACCEPTED' ? (
        <Muted>{t('grading.fee.accepted', { rank: r.toRungName })}</Muted>
      ) : !open ? (
        <Button title={t('grading.fee.seeAndAnswer')} variant="secondary" onPress={() => setOpen(true)} />
      ) : (
        <View style={{ marginTop: spacing[2] }}>
          <Text>{t('grading.fee.gradedOn', { date: graded })}</Text>
          <Text style={{ marginTop: spacing[1] }}>
            {childName ? t('grading.fee.nothingChargedChild', { name: childName }) : t('grading.fee.nothingChargedSelf')}
          </Text>
          {confirmingDecline ? (
            <>
              <Text style={{ color: theme.textDanger, marginTop: spacing[2] }}>
                {t('grading.fee.confirmDecline', { amount, rank: r.toRungName })}
              </Text>
              <Button title={t('grading.fee.yesDecline')} variant="destructive" loading={answer.isPending} onPress={() => send('decline')} />
              <Button title={t('grading.fee.keepIt')} variant="secondary" onPress={() => setConfirmingDecline(false)} />
            </>
          ) : (
            <>
              <Button title={t('grading.fee.accept', { amount })} loading={answer.isPending} onPress={() => send('accept')} />
              <Button title={t('grading.fee.decline')} variant="secondary" onPress={() => setConfirmingDecline(true)} />
            </>
          )}
        </View>
      )}
    </View>
  );
}
