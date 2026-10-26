/**
 * Minimal local RN primitives — NOT a port of @ultm8/ui. That package (packages/ui) is
 * built on react-dom/react-router-dom and ships plain `.css` imports (tokens.css,
 * components.css); none of that runs in React Native. Verified by reading its
 * package.json/src before assuming it was reusable, per the kickoff doc's instruction
 * not to assume. This file exists only because a walking-skeleton auth flow needs
 * *something* to render — it is deliberately small, not a new design system.
 *
 * Colors/spacing/type now come from theme/tokens.ts (DESIGN.md translated to plain RN
 * values) rather than the ad hoc Material-style hex this file shipped with in Slice 1
 * — see tokens.ts's own header for why a separate translation was needed instead of
 * reusing packages/ui directly. Two real DESIGN.md violations were caught fixing this,
 * not just a color swap: the input font size was 15px (DESIGN.md requires >=16px on
 * any text input — below that, iOS Safari/WebKit auto-zooms the viewport on focus),
 * and the Button had no guaranteed minimum touch target (DESIGN.md: "every interactive
 * element: minimum 44×44px, regardless of visual size").
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useSchoolTheme } from '../theme/SchoolThemeContext';
import { useI18n, useT } from '../i18n/I18nProvider';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
} from 'react-native';
import {
  AsYouType,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';
import { colors, theme, spacing, fontSize, fontWeight, radius, minTouchTarget } from '../theme/tokens';

export function Screen({ children }: { children: React.ReactNode }) {
  return <View style={styles.screen}>{children}</View>;
}

export function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      {children}
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function TextField(props: TextInputProps) {
  return <TextInput style={styles.input} placeholderTextColor={theme.textMuted} {...props} />;
}

/** `[ISO 3166-1 alpha-2, English name, calling code]` for every country/territory
 * `libphonenumber-js`'s "min" metadata (the plain `libphonenumber-js` import below
 * — same build this file's web counterpart, packages/ui/src/components.tsx, uses;
 * see that file's own comment for why `min` and not `mobile`/`max`) actually
 * supports. Kept as its own frozen copy here, identical to packages/ui's, rather
 * than computed at runtime via `Intl.DisplayNames` — that API isn't guaranteed on
 * every Hermes build this app ships on, and a runtime failure here would be a
 * broken country picker, not a graceful degrade. Sorted by name for the picker. */
const PHONE_COUNTRIES: Array<[CountryCode, string, string]> = [
  ['AF','Afghanistan','93'],['AX','Åland Islands','358'],['AL','Albania','355'],['DZ','Algeria','213'],['AS','American Samoa','1'],
  ['AD','Andorra','376'],['AO','Angola','244'],['AI','Anguilla','1'],['AG','Antigua & Barbuda','1'],['AR','Argentina','54'],
  ['AM','Armenia','374'],['AW','Aruba','297'],['AU','Australia','61'],['AT','Austria','43'],['AZ','Azerbaijan','994'],
  ['BS','Bahamas','1'],['BH','Bahrain','973'],['BD','Bangladesh','880'],['BB','Barbados','1'],['BY','Belarus','375'],
  ['BE','Belgium','32'],['BZ','Belize','501'],['BJ','Benin','229'],['BM','Bermuda','1'],['BT','Bhutan','975'],
  ['BO','Bolivia','591'],['BA','Bosnia & Herzegovina','387'],['BW','Botswana','267'],['BR','Brazil','55'],['IO','British Indian Ocean Territory','246'],
  ['VG','British Virgin Islands','1'],['BN','Brunei','673'],['BG','Bulgaria','359'],['BF','Burkina Faso','226'],['BI','Burundi','257'],
  ['KH','Cambodia','855'],['CM','Cameroon','237'],['CA','Canada','1'],['CV','Cape Verde','238'],['BQ','Caribbean Netherlands','599'],
  ['KY','Cayman Islands','1'],['CF','Central African Republic','236'],['TD','Chad','235'],['CL','Chile','56'],['CN','China','86'],
  ['CX','Christmas Island','61'],['CC','Cocos (Keeling) Islands','61'],['CO','Colombia','57'],['KM','Comoros','269'],['CG','Congo - Brazzaville','242'],
  ['CD','Congo - Kinshasa','243'],['CK','Cook Islands','682'],['CR','Costa Rica','506'],['CI','Côte d’Ivoire','225'],['HR','Croatia','385'],
  ['CU','Cuba','53'],['CW','Curaçao','599'],['CY','Cyprus','357'],['CZ','Czechia','420'],['DK','Denmark','45'],
  ['DJ','Djibouti','253'],['DM','Dominica','1'],['DO','Dominican Republic','1'],['EC','Ecuador','593'],['EG','Egypt','20'],
  ['SV','El Salvador','503'],['GQ','Equatorial Guinea','240'],['ER','Eritrea','291'],['EE','Estonia','372'],['SZ','Eswatini','268'],
  ['ET','Ethiopia','251'],['FK','Falkland Islands','500'],['FO','Faroe Islands','298'],['FJ','Fiji','679'],['FI','Finland','358'],
  ['FR','France','33'],['GF','French Guiana','594'],['PF','French Polynesia','689'],['GA','Gabon','241'],['GM','Gambia','220'],
  ['GE','Georgia','995'],['DE','Germany','49'],['GH','Ghana','233'],['GI','Gibraltar','350'],['GR','Greece','30'],
  ['GL','Greenland','299'],['GD','Grenada','1'],['GP','Guadeloupe','590'],['GU','Guam','1'],['GT','Guatemala','502'],
  ['GG','Guernsey','44'],['GN','Guinea','224'],['GW','Guinea-Bissau','245'],['GY','Guyana','592'],['HT','Haiti','509'],
  ['HN','Honduras','504'],['HK','Hong Kong','852'],['HU','Hungary','36'],['IS','Iceland','354'],['IN','India','91'],
  ['ID','Indonesia','62'],['IR','Iran','98'],['IQ','Iraq','964'],['IE','Ireland','353'],['IM','Isle of Man','44'],
  ['IL','Israel','972'],['IT','Italy','39'],['JM','Jamaica','1'],['JP','Japan','81'],['JE','Jersey','44'],
  ['JO','Jordan','962'],['KZ','Kazakhstan','7'],['KE','Kenya','254'],['KI','Kiribati','686'],['XK','Kosovo','383'],
  ['KW','Kuwait','965'],['KG','Kyrgyzstan','996'],['LA','Laos','856'],['LV','Latvia','371'],['LB','Lebanon','961'],
  ['LS','Lesotho','266'],['LR','Liberia','231'],['LY','Libya','218'],['LI','Liechtenstein','423'],['LT','Lithuania','370'],
  ['LU','Luxembourg','352'],['MO','Macao','853'],['MG','Madagascar','261'],['MW','Malawi','265'],['MY','Malaysia','60'],
  ['MV','Maldives','960'],['ML','Mali','223'],['MT','Malta','356'],['MH','Marshall Islands','692'],['MQ','Martinique','596'],
  ['MR','Mauritania','222'],['MU','Mauritius','230'],['YT','Mayotte','262'],['MX','Mexico','52'],['FM','Micronesia','691'],
  ['MD','Moldova','373'],['MC','Monaco','377'],['MN','Mongolia','976'],['ME','Montenegro','382'],['MS','Montserrat','1'],
  ['MA','Morocco','212'],['MZ','Mozambique','258'],['MM','Myanmar (Burma)','95'],['NA','Namibia','264'],['NR','Nauru','674'],
  ['NP','Nepal','977'],['NL','Netherlands','31'],['NC','New Caledonia','687'],['NZ','New Zealand','64'],['NI','Nicaragua','505'],
  ['NE','Niger','227'],['NG','Nigeria','234'],['NU','Niue','683'],['NF','Norfolk Island','672'],['KP','North Korea','850'],
  ['MK','North Macedonia','389'],['MP','Northern Mariana Islands','1'],['NO','Norway','47'],['OM','Oman','968'],['PK','Pakistan','92'],
  ['PW','Palau','680'],['PS','Palestine','970'],['PA','Panama','507'],['PG','Papua New Guinea','675'],['PY','Paraguay','595'],
  ['PE','Peru','51'],['PH','Philippines','63'],['PL','Poland','48'],['PT','Portugal','351'],['PR','Puerto Rico','1'],
  ['QA','Qatar','974'],['RE','Réunion','262'],['RO','Romania','40'],['RU','Russia','7'],['RW','Rwanda','250'],
  ['WS','Samoa','685'],['SM','San Marino','378'],['ST','São Tomé & Príncipe','239'],['SA','Saudi Arabia','966'],['SN','Senegal','221'],
  ['RS','Serbia','381'],['SC','Seychelles','248'],['SL','Sierra Leone','232'],['SG','Singapore','65'],['SX','Sint Maarten','1'],
  ['SK','Slovakia','421'],['SI','Slovenia','386'],['SB','Solomon Islands','677'],['SO','Somalia','252'],['ZA','South Africa','27'],
  ['KR','South Korea','82'],['SS','South Sudan','211'],['ES','Spain','34'],['LK','Sri Lanka','94'],['BL','St. Barthélemy','590'],
  ['SH','St. Helena','290'],['KN','St. Kitts & Nevis','1'],['LC','St. Lucia','1'],['MF','St. Martin','590'],['PM','St. Pierre & Miquelon','508'],
  ['VC','St. Vincent & Grenadines','1'],['SD','Sudan','249'],['SR','Suriname','597'],['SE','Sweden','46'],['CH','Switzerland','41'],
  ['SY','Syria','963'],['TW','Taiwan','886'],['TJ','Tajikistan','992'],['TZ','Tanzania','255'],['TH','Thailand','66'],
  ['TL','Timor-Leste','670'],['TG','Togo','228'],['TK','Tokelau','690'],['TO','Tonga','676'],['TT','Trinidad & Tobago','1'],
  ['TA','Tristan da Cunha','290'],['TN','Tunisia','216'],['TR','Türkiye','90'],['TM','Turkmenistan','993'],['TC','Turks & Caicos Islands','1'],
  ['TV','Tuvalu','688'],['UG','Uganda','256'],['UA','Ukraine','380'],['AE','United Arab Emirates','971'],['GB','United Kingdom','44'],
  ['US','United States','1'],['UY','Uruguay','598'],['UZ','Uzbekistan','998'],['VU','Vanuatu','678'],['VA','Vatican City','39'],
  ['VE','Venezuela','58'],['VN','Vietnam','84'],['WF','Wallis & Futuna','681'],['EH','Western Sahara','212'],['YE','Yemen','967'],
  ['ZM','Zambia','260'],['ZW','Zimbabwe','263'],
];

/** `AA` → 🇦🇦 via the "regional indicator symbol" Unicode block — same trick as
 * packages/ui's web PhoneField. Renders fine on iOS/Android; degrades to plain
 * letters only in contexts with no flag-emoji font support. */
function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

/** Best-effort E.164 string from a country + whatever national-number digits have
 * been typed so far — see packages/ui's identical `composeE164` for the full
 * reasoning (always returns *something* E.164-shaped once a country is picked,
 * even mid-typing, rather than only once the number is complete/valid). */
function composeE164(country: CountryCode | undefined, digits: string): string {
  if (!country || !digits) return '';
  const asYouType = new AsYouType(country);
  asYouType.input(digits);
  const parsed = asYouType.getNumber();
  if (parsed) return parsed.number;
  try {
    return `+${getCountryCallingCode(country)}${digits}`;
  } catch {
    return '';
  }
}

export interface PhoneFieldProps {
  /** Always a plain E.164 string (e.g. `"+15551234567"`), or `''` until a country
   * has been chosen and at least one digit typed. */
  value: string;
  onChange: (value: string) => void;
  /** Initial country when `value` is empty and nothing's been typed yet — pass the
   * caller's own best locale guess (e.g. the device locale). Omit to force an
   * explicit choice rather than guessing wrong for the wrong country. */
  defaultCountry?: CountryCode;
  placeholder?: string;
}

/** RN equivalent of packages/ui's web `PhoneField` — same `libphonenumber-js`
 * logic, a country picker rendered as a `Modal` (this app has no Picker
 * dependency anywhere, matching this file's own header comment on why a native
 * dependency isn't pulled in just for this). A trigger `Pressable` (flag + dial
 * code) opens the modal; a search box filters by country name or dial code. */
export function PhoneField({ value, onChange, defaultCountry, placeholder }: PhoneFieldProps) {
  const { t, locale } = useI18n();
  // Country names in the app's language where the engine has `Intl.DisplayNames`
  // (same approach as packages/ui's web PhoneField); the frozen English list otherwise.
  const countries = useMemo<Array<[CountryCode, string, string, string]>>(() => {
    let names: Intl.DisplayNames | undefined;
    try {
      names = locale === 'en' ? undefined : new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      names = undefined;
    }
    if (!names) return PHONE_COUNTRIES.map(([code, name, dial]) => [code, name, dial, name]);
    const list = PHONE_COUNTRIES.map(([code, name, dial]): [CountryCode, string, string, string] => [code, names?.of(code) ?? name, dial, name]);
    return list.sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [locale]);
  const [country, setCountry] = useState<CountryCode | undefined>(() => {
    if (value) return parsePhoneNumberFromString(value)?.country ?? defaultCountry;
    return defaultCountry;
  });
  const [digits, setDigits] = useState<string>(() => {
    if (!value) return '';
    const parsed = parsePhoneNumberFromString(value);
    return parsed ? parsed.nationalNumber : value.replace(/\D/g, '');
  });
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [touched, setTouched] = useState(false);
  const lastEmitted = useRef(value);

  // Resync from an *external* value change (e.g. the parent prefilling this field
  // from a route param after another screen already collected the number) — not
  // from our own `emit()` below, which already updated `lastEmitted` before
  // calling `onChange`, so a controlled parent that just stores what it's given
  // doesn't bounce straight back into a resync here.
  useEffect(() => {
    if (value === lastEmitted.current) return;
    lastEmitted.current = value;
    if (!value) {
      setDigits('');
      return;
    }
    const parsed = parsePhoneNumberFromString(value);
    if (parsed?.country) {
      setCountry(parsed.country);
      setDigits(parsed.nationalNumber);
    } else {
      setDigits(value.replace(/\D/g, ''));
    }
  }, [value]);

  function emit(nextCountry: CountryCode | undefined, nextDigits: string) {
    const e164 = composeE164(nextCountry, nextDigits);
    lastEmitted.current = e164;
    onChange(e164);
  }

  function handleNationalInput(raw: string) {
    const trimmed = raw.trim();
    if (trimmed.startsWith('+')) {
      const parsed = parsePhoneNumberFromString(trimmed);
      if (parsed?.country) {
        setCountry(parsed.country);
        setDigits(parsed.nationalNumber);
        emit(parsed.country, parsed.nationalNumber);
        return;
      }
    }
    const nextDigits = raw.replace(/\D/g, '');
    setDigits(nextDigits);
    emit(country, nextDigits);
  }

  function selectCountry(code: CountryCode) {
    setCountry(code);
    setOpen(false);
    setSearch('');
    emit(code, digits);
  }

  const displayNational = useMemo(() => {
    if (!digits) return '';
    if (!country) return digits;
    return new AsYouType(country).input(digits);
  }, [country, digits]);

  const e164 = composeE164(country, digits);
  const invalid = touched && digits.length > 0 && !isValidPhoneNumber(e164);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return countries;
    return countries.filter(
      ([code, name, dial, englishName]) =>
        name.toLowerCase().includes(q) || englishName.toLowerCase().includes(q) || dial.includes(q.replace(/^\+/, '')) || code.toLowerCase() === q,
    );
  }, [search, countries]);

  const selected = country ? countries.find(([code]) => code === country) : undefined;

  return (
    <View>
      <View style={styles.phoneFieldRow}>
        <Pressable
          onPress={() => setOpen(true)}
          style={({ pressed }) => [styles.phoneFieldTrigger, pressed && styles.buttonPressed]}
          accessibilityRole="button"
          accessibilityLabel={t('common.phoneField.countryCallingCode')}
        >
          {selected ? (
            <Text style={styles.phoneFieldTriggerText}>{`${flagEmoji(selected[0])} +${selected[2]}`}</Text>
          ) : (
            <Text style={[styles.phoneFieldTriggerText, { color: theme.textMuted }]}>{t('common.phoneField.country')}</Text>
          )}
        </Pressable>
        <TextInput
          style={[styles.input, styles.phoneFieldInput]}
          placeholderTextColor={theme.textMuted}
          placeholder={placeholder}
          accessibilityLabel={t('common.phoneField.phoneNumber')}
          keyboardType="phone-pad"
          value={displayNational}
          onChangeText={handleNationalInput}
          onBlur={() => setTouched(true)}
        />
      </View>
      {invalid ? (
        <InlineError
          message={selected ? t('common.phoneField.invalidPhoneFor', { country: selected[1] }) : t('common.phoneField.invalidPhone')}
        />
      ) : null}
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.phoneFieldModal}>
          <TextInput
            style={styles.input}
            placeholderTextColor={theme.textMuted}
            placeholder={t('common.phoneField.searchPlaceholder')}
            accessibilityLabel={t('common.phoneField.searchCountry')}
            autoFocus
            value={search}
            onChangeText={setSearch}
          />
          <FlatList
            data={filtered}
            keyExtractor={([code]) => code}
            renderItem={({ item: [code, name, dial] }) => (
              <Pressable
                onPress={() => selectCountry(code)}
                style={({ pressed }) => [styles.phoneFieldOption, pressed && styles.buttonPressed]}
                accessibilityRole="button"
              >
                <Text style={styles.phoneFieldOptionFlag}>{flagEmoji(code)}</Text>
                <Text style={styles.phoneFieldOptionName}>{name}</Text>
                <Text style={styles.phoneFieldOptionDial}>+{dial}</Text>
              </Pressable>
            )}
          />
          <Button title={t('common.close')} variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

export interface CodeNameOption {
  code: string;
  name: string;
}

/** A trigger `Pressable` + full-screen `Modal` with a search box and `FlatList` —
 * same pattern as `PhoneField`'s country picker above, generalized over any
 * `{code, name}` list. Added for the Currency field once it grew from 6 entries to
 * every Stripe-supported currency (~135, product-owner-approved 11/12 Oct 2026):
 * the chip-row pattern `ProfileScreen`'s own local `ChipPicker` still uses for the
 * 4-item Language list would wrap into an unusable wall of buttons at that size.
 * No new native dependency pulled in, same reasoning as `PhoneField`'s own header
 * comment on why a Picker dependency isn't worth it for a couple of fields. */
export function SearchablePickerField({
  options,
  value,
  onSelect,
  loading,
  placeholder: placeholderProp,
  searchPlaceholder: searchPlaceholderProp,
  emptyLabel: emptyLabelProp,
  triggerAccessibilityLabel,
}: {
  options: CodeNameOption[];
  value: string;
  onSelect: (code: string) => void;
  loading?: boolean;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyLabel?: string;
  triggerAccessibilityLabel?: string;
}) {
  const t = useT();
  const placeholder = placeholderProp ?? t('common.searchablePicker.placeholder');
  const searchPlaceholder = searchPlaceholderProp ?? t('common.searchablePicker.searchPlaceholder');
  const emptyLabel = emptyLabelProp ?? t('common.searchablePicker.empty');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return options;
    return options.filter((o) => o.name.toLowerCase().includes(q) || o.code.toLowerCase().includes(q));
  }, [search, options]);

  const selected = options.find((o) => o.code === value);

  function select(code: string) {
    onSelect(code);
    setOpen(false);
    setSearch('');
  }

  if (loading) return <ActivityIndicator />;
  if (options.length === 0) return <Text style={styles.hint}>{emptyLabel}</Text>;

  return (
    <View>
      <Pressable
        onPress={() => setOpen(true)}
        style={({ pressed }) => [styles.input, styles.searchPickerTrigger, pressed && styles.buttonPressed]}
        accessibilityRole="button"
        accessibilityLabel={triggerAccessibilityLabel}
      >
        <Text style={[styles.phoneFieldTriggerText, !selected && { color: theme.textMuted }]}>
          {selected ? `${selected.code} — ${selected.name}` : placeholder}
        </Text>
      </Pressable>
      <Modal visible={open} animationType="slide" onRequestClose={() => setOpen(false)}>
        <View style={styles.phoneFieldModal}>
          <TextInput
            style={styles.input}
            placeholderTextColor={theme.textMuted}
            placeholder={searchPlaceholder}
            accessibilityLabel={searchPlaceholder}
            autoFocus
            value={search}
            onChangeText={setSearch}
          />
          <FlatList
            data={filtered}
            keyExtractor={(o) => o.code}
            renderItem={({ item }) => (
              <Pressable
                onPress={() => select(item.code)}
                style={({ pressed }) => [styles.phoneFieldOption, pressed && styles.buttonPressed]}
                accessibilityRole="button"
              >
                <Text style={styles.phoneFieldOptionName}>{item.name}</Text>
                <Text style={styles.phoneFieldOptionDial}>{item.code}</Text>
              </Pressable>
            )}
          />
          <Button title={t('common.close')} variant="secondary" onPress={() => setOpen(false)} />
        </View>
      </Modal>
    </View>
  );
}

export function Button({
  title,
  onPress,
  loading,
  variant = 'primary',
  disabled,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  variant?: 'primary' | 'secondary' | 'destructive';
  disabled?: boolean;
}) {
  // Decision 266 — "light theming post-login": the primary button is the
  // single most-repeated accent-colored surface in this app, so it's the one
  // place this feature's narrow scope actually applies the School's color.
  // Resolves to `null` outside AppNavigator (SchoolThemeProvider isn't
  // mounted there) or for a multi-School Student (SchoolThemeContext's own
  // comment) — React context already falls back to the default value with
  // no Provider above it, so this needs no conditional rendering here.
  const { accentColor } = useSchoolTheme();
  const accentOverride = variant === 'primary' && accentColor ? { backgroundColor: accentColor } : null;

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => [
        styles.button,
        variant === 'secondary' && styles.buttonSecondary,
        variant === 'destructive' && styles.buttonDestructive,
        accentOverride,
        (disabled || loading) && styles.buttonDisabled,
        pressed && styles.buttonPressed,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={variant === 'secondary' ? theme.textAccent : theme.onAccent} />
      ) : (
        <Text style={[styles.buttonText, variant === 'secondary' && styles.buttonTextSecondary]}>
          {title}
        </Text>
      )}
    </Pressable>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <View style={styles.errorBanner}>
      <Text style={styles.errorText}>{message}</Text>
    </View>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <View style={styles.successBanner}>
      <Text style={styles.successText}>{message}</Text>
    </View>
  );
}

/** A lighter-weight error display than `ErrorBanner` — no padded/colored box, just
 * text in the shared error color — for per-row inline errors (e.g. a failed booking
 * action) where a full banner would look out of place crammed into a compact row. */
export function InlineError({ message }: { message: string }) {
  return <Text style={styles.inlineErrorText}>{message}</Text>;
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: theme.surface0,
    padding: spacing[4] + spacing[1], // 20 — no exact DESIGN.md token, closest is space-4/space-6; kept as-is since it's a wrapper margin, not a component listed in DESIGN.md's own state table.
  },
  field: {
    marginBottom: spacing[4],
  },
  label: {
    fontSize: fontSize.caption,
    fontWeight: fontWeight.heading,
    color: theme.textPrimary,
    marginBottom: spacing[2],
  },
  hint: {
    fontSize: fontSize.caption,
    color: theme.textSecondary,
    marginTop: spacing[1],
  },
  input: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.input,
    paddingHorizontal: spacing[3],
    paddingVertical: spacing[3],
    fontSize: fontSize.input,
    color: theme.textPrimary,
  },
  phoneFieldRow: {
    flexDirection: 'row',
    gap: spacing[2],
  },
  phoneFieldTrigger: {
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: radius.input,
    paddingHorizontal: spacing[3],
    minHeight: minTouchTarget,
    minWidth: 88,
    alignItems: 'center',
    justifyContent: 'center',
  },
  phoneFieldTriggerText: {
    fontSize: fontSize.input,
    color: theme.textPrimary,
  },
  phoneFieldInput: {
    flex: 1,
  },
  searchPickerTrigger: {
    minHeight: minTouchTarget,
    justifyContent: 'center',
  },
  phoneFieldModal: {
    flex: 1,
    backgroundColor: theme.surface0,
    padding: spacing[4],
    paddingTop: spacing[8],
    gap: spacing[2],
  },
  phoneFieldOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing[2],
    minHeight: minTouchTarget,
    paddingHorizontal: spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  phoneFieldOptionFlag: {
    fontSize: fontSize.headingSm,
  },
  phoneFieldOptionName: {
    flex: 1,
    fontSize: fontSize.footnote,
    color: theme.textPrimary,
  },
  phoneFieldOptionDial: {
    fontSize: fontSize.caption,
    color: theme.textSecondary,
  },
  button: {
    backgroundColor: theme.fillAccent,
    borderRadius: radius.button,
    paddingVertical: spacing[3],
    minHeight: minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing[2],
  },
  buttonSecondary: {
    backgroundColor: 'transparent',
  },
  buttonDestructive: {
    backgroundColor: colors.danger,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonPressed: {
    opacity: 0.85,
  },
  buttonText: {
    color: theme.onAccent,
    fontWeight: fontWeight.heading,
    fontSize: fontSize.footnote,
  },
  buttonTextSecondary: {
    color: theme.textAccent,
  },
  errorBanner: {
    backgroundColor: theme.bgDanger,
    borderRadius: radius.input,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  errorText: {
    color: theme.textDanger,
    fontSize: fontSize.caption,
  },
  inlineErrorText: {
    color: theme.textDanger,
    fontSize: fontSize.caption,
    marginTop: spacing[1],
  },
  successBanner: {
    backgroundColor: theme.bgSuccess,
    borderRadius: radius.input,
    padding: spacing[3],
    marginBottom: spacing[3],
  },
  successText: {
    color: theme.textSuccess,
    fontSize: fontSize.caption,
  },
});
