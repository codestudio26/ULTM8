import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, InlineError, SuccessBanner, TextField } from '../components/ui';
import { useDisciplines } from '../ranks/rankQueries';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
import { theme, spacing, minTouchTarget } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import {
  useCycleSkill,
  useDowngrade,
  useLogClass,
  useMyGrading,
  usePromote,
  useRankHistory,
  useStripeAward,
  useStudentEligibility,
  useStyleRanks,
  useStyleSkills,
  useVerifyRank,
  type Eligibility,
  type PromotionEvent,
  type SkillResponse,
  type StudentEligibility,
} from './coachQueries';
import { countingClassTypes, flattenLadder, type Rung } from './ladder';
import { Muted, Section } from './parts';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';

type Props = NativeStackScreenProps<AppStackParamList, 'CoachStudent'>;

const SKILL_LABEL: Record<string, TranslationKey> = {
  NOT_STARTED: 'coach.skillStatus.notStarted',
  LEARNING: 'coach.skillStatus.learning',
  SIGNED_OFF: 'coach.skillStatus.signedOff',
};
const EVENT_LABEL: Record<string, TranslationKey> = {
  PROMOTION: 'coach.events.promotion',
  BULK_PROMOTION: 'coach.events.bulkPromotion',
  STRIPE_AWARD: 'coach.events.stripeAward',
  BULK_STRIPE_AWARD: 'coach.events.bulkStripeAward',
  DOWNGRADE: 'coach.events.downgrade',
  ADJUSTMENT: 'coach.events.adjustment',
  SELF_DECLARED: 'coach.events.selfDeclared',
  RANK_CORRECTION: 'coach.events.rankCorrection',
};

/**
 * One student's grading in one style, for a coach on a phone (Decision 184):
 * their stripe, progress to the next one, the skills for it, and their
 * history. Only the actions the coach's grading permission allows are shown
 * (Decision 181); the API checks them again. Every grade sends the stripe the
 * coach is looking at, so it's refused if someone else graded first
 * (Decision 185). Grading moves one stripe at a time here; skipping stripes,
 * back-dating and starting classes are on the web portal.
 */
export function CoachStudentScreen({ route }: Props) {
  const { schoolId, disciplineId, studentId, styleName } = route.params;
  const t = useT();
  const my = useMyGrading(schoolId);
  const eligibility = useStudentEligibility(studentId, schoolId);
  const ranks = useStyleRanks(disciplineId);
  const skills = useStyleSkills(disciplineId);
  const disciplines = useDisciplines(schoolId);
  const discipline = disciplines.data?.items.find((d) => d.id === disciplineId) ?? null;
  const ladder = useMemo(() => flattenLadder(ranks.data?.items ?? []), [ranks.data]);
  const item = eligibility.data?.items.find((i) => i.disciplineId === disciplineId) ?? null;
  const current = ladder.find((r) => r.id === item?.currentStripeId) ?? null;

  if (eligibility.isLoading || ranks.isLoading || my.isLoading) {
    return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  }
  const loadError = eligibility.error ?? ranks.error ?? my.error;
  if (loadError) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(loadError, t('coach.student.loadError'))} />
      </View>
    );
  }
  if (!item || !current) {
    return (
      <View style={{ padding: spacing[4] }}>
        <Muted>{t('coach.student.noRank', { style: styleName })}</Muted>
      </View>
    );
  }
  const can = (toggle: Parameters<typeof my.can>[1]) => my.can(disciplineId, toggle);

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }} keyboardShouldPersistTaps="handled">
      <Section title={styleName}>
        <Text style={{ fontWeight: '600' }}>{current.name}</Text>
        <Muted>{t('coach.student.since', { date: formatDate(item.dateOfCurrentRank) })}</Muted>
        {item.verificationStatus === 'UNVERIFIED' ? <Muted>{t('coach.student.unverified')}</Muted> : null}
        <Progress eligibility={item.eligibility} />
      </Section>
      <Actions studentId={studentId} disciplineId={disciplineId} item={item} ladder={ladder} current={current} skillsRequired={!!discipline?.skillsRequiredToGrade} can={can} />
      <Skills studentId={studentId} item={item} skills={skills.data?.items ?? []} canSignOff={can('canSignOffSkills')} />
      <History studentId={studentId} schoolId={schoolId} ladder={ladder} />
    </ScrollView>
  );
}

function Progress({ eligibility: e }: { eligibility: Eligibility }) {
  const t = useT();
  if (!e.hasNext) return <Muted>{t('coach.student.topOfLadder')}</Muted>;
  const tick = (ok: boolean | undefined) => (ok ? '✓' : '·');
  return (
    <View style={{ marginTop: spacing[2] }}>
      <Text>{t(e.eligible ? 'coach.student.toNextGradeReady' : 'coach.student.toNextGrade', { percent: e.progressPercent ?? 0 })}</Text>
      {e.timeOnly ? null : e.byType && e.byType.length > 0 ? (
        e.byType.map((bt) => (
          <Muted key={bt.classType}>
            {t('coach.student.classTypeLine', { tick: tick(bt.counted >= bt.required), classType: bt.classType, counted: bt.counted, count: bt.required })}
          </Muted>
        ))
      ) : (
        <Muted>{t('coach.student.classesLine', { tick: tick(e.classesOk), counted: e.countedClasses ?? 0, required: e.requiredClasses ?? 0 })}</Muted>
      )}
      <Muted>{t('coach.student.daysLine', { tick: tick(e.daysOk), elapsed: e.elapsedDays ?? 0, required: e.requiredDays ?? 0 })}</Muted>
      {(e.requiredSkillIds?.length ?? 0) > 0 ? (
        <Muted>
          {t('coach.student.skillsLine', {
            tick: tick(e.skillsOk),
            done: (e.requiredSkillIds?.length ?? 0) - (e.missingSkillIds?.length ?? 0),
            required: e.requiredSkillIds?.length ?? 0,
          })}
        </Muted>
      ) : null}
    </View>
  );
}

type Can = (toggle: 'canPromote' | 'canDowngrade' | 'canSignOffSkills' | 'canAdjustProgress' | 'canVerifyRanks') => boolean;

function Actions({
  studentId,
  disciplineId,
  item,
  ladder,
  current,
  skillsRequired,
  can,
}: {
  studentId: string;
  disciplineId: string;
  item: StudentEligibility;
  ladder: Rung[];
  current: Rung;
  skillsRequired: boolean;
  can: Can;
}) {
  const t = useT();
  const promote = usePromote(studentId, disciplineId);
  const stripeAward = useStripeAward(studentId, disciplineId);
  const downgrade = useDowngrade(studentId, disciplineId);
  const verify = useVerifyRank(studentId, disciplineId);
  const logClass = useLogClass(studentId, disciplineId);
  const [open, setOpen] = useState<'grade' | 'down' | 'log' | null>(null);
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('');
  const [acknowledged, setAcknowledged] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  const e = item.eligibility;
  const next = e.hasNext ? ladder.find((r) => r.id === e.nextRungId) ?? null : null;
  const below = current.index > 0 ? ladder[current.index - 1] : null;
  const isStripe = !!next && next.rankId === current.rankId;
  const missing = e.hasNext && !e.timeOnly ? e.missingSkillIds?.length ?? 0 : 0;
  const blockedBySkills = missing > 0 && skillsRequired;
  const needsAck = missing > 0 && !skillsRequired;
  const classTypes = countingClassTypes(ladder, current);

  const toggle = (which: 'grade' | 'down' | 'log') => {
    setOpen(open === which ? null : which);
    setError(null);
    setDone(null);
  };
  async function run(action: () => Promise<unknown>, message: string) {
    setError(null);
    try {
      await action();
      setOpen(null);
      setNote('');
      setReason('');
      setAcknowledged(false);
      setDone(message);
    } catch (err) {
      setError(getApiErrorMessage(err, t('coach.student.actionError')));
    }
  }
  const grade = () => {
    const body = { acknowledgeWithoutSkillSignoff: needsAck, expectedCurrentRungId: current.id, ...(note.trim() ? { note: note.trim() } : {}) };
    return run(() => (isStripe ? stripeAward.mutateAsync(body) : promote.mutateAsync({ ...body, targetRungId: next!.id })), t('coach.student.gradedTo', { rung: next!.name }));
  };
  const moveDown = () =>
    run(
      () => downgrade.mutateAsync({ acknowledgeWithoutSkillSignoff: false, targetRungId: below!.id, expectedCurrentRungId: current.id, reason: reason.trim() }),
      t('coach.student.movedDownTo', { rung: below!.name }),
    );

  const any = (next && can('canPromote')) || (below && can('canDowngrade')) || can('canAdjustProgress') || (item.verificationStatus === 'UNVERIFIED' && can('canVerifyRanks'));
  if (!any) return null;

  return (
    <Section title={t('coach.student.gradeTitle')}>
      {error ? <ErrorBanner message={error} /> : null}
      {done ? <SuccessBanner message={done} /> : null}
      {item.verificationStatus === 'UNVERIFIED' && can('canVerifyRanks') ? (
        <Button title={t('coach.student.verifyBelt')} loading={verify.isPending} onPress={() => run(() => verify.mutateAsync(undefined), t('coach.student.beltVerified'))} />
      ) : null}

      {next && can('canPromote') ? (
        <>
          <Button title={isStripe ? t('coach.student.awardStripe', { rung: next.name }) : t('coach.student.gradeTo', { rung: next.name })} variant={open === 'grade' ? 'secondary' : 'primary'} onPress={() => toggle('grade')} />
          {open === 'grade' ? (
            <View style={{ marginBottom: spacing[3] }}>
              {e.daysOk === false ? <Muted>{t('coach.student.tooEarly', { count: (e.requiredDays ?? 0) - (e.elapsedDays ?? 0) })}</Muted> : null}
              {blockedBySkills ? (
                <InlineError message={t('coach.student.skillsBlocked', { count: missing })} />
              ) : null}
              {needsAck ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: minTouchTarget }}>
                  <Switch value={acknowledged} onValueChange={setAcknowledged} accessibilityLabel={t('coach.student.gradeWithoutSkills')} />
                  <Text style={{ flex: 1, marginLeft: spacing[2] }}>
                    {t('coach.student.gradeWithoutSkillsDetail', { count: missing })}
                  </Text>
                </View>
              ) : null}
              <Field label={t('coach.student.note')} hint={t('coach.student.noteHint')}>
                <TextField value={note} onChangeText={setNote} maxLength={1000} accessibilityLabel={t('coach.student.note')} />
              </Field>
              <Button
                title={t('coach.student.confirm')}
                loading={promote.isPending || stripeAward.isPending}
                disabled={blockedBySkills || (needsAck && !acknowledged)}
                onPress={grade}
              />
            </View>
          ) : null}
        </>
      ) : null}

      {below && can('canDowngrade') ? (
        <>
          <Button title={t('coach.student.moveDownTo', { rung: below.name })} variant="secondary" onPress={() => toggle('down')} />
          {open === 'down' ? (
            <View style={{ marginBottom: spacing[3] }}>
              <Field label={t('coach.student.reason')} hint={t('coach.student.reasonHint')}>
                <TextField value={reason} onChangeText={setReason} maxLength={1000} accessibilityLabel={t('coach.student.reason')} />
              </Field>
              <Button title={t('coach.student.confirmMoveDown')} variant="destructive" loading={downgrade.isPending} disabled={!reason.trim()} onPress={moveDown} />
            </View>
          ) : null}
        </>
      ) : null}

      {can('canAdjustProgress') && e.hasNext && !e.timeOnly ? (
        <>
          <Button title={t('coach.student.logClass')} variant="secondary" onPress={() => (classTypes.length > 0 ? toggle('log') : run(() => logClass.mutateAsync(null), t('coach.student.classLogged')))} />
          {open === 'log' ? (
            <View style={{ marginBottom: spacing[3] }}>
              <Muted>{t('coach.student.whichClassType')}</Muted>
              {classTypes.map((ct) => (
                <Button key={ct} title={ct} variant="secondary" loading={logClass.isPending} onPress={() => run(() => logClass.mutateAsync(ct), t('coach.student.classTypeLogged', { classType: ct }))} />
              ))}
            </View>
          ) : null}
        </>
      ) : null}
    </Section>
  );
}

/** The skills for the next grade; each tap moves a skill one step (Not started → Learning → Signed off). */
function Skills({ studentId, item, skills, canSignOff }: { studentId: string; item: StudentEligibility; skills: SkillResponse[]; canSignOff: boolean }) {
  const t = useT();
  const cycle = useCycleSkill(studentId);
  const e = item.eligibility;
  const ids = [...(e.requiredSkillIds ?? []), ...(e.optionalSkillIds ?? [])];
  if (!e.hasNext || ids.length === 0) return null;
  const status = new Map(item.skillStatuses.map((s) => [s.skillId, s.status]));
  return (
    <Section title={e.timeOnly ? t('coach.student.skillsOptional') : t('coach.student.skillsForNextGrade')}>
      {cycle.isError ? <InlineError message={getApiErrorMessage(cycle.error, t('coach.student.skillError'))} /> : null}
      {ids.map((id) => {
        const skillStatus = status.get(id) ?? 'NOT_STARTED';
        const label = SKILL_LABEL[skillStatus] ? t(SKILL_LABEL[skillStatus]!) : skillStatus;
        const name = skills.find((s) => s.id === id)?.name ?? t('coach.student.skillFallback');
        return (
          <Pressable
            key={id}
            disabled={!canSignOff || cycle.isPending}
            onPress={() => cycle.mutate(id)}
            accessibilityRole={canSignOff ? 'button' : undefined}
            accessibilityLabel={t('coach.student.skillStatus', { name, status: label })}
            style={{ minHeight: minTouchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border }}
          >
            <Text style={{ flex: 1 }}>{name}</Text>
            <Text style={{ color: skillStatus === 'SIGNED_OFF' ? theme.textSuccess : theme.textSecondary }}>{label}</Text>
          </Pressable>
        );
      })}
      {!canSignOff ? <Muted>{t('coach.student.cannotSignOff')}</Muted> : null}
    </Section>
  );
}

function History({ studentId, schoolId, ladder }: { studentId: string; schoolId: string; ladder: Rung[] }) {
  const t = useT();
  const history = useRankHistory(studentId, schoolId);
  const name = (id: string | null | undefined) => ladder.find((r) => r.id === id)?.name ?? '';
  const eventLabel = (type: string) => (EVENT_LABEL[type] ? t(EVENT_LABEL[type]!) : type);
  return (
    <Section title={t('coach.student.historyTitle')}>
      {history.isLoading ? (
        <ActivityIndicator />
      ) : history.error ? (
        <InlineError message={getApiErrorMessage(history.error, t('coach.student.historyError'))} />
      ) : (history.data?.items ?? []).length === 0 ? (
        <Muted>{t('coach.student.nothingYet')}</Muted>
      ) : (
        (history.data?.items ?? []).map((ev: PromotionEvent) => (
          <View key={ev.id} style={{ marginBottom: spacing[2] }}>
            <Text style={{ fontWeight: '600' }}>
              {ev.toStripeTierId
                ? t('coach.student.eventWithRung', { event: eventLabel(ev.type), rung: name(ev.toStripeTierId) })
                : eventLabel(ev.type)}
            </Text>
            <Muted>{formatDate(ev.effectiveDate)}</Muted>
            {ev.reason ? <Muted>{t('coach.student.reasonLine', { reason: ev.reason })}</Muted> : null}
            {ev.note ? <Muted>{ev.noteHiddenAt ? t('coach.student.noteHidden', { note: ev.note }) : ev.note}</Muted> : null}
          </View>
        ))
      )}
    </Section>
  );
}
