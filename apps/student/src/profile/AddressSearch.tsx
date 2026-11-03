import React, { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Field, TextField } from '../components/ui';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import { useI18n, useT } from '../i18n/I18nProvider';
import {
  fetchAddressDetails,
  fetchAddressSuggestions,
  newSessionToken,
  useAddressLookupStatus,
  type AddressDetails,
  type AddressSuggestion,
} from './addressLookupQueries';

type SearchState = 'idle' | 'done' | 'failed';

/**
 * "Search address" above My Profile's address field (Google Places, Decision
 * 212). Renders nothing until the API says the lookup is switched on, so
 * without a key the screen is exactly as before. Choosing a result hands the
 * looked-up address to `onPicked`; the person can still edit the text.
 */
export function AddressSearch({ onPicked }: { onPicked: (details: AddressDetails) => void }) {
  const t = useT();
  const { locale } = useI18n();
  const status = useAddressLookupStatus();
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [state, setState] = useState<SearchState>('idle');
  const session = useRef<string | null>(null);
  const latest = useRef('');
  const enabled = status.data?.enabled === true;

  useEffect(() => {
    const q = query.trim();
    latest.current = q;
    if (!enabled || q.length < 3) {
      setSuggestions([]);
      setState('idle');
      return;
    }
    const timer = setTimeout(() => {
      session.current ??= newSessionToken();
      fetchAddressSuggestions({ q, sessionToken: session.current, language: locale })
        .then((found) => {
          if (latest.current !== q) return;
          setSuggestions(found);
          setState('done');
        })
        .catch(() => {
          if (latest.current !== q) return;
          setSuggestions([]);
          setState('failed');
        });
    }, 300);
    return () => clearTimeout(timer);
  }, [query, enabled, locale]);

  if (!enabled) return null;

  async function pick(s: AddressSuggestion) {
    setSuggestions([]);
    const sessionToken = session.current ?? newSessionToken();
    session.current = null;
    try {
      onPicked(await fetchAddressDetails({ placeId: s.placeId, sessionToken, language: locale }));
      setQuery('');
      setState('idle');
    } catch {
      setState('failed');
    }
  }

  const hint =
    state === 'failed'
      ? t('profile.screen.addressSearchFailed')
      : state === 'done' && suggestions.length === 0
        ? t('profile.screen.addressSearchNoResults')
        : t('profile.screen.addressSearchHint');

  return (
    <Field label={t('profile.screen.addressSearch')} hint={hint}>
      <TextField
        value={query}
        onChangeText={setQuery}
        placeholder={t('profile.screen.addressSearchPlaceholder')}
        autoCorrect={false}
        accessibilityLabel={t('profile.screen.addressSearch')}
        maxLength={200}
      />
      {suggestions.length > 0 ? (
        <View style={styles.list} accessibilityRole="list">
          {suggestions.map((s) => (
            <Pressable key={s.placeId} onPress={() => void pick(s)} accessibilityRole="button" style={styles.option}>
              <Text style={styles.main}>{s.mainText || s.text}</Text>
              {s.mainText && s.secondaryText ? <Text style={styles.secondary}>{s.secondaryText}</Text> : null}
            </Pressable>
          ))}
          <Text style={styles.attribution}>{t('profile.screen.addressSearchAttribution')}</Text>
        </View>
      ) : null}
    </Field>
  );
}

const styles = StyleSheet.create({
  list: {
    marginTop: spacing[1],
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.input,
    backgroundColor: theme.surface2,
  },
  option: {
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
    minHeight: 44,
    justifyContent: 'center',
  },
  main: { color: theme.textPrimary, fontSize: fontSize.body },
  secondary: { color: theme.textSecondary, fontSize: fontSize.caption },
  attribution: { color: theme.textMuted, fontSize: fontSize.caption, paddingHorizontal: spacing[3], paddingVertical: spacing[1] },
});
