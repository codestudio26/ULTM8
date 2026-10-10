import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ApiError } from '@ultm8/api-client';
import { Button, ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useAuth, useEnrolledSchoolIds, useIsGuardian } from '../auth/AuthContext';
import { useMyMinors } from '../guardians/guardianQueries';
import { BeltSwatch } from '../grading/MyGradingScreen';
import { theme, spacing, fontSize, fontWeight, radius, minTouchTarget } from '../theme/tokens';
import { useAcademy } from './academyQueries';
import { type DeclareStyle, useDeclareBelt, useDeclareOptions, useJoinSchool } from './joinQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'JoinSchool'>;
type Person = { studentId: string; name: string };

/** One choice in a list: a row the person taps, marked when chosen. */
function Choice({ label, selected, onPress, children }: { label: string; selected: boolean; onPress: () => void; children?: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ selected }}
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        minHeight: minTouchTarget,
        paddingHorizontal: spacing[3],
        marginBottom: spacing[1],
        borderRadius: radius.input,
        borderWidth: selected ? 2 : 1,
        borderColor: selected ? theme.fillAccent : theme.border,
      }}
    >
      {children}
      <Text style={{ flex: 1, fontSize: fontSize.body, fontWeight: selected ? fontWeight.heading : fontWeight.body }}>{label}</Text>
      {selected ? <Text style={{ color: theme.textAccent }}>✓</Text> : null}
    </Pressable>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <Text style={{ fontSize: fontSize.headingSm, fontWeight: fontWeight.heading, marginTop: spacing[4], marginBottom: spacing[2] }}>{children}</Text>;
}

/** Joining a School from the app: who is joining (oneself, or a guardian's
 * child), their home branch when the School has branches (Decisions 139, 168,
 * 209), then their current belt in each style they train (Decisions 137,
 * 147). Opened with `beltsFor` it skips straight to the belts, for someone
 * who joined earlier and hasn't added a belt yet. */
export function JoinSchoolScreen({ route, navigation }: Props) {
  const { academyId, name, beltsFor } = route.params;
  const { claims, applyAccessToken } = useAuth();
  const alreadyMine = useEnrolledSchoolIds().includes(academyId);
  const isGuardian = useIsGuardian();
  const minors = useMyMinors(isGuardian);
  const { data: academy, isLoading, error } = useAcademy(academyId);
  const join = useJoinSchool();

  const [who, setWho] = useState<Person | null>(beltsFor ?? null);
  const [branchId, setBranchId] = useState<string | null>(null);
  const [joinedAs, setJoinedAs] = useState<Person | null>(beltsFor ?? null);
  const [note, setNote] = useState<string | null>(null);

  if (joinedAs) {
    return <BeltsStep schoolId={academyId} schoolName={name} person={joinedAs} isMe={joinedAs.studentId === claims?.sub} note={note} navigation={navigation} />;
  }

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }
  if (!academy) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Failed to load this School — please try again.')} />
      </Screen>
    );
  }

  const people: Person[] = [
    ...(claims && !alreadyMine ? [{ studentId: claims.sub, name: 'Me' }] : []),
    ...(minors.data?.items ?? []).map((m) => ({ studentId: m.studentId, name: `${m.firstName} ${m.surname}` })),
  ];
  const branches = academy.branches;
  const needsBranch = branches.length > 0;
  const ready = !!who && (!needsBranch || !!branchId);

  async function onJoin() {
    if (!who || !claims) return;
    const isMe = who.studentId === claims.sub;
    try {
      const res = await join.mutateAsync({ schoolId: academyId, studentId: isMe ? undefined : who.studentId, branchId: branchId ?? undefined });
      // Joining oneself mints a token carrying the new STUDENT grant.
      if (isMe && 'accessToken' in res && typeof res.accessToken === 'string') {
        await applyAccessToken(res.accessToken);
      }
      setNote(null);
      setJoinedAs(who);
    } catch (err) {
      // Already a student here: they can still add a belt they haven't yet.
      if (err instanceof ApiError && err.status === 409) {
        setNote(`${isMe ? 'You are' : `${who.name} is`} already a student here.`);
        setJoinedAs(who);
      }
    }
  }

  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading }}>Join {academy.name}</Text>

        {people.length === 0 ? (
          <Text style={{ marginTop: spacing[3], color: theme.textSecondary }}>You are already a student here.</Text>
        ) : (
          <>
            <Heading>Who is joining?</Heading>
            <View accessibilityRole="radiogroup">
              {people.map((p) => (
                <Choice key={p.studentId} label={p.name} selected={who?.studentId === p.studentId} onPress={() => setWho(p)} />
              ))}
            </View>

            {needsBranch ? (
              <>
                <Heading>Home branch</Heading>
                <Text style={{ color: theme.textSecondary, marginBottom: spacing[2] }}>The branch you mainly train at. Its coaches look after your grading.</Text>
                <View accessibilityRole="radiogroup">
                  {branches.map((b) => (
                    <Choice key={b.id} label={b.name} selected={branchId === b.id} onPress={() => setBranchId(b.id)} />
                  ))}
                </View>
              </>
            ) : null}

            {join.isError && !(join.error instanceof ApiError && join.error.status === 409) ? (
              <ErrorBanner message={getApiErrorMessage(join.error, 'Could not join — please try again.')} />
            ) : null}
            <View style={{ marginTop: spacing[4] }}>
              <Button title="Join" onPress={onJoin} loading={join.isPending} disabled={!ready} />
            </View>
          </>
        )}
      </Screen>
    </ScrollView>
  );
}

/** "Your current belt", one choice per style; a style left on "I don't train
 * this" is not declared. Only the plain first belt counts as verified
 * straight away; any other waits for the School (Decision 147). */
function BeltsStep({
  schoolId,
  schoolName,
  person,
  isMe,
  note,
  navigation,
}: {
  schoolId: string;
  schoolName: string;
  person: Person;
  isMe: boolean;
  note: string | null;
  navigation: Props['navigation'];
}) {
  const { data, isLoading, error } = useDeclareOptions(person.studentId, schoolId);
  const declare = useDeclareBelt();
  const [chosen, setChosen] = useState<Record<string, string>>({});
  const [failed, setFailed] = useState<string | null>(null);

  function done() {
    navigation.navigate('MyGrading', isMe ? undefined : { studentId: person.studentId, name: person.name });
  }

  async function onSave(styles: DeclareStyle[]) {
    setFailed(null);
    for (const style of styles) {
      const rungId = chosen[style.disciplineId];
      const rung = style.ladder.find((r) => r.id === rungId);
      if (!rung) continue;
      try {
        await declare.mutateAsync({ studentId: person.studentId, disciplineId: style.disciplineId, rankId: rung.rankId, stripeTierId: rung.id });
      } catch (err) {
        setFailed(getApiErrorMessage(err, `Could not save the ${style.disciplineName} belt — please try again.`));
        return;
      }
    }
    done();
  }

  const styles = data?.items ?? [];
  return (
    <ScrollView>
      <Screen>
        <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading }}>
          {isMe ? 'Your current belt' : `${person.name}'s current belt`}
        </Text>
        <Text style={{ color: theme.textSecondary, marginTop: spacing[1] }}>{schoolName}</Text>
        {note ? <Text style={{ marginTop: spacing[2] }}>{note}</Text> : null}

        {isLoading ? <ActivityIndicator /> : null}
        {!isLoading && !data ? <ErrorBanner message={getApiErrorMessage(error, 'Could not load the belts — please try again.')} /> : null}

        {data && styles.length === 0 ? (
          <>
            <Text style={{ marginTop: spacing[3] }}>Nothing to add here: the School grades you from your first class.</Text>
            <View style={{ marginTop: spacing[4] }}>
              <Button title="Done" onPress={() => navigation.goBack()} />
            </View>
          </>
        ) : null}

        {styles.length > 0 ? (
          <>
            <Text style={{ marginTop: spacing[3] }}>
              Choose {isMe ? 'your' : 'their'} belt in each style {isMe ? 'you train' : 'they train'}. Never graded? Choose the first belt. Any other belt waits for the School to check it.
            </Text>
            {styles.map((style) => (
              <View key={style.disciplineId}>
                <Heading>{style.disciplineName}</Heading>
                <View accessibilityRole="radiogroup" accessibilityLabel={style.disciplineName}>
                  <Choice
                    label="I don't train this"
                    selected={!chosen[style.disciplineId]}
                    onPress={() => setChosen((c) => ({ ...c, [style.disciplineId]: '' }))}
                  />
                  {style.ladder.map((rung) => (
                    <Choice
                      key={rung.id}
                      label={rung.name}
                      selected={chosen[style.disciplineId] === rung.id}
                      onPress={() => setChosen((c) => ({ ...c, [style.disciplineId]: rung.id }))}
                    >
                      <BeltSwatch rung={rung} />
                    </Choice>
                  ))}
                </View>
              </View>
            ))}
            {failed ? <ErrorBanner message={failed} /> : null}
            <View style={{ marginTop: spacing[4], gap: spacing[2] }}>
              <Button title="Save" onPress={() => onSave(styles)} loading={declare.isPending} disabled={!Object.values(chosen).some(Boolean)} />
              <Button title="Not now" variant="secondary" onPress={() => navigation.goBack()} />
            </View>
          </>
        ) : null}
      </Screen>
    </ScrollView>
  );
}
