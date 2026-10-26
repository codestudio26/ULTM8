import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { ApiError, type components } from '@ultm8/api-client';
import { Button, ErrorBanner, Field, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { useT } from '../i18n/I18nProvider';
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
  const t = useT();
  const [mode, setMode] = useState<Mode>('search');
  const { setPendingSchoolPick } = useAuth();

  function pick(school: { id: string; name: string }) {
    setPendingSchoolPick(school);
  }

  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        <Text style={{ fontSize: fontSize.headingMd, fontWeight: fontWeight.heading, marginBottom: 4 }}>{t('academies.schoolPick.title')}</Text>
        <Text style={{ fontSize: fontSize.body, color: theme.textSecondary, marginBottom: spacing[4] }}>
          {t('academies.schoolPick.intro')}
        </Text>

        <View style={{ flexDirection: 'row', marginBottom: spacing[4], borderRadius: radius.input, borderWidth: 1, borderColor: theme.border, overflow: 'hidden' }}>
          <ModeTab label={t('academies.schoolPick.searchTab')} selected={mode === 'search'} onPress={() => setMode('search')} />
          <ModeTab label={t('academies.schoolPick.joinCodeTab')} selected={mode === 'code'} onPress={() => setMode('code')} />
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

/** 350ms is comfortably under a typical inter-keystroke gap while typing a
 * School name, so it reads as instant, but keeps a 20+ character name from
 * firing a request per keystroke — FOUND ON REVIEW: without this, ordinary
 * typing could itself trip SCHOOL_SEARCH_THROTTLE (30/60s per IP,
 * public-academies.controller.ts), the throttle this PR added specifically
 * to protect this same endpoint, turning it into a self-inflicted 429. */
const SEARCH_DEBOUNCE_MS = 350;

function SearchMode({ onPick }: { onPick: (school: { id: string; name: string }) => void }) {
  const t = useT();
  const [query, setQuery] = useState('');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query]);

  const { data, isLoading, isFetching, error } = useSchoolSearch(debouncedQuery);

  return (
    <View>
      <Field label={t('academies.schoolPick.schoolName')}>
        <TextField value={query} onChangeText={setQuery} placeholder={t('academies.schoolPick.schoolNamePlaceholder')} autoCapitalize="words" />
      </Field>

      {query.trim() && (query !== debouncedQuery || isLoading) ? <ActivityIndicator style={{ marginTop: spacing[3] }} /> : null}
      {error ? <ErrorBanner message={getApiErrorMessage(error, t('academies.schoolPick.searchFailed'))} /> : null}
      {!isLoading && query === debouncedQuery && debouncedQuery.trim() && data?.items.length === 0 ? (
        <Text style={{ color: theme.textSecondary, marginTop: spacing[3] }}>{t('academies.schoolPick.noMatch', { query: debouncedQuery.trim() })}</Text>
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
  const t = useT();
  const [code, setCode] = useState('');
  const [submittedCode, setSubmittedCode] = useState<string | null>(null);
  const { data, isLoading, error } = useSchoolByJoinCode(submittedCode);
  const notFound = error instanceof ApiError && error.status === 404;

  return (
    <View>
      <Field label={t('academies.schoolPick.joinCode')}>
        <TextField
          value={code}
          onChangeText={(v) => setCode(v.toUpperCase())}
          placeholder={t('academies.schoolPick.joinCodePlaceholder')}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
        />
      </Field>
      <Button title={t('academies.schoolPick.findMySchool')} onPress={() => setSubmittedCode(code.trim())} disabled={code.trim().length === 0} loading={isLoading} />

      {/* FOUND ON REVIEW: gated on `code === submittedCode`, not just
          `data`/`error` truthiness — without this, editing the field after a
          successful (or failed) lookup left the PREVIOUS result/error still
          rendered and tappable, so a tap could silently pick a School that
          no longer matches what's actually typed. The moment the field
          changes, the stale result disappears until re-submitted. */}
      {code === submittedCode && notFound ? (
        <ErrorBanner message={t('academies.schoolPick.codeNotFound')} />
      ) : null}
      {code === submittedCode && error && !notFound ? (
        <ErrorBanner message={getApiErrorMessage(error, t('academies.schoolPick.lookupFailed'))} />
      ) : null}

      {code === submittedCode && data ? (
        <View style={{ marginTop: spacing[4] }}>
          <SchoolRow school={data} onPress={() => onPick({ id: data.id, name: data.name })} />
          <Text style={{ color: theme.textSecondary, marginTop: spacing[2] }}>{t('academies.schoolPick.tapToContinue')}</Text>
        </View>
      ) : null}
    </View>
  );
}
