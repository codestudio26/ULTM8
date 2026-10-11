import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import { Button, ErrorBanner, Field, SuccessBanner, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight, radius } from '../theme/tokens';
import { useCurrencies, useLanguages, useMyProfile, useUpdateProfile, type CodeName, type UserProfile } from './profileQueries';

const Muted = ({ children }: { children: React.ReactNode }) => (
  <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>
);

type Form = {
  firstName: string;
  surname: string;
  username: string;
  dateOfBirth: string;
  gender: string;
  nationality: string;
  address: string;
  language: string;
  currency: string;
};

function formFrom(profile: UserProfile): Form {
  return {
    firstName: profile.firstName,
    surname: profile.surname,
    username: profile.username ?? '',
    dateOfBirth: profile.dateOfBirth.slice(0, 10),
    gender: profile.gender ?? '',
    nationality: profile.nationality ?? '',
    address: profile.address ?? '',
    language: profile.language ?? '',
    currency: profile.currency ?? '',
  };
}

/** Off Home — the first screen anywhere in this app to read/edit `GET`/`PATCH
 * /users/me`. Covers every PATCH-able field on `UpdateUserDto` except
 * `profilePhotoUrl` (see profileQueries.ts's own header comment: that field
 * takes a plain URL, not an upload flow, and nothing resolves "pick a photo" to
 * one yet — a real gap, not built around here). `email`/`phone` are shown
 * read-only — the DTO deliberately excludes both, since changing either is a
 * login/OTP identifier change, not a bare profile edit.
 *
 * `language`/`currency` pick from the real confirmed lists
 * (`GET /settings/languages`/`/settings/currencies`, domain-rules §1's "4
 * languages... 6 currencies") via plain chip buttons — this app has no Picker
 * dependency anywhere, and adding one just for two fields isn't worth a new
 * native dependency when a row of Pressable chips (the same pattern
 * LessonRow.tsx already uses for its format/duration chips) does the same job
 * with what's already here. */
export function ProfileScreen() {
  const profile = useMyProfile();
  const languages = useLanguages();
  const currencies = useCurrencies();
  const updateProfile = useUpdateProfile();

  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (profile.data && form === null) setForm(formFrom(profile.data));
  }, [profile.data, form]);

  function set<K extends keyof Form>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  function handleSave() {
    if (!form || updateProfile.isPending) return;
    updateProfile.mutate(
      {
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        username: form.username.trim() || undefined,
        dateOfBirth: form.dateOfBirth.trim(),
        gender: form.gender.trim() || undefined,
        nationality: form.nationality.trim() || undefined,
        address: form.address.trim() || undefined,
        language: form.language || undefined,
        currency: form.currency || undefined,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  if (profile.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (profile.isError && !profile.data) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(profile.error, 'Could not load your profile — please try again.')} />
      </View>
    );
  }
  if (!form || !profile.data) return null;

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      <Field label="Email">
        <Text style={{ fontSize: fontSize.input, color: theme.textPrimary }}>{profile.data.email}</Text>
      </Field>
      <Field label="Phone" hint={profile.data.phoneVerifiedAt ? 'Verified' : 'Not yet verified'}>
        <Text style={{ fontSize: fontSize.input, color: theme.textPrimary }}>{profile.data.phone}</Text>
      </Field>
      <Muted>Email and phone can't be changed here — they're your login identifiers.</Muted>

      <View style={{ height: spacing[4] }} />

      <Field label="First name">
        <TextField value={form.firstName} onChangeText={(v) => set('firstName', v)} />
      </Field>
      <Field label="Surname">
        <TextField value={form.surname} onChangeText={(v) => set('surname', v)} />
      </Field>
      <Field label="Username" hint="Mobile only">
        <TextField autoCapitalize="none" value={form.username} onChangeText={(v) => set('username', v)} />
      </Field>
      <Field label="Date of birth" hint="YYYY-MM-DD">
        <TextField value={form.dateOfBirth} onChangeText={(v) => set('dateOfBirth', v)} placeholder="YYYY-MM-DD" />
      </Field>
      <Field label="Gender">
        <TextField value={form.gender} onChangeText={(v) => set('gender', v)} />
      </Field>
      <Field label="Nationality">
        <TextField value={form.nationality} onChangeText={(v) => set('nationality', v)} />
      </Field>
      <Field label="Address">
        <TextField value={form.address} onChangeText={(v) => set('address', v)} multiline />
      </Field>

      <Field label="Language">
        <ChipPicker
          options={languages.data ?? []}
          value={form.language}
          onSelect={(code) => set('language', code)}
          loading={languages.isLoading}
        />
      </Field>
      <Field label="Currency">
        <ChipPicker
          options={currencies.data ?? []}
          value={form.currency}
          onSelect={(code) => set('currency', code)}
          loading={currencies.isLoading}
        />
      </Field>

      {updateProfile.isError ? (
        <ErrorBanner message={getApiErrorMessage(updateProfile.error, 'Could not save your profile — please try again.')} />
      ) : null}
      {saved ? <SuccessBanner message="Saved." /> : null}

      <Button
        title="Save"
        onPress={handleSave}
        loading={updateProfile.isPending}
        disabled={!form.firstName.trim() || !form.surname.trim() || !form.dateOfBirth.trim()}
      />
    </ScrollView>
  );
}

function ChipPicker({
  options,
  value,
  onSelect,
  loading,
}: {
  options: CodeName[];
  value: string;
  onSelect: (code: string) => void;
  loading: boolean;
}) {
  if (loading) return <Muted>Loading…</Muted>;
  if (options.length === 0) return <Muted>Not available.</Muted>;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: spacing[2] }}>
      {options.map((o) => {
        const selected = o.code === value;
        return (
          <Pressable
            key={o.code}
            onPress={() => onSelect(o.code)}
            style={{
              borderRadius: radius.input,
              borderWidth: 1,
              borderColor: selected ? theme.fillAccent : theme.border,
              backgroundColor: selected ? theme.fillAccent : theme.surface1,
              paddingHorizontal: spacing[3],
              paddingVertical: spacing[2],
            }}
          >
            <Text style={{ color: selected ? theme.onAccent : theme.textPrimary, fontSize: fontSize.footnote, fontWeight: fontWeight.emphasis }}>
              {o.name}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}
