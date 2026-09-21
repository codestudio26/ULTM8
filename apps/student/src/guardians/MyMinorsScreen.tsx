import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, InlineError, Screen, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDate } from '../lib/formatDate';
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

  if (isError) {
    return (
      <Screen>
        <ErrorBanner message={getApiErrorMessage(error, 'Failed to load your minors — please try again.')} />
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
      {minors.length === 0 ? <Text style={{ color: '#5F6368', marginBottom: 12 }}>No linked minors yet.</Text> : null}

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
          <Text style={{ color: '#5F6368', marginTop: 2, fontSize: 12 }}>Born {formatDate(minor.dateOfBirth)}</Text>
        </Pressable>
      ))}

      {adding ? (
        <View style={{ marginTop: 16 }}>
          <Field label="First name">
            <TextField
              value={form.firstName}
              onChangeText={(firstName) => setForm((f) => ({ ...f, firstName }))}
              placeholder="First name"
            />
          </Field>
          <Field label="Surname">
            <TextField value={form.surname} onChangeText={(surname) => setForm((f) => ({ ...f, surname }))} placeholder="Surname" />
          </Field>
          <Field label="Date of birth" hint="YYYY-MM-DD">
            <TextField
              value={form.dateOfBirth}
              onChangeText={(dateOfBirth) => setForm((f) => ({ ...f, dateOfBirth }))}
              placeholder="2015-06-01"
            />
          </Field>
          {addMinor.isError ? (
            <InlineError message={getApiErrorMessage(addMinor.error, 'Could not add this minor — please try again.')} />
          ) : null}
          <Button
            title="Add minor"
            onPress={handleAddMinor}
            loading={addMinor.isPending}
            disabled={!form.firstName.trim() || !form.surname.trim() || !form.dateOfBirth.trim()}
          />
        </View>
      ) : (
        <Button title="Add a minor" variant="secondary" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}
