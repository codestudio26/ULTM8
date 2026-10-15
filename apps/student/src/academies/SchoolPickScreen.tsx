import React, { useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError, type components } from '@ultm8/api-client';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useAuth } from '../auth/AuthContext';
import { theme, spacing, fontSize, fontWeight, radius, minTouchTarget } from '../theme/tokens';
import { useSchoolByJoinCode, useSchoolSearch } from './publicSchoolQueries';

type AcademySummary = components['schemas']['AcademySummaryDto'];
type Mode = 'search' | 'code';

/**
 * Decision 266 — Apple 4.2.6/4.3 compliance (Decision 247's "one shared app,
 * School picked after install"). The very first screen a brand-new installer
 * sees, ahead of login/signup (RootNavigator's own three-way branch) — the
 * product owner's own confirmed sequencing ("pick School first, then sign
 * up"). Both modes the product owner approved (search by name, enter a join
 * code) live on this one screen as a toggle, not two separate navigation
 * destinations — there's nothing else to navigate between before a School is
 * picked.
 *
 * Picking a School here only records the INTENT (AuthContext's
 * pendingSchoolPick, persisted) — it does not itself create a STUDENT
 * RoleGrant. That happens after Register → VerifyOtp → Login, when
 * AppNavigator's own initial-route logic routes a signed-in Student with a
 * still-pending pick straight to JoinSchoolScreen (the existing, real join
 * flow: who's joining, home branch, current belt).
 */
export function SchoolPickScreen() {
  const [mode, setMode] = useState<Mode>('search');
  const { setPendingSchoolPick } = useAuth();

  function pick(school: { id: string; name: string }) {
    setPendingSchoolPick(school);
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading, marginBottom: 4 }}>Find your School</Text>
        <Text style={{ fontSize: fontSize.body, color: theme.textSecondary, marginBottom: spacing[4] }}>
          Search by name, or enter the join code your School gave you.
        </Text>

        <View style={{ flexDirection: 'row', marginBottom: spacing[4], borderRadius: radius.input, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
          <ModeTab label="Search" selected={mode === 'search'} onPress={() => setMode('search')} />
          <ModeTab label="Join code" selected={mode === 'code'} onPress={() => setMode('code')} />
        </View>

        {mode === 'search' ? <SearchMode onPick={pick} /> : <JoinCodeMode onPick={pick} />}
      </Screen>
    </ScrollView>
  );
}

function ModeTab({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="tab"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        flex: 1,
        minHeight: minTouchTarget,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: selected ? theme.fillAccent : theme.surface1,
      }}
    >
      <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.emphasis, color: selected ? theme.onAccent : theme.textPrimary }}>{label}</Text>
    </Pressable>
  );
}

function SchoolRow({ school, onPress }: { school: { id: string; name: string; address?: string | null }; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ minHeight: minTouchTarget, paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}
    >
      <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.emphasis }}>{school.name}</Text>
      {school.address ? <Text style={{ color: theme.textSecondary, marginTop: 2 }}>{school.address}</Text> : null}
    </Pressable>
  );
}

function SearchMode({ onPick }: { onPick: (school: { id: string; name: string }) => void }) {
  const [query, setQuery] = useState('');
  const { data, isLoading, isFetching, error } = useSchoolSearch(query);

  return (
    <View>
      <Field label="School name">
        <TextField value={query} onChangeText={setQuery} placeholder="e.g. Downtown Jiu-Jitsu" autoCapitalize="words" />
      </Field>

      {query.trim() && isLoading ? <ActivityIndicator style={{ marginTop: spacing[3] }} /> : null}
      {error ? <ErrorBanner message={getApiErrorMessage(error, 'Could not search — please try again.')} /> : null}
      {!isLoading && query.trim() && data?.items.length === 0 ? (
        <Text style={{ color: theme.textSecondary, marginTop: spacing[3] }}>No School matched “{query.trim()}”.</Text>
      ) : null}

      <View style={{ marginTop: spacing[2], opacity: isFetching && !isLoading ? 0.6 : 1 }}>
        {(data?.items ?? []).map((item: AcademySummary) => (
          <SchoolRow key={item.id} school={item} onPress={() => onPick({ id: item.id, name: item.name })} />
        ))}
      </View>
    </View>
  );
}

function JoinCodeMode({ onPick }: { onPick: (school: { id: string; name: string }) => void }) {
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const { data, isLoading, error } = useSchoolByJoinCode(submittedCode);
  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <View>
      <Field label="Join code">
        <TextField
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder="e.g. DDZ8KFAA"
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />
      </Field>
      <Button title="Find my School" onPress={() => setSubmittedCode(code.trim())} disabled={code.trim().length === 0} loading={isLoading} />

      {notFound ? <ErrorBanner message="No School has that join code — check with your School and try again." /> : null}
      {error && !notFound ? <ErrorBanner message={getApiErrorMessage(error, 'Could not look that up — please try again.')} /> : null}

      {data ? (
        <View style={{ marginTop: spacing[4] }}>
          <SchoolRow school={data} onPress={() => onPick({ id: data.id, name: data.name })} />
          <Text style={{ color: theme.textSecondary, marginTop: spacing[2] }}>Tap above to continue with this School.</Text>
        </View>
      ) : null}
    </View>
  );
}
