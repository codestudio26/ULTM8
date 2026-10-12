import React, { forwardRef, useEffect, useMemo, useRef, useState, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { NavLink } from 'react-router-dom';
import {
  AsYouType,
  getCountryCallingCode,
  isValidPhoneNumber,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js';

/* ---------------------------------------------------------------------- Button */

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'success';
  fullWidth?: boolean;
  loading?: boolean;
}

export function Button({ variant = 'primary', fullWidth, loading, disabled, children, className, ...rest }: ButtonProps) {
  const classes = ['ultm8-btn', `ultm8-btn--${variant}`, fullWidth ? 'ultm8-btn--full' : '', className ?? ''].join(' ').trim();
  return (
    <button className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/* ---------------------------------------------------------------------- Field wrapper */

export interface FieldProps {
  label: string;
  htmlFor: string;
  hint?: string;
  error?: string;
  /** Optional inline element rendered alongside the label (e.g. a "Forgot your
   * passcode?" link) — same row, opposite end. */
  labelAction?: ReactNode;
  children: ReactNode;
}

export function Field({ label, htmlFor, hint, error, labelAction, children }: FieldProps) {
  const hintId = hint ? `${htmlFor}-hint` : undefined;
  const errorId = error ? `${htmlFor}-error` : undefined;
  return (
    <div className="ultm8-field">
      <div className="ultm8-field__label-row">
        <label className="ultm8-field__label" htmlFor={htmlFor}>
          {label}
        </label>
        {labelAction}
      </div>
      {React.isValidElement(children)
        ? React.cloneElement(children as React.ReactElement<any>, {
            id: htmlFor,
            'aria-invalid': error ? 'true' : undefined,
            'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
          })
        : children}
      {hint && !error ? (
        <span className="ultm8-field__hint" id={hintId}>
          {hint}
        </span>
      ) : null}
      {error ? (
        <span className="ultm8-field__error" id={errorId} role="alert">
          {error}
        </span>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- Inputs */

export const TextField = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>((props, ref) => (
  <input ref={ref} className="ultm8-input" {...props} />
));
TextField.displayName = 'TextField';

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>((props, ref) => (
  <textarea ref={ref} className="ultm8-input" {...props} />
));
TextArea.displayName = 'TextArea';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectFieldProps extends SelectHTMLAttributes<HTMLSelectElement> {
  options: SelectOption[];
}

export const SelectField = forwardRef<HTMLSelectElement, SelectFieldProps>(({ options, ...rest }, ref) => (
  <select ref={ref} className="ultm8-select" {...rest}>
    {options.map((opt) => (
      <option key={opt.value} value={opt.value}>
        {opt.label}
      </option>
    ))}
  </select>
));
SelectField.displayName = 'SelectField';

/* ---------------------------------------------------------------------- Timezone combobox */

/** The full IANA tz database the runtime ships, not a hand-maintained list — this is
 * exactly what `Intl.supportedValuesOf('timeZone')` exists for (Node 18+ / every
 * evergreen browser). The `typeof` guard and short fallback below are defensive only;
 * this app's supported runtimes all have it. */
const ALL_TIMEZONES: string[] = (() => {
  try {
    if (typeof Intl.supportedValuesOf === 'function') {
      return Intl.supportedValuesOf('timeZone');
    }
  } catch {
    /* fall through to the fallback below */
  }
  return [
    'UTC',
    'America/New_York',
    'America/Chicago',
    'America/Denver',
    'America/Los_Angeles',
    'Europe/London',
    'Europe/Paris',
    'Asia/Tokyo',
    'Asia/Shanghai',
    'Australia/Sydney',
  ];
})();

/** Live, DST-aware UTC offset for `zone` at `at` — computed from the runtime's own
 * tz database via `Intl.DateTimeFormat`, never a hardcoded offset table (which would
 * go stale at every DST transition). `timeZoneName: 'longOffset'` is the option that
 * reliably yields a numeric `GMT±HH:MM` part across zones; some implementations
 * render the zero-offset zone as plain `GMT`, normalized to `UTC+00:00` here so every
 * zone's label has the same shape. */
function getUtcOffsetLabel(zone: string, at: Date): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' })
      .formatToParts(at)
      .find((p) => p.type === 'timeZoneName')?.value;
    if (!part) return '';
    return part === 'GMT' ? 'UTC+00:00' : part.replace('GMT', 'UTC');
  } catch {
    return '';
  }
}

/* ---------------------------------------------------------------------- Phone field */

/** `[ISO 3166-1 alpha-2, English name, calling code]` for every country/territory
 * `libphonenumber-js`'s "min" metadata (see this file's own `libphonenumber-js`
 * import — same build, not `/max` or `/mobile`: this field is reused for both
 * login/OTP mobile numbers AND School/Franchise/Branch business contact numbers,
 * which aren't confirmed to always be mobile lines, so the `mobile`-only metadata's
 * stricter `isValid()` risked flagging a genuine landline contact number as
 * invalid — `min` is also the package's own documented default) actually supports,
 * generated once via `getCountries()` + `Intl.DisplayNames` and frozen here rather
 * than computed at runtime — avoids depending on `Intl.DisplayNames` (not
 * universally available, notably on some React Native/Hermes builds, which is
 * exactly why the apps/student PhoneField keeps its own identical copy of this
 * list instead of a runtime lookup) and keeps country names identical between
 * this web implementation and that native one. Sorted by name for the picker. */
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

/** `AA` → 🇦🇦 via the "regional indicator symbol" Unicode block — standard trick,
 * degrades gracefully to the plain two letters on platforms without flag-emoji
 * rendering (older Windows browsers) rather than erroring. */
function flagEmoji(iso2: string): string {
  return iso2
    .toUpperCase()
    .replace(/./g, (char) => String.fromCodePoint(127397 + char.charCodeAt(0)));
}

/** Best-effort E.164 string from a country + whatever national-number digits have
 * been typed so far — always returns *something* shaped like E.164 once a country
 * is picked, even mid-typing, rather than only once the number is complete/valid.
 * `AsYouType.getNumber()` only returns a `PhoneNumber` once the digits so far are
 * at least "possible" for that country, so a manual `+<calling code><digits>`
 * fallback covers every shorter, in-progress input. */
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

function formatTimezoneOption(zone: string, at: Date): string {
  const offset = getUtcOffsetLabel(zone, at);
  return offset ? `${zone} (${offset})` : zone;
}

const TIMEZONE_MAX_RESULTS = 50;

export interface TimezoneFieldProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  'aria-invalid'?: React.AriaAttributes['aria-invalid'];
  'aria-describedby'?: string;
}

/** Searchable combobox over the full IANA timezone list, each option showing its
 * live UTC offset (Decision: replaces the plain free-text "IANA name" `TextField`
 * every Branch/School timezone field used — product-approved full combobox, not a
 * `<datalist>`). The committed value stays a plain IANA string (e.g.
 * `"America/New_York"`), same shape the free-text field carried, so no DTO/backend
 * change is needed.
 *
 * Follows the ARIA 1.2 "editable combobox with list autocomplete" pattern: `role`
 * lives on the `<input>` itself (`combobox`/`aria-expanded`/`aria-controls`/
 * `aria-autocomplete="list"`/`aria-activedescendant`), with a sibling `listbox` of
 * `option`s. No existing component in this package already had a dropdown/listbox
 * to match — `Modal` is the only other floating-layer pattern, so this borrows its
 * surface/shadow/radius tokens for the popover rather than inventing new ones. */
export function TimezoneField({
  id,
  value,
  onChange,
  placeholder,
  disabled,
  required,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: TimezoneFieldProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const baseId = id ?? 'ultm8-timezone';
  const listboxId = `${baseId}-listbox`;
  const optionId = (zone: string) => `${baseId}-option-${zone.replace(/[^a-zA-Z0-9]/g, '-')}`;

  // Computed once per render, not cached across renders — cheap (one
  // `Intl.DateTimeFormat` per visible option) and keeps the offset correct across a
  // DST transition without any extra wiring.
  const now = new Date();

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = !q
      ? ALL_TIMEZONES
      : ALL_TIMEZONES.filter((zone) => {
          const normalized = zone.toLowerCase();
          // Matches the raw IANA name AND its underscore-free reading (e.g. typing
          // "new york" still finds "America/New_York") — still a plain substring
          // match on the zone name, just normalized for the one punctuation
          // difference between how these names are typed vs. written.
          return normalized.includes(q) || normalized.replace(/_/g, ' ').includes(q);
        });
    return matches.slice(0, TIMEZONE_MAX_RESULTS);
  }, [query]);

  useEffect(() => {
    if (!isOpen) return;
    function handleOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setQuery('');
        setActiveIndex(-1);
      }
    }
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, [isOpen]);

  function openDropdown() {
    setQuery('');
    setIsOpen(true);
    setActiveIndex(-1);
  }

  function closeDropdown() {
    setIsOpen(false);
    setQuery('');
    setActiveIndex(-1);
  }

  function selectZone(zone: string) {
    onChange(zone);
    closeDropdown();
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (!isOpen) {
          openDropdown();
        } else {
          setActiveIndex((i) => Math.min(i + 1, results.length - 1));
        }
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (isOpen) setActiveIndex((i) => Math.max(i - 1, 0));
        break;
      case 'Enter':
        if (isOpen && activeIndex >= 0 && results[activeIndex]) {
          e.preventDefault();
          selectZone(results[activeIndex]);
        }
        break;
      case 'Escape':
        if (isOpen) {
          e.preventDefault();
          closeDropdown();
        }
        break;
      default:
        break;
    }
  }

  // While open, the input shows what's being typed (`query`); while closed, it
  // shows the committed value's formatted "zone (offset)" label.
  const displayValue = isOpen ? query : value ? formatTimezoneOption(value, now) : '';

  return (
    <div className="ultm8-combobox" ref={containerRef}>
      <input
        id={id}
        role="combobox"
        type="text"
        autoComplete="off"
        className="ultm8-input"
        aria-expanded={isOpen}
        aria-controls={isOpen ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={isOpen && activeIndex >= 0 ? optionId(results[activeIndex]) : undefined}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        disabled={disabled}
        required={required}
        placeholder={placeholder}
        value={displayValue}
        onFocus={openDropdown}
        onChange={(e) => {
          setQuery(e.target.value);
          setIsOpen(true);
          setActiveIndex(-1);
        }}
        onKeyDown={handleKeyDown}
        onBlur={closeDropdown}
      />
      {isOpen ? (
        <ul className="ultm8-combobox__listbox" role="listbox" id={listboxId}>
          {results.length === 0 ? (
            <li className="ultm8-combobox__empty">No matching timezone</li>
          ) : (
            results.map((zone, i) => (
              <li
                key={zone}
                id={optionId(zone)}
                role="option"
                aria-selected={zone === value}
                className={['ultm8-combobox__option', i === activeIndex ? 'ultm8-combobox__option--active' : ''].join(' ').trim()}
                // `preventDefault` on mousedown keeps focus in the input across the
                // click, so no `blur` fires before `onClick`'s `selectZone` runs.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => selectZone(zone)}
                onMouseEnter={() => setActiveIndex(i)}
              >
                {formatTimezoneOption(zone, now)}
              </li>
            ))
          )}
        </ul>
      ) : null}
    </div>
  );
}

export interface PhoneFieldProps {
  /** Always a plain E.164 string (e.g. `"+15551234567"`), or `''` until a country
   * has been chosen and at least one digit typed — never a formatted/national
   * display string. */
  value: string;
  onChange: (value: string) => void;
  /** Initial country when `value` is empty and nothing's been typed yet — pass the
   * caller's own best locale guess (e.g. parsed device/browser locale). Omit to
   * force an explicit choice rather than guessing wrong for the wrong country. */
  defaultCountry?: CountryCode;
  id?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  'aria-invalid'?: 'true' | 'false';
  'aria-describedby'?: string;
}

/** A country-flag/dial-code selector paired with a national-number text input,
 * composing to a full E.164 string via `libphonenumber-js`. `Field` (above) clones
 * `id`/`aria-invalid`/`aria-describedby` onto its child, which land here on the
 * national-number `<input>` — the control a `<label htmlFor>` can actually
 * associate with — not on the outer wrapper or the country-picker button. */
export const PhoneField = forwardRef<HTMLInputElement, PhoneFieldProps>(
  (
    { value, onChange, defaultCountry, id, required, disabled, placeholder, 'aria-invalid': ariaInvalid, 'aria-describedby': ariaDescribedBy },
    ref,
  ) => {
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
    const rootRef = useRef<HTMLDivElement | null>(null);
    const searchRef = useRef<HTMLInputElement | null>(null);

    // Resync from an *external* value change (e.g. the parent prefilling this
    // field from a route param after another screen already collected the
    // number) — not from our own `emit()` below, which already updated
    // `lastEmitted` before calling `onChange`, so a controlled parent that just
    // stores what it's given doesn't bounce straight back into a resync here.
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

    useEffect(() => {
      if (!open) return;
      function onDocPointerDown(e: MouseEvent) {
        if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
      }
      document.addEventListener('mousedown', onDocPointerDown);
      return () => document.removeEventListener('mousedown', onDocPointerDown);
    }, [open]);

    useEffect(() => {
      if (open) searchRef.current?.focus();
    }, [open]);

    function emit(nextCountry: CountryCode | undefined, nextDigits: string) {
      const e164 = composeE164(nextCountry, nextDigits);
      lastEmitted.current = e164;
      onChange(e164);
    }

    function handleNationalInput(raw: string) {
      const trimmed = raw.trim();
      // Pasting a full international number (e.g. copied from elsewhere) — detect
      // and switch country automatically rather than mangling it against whatever
      // country happened to be selected already.
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
      if (!q) return PHONE_COUNTRIES;
      return PHONE_COUNTRIES.filter(
        ([code, name, dial]) => name.toLowerCase().includes(q) || dial.includes(q.replace(/^\+/, '')) || code.toLowerCase() === q,
      );
    }, [search]);

    const selected = country ? PHONE_COUNTRIES.find(([code]) => code === country) : undefined;

    return (
      <div className="ultm8-phone-field" ref={rootRef}>
        <button
          type="button"
          className="ultm8-phone-field__trigger"
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-label="Country calling code"
          onClick={() => setOpen((o) => !o)}
        >
          {selected ? (
            <>
              <span aria-hidden="true">{flagEmoji(selected[0])}</span>
              <span>+{selected[2]}</span>
            </>
          ) : (
            <span className="ultm8-phone-field__placeholder">Country</span>
          )}
          <span className="ultm8-phone-field__caret" aria-hidden="true">
            ▾
          </span>
        </button>
        <input
          ref={ref}
          id={id}
          type="tel"
          className="ultm8-input ultm8-phone-field__input"
          required={required}
          disabled={disabled}
          placeholder={placeholder}
          aria-invalid={ariaInvalid ?? (invalid ? 'true' : undefined)}
          aria-describedby={ariaDescribedBy}
          value={displayNational}
          onChange={(e) => handleNationalInput(e.target.value)}
          onBlur={() => setTouched(true)}
        />
        {open ? (
          <div className="ultm8-phone-field__popover" role="presentation">
            <input
              ref={searchRef}
              type="text"
              className="ultm8-phone-field__search"
              placeholder="Search country or dial code…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') setOpen(false);
                else if (e.key === 'Enter' && filtered.length > 0) {
                  e.preventDefault();
                  selectCountry(filtered[0][0]);
                }
              }}
            />
            <ul className="ultm8-phone-field__list" role="listbox" aria-label="Country">
              {filtered.length === 0 ? (
                <li className="ultm8-phone-field__empty">No matches.</li>
              ) : (
                filtered.map(([code, name, dial]) => (
                  <li key={code}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={code === country}
                      className="ultm8-phone-field__option"
                      onClick={() => selectCountry(code)}
                    >
                      <span aria-hidden="true">{flagEmoji(code)}</span>
                      <span className="ultm8-phone-field__option-name">{name}</span>
                      <span className="ultm8-phone-field__option-dial">+{dial}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </div>
        ) : null}
        {invalid ? (
          <span className="ultm8-field__error" role="alert">
            Enter a valid phone number{selected ? ` for ${selected[1]}` : ''}.
          </span>
        ) : null}
      </div>
    );
  },
);
PhoneField.displayName = 'PhoneField';

function EyeIcon() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
      <path
        d="M1 7C1 7 4.5 1.5 10 1.5C15.5 1.5 19 7 19 7C19 7 15.5 12.5 10 12.5C4.5 12.5 1 7 1 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <circle cx="10" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="20" height="14" viewBox="0 0 20 14" fill="none" aria-hidden="true">
      <path
        d="M1 7C1 7 4.5 1.5 10 1.5C15.5 1.5 19 7 19 7C19 7 15.5 12.5 10 12.5C4.5 12.5 1 7 1 7Z"
        stroke="currentColor"
        strokeWidth="1.3"
      />
      <line x1="2" y1="12" x2="18" y2="2" stroke="currentColor" strokeWidth="1.3" />
    </svg>
  );
}

/** A passcode/password input with a show/hide toggle — same `ultm8-input` look and
 * the same props surface as `TextField`, so it drops in wherever a masked field is
 * used today. */
export const PasscodeField = forwardRef<HTMLInputElement, Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...rest }, ref) => {
    const [visible, setVisible] = useState(false);
    return (
      <div className="ultm8-passcode-field">
        <input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={['ultm8-input', className ?? ''].join(' ').trim()}
          {...rest}
        />
        <button
          type="button"
          className="ultm8-passcode-field__toggle"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? 'Hide passcode' : 'Show passcode'}
        >
          {visible ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    );
  },
);
PasscodeField.displayName = 'PasscodeField';

export interface SegmentedCodeInputProps extends Omit<React.HTMLAttributes<HTMLDivElement>, 'onChange'> {
  /** Number of digit boxes. Defaults to 6 — matches this app's own passcode length
   * and Twilio Verify's typical default, but the real OTP length isn't confirmed by
   * the backend (`VerifyOtpDto.code` only validates `@Length(4, 8)`) — flagged as an
   * assumption, not a confirmed value. */
  length?: number;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
  /** Applied to every box, so the browser blocks submission until all are filled —
   * matches (and improves on) the plain-text field's own `required`, which only
   * checked "not empty," not "exactly `length` digits." */
  required?: boolean;
}

/** A 6-box (by default) digit input for OTP/verification codes, matching the
 * approved Figma-reference design. Single control: `value`/`onChange` carry the
 * concatenated digit string, same shape a plain text `code` field would.
 *
 * `id`/`aria-invalid`/`aria-describedby` (as `Field` clones onto a single child)
 * land on the FIRST box, not the outer group `<div>` — a `<label htmlFor>` can
 * only associate with a labelable control, and a `role="group"` div isn't one; the
 * previous plain `<input>` was directly labelable, so anchoring to box 0 keeps
 * "click the label to focus the field" and the screen-reader name/error working. */
export function SegmentedCodeInput({
  length = 6,
  value,
  onChange,
  autoFocus,
  required,
  id,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
  ...rest
}: SegmentedCodeInputProps) {
  const inputsRef = useRef<Array<HTMLInputElement | null>>([]);

  function handleChange(index: number, e: React.ChangeEvent<HTMLInputElement>) {
    const raw = e.target.value.replace(/\D/g, '');
    if (!raw) {
      // Clearing an already-filled box — drop it and everything after, same as a
      // plain text field losing its tail; a string has no way to represent "blank
      // here, digits after" without a placeholder character.
      if (index < value.length) onChange(value.slice(0, index));
      return;
    }
    const digit = raw[raw.length - 1];
    if (index < value.length) {
      // Editing an already-filled digit in place — keep every other position.
      const next = value.slice(0, index) + digit + value.slice(index + 1);
      onChange(next);
      if (index < length - 1) inputsRef.current[index + 1]?.focus();
      return;
    }
    // Typing into a box ahead of the current end (e.g. clicked a later empty box
    // directly, not reached via auto-advance). The digit lands at the true next
    // slot, not at `index` — `chars[index] = digit; chars.join('')` would silently
    // collapse the gap (array holes join as '', losing position), corrupting which
    // digit ends up where. Landing it at the real next slot and refocusing there
    // keeps state correct and is self-correcting for the user.
    const next = (value + digit).slice(0, length);
    onChange(next);
    if (next.length < length) inputsRef.current[next.length]?.focus();
  }

  function handleKeyDown(index: number, e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Backspace') return;
    // Handled explicitly rather than left to the native input: with `maxLength={1}`,
    // where the browser places the cursor inside an already-filled box is ambiguous
    // (before or after the one character, depending on click position) — Backspace
    // can silently do nothing if the cursor lands before it. Owning the behavior
    // here makes it deterministic: clear this box and stay, or if already empty,
    // clear the previous box and move focus there — the standard OTP-input pattern.
    e.preventDefault();
    if (value[index]) {
      onChange(value.slice(0, index) + value.slice(index + 1));
    } else if (index > 0) {
      onChange(value.slice(0, index - 1) + value.slice(index));
      inputsRef.current[index - 1]?.focus();
    }
  }

  function handlePaste(e: React.ClipboardEvent<HTMLInputElement>) {
    const digits = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, length);
    if (!digits) return;
    e.preventDefault();
    onChange(digits);
    inputsRef.current[Math.min(digits.length, length - 1)]?.focus();
  }

  return (
    <div className="ultm8-segmented-code" role="group" {...rest}>
      {Array.from({ length }).map((_, i) => (
        <input
          key={i}
          id={i === 0 ? id : undefined}
          aria-invalid={i === 0 ? ariaInvalid : undefined}
          aria-describedby={i === 0 ? ariaDescribedBy : undefined}
          required={required}
          ref={(el) => {
            inputsRef.current[i] = el;
          }}
          className="ultm8-segmented-code__box"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={1}
          value={value[i] ?? ''}
          onChange={(e) => handleChange(i, e)}
          onKeyDown={(e) => handleKeyDown(i, e)}
          onFocus={(e) => e.target.select()}
          onPaste={handlePaste}
          autoFocus={autoFocus && i === 0}
        />
      ))}
    </div>
  );
}

export function Checkbox({ label, ...rest }: { label: string } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className="ultm8-checkbox">
      <input type="checkbox" {...rest} />
      {label}
    </label>
  );
}

/* ---------------------------------------------------------------------- Layout */

export function Card({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={['ultm8-card', className ?? ''].join(' ').trim()}>{children}</div>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="ultm8-page-header">
      <div>
        <h1 className="ultm8-page-header__title">{title}</h1>
        {subtitle ? <p className="ultm8-page-header__subtitle">{subtitle}</p> : null}
      </div>
      {actions}
    </div>
  );
}

/* ---------------------------------------------------------------------- Row actions (kebab menu) */

export interface RowAction {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Visually distinguishes a destructive action (e.g. "Delete") — same
   * red treatment `Button`'s `danger` variant uses elsewhere. */
  variant?: 'default' | 'danger';
}

export interface RowActionsMenuProps {
  /** Used as the trigger button's `aria-label` (e.g. `Actions for ${title}`) —
   * every action is a `menuitem`, so a per-row label is the only way a screen
   * reader distinguishes this row's "⋮" button from every other row's. Also
   * doubles as the open menu's `aria-label`. */
  label: string;
  actions: RowAction[];
}

/** Collapses a row's always-visible action buttons behind a single "⋮" trigger
 * — same popover ingredients `PhoneField`'s country picker and `TimezoneField`'s
 * listbox already use (outside-`mousedown` dismissal, `Escape` to close,
 * absolutely-positioned panel), since no dedicated `Menu`/`Dropdown` component
 * existed in this package yet. Lives here rather than page-local because dense
 * list-page tables with several per-row actions are a recurring shape across
 * this app (Branches, Disciplines, Curriculum, …), not a one-off. */
export function RowActionsMenu({ label, actions }: RowActionsMenuProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  return (
    <div
      className="ultm8-row-actions"
      ref={rootRef}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          close();
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        className="ultm8-row-actions__trigger"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">⋮</span>
      </button>
      {open ? (
        <ul className="ultm8-row-actions__menu" role="menu" aria-label={label}>
          {actions.map((action, i) => (
            <li key={i} role="none">
              <button
                type="button"
                role="menuitem"
                disabled={action.disabled}
                className={[
                  'ultm8-row-actions__item',
                  action.variant === 'danger' ? 'ultm8-row-actions__item--danger' : '',
                ]
                  .join(' ')
                  .trim()}
                onClick={() => {
                  close();
                  action.onClick();
                }}
              >
                {action.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

/* ---------------------------------------------------------------------- Table */

export interface TableColumn<T> {
  key: string;
  header: string;
  render: (row: T) => ReactNode;
}

export function Table<T extends { id: string }>({ columns, rows }: { columns: TableColumn<T>[]; rows: T[] }) {
  return (
    // Scrolls horizontally within itself rather than letting a wide table push the
    // page wider (DESIGN.md "Layout & spacing": no horizontal overflow at any
    // breakpoint — this is the one place in this component set a table's natural
    // column count can realistically exceed a phone viewport).
    <div className="ultm8-table-scroll">
      <table className="ultm8-table">
        <thead>
          <tr>
            {columns.map((col) => (
              <th key={col.key}>{col.header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              {columns.map((col) => (
                <td key={col.key}>{col.render(row)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------- Feedback */

export function Badge({ children, variant = 'default' }: { children: ReactNode; variant?: 'default' | 'accent' | 'success' | 'danger' }) {
  const cls = variant === 'default' ? 'ultm8-badge' : `ultm8-badge ultm8-badge--${variant}`;
  return <span className={cls}>{children}</span>;
}

export function Spinner() {
  return <span className="ultm8-spinner" role="status" aria-label="Loading" />;
}

export function EmptyState({ title, description, action }: { title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="ultm8-state">
      <p className="ultm8-state__title">{title}</p>
      {description ? <p>{description}</p> : null}
      {action}
    </div>
  );
}

export function ErrorBanner({ message }: { message: string }) {
  return (
    <div className="ultm8-banner ultm8-banner--error" role="alert">
      {message}
    </div>
  );
}

export function SuccessBanner({ message }: { message: string }) {
  return (
    <div className="ultm8-banner ultm8-banner--success" role="status">
      {message}
    </div>
  );
}

/* ---------------------------------------------------------------------- App shell */

export interface NavItem {
  label: string;
  to: string;
}

export function AppShell({
  brand,
  navItems,
  footer,
  header,
  children,
}: {
  brand: string;
  navItems: NavItem[];
  footer?: ReactNode;
  /** Optional app-shell header, rendered once at the top of the main content
   * column (above every page's own content) — opt-in so an app that doesn't
   * pass it (e.g. platform-admin's Shell today) renders exactly as before. */
  header?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="ultm8-shell">
      <aside className="ultm8-shell__sidebar">
        <p className="ultm8-shell__brand">{brand}</p>
        <nav>
          {navItems.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) => 'ultm8-shell__nav-link' + (isActive ? ' ultm8-shell__nav-link--active' : '')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        {footer ? <div className="ultm8-shell__footer-action">{footer}</div> : null}
      </aside>
      <main className="ultm8-shell__main">
        {header ? <div className="ultm8-shell__topbar">{header}</div> : null}
        {children}
      </main>
    </div>
  );
}

/* ---------------------------------------------------------------------- Auth card layout */

export function AuthCard({
  title,
  subtitle,
  children,
  footer,
  rail,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
  /** Optional banner rendered above the card, inside the same centered column —
   * currently only Login's brand rail uses this. */
  rail?: ReactNode;
}) {
  return (
    <div className="ultm8-auth-page">
      <div className="ultm8-auth-card">
        {rail}
        <Card>
          <h1 className="ultm8-auth-card__title">{title}</h1>
          {subtitle ? <p className="ultm8-auth-card__subtitle">{subtitle}</p> : null}
          {children}
        </Card>
        {footer ? <div className="ultm8-auth-card__footer">{footer}</div> : null}
      </div>
    </div>
  );
}

/** Checkmark / title / subtitle / dismiss (×) confirmation panel — the pattern
 * DESIGN.md's "Success confirmation panel" section documents, now built for real.
 * Auto-advances via `onContinue` after `autoAdvanceMs`, but the dismiss button or a
 * `secondaryAction` (if given) let the user skip the wait immediately. */
export function SuccessPanel({
  title,
  subtitle,
  onContinue,
  autoAdvanceMs = 2000,
}: {
  title: string;
  subtitle?: string;
  onContinue: () => void;
  autoAdvanceMs?: number;
}) {
  const onContinueRef = useRef(onContinue);
  onContinueRef.current = onContinue;

  useEffect(() => {
    const timer = setTimeout(() => onContinueRef.current(), autoAdvanceMs);
    return () => clearTimeout(timer);
  }, [autoAdvanceMs]);

  return (
    <div className="ultm8-success-panel">
      <button type="button" className="ultm8-success-panel__dismiss" aria-label="Dismiss" onClick={onContinue}>
        &times;
      </button>
      <div className="ultm8-success-panel__check" aria-hidden="true">
        ✓
      </div>
      <p className="ultm8-success-panel__title">{title}</p>
      {subtitle ? <p className="ultm8-success-panel__subtitle">{subtitle}</p> : null}
    </div>
  );
}

/** The same centered auth-page/card chrome as `AuthCard`, holding a `SuccessPanel`
 * instead of a form — for the post-Login/Register/Reset confirmation screen. */
export function AuthSuccessCard({
  title,
  subtitle,
  onContinue,
  autoAdvanceMs,
}: {
  title: string;
  subtitle?: string;
  onContinue: () => void;
  autoAdvanceMs?: number;
}) {
  return (
    <div className="ultm8-auth-page">
      <div className="ultm8-auth-card">
        <Card>
          <SuccessPanel title={title} subtitle={subtitle} onContinue={onContinue} autoAdvanceMs={autoAdvanceMs} />
        </Card>
      </div>
    </div>
  );
}

/* ---------------------------------------------------------------------- Modal */

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="ultm8-modal-overlay" role="presentation" onClick={onClose}>
      <div
        className="ultm8-modal"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="ultm8-page-header__title">{title}</h2>
        {children}
      </div>
    </div>
  );
}
