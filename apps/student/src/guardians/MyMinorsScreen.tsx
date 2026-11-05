import React, { useState } from 'react';
import { ActivityIndicator, Pressable, Switch, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, Field, InlineError, Screen, SuccessBanner, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateOnly } from '../lib/formatDate';
import { useT } from '../i18n/I18nProvider';
import { useAddMinor, useMyMinors } from './guardianQueries';
import { CURRENT_POLICY_VERSION } from './ConsentTierRow';
import type { TranslationKey } from '../i18n/types';
import type { AppStackParamList } from '../navigation/types';

type Props = NativeStackScreenProps<AppStackParamList, 'MyMinors'>;

/** CANDIDATE UI, pending your approval — see ConsentTierRow.tsx's own header
 * comment and docs/TRACK-B-ROADMAP.md's Guardian section. `rank` is
 * deliberately not a field here (CreateMinorDto's own header comment: it's
 * Staff-populated grading data, not a creation-time input). `dateOfBirth` is
 * collected as YYYY-MM-DD text — a real date picker is left for the actual
 * design pass this screen is standing in for, not built here. */
const EMPTY_FORM = { firstName: '', surname: '', dateOfBirth: '', consent: false };

/** Decision 430 item 3: a real date, not in the future, under 18 — checked
 * here as well as by the API, so the parent sees why at once. */
export function birthDateProblem(value: string, today = new Date()): TranslationKey | null {
  const text = value.trim();
  if (!text) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  const d = m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
  if (!m || !d || d.getUTCFullYear() !== +m[1] || d.getUTCMonth() !== +m[2] - 1 || d.getUTCDate() !== +m[3] || +m[1] < 1900) {
    return 'guardians.myMinors.dateInvalid';
  }
  const day = (x: Date) => x.getFullYear() * 10000 + (x.getMonth() + 1) * 100 + x.getDate();
  const born = +m[1] * 10000 + +m[2] * 100 + +m[3];
  if (born > day(today)) return 'guardians.myMinors.dateFuture';
  if (born + 180000 <= day(today)) return 'guardians.myMinors.dateAdult';
  return null;
}

export function MyMinorsScreen({ navigation }: Props) {
  const t = useT();
  const { data, isLoading, isError, error } = useMyMinors();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const addMinor = useAddMinor();
  const [added, setAdded] = useState<string | null>(null);

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
    if (birthDateProblem(form.dateOfBirth)) return;
    addMinor.mutate(
      {
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        dateOfBirth: form.dateOfBirth.trim(),
        // Decision 430 item 9: the consent ticked here is recorded with the child.
        ...(form.consent ? { consentPolicyVersion: CURRENT_POLICY_VERSION } : {}),
      },
      {
        onSuccess: (res) => {
          // Decision 430 item 4: the same child sent twice is added once.
          setAdded(res.alreadyAdded ? t('guardians.myMinors.alreadyAdded', { name: res.firstName }) : null);
          setAdding(false);
          setForm(EMPTY_FORM);
        },
      },
    );
  }

  return (
    <Screen>
      {added ? <SuccessBanner message={added} /> : null}
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
          {/* Decision 430 item 7: at 18 they sign for themselves; the parent keeps reading and paying for 30 days. */}
          {minor.isAdult ? (
            <Text style={{ color: '#8A4B00', marginTop: 6, fontSize: 13 }}>
              {minor.parentAccessEndsOn
                ? t('guardians.myMinors.adultUntil', { name: minor.firstName, date: formatDateOnly(minor.parentAccessEndsOn) })
                : t('guardians.myMinors.adult', { name: minor.firstName })}
            </Text>
          ) : null}
          {/* Decision 430 item 9: no booking or check-in until a parent gives consent. */}
          {!minor.isAdult && (minor.consent === 'PENDING' || minor.consent === 'WITHDRAWN') ? (
            <Text style={{ color: '#8A4B00', marginTop: 6, fontSize: 13 }}>
              {t(minor.consent === 'PENDING' ? 'guardians.myMinors.consentPending' : 'guardians.myMinors.consentWithdrawn', { name: minor.firstName })}
            </Text>
          ) : null}
          {/* Book them into a class, with guests on their Friend Passes (Decision 379). */}
          {!minor.isAdult ? (
            <Button
              title={t('guardians.myMinors.bookAClass')}
              variant="secondary"
              onPress={() => navigation.navigate('ChildBooking', { studentId: minor.studentId, name: minor.firstName })}
            />
          ) : null}
          {/* Decision 428 (M1, M2): sign their waivers, and buy them a plan. */}
          {!minor.isAdult ? (
            <Button
              title={t('guardians.myMinors.waivers')}
              variant="secondary"
              onPress={() => navigation.navigate('ChildWaivers', { studentId: minor.studentId, name: minor.firstName })}
            />
          ) : null}
          <Button
            title={t('guardians.myMinors.plans')}
            variant="secondary"
            onPress={() => navigation.navigate('ChildPlans', { studentId: minor.studentId, name: minor.firstName })}
          />
          {/* Their membership card at each of their Schools (Decision 398). */}
          <Button
            title={t('guardians.myMinors.card')}
            variant="secondary"
            onPress={() => navigation.navigate('ChildCard', { studentId: minor.studentId, name: minor.firstName })}
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
          {/* Their invoices and receipts (Decisions 303, 338). */}
          <Button
            title={t('charges.childButton')}
            variant="secondary"
            onPress={() => navigation.navigate('MyCharges', { studentId: minor.studentId, name: minor.firstName })}
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
          {birthDateProblem(form.dateOfBirth) ? <InlineError message={t(birthDateProblem(form.dateOfBirth)!)} /> : null}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, minHeight: 44 }}>
            <Switch
              value={form.consent}
              onValueChange={(consent) => setForm((f) => ({ ...f, consent }))}
              accessibilityLabel={t('guardians.myMinors.consentLabel')}
            />
            <Text style={{ flex: 1, fontSize: 13 }}>{t('guardians.myMinors.consentLabel')}</Text>
          </View>
          {addMinor.isError ? (
            <InlineError message={getApiErrorMessage(addMinor.error, t('guardians.myMinors.addError'))} />
          ) : null}
          <Button
            title={t('guardians.myMinors.addMinor')}
            onPress={handleAddMinor}
            loading={addMinor.isPending}
            disabled={!form.firstName.trim() || !form.surname.trim() || !form.dateOfBirth.trim() || !!birthDateProblem(form.dateOfBirth)}
          />
        </View>
      ) : (
        <Button title={t('guardians.myMinors.addAMinor')} variant="secondary" onPress={() => setAdding(true)} />
      )}
    </Screen>
  );
}
