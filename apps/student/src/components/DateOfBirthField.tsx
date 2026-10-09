import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text } from 'react-native';
import DateTimePicker, { type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { TextField } from './ui';
import { colors, theme, spacing, fontSize, radius } from '../theme/tokens';

/** Replaces the plain YYYY-MM-DD text input Register previously used. Confirmed
 * `@react-native-community/datetimepicker` is in this Expo SDK's own
 * bundledNativeModules.json (pinned 9.1.0) — Expo Go-compatible, not the
 * custom-dev-client problem Stripe/PaymentSheet has (Decision 100).
 *
 * FOUND BEFORE BUILDING: this library ships .ios.js/.android.js/.windows.js plus a
 * generic no-suffix fallback (confirmed via `npm pack --dry-run` + reading
 * src/datetimepicker.js) that Metro resolves to on web — but that fallback just
 * renders `null` with a one-time console.warn, which would silently remove the DOB
 * field from the Register form entirely on web with no visible input at all. The
 * static top-level import below is safe on every platform (Metro's own platform-
 * extension resolution handles it, confirmed, not a bundler risk) — the explicit
 * `Platform.OS === 'web'` branch below exists for UX, not bundler safety: it swaps in
 * the original, already-validated plain-text field so web (this whole track's
 * primary verification path) keeps a working input instead of the library's own
 * silent no-op.
 */
export function DateOfBirthField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [showPicker, setShowPicker] = useState(false);

  if (Platform.OS === 'web') {
    return <TextField placeholder="YYYY-MM-DD" value={value} onChangeText={onChange} />;
  }

  const parsed = /^\d{4}-\d{2}-\d{2}$/.test(value) ? new Date(`${value}T00:00:00Z`) : undefined;

  return (
    <>
      <Pressable
        onPress={() => setShowPicker(true)}
        style={styles.pressable}
        accessibilityRole="button"
        accessibilityLabel={value ? `Date of birth, ${value}` : 'Select date of birth'}
      >
        <Text style={value ? styles.valueText : styles.placeholderText}>{value || 'Select date of birth'}</Text>
      </Pressable>
      {showPicker ? (
        <DateTimePicker
          value={parsed ?? new Date(2000, 0, 1)}
          mode="date"
          // Can never be born in the future — the one bound worth enforcing at the
          // picker level rather than leaving to server-side validation alone.
          maximumDate={new Date()}
          onChange={(_event: DateTimePickerEvent, selectedDate?: Date) => {
            setShowPicker(false);
            if (selectedDate) {
              onChange(selectedDate.toISOString().slice(0, 10));
            }
          }}
        />
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  pressable: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.input,
    paddingVertical: spacing[3],
    paddingHorizontal: spacing[3],
    backgroundColor: colors.white,
  },
  valueText: { fontSize: fontSize.input, color: theme.textPrimary },
  placeholderText: { fontSize: fontSize.input, color: theme.textMuted },
});
