import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, InlineError, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateOnly } from '../lib/formatDate';
import { useT } from '../i18n/I18nProvider';
import { useAddMinor, useMyMinors } from './guardianQueries';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'MyMinors'>;

/** CANDIDATE UI, pending your approval — see ConsentTierRow.tsx's own header
 * comment and docs/TRACK-B-ROADMAP.md's Guardian section. `rank` is
 * deliberately not a field here (CreateMinorDto's own header comment: it's
 * Staff-populated grading data, not a creation-time input). `dateOfBirth` is
 * collected as YYYY-MM-DD text — a real date picker is left for the actual
 * design pass this screen is standing in for, not built here. */
const EMPTY_FORM = { firstName: '', surname: '', dateOfBirth: '' };

export function MyMinorsScreen({ navigation }: Props) {
  const t = useT();
  const { data, isLoading, isError, error } = useMyMinors();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const addMinor = useAddMinor();

  if (isLoading) {
    return (
      <Screen>
        <ActivityIndicator />
      </Screen>
    );
  }

  // FOUND ON REVIEW: checking `isError` before `data` replaced perfectly good
  // already-loaded minors with a full-screen error banner the moment any
  // background refetch failed — including the exact "no connection" case this
  // app's offline-caching phase exists to handle gracefully. Only block on
  // the error when there's genuinely nothing to show, matching
  // PaginatedListScreen's own established "data takes precedence" discipline.
  if (isError && !data) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, t('guardians.myMinors.loadError'))} />
      </Screen>
    );
  }

  const minors = data?.items ?? [];

  // FOUND ON REVIEW: the enable check below trims before deciding whether to
  // allow submission, but the mutation was sending the raw, untrimmed
  // values — a trailing space (autocorrect/paste) would pass the enable
  // check yet still fail CreateMinorDto's strict @IsDateString() on the
  // backend, or silently pad a stored name. Trimmed here, once, right before
  // the actual submission.
  function handleAddMinor() {
    if (addMinor.isPending) return;
    addMinor.mutate(
      { firstName: form.firstName.trim(), surname: form.surname.trim(), dateOfBirth: form.dateOfBirth.trim() },
      {
        onSuccess: () => {
          setAdding(false);
          setForm(EMPTY_FORM);
        },
      },
    );
  }

  return (
    <Screen>
      {minors.length === 0 ? <Text style={{ color: '#5F6368', marginBottom: 12 }}>{t('guardians.myMinors.empty')}</Text> : null}

      {minors.map((minor) => (
        <Pressable
          key={minor.linkId}
          onPress={() =>
            navigation.navigate('MinorConsent', { studentId: minor.studentId, name: `${minor.firstName} ${minor.surname}` })
          }
          style={{ paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#EEE' }}
        >
          <Text style={{ fontSize: 16, fontWeight: '600' }}>
            {minor.firstName} {minor.surname}
          </Text>
          <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>
            {t('guardians.myMinors.born', { date: formatDateOnly(minor.dateOfBirth) })}
          </Text>
          {/* Book them into a class, with guests on their Friend Passes (Decision 379). */}
          <Button
            title={t('guardians.myMinors.bookAClass')}
            variant="secondary"
            onPress={() => navigation.navigate('ChildBooking', { studentId: minor.studentId, name: minor.firstName })}
          />
          {/* Their ranks, progress, skills and history, read-only (Decision 132). */}
          <Button
            title={t('guardians.myMinors.grading')}
            variant="secondary"
            onPress={() => navigation.navigate('MyGrading', { studentId: minor.studentId, name: minor.firstName })}
          />
          {/* The Lessons their enrolled School(s) have published (Decisions 154, 190, 195). */}
          <Button
            title={t('guardians.myMinors.lessons')}
            variant="secondary"
            onPress={() => navigation.navigate('Lessons', { studentId: minor.studentId, name: minor.firstName })}
          />
          {/* Notes their School shows them (Decision 400). */}
          <Button
            title={t('guardians.myMinors.notes')}
            variant="secondary"
            onPress={() => navigation.navigate('SchoolNotes', { studentId: minor.studentId, name: minor.firstName })}
          />
        </Pressable>
      ))}

      {adding ? (
        <View style={{ marginTop: 16 }}>
          <Field label={t('guardians.myMinors.firstName')}>
            <TextField
              value={form.firstName}
              onChangeText={(firstName) => setForm((f) => ({ ...f, firstName }))}
              placeholder={t('guardians.myMinors.firstName')}
            />
          </Field>
          <Field label={t('guardians.myMinors.surname')}>
            <TextField value={form.surname} onChangeText={(surname) => setForm((f) => ({ ...f, surname }))} placeholder={t('guardians.myMinors.surname')} />
          </Field>
          <Field label={t('guardians.myMinors.dateOfBirth')} hint={t('guardians.myMinors.dateOfBirthHint')}>
            <TextField
              value={form.dateOfBirth}
              onChangeText={(dateOfBirth) => setForm((f) => ({ ...f, dateOfBirth }))}
              placeholder={t('guardians.myMinors.dateOfBirthPlaceholder')}
            />
          </Field>
          {addMinor.isError ? (
            <InlineError message={getApiErrorMessage(addMinor.error, t('guardians.myMinors.addError'))} />
          ) : null}
          <Button
            title={t('guardians.myMinors.addMinor')}
            onPress={handleAddMinor}
            loading={addMinor.isPending}
            disabled={!form.firstName.trim() || !form.surname.trim() || !form.dateOfBirth.trim()}
          />
        </View>
      ) : (
        <Button title={t('guardians.myMinors.addAMinor')} variant="secondary" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}
