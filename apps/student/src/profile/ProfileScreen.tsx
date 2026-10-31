import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { Avatar } from '../components/Avatar';
import { Button, ErrorBanner, Field, InlineError, SearchablePickerField, SuccessBanner, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight, radius } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import {
  useCurrencies,
  useLanguages,
  useMyProfile,
  useUpdateProfile,
  useUploadMyProfilePhoto,
  type CodeName,
  type ProfilePhotoContentType,
  type UserProfile,
} from './profileQueries';

/** Same 5MB/PNG+JPEG+WebP limits `PhotoUploadField` (packages/ui, the web
 * equivalent for Instructor/Branch/Franchise/Class photos) already
 * established — CHANGELOG.md's own entry for that build discloses there was
 * no prior size-limit convention to inherit from; this reuses ITS number
 * rather than picking a second, different one for the same kind of field. */
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES: ProfilePhotoContentType[] = ['image/png', 'image/jpeg', 'image/webp'];

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
  weightCategory: string;
  kimonoSize: string;
  beltSize: string;
  secondaryPhone: string;
  secondaryEmail: string;
  emergencyContactName: string;
  emergencyContactPhone: string;
  emergencyContactRelationship: string;
};

/** Decision 315 item 5: the member's other contacts (not logins). */
const CONTACT_FIELDS = ['secondaryPhone', 'secondaryEmail', 'emergencyContactName', 'emergencyContactPhone', 'emergencyContactRelationship'] as const;

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
    weightCategory: profile.weightCategory ?? '',
    kimonoSize: profile.kimonoSize ?? '',
    beltSize: profile.beltSize ?? '',
    secondaryPhone: profile.secondaryPhone ?? '',
    secondaryEmail: profile.secondaryEmail ?? '',
    emergencyContactName: profile.emergencyContactName ?? '',
    emergencyContactPhone: profile.emergencyContactPhone ?? '',
    emergencyContactRelationship: profile.emergencyContactRelationship ?? '',
  };
}

/** Off Home — the first screen anywhere in this app to read/edit `GET`/`PATCH
 * /users/me`. Covers every PATCH-able field on `UpdateUserDto`, including
 * `profilePhotoUrl` — set via its own dedicated pick/upload flow
 * (`useUploadMyProfilePhoto`), not a plain text field, since it's a real R2
 * upload (the shared `POST /uploads/public-photo-url` presign endpoint, USER
 * entityType, self-service), not a pasted URL. `email`/`phone` are shown
 * read-only — the DTO deliberately excludes both, since changing either is a
 * login/OTP identifier change, not a bare profile edit.
 *
 * Every plain-text field here (username/gender/nationality/address/
 * weightCategory/kimonoSize/beltSize) now sends `null`, not `undefined`, when
 * cleared to empty — `handleSave`'s own comment explains why this screen,
 * unlike `StudentUpdatePage.tsx` on the Staff-on-behalf-of side, can safely
 * treat "blank" as "clear it": every field here starts pre-filled from the
 * real current profile (`formFrom`, right above), so blank unambiguously means
 * the Student emptied it, not "I never touched this field."
 *
 * `language`/`currency` pick from the real confirmed lists (`GET
 * /settings/languages`/`/settings/currencies`). Language (4 entries, domain-rules
 * §1) stays a row of plain chip buttons — the same pattern LessonRow.tsx already
 * uses for its format/duration chips, no new native dependency needed. Currency
 * (now every Stripe-supported currency, ~135 ISO 4217 codes, up from the old
 * hardcoded 6 — product-owner-approved 11/12 Oct 2026, see `CHANGELOG.md` →
 * Unreleased) uses `SearchablePickerField` instead — a chip row that size would
 * wrap into an unusable wall of buttons; see that component's own header comment
 * for why a Modal+search, not a new Picker dependency, solves it. Both pickers
 * still send `undefined` when left at their initial empty value — neither
 * offers a "none"/"clear" option in its own UI (every option is a real
 * language/currency), so there is still no way to blank EITHER of these two
 * specifically from this screen. A real, disclosed, narrower remaining gap,
 * not silently expanded scope: closing it means deciding what an "unset"
 * language/currency state should even look like in the picker UI, which is a
 * product/UX call this task doesn't make on its own. */
export function ProfileScreen() {
  const t = useT();
  const profile = useMyProfile();
  const languages = useLanguages();
  const currencies = useCurrencies();
  const updateProfile = useUpdateProfile();
  const uploadPhoto = useUploadMyProfilePhoto();

  const [form, setForm] = useState<Form | null>(null);
  const [saved, setSaved] = useState(false);
  const [photoError, setPhotoError] = useState<string | null>(null);

  useEffect(() => {
    if (profile.data && form === null) setForm(formFrom(profile.data));
  }, [profile.data, form]);

  function set<K extends keyof Form>(key: K, value: string) {
    setForm((f) => (f ? { ...f, [key]: value } : f));
    setSaved(false);
  }

  function handleSave() {
    if (!form || updateProfile.isPending) return;
    // Decision 315 item 5: only the contacts that changed (blank clears one).
    const initial = profile.data ? formFrom(profile.data) : null;
    const contacts: Partial<Record<(typeof CONTACT_FIELDS)[number], string | null>> = {};
    for (const key of CONTACT_FIELDS) {
      if (form[key].trim() !== (initial?.[key] ?? '')) contacts[key] = form[key].trim() || null;
    }
    updateProfile.mutate(
      {
        firstName: form.firstName.trim(),
        surname: form.surname.trim(),
        // `null`, not `undefined`, when blank — `UpdateUserDto` now accepts
        // `null` for each of these to CLEAR them (see profileQueries.ts's own
        // header comment); `undefined` still means "leave the existing value
        // alone" (used nowhere in this screen's own save path, since every
        // field here is always pre-filled with the real current value — see
        // this component's own header comment for why that's what makes
        // blank-means-clear safe here).
        username: form.username.trim() || null,
        dateOfBirth: form.dateOfBirth.trim(),
        gender: form.gender === 'FEMALE' || form.gender === 'MALE' ? form.gender : null,
        nationality: form.nationality.trim() || null,
        // Left out when untouched: this screen still edits the one-line text,
        // and sending it would clear a structured (Decision 276) address the
        // School Portal saved, even though the Student never changed it.
        address: form.address.trim() === (profile.data?.address ?? '') ? undefined : form.address.trim() || null,
        // Still `undefined`, not `null`, for these two — neither picker offers
        // a "none" selection, so an empty `form.language`/`form.currency`
        // genuinely can't happen via this screen's own UI today; see this
        // component's own header comment.
        language: form.language || undefined,
        currency: form.currency || undefined,
        weightCategory: form.weightCategory.trim() || null,
        kimonoSize: form.kimonoSize.trim() || null,
        beltSize: form.beltSize.trim() || null,
        ...contacts,
      },
      { onSuccess: () => setSaved(true) },
    );
  }

  /** Shared by both pickers below — rejects a type/size the backend would also
   * reject (same checks `PhotoUploadField`'s own `handleFileSelected` makes on
   * the web side), then runs the request→PUT→save composition in
   * `useUploadMyProfilePhoto`. */
  function handlePickedAsset(asset: ImagePicker.ImagePickerAsset) {
    setPhotoError(null);
    const contentType = (asset.mimeType ?? 'image/jpeg') as ProfilePhotoContentType;
    if (!ALLOWED_CONTENT_TYPES.includes(contentType)) {
      setPhotoError(t('profile.screen.photoWrongType'));
      return;
    }
    if (asset.fileSize && asset.fileSize > MAX_PHOTO_BYTES) {
      setPhotoError(t('profile.screen.photoTooLarge'));
      return;
    }
    uploadPhoto.mutate({ uri: asset.uri, contentType });
  }

  async function pickPhotoFromLibrary() {
    setPhotoError(null);
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setPhotoError(t('profile.screen.libraryPermission'));
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: 'images', allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]) handlePickedAsset(result.assets[0]);
  }

  async function takePhoto() {
    setPhotoError(null);
    const permission = await ImagePicker.requestCameraPermissionsAsync();
    if (!permission.granted) {
      setPhotoError(t('profile.screen.cameraPermission'));
      return;
    }
    const result = await ImagePicker.launchCameraAsync({ allowsEditing: true, aspect: [1, 1], quality: 0.8 });
    if (!result.canceled && result.assets[0]) handlePickedAsset(result.assets[0]);
  }

  if (profile.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (profile.isError && !profile.data) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(profile.error, t('profile.screen.loadFailed'))} />
      </View>
    );
  }
  if (!form || !profile.data) return null;

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      <View style={{ alignItems: 'center', marginBottom: spacing[4] }}>
        <Avatar firstName={profile.data.firstName} surname={profile.data.surname} photoUrl={profile.data.profilePhotoUrl} size={96} />
        <View style={{ flexDirection: 'row', gap: spacing[2], marginTop: spacing[3] }}>
          <Button title={t('profile.screen.takePhoto')} variant="secondary" loading={uploadPhoto.isPending} onPress={takePhoto} />
          <Button title={t('profile.screen.choosePhoto')} variant="secondary" loading={uploadPhoto.isPending} onPress={pickPhotoFromLibrary} />
        </View>
        {photoError ? <InlineError message={photoError} /> : null}
        {uploadPhoto.isError ? (
          <InlineError message={getApiErrorMessage(uploadPhoto.error, t('profile.screen.uploadFailed'))} />
        ) : null}
      </View>

      <Field label={t('profile.screen.email')}>
        <Text style={{ fontSize: fontSize.input, color: theme.textPrimary }}>{profile.data.email}</Text>
      </Field>
      <Field label={t('profile.screen.phone')} hint={profile.data.phoneVerifiedAt ? t('profile.screen.verified') : t('profile.screen.notVerified')}>
        <Text style={{ fontSize: fontSize.input, color: theme.textPrimary }}>{profile.data.phone}</Text>
      </Field>
      <Muted>{t('profile.screen.identifiersNote')}</Muted>

      <View style={{ height: spacing[4] }} />

      <Field label={t('profile.screen.firstName')}>
        <TextField value={form.firstName} onChangeText={(v) => set('firstName', v)} />
      </Field>
      <Field label={t('profile.screen.surname')}>
        <TextField value={form.surname} onChangeText={(v) => set('surname', v)} />
      </Field>
      <Field label={t('profile.screen.username')} hint={t('profile.screen.usernameHint')}>
        <TextField autoCapitalize="none" value={form.username} onChangeText={(v) => set('username', v)} />
      </Field>
      <Field label={t('profile.screen.dateOfBirth')} hint={t('profile.screen.dateFormat')}>
        <TextField value={form.dateOfBirth} onChangeText={(v) => set('dateOfBirth', v)} placeholder={t('profile.screen.dateFormat')} />
      </Field>
      <Field label={t('profile.screen.gender')}>
        {/* Decision 315 item 15: Female, Male or not given. */}
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {(['FEMALE', 'MALE', ''] as const).map((g) => (
            <View key={g || 'none'} style={{ flex: 1 }}>
              <Button
                title={g === 'FEMALE' ? t('profile.screen.genderFemale') : g === 'MALE' ? t('profile.screen.genderMale') : t('profile.screen.genderNotGiven')}
                variant={form.gender === g ? 'primary' : 'secondary'}
                onPress={() => set('gender', g)}
              />
            </View>
          ))}
        </View>
      </Field>
      <Field label={t('profile.screen.nationality')}>
        <TextField value={form.nationality} onChangeText={(v) => set('nationality', v)} />
      </Field>
      <Field label={t('profile.screen.address')}>
        <TextField value={form.address} onChangeText={(v) => set('address', v)} multiline />
      </Field>

      <Field label={t('profile.screen.weightCategory')} hint={t('profile.screen.weightCategoryHint')}>
        <TextField value={form.weightCategory} onChangeText={(v) => set('weightCategory', v)} />
      </Field>
      <Field label={t('profile.screen.kimonoSize')} hint={t('profile.screen.kimonoSizeHint')}>
        <TextField value={form.kimonoSize} onChangeText={(v) => set('kimonoSize', v)} />
      </Field>
      <Field label={t('profile.screen.beltSize')} hint={t('profile.screen.beltSizeHint')}>
        <TextField value={form.beltSize} onChangeText={(v) => set('beltSize', v)} />
      </Field>

      <Field label={t('profile.screen.secondaryPhone')} hint={t('profile.screen.secondaryHint')}>
        <TextField value={form.secondaryPhone} onChangeText={(v) => set('secondaryPhone', v)} keyboardType="phone-pad" maxLength={40} />
      </Field>
      <Field label={t('profile.screen.secondaryEmail')} hint={t('profile.screen.secondaryHint')}>
        <TextField value={form.secondaryEmail} onChangeText={(v) => set('secondaryEmail', v)} keyboardType="email-address" autoCapitalize="none" maxLength={254} />
      </Field>
      <Muted>{t('profile.screen.emergencyHeading')}</Muted>
      <Muted>{t('profile.screen.emergencyHint')}</Muted>
      <Field label={t('profile.screen.emergencyName')}>
        <TextField value={form.emergencyContactName} onChangeText={(v) => set('emergencyContactName', v)} maxLength={100} />
      </Field>
      <Field label={t('profile.screen.emergencyPhone')}>
        <TextField value={form.emergencyContactPhone} onChangeText={(v) => set('emergencyContactPhone', v)} keyboardType="phone-pad" maxLength={40} />
      </Field>
      <Field label={t('profile.screen.emergencyRelationship')}>
        <TextField value={form.emergencyContactRelationship} onChangeText={(v) => set('emergencyContactRelationship', v)} maxLength={60} />
      </Field>

      <Field
        label={t('profile.screen.language')}
        hint={form.language.toLowerCase().startsWith('ar') ? t('profile.screen.rtlRestartHint') : undefined}
      >
        <ChipPicker
          options={languages.data ?? []}
          value={form.language}
          onSelect={(code) => set('language', code)}
          loading={languages.isLoading}
        />
      </Field>
      <Field label={t('profile.screen.currency')}>
        <SearchablePickerField
          options={currencies.data ?? []}
          value={form.currency}
          onSelect={(code) => set('currency', code)}
          loading={currencies.isLoading}
          placeholder={t('profile.screen.currencyPlaceholder')}
          searchPlaceholder={t('profile.screen.currencySearch')}
          emptyLabel={t('profile.screen.notAvailable')}
          triggerAccessibilityLabel={t('profile.screen.currency')}
        />
      </Field>

      {updateProfile.isError ? (
        <ErrorBanner message={getApiErrorMessage(updateProfile.error, t('profile.screen.saveFailed'))} />
      ) : null}
      {saved ? <SuccessBanner message={t('profile.screen.saved')} /> : null}

      <Button
        title={t('profile.screen.save')}
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
  const t = useT();
  if (loading) return <Muted>{t('profile.screen.loading')}</Muted>;
  if (options.length === 0) return <Muted>{t('profile.screen.notAvailable')}</Muted>;
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
