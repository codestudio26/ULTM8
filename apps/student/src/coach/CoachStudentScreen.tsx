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

type Props = NativeStackScreenProps<AppStackParamList, 'CoachStudent'>;

const SKILL_LABEL: Record<string, string> = { NOT_STARTED: 'Not started', LEARNING: 'Learning', SIGNED_OFF: 'Signed off' };
const EVENT_LABEL: Record<string, string> = {
  PROMOTION: 'Promoted',
  BULK_PROMOTION: 'Promoted (bulk)',
  STRIPE_AWARD: 'Stripe awarded',
  BULK_STRIPE_AWARD: 'Stripe awarded (bulk)',
  DOWNGRADE: 'Moved down',
  ADJUSTMENT: 'Progress adjusted',
  SELF_DECLARED: 'Belt declared',
  RANK_CORRECTION: 'Belt corrected',
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
        <ErrorBanner message={getApiErrorMessage(loadError, 'Could not load this student.')} />
      </View>
    );
  }
  if (!item || !current) {
    return (
      <View style={{ padding: spacing[4] }}>
        <Muted>No rank in {styleName} yet. Give a first rank from the web portal.</Muted>
      </View>
    );
  }
  const can = (t: Parameters<typeof my.can>[1]) => my.can(disciplineId, t);

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }} keyboardShouldPersistTaps="handled">
      <Section title={styleName}>
        <Text style={{ fontWeight: '600' }}>{current.name}</Text>
        <Muted>Since {formatDate(item.dateOfCurrentRank)}</Muted>
        {item.verificationStatus === 'UNVERIFIED' ? <Muted>Declared by the student, not verified yet.</Muted> : null}
        <Progress eligibility={item.eligibility} />
      </Section>
      <Actions studentId={studentId} disciplineId={disciplineId} item={item} ladder={ladder} current={current} skillsRequired={!!discipline?.skillsRequiredToGrade} can={can} />
      <Skills studentId={studentId} item={item} skills={skills.data?.items ?? []} canSignOff={can('canSignOffSkills')} />
      <History studentId={studentId} schoolId={schoolId} ladder={ladder} />
    </ScrollView>
  );
}

function Progress({ eligibility: e }: { eligibility: Eligibility }) {
  if (!e.hasNext) return <Muted>Top of the ladder: no next grade.</Muted>;
  const tick = (ok: boolean | undefined) => (ok ? '✓' : '·');
  return (
    <View style={{ marginTop: spacing[2] }}>
      <Text>
        {e.progressPercent ?? 0}% to the next grade{e.eligible ? ' · Ready to grade' : ''}
      </Text>
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
      {(e.requiredSkillIds?.length ?? 0) > 0 ? (
        <Muted>
          {tick(e.skillsOk)} Skills: {(e.requiredSkillIds?.length ?? 0) - (e.missingSkillIds?.length ?? 0)} of {e.requiredSkillIds?.length}
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
      setError(getApiErrorMessage(err, 'That didn\'t work. Please try again.'));
    }
  }
  const grade = () => {
    const body = { acknowledgeWithoutSkillSignoff: needsAck, expectedCurrentRungId: current.id, ...(note.trim() ? { note: note.trim() } : {}) };
    return run(() => (isStripe ? stripeAward.mutateAsync(body) : promote.mutateAsync({ ...body, targetRungId: next!.id })), `Graded to ${next!.name}.`);
  };
  const moveDown = () =>
    run(
      () => downgrade.mutateAsync({ acknowledgeWithoutSkillSignoff: false, targetRungId: below!.id, expectedCurrentRungId: current.id, reason: reason.trim() }),
      `Moved down to ${below!.name}.`,
    );

  const any = (next && can('canPromote')) || (below && can('canDowngrade')) || can('canAdjustProgress') || (item.verificationStatus === 'UNVERIFIED' && can('canVerifyRanks'));
  if (!any) return null;

  return (
    <Section title="Grade">
      {error ? <ErrorBanner message={error} /> : null}
      {done ? <SuccessBanner message={done} /> : null}
      {item.verificationStatus === 'UNVERIFIED' && can('canVerifyRanks') ? (
        <Button title="Verify belt" loading={verify.isPending} onPress={() => run(() => verify.mutateAsync(undefined), 'Belt verified.')} />
      ) : null}

      {next && can('canPromote') ? (
        <>
          <Button title={isStripe ? `Award stripe: ${next.name}` : `Grade to ${next.name}`} variant={open === 'grade' ? 'secondary' : 'primary'} onPress={() => toggle('grade')} />
          {open === 'grade' ? (
            <View style={{ marginBottom: spacing[3] }}>
              {e.daysOk === false ? <Muted>Too early: {(e.requiredDays ?? 0) - (e.elapsedDays ?? 0)} days short of the minimum.</Muted> : null}
              {blockedBySkills ? (
                <InlineError message={`${missing} skill${missing === 1 ? '' : 's'} not signed off. This style needs every skill signed off before grading.`} />
              ) : null}
              {needsAck ? (
                <View style={{ flexDirection: 'row', alignItems: 'center', minHeight: minTouchTarget }}>
                  <Switch value={acknowledged} onValueChange={setAcknowledged} accessibilityLabel="Grade without all skills signed off" />
                  <Text style={{ flex: 1, marginLeft: spacing[2] }}>
                    Grade without all skills signed off ({missing} missing). This is recorded on the history.
                  </Text>
                </View>
              ) : null}
              <Field label="Note" hint="Optional. Shown on the history.">
                <TextField value={note} onChangeText={setNote} maxLength={1000} accessibilityLabel="Note" />
              </Field>
              <Button
                title="Confirm"
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
          <Button title={`Move down to ${below.name}`} variant="secondary" onPress={() => toggle('down')} />
          {open === 'down' ? (
            <View style={{ marginBottom: spacing[3] }}>
              <Field label="Reason" hint="Required. Shown on the student's history.">
                <TextField value={reason} onChangeText={setReason} maxLength={1000} accessibilityLabel="Reason" />
              </Field>
              <Button title="Confirm move down" variant="destructive" loading={downgrade.isPending} disabled={!reason.trim()} onPress={moveDown} />
            </View>
          ) : null}
        </>
      ) : null}

      {can('canAdjustProgress') && e.hasNext && !e.timeOnly ? (
        <>
          <Button title="Log a class" variant="secondary" onPress={() => (classTypes.length > 0 ? toggle('log') : run(() => logClass.mutateAsync(null), 'Class logged.'))} />
          {open === 'log' ? (
            <View style={{ marginBottom: spacing[3] }}>
              <Muted>Which class type?</Muted>
              {classTypes.map((t) => (
                <Button key={t} title={t} variant="secondary" loading={logClass.isPending} onPress={() => run(() => logClass.mutateAsync(t), `${t} class logged.`)} />
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
  const cycle = useCycleSkill(studentId);
  const e = item.eligibility;
  const ids = [...(e.requiredSkillIds ?? []), ...(e.optionalSkillIds ?? [])];
  if (!e.hasNext || ids.length === 0) return null;
  const status = new Map(item.skillStatuses.map((s) => [s.skillId, s.status]));
  return (
    <Section title={e.timeOnly ? 'Skills (optional)' : 'Skills for the next grade'}>
      {cycle.isError ? <InlineError message={getApiErrorMessage(cycle.error, 'Could not change that skill.')} /> : null}
      {ids.map((id) => {
        const label = SKILL_LABEL[status.get(id) ?? 'NOT_STARTED'];
        const name = skills.find((s) => s.id === id)?.name ?? 'Skill';
        return (
          <Pressable
            key={id}
            disabled={!canSignOff || cycle.isPending}
            onPress={() => cycle.mutate(id)}
            accessibilityRole={canSignOff ? 'button' : undefined}
            accessibilityLabel={`${name}: ${label}`}
            style={{ minHeight: minTouchTarget, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', borderBottomWidth: 1, borderBottomColor: theme.border }}
          >
            <Text style={{ flex: 1 }}>{name}</Text>
            <Text style={{ color: label === 'Signed off' ? theme.textSuccess : theme.textSecondary }}>{label}</Text>
          </Pressable>
        );
      })}
      {!canSignOff ? <Muted>You can't sign off skills in this style.</Muted> : null}
    </Section>
  );
}

function History({ studentId, schoolId, ladder }: { studentId: string; schoolId: string; ladder: Rung[] }) {
  const history = useRankHistory(studentId, schoolId);
  const name = (id: string | null | undefined) => ladder.find((r) => r.id === id)?.name ?? '';
  return (
    <Section title="History">
      {history.isLoading ? (
        <ActivityIndicator />
      ) : history.error ? (
        <InlineError message={getApiErrorMessage(history.error, 'Could not load the history.')} />
      ) : (history.data?.items ?? []).length === 0 ? (
        <Muted>Nothing yet.</Muted>
      ) : (
        (history.data?.items ?? []).map((ev: PromotionEvent) => (
          <View key={ev.id} style={{ marginBottom: spacing[2] }}>
            <Text style={{ fontWeight: '600' }}>
              {EVENT_LABEL[ev.type] ?? ev.type}
              {ev.toStripeTierId ? `: ${name(ev.toStripeTierId)}` : ''}
            </Text>
            <Muted>{formatDate(ev.effectiveDate)}</Muted>
            {ev.reason ? <Muted>Reason: {ev.reason}</Muted> : null}
            {ev.note ? <Muted>{ev.noteHiddenAt ? `${ev.note} (hidden from the student)` : ev.note}</Muted> : null}
          </View>
        ))
      )}
    </Section>
  );
}
