import React, { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { COUNTRY_NAMES, Field, SelectField, TextField, useUiLocale } from './components';
import {
  EMPTY_POSTAL_ADDRESS,
  POSTAL_ADDRESS_MAX_LENGTH,
  getAddressFormat,
  isPostalAddressEmpty,
  normalizePostalAddress,
  validatePostalAddress,
  visibleAddressFields,
  type CityLabelKey,
  type PostalAddress,
  type PostalAddressErrors,
  type PostalAddressField,
  type PostalLabelKey,
  type RegionLabelKey,
} from './postalAddress';

/* ---------------------------------------------------------------------- Text
 * Decision 276 — every string this component shows lives in this one object, so
 * the School Portal's translation layer (Decision 273) can pass translated text
 * through `AddressTextProvider` (every form at once) or the `text` prop (one
 * form) instead of these English defaults. */
export const ADDRESS_TEXT = {
  legend: 'Address',
  country: 'Country',
  chooseCountry: 'Select a country',
  line1: 'Address line 1',
  line1Placeholder: 'Street address',
  line2: 'Address line 2',
  line2Placeholder: 'Apartment, suite, unit, building, floor',
  optional: 'optional',
  chooseRegion: 'Select…',
  postalExample: 'e.g. {example}',
  legacyNotice:
    'This address was saved as a single line before addresses had separate fields. Choose the country and check each field to update it, or leave it as it is.',
  search: 'Search address',
  searchPlaceholder: 'Start typing the street and number',
  searchHint: 'Choose a result to fill in the fields below. You can still edit them.',
  searchNoResults: 'No matching address. Enter it in the fields below.',
  searchFailed: "Address search isn't working right now. Enter the address in the fields below.",
  searchAttribution: 'Powered by Google',
  city: { city: 'City', town: 'Town', post_town: 'Town/City', suburb: 'Suburb', district: 'District', area: 'Area' } as Record<CityLabelKey, string>,
  region: {
    state: 'State',
    province: 'Province',
    county: 'County',
    emirate: 'Emirate',
    prefecture: 'Prefecture',
    region: 'State/Province/Region',
    do_si: 'Province (Do/Si)',
    oblast: 'Region (Oblast)',
    area: 'Area',
  } as Record<RegionLabelKey, string>,
  postal: { postal_code: 'Postal code', postcode: 'Postcode', zip: 'ZIP code', pin: 'PIN code', eircode: 'Eircode', cep: 'CEP' } as Record<PostalLabelKey, string>,
  errors: {
    required: '{field} is required.',
    countryRequired: 'Choose a country.',
    countryInvalid: 'Choose a country from the list.',
    tooLong: '{field} is too long.',
    postalInvalid: 'Enter a valid {field}, e.g. {example}.',
    postalInvalidNoExample: 'Enter a valid {field}.',
    regionInvalid: 'Choose a {field} from the list.',
  },
};
export type AddressText = typeof ADDRESS_TEXT;

const AddressTextContext = React.createContext<AddressText>(ADDRESS_TEXT);

/** Sets the text every `AddressFields` below it uses, the same way
 * `UiStringsProvider` does for the rest of this package. */
export function AddressTextProvider({ text, children }: { text: AddressText; children: ReactNode }) {
  return <AddressTextContext.Provider value={text}>{children}</AddressTextContext.Provider>;
}

function fill(template: string, values: Record<string, string>): string {
  return template.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
}

/* ---------------------------------------------------------------------- Record helpers */

/** The address columns every addressable API record (User, School, Branch, Franchise, Instructor) carries. */
export interface PostalAddressRecord {
  address?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  addressCity?: string | null;
  addressRegion?: string | null;
  addressPostalCode?: string | null;
  addressCountry?: string | null;
}

/**
 * The form value for a record's stored address. A record saved before
 * Decision 276 has only the one-line `address` text and no country: that text
 * goes into line 1 so nothing is lost, and the country is left for the person
 * to choose. A record with no address at all starts on `defaultCountry` (the
 * caller's locale guess), so most people never have to pick one.
 */
export function postalAddressFromRecord(record: PostalAddressRecord | null | undefined, defaultCountry?: string): PostalAddress {
  if (record?.addressCountry) {
    return {
      line1: record.addressLine1 ?? '',
      line2: record.addressLine2 ?? '',
      city: record.addressCity ?? '',
      region: record.addressRegion ?? '',
      postalCode: record.addressPostalCode ?? '',
      country: record.addressCountry,
    };
  }
  if (record?.address) return { ...EMPTY_POSTAL_ADDRESS, line1: record.address };
  return { ...EMPTY_POSTAL_ADDRESS, country: defaultCountry ?? '' };
}

/** True when the record still only has a pre-Decision-276 one-line address. */
export function hasLegacyAddressOnly(record: PostalAddressRecord | null | undefined): boolean {
  return Boolean(record?.address && !record.addressCountry);
}

function samePostalAddress(a: PostalAddress, b: PostalAddress): boolean {
  return (Object.keys(EMPTY_POSTAL_ADDRESS) as Array<keyof PostalAddress>).every((k) => a[k] === b[k]);
}

export type PreparedPostalAddress =
  | { ok: true; /** `undefined` = unchanged, leave it out of the request; `null` = clear it. */ postalAddress: PostalAddress | null | undefined }
  | { ok: false; errors: PostalAddressErrors };

/**
 * What a form sends as `postalAddress`. Unchanged from what was loaded → left
 * out entirely, so an untouched legacy address never blocks saving the rest of
 * the form. All blank → `null` (no address). Otherwise it must pass the
 * country's rules, the same ones the API enforces.
 */
export function preparePostalAddress(current: PostalAddress, initial?: PostalAddress): PreparedPostalAddress {
  if (initial && samePostalAddress(current, initial)) return { ok: true, postalAddress: undefined };
  if (isPostalAddressEmpty(current)) return { ok: true, postalAddress: null };
  const errors = validatePostalAddress(current);
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, postalAddress: normalizePostalAddress(current) };
}

/* ---------------------------------------------------------------------- Places hook */

export interface AddressSuggestion {
  id: string;
  label: string;
  /** Optional second line, e.g. the town and country under the street. */
  secondary?: string;
}

/**
 * The seam for address search (Google Places, Decision 212). Pass an
 * implementation as `autocomplete`, or once for every form with
 * `AddressLookupProvider`, and the form gets a "Search address" box above the
 * fields: picking a result fills every field it can, and the person can still
 * edit them. Without one, the form is plain inputs.
 */
export interface AddressAutocompleteProvider {
  suggest(query: string, country: string): Promise<AddressSuggestion[]>;
  resolve(suggestionId: string): Promise<Partial<PostalAddress>>;
}

const AddressLookupContext = React.createContext<AddressAutocompleteProvider | null>(null);

/** Gives every `AddressFields` below it the same search provider; `null` (e.g.
 * while the server's lookup is switched off) leaves the plain fields. */
export function AddressLookupProvider({ provider, children }: { provider: AddressAutocompleteProvider | null; children: ReactNode }) {
  return <AddressLookupContext.Provider value={provider}>{children}</AddressLookupContext.Provider>;
}

/* ---------------------------------------------------------------------- Component */

export interface AddressFieldsProps {
  value: PostalAddress;
  onChange: (next: PostalAddress) => void;
  /** Field errors to show, usually from `preparePostalAddress()` on submit. */
  errors?: PostalAddressErrors;
  /** Prefix for the inputs' ids, unique per form. */
  idPrefix: string;
  /** Shows the "saved as a single line" notice (see `hasLegacyAddressOnly`). */
  legacy?: boolean;
  autocomplete?: AddressAutocompleteProvider;
  text?: AddressText;
  /** Heading over the group; defaults to `text.legend` ("Address"). */
  legend?: string;
  /** Short note under the heading, e.g. "Leave blank to keep unchanged." */
  hint?: string;
  disabled?: boolean;
}

/**
 * Country-first address entry: the country decides which of city / region /
 * postal code are shown, what they're called, which are required, and the
 * postal-code format — the same rules the API checks (`postalAddress.ts`).
 * Changing the country keeps what's typed in the fields both countries use.
 */
export function AddressFields({ value, onChange, errors = {}, idPrefix, legacy, autocomplete: autocompleteProp, text: textProp, legend, hint, disabled }: AddressFieldsProps) {
  const contextText = React.useContext(AddressTextContext);
  const contextLookup = React.useContext(AddressLookupContext);
  const autocomplete = autocompleteProp ?? contextLookup ?? undefined;
  const text = textProp ?? contextText;
  const countryNames = useLocalCountryNames(useUiLocale());
  const format = getAddressFormat(value.country);
  const fields = visibleAddressFields(format);

  function set(field: keyof PostalAddress, next: string) {
    onChange({ ...value, [field]: next });
  }

  function labelFor(field: PostalAddressField): string {
    if (field === 'line1') return text.line1;
    if (field === 'line2') return text.line2;
    if (field === 'city') return text.city[format.city ?? 'city'];
    if (field === 'region') return text.region[format.region ?? 'region'];
    return text.postal[format.postal ?? 'postal_code'];
  }

  function withOptional(field: PostalAddressField): string {
    const label = labelFor(field);
    return format.required.includes(field) ? label : `${label} (${text.optional})`;
  }

  function errorFor(field: PostalAddressField | 'country'): string | undefined {
    const code = errors[field];
    if (!code) return undefined;
    if (field === 'country') return code === 'required' ? text.errors.countryRequired : text.errors.countryInvalid;
    const name = labelFor(field);
    if (code === 'required') return fill(text.errors.required, { field: name });
    if (code === 'too_long') return fill(text.errors.tooLong, { field: name });
    if (field === 'postalCode') {
      return format.postalExample
        ? fill(text.errors.postalInvalid, { field: name, example: format.postalExample })
        : fill(text.errors.postalInvalidNoExample, { field: name });
    }
    return fill(text.errors.regionInvalid, { field: name.toLowerCase() });
  }

  const countryOptions = [{ value: '', label: text.chooseCountry }, ...countryNames.map(([code, name]) => ({ value: code, label: name }))];
  // A stored country the list doesn't know (shouldn't happen) still shows rather than silently blanking.
  if (value.country && !countryNames.some(([code]) => code === value.country)) {
    countryOptions.push({ value: value.country, label: value.country });
  }

  return (
    <fieldset className="ultm8-address">
      <legend className="ultm8-field__label">{legend ?? text.legend}</legend>
      {hint || legacy ? (
        <p className="ultm8-field__hint" style={{ margin: '0 0 var(--space-2)' }}>
          {legacy ? text.legacyNotice : hint}
        </p>
      ) : null}
      <Field label={text.country} htmlFor={`${idPrefix}-country`} error={errorFor('country')}>
        <SelectField
          options={countryOptions}
          value={value.country}
          onChange={(e) => set('country', e.target.value)}
          autoComplete="country"
          disabled={disabled}
        />
      </Field>
      {autocomplete && !disabled ? (
        <AddressSearch id={`${idPrefix}-search`} value={value} onChange={onChange} provider={autocomplete} text={text} />
      ) : null}
      <Field label={withOptional('line1')} htmlFor={`${idPrefix}-line1`} error={errorFor('line1')}>
        <TextField
          value={value.line1}
          onChange={(e) => set('line1', e.target.value)}
          placeholder={text.line1Placeholder}
          autoComplete="address-line1"
          maxLength={POSTAL_ADDRESS_MAX_LENGTH.line1}
          disabled={disabled}
        />
      </Field>
      <Field label={withOptional('line2')} htmlFor={`${idPrefix}-line2`} error={errorFor('line2')}>
        <TextField
          value={value.line2}
          onChange={(e) => set('line2', e.target.value)}
          placeholder={text.line2Placeholder}
          autoComplete="address-line2"
          maxLength={POSTAL_ADDRESS_MAX_LENGTH.line2}
          disabled={disabled}
        />
      </Field>
      <div className="ultm8-address__row">
        {fields.includes('city') ? (
          <Field label={withOptional('city')} htmlFor={`${idPrefix}-city`} error={errorFor('city')}>
            <TextField
              value={value.city}
              onChange={(e) => set('city', e.target.value)}
              autoComplete="address-level2"
              maxLength={POSTAL_ADDRESS_MAX_LENGTH.city}
              disabled={disabled}
            />
          </Field>
        ) : null}
        {fields.includes('region') ? (
          <Field label={withOptional('region')} htmlFor={`${idPrefix}-region`} error={errorFor('region')}>
            {format.regions ? (
              <SelectField
                options={[{ value: '', label: text.chooseRegion }, ...format.regions.map(([v, label]) => ({ value: v, label }))]}
                value={format.regions.some(([v]) => v === value.region) ? value.region : ''}
                onChange={(e) => set('region', e.target.value)}
                autoComplete="address-level1"
                disabled={disabled}
              />
            ) : (
              <TextField
                value={value.region}
                onChange={(e) => set('region', e.target.value)}
                autoComplete="address-level1"
                maxLength={POSTAL_ADDRESS_MAX_LENGTH.region}
                disabled={disabled}
              />
            )}
          </Field>
        ) : null}
        {fields.includes('postalCode') ? (
          <Field label={withOptional('postalCode')} htmlFor={`${idPrefix}-postal`} error={errorFor('postalCode')}>
            <TextField
              value={value.postalCode}
              onChange={(e) => set('postalCode', e.target.value)}
              placeholder={format.postalExample ? fill(text.postalExample, { example: format.postalExample }) : undefined}
              autoComplete="postal-code"
              maxLength={POSTAL_ADDRESS_MAX_LENGTH.postalCode}
              disabled={disabled}
            />
          </Field>
        ) : null}
      </div>
    </fieldset>
  );
}

/** The country list in the reader's language, sorted in it, when a locale is
 * set (same approach as `PhoneField`); English keeps the package's own names. */
function useLocalCountryNames(locale: string | undefined): ReadonlyArray<readonly [string, string]> {
  return useMemo(() => {
    if (!locale) return COUNTRY_NAMES;
    let names: Intl.DisplayNames | undefined;
    try {
      names = new Intl.DisplayNames([locale], { type: 'region' });
    } catch {
      return COUNTRY_NAMES;
    }
    return COUNTRY_NAMES.map(([code, name]) => [code, names?.of(code) ?? name] as const).sort((a, b) => a[1].localeCompare(b[1], locale));
  }, [locale]);
}

type SearchState = 'idle' | 'done' | 'failed';

/**
 * "Search address": a combobox above the fields, only shown when a provider is
 * given. Searches in the chosen country after a short pause in typing;
 * choosing a result replaces the address with it (the country too, if the
 * result is elsewhere). Arrow keys move through the results, Enter picks,
 * Escape closes.
 */
function AddressSearch({
  id,
  value,
  onChange,
  provider,
  text,
}: {
  id: string;
  value: PostalAddress;
  onChange: (next: PostalAddress) => void;
  provider: AddressAutocompleteProvider;
  text: AddressText;
}) {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<AddressSuggestion[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [state, setState] = useState<SearchState>('idle');
  // The latest search asked for; an older answer arriving late is ignored.
  const latest = useRef('');

  useEffect(() => {
    const q = query.trim();
    const key = `${value.country}|${q}`;
    latest.current = key;
    if (q.length < 3) {
      setSuggestions([]);
      setState('idle');
      return;
    }
    const timer = setTimeout(() => {
      provider
        .suggest(q, value.country)
        .then((found) => {
          if (latest.current !== key) return;
          setSuggestions(found);
          setActive(-1);
          setState('done');
        })
        .catch(() => {
          if (latest.current !== key) return;
          setSuggestions([]);
          setState('failed');
        });
    }, 250);
    return () => clearTimeout(timer);
  }, [query, value.country, provider]);

  async function pick(s: AddressSuggestion) {
    setOpen(false);
    setSuggestions([]);
    try {
      const resolved = await provider.resolve(s.id);
      const filled: Partial<PostalAddress> = Object.fromEntries(Object.entries(resolved).filter(([, v]) => typeof v === 'string'));
      onChange({ ...EMPTY_POSTAL_ADDRESS, ...filled, country: filled.country || value.country });
      setQuery('');
      setState('idle');
    } catch {
      // Lookup failed: keep what was typed; the person can fill the fields by hand.
      setState('failed');
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i + 1) % suggestions.length);
    } else if (e.key === 'ArrowUp' && suggestions.length) {
      e.preventDefault();
      setOpen(true);
      setActive((i) => (i <= 0 ? suggestions.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      // Never submits the surrounding form from the search box.
      e.preventDefault();
      if (open && active >= 0 && suggestions[active]) void pick(suggestions[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const listId = `${id}-suggestions`;
  const showList = open && suggestions.length > 0;
  const message =
    state === 'failed' ? text.searchFailed : state === 'done' && suggestions.length === 0 && query.trim().length >= 3 ? text.searchNoResults : undefined;
  return (
    // Laid out like `Field`, which can't be used here: it would put the input's id on the wrapper.
    <div className="ultm8-field">
      <div className="ultm8-field__label-row">
        <label className="ultm8-field__label" htmlFor={id}>
          {text.search}
        </label>
      </div>
      <div className="ultm8-combobox">
        <TextField
          id={id}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onKeyDown={onKeyDown}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          placeholder={text.searchPlaceholder}
          autoComplete="off"
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showList}
          aria-controls={listId}
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          aria-describedby={`${id}-hint`}
          maxLength={200}
        />
        {showList ? (
          <ul id={listId} role="listbox" aria-label={text.search} className="ultm8-combobox__listbox">
            {suggestions.map((s, i) => (
              <li
                key={s.id}
                id={`${listId}-${i}`}
                role="option"
                aria-selected={i === active}
                className={`ultm8-combobox__option${i === active ? ' ultm8-combobox__option--active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault();
                  void pick(s);
                }}
              >
                {s.label}
                {s.secondary ? <span className="ultm8-combobox__option-secondary">{s.secondary}</span> : null}
              </li>
            ))}
            <li role="presentation" className="ultm8-combobox__empty">
              {text.searchAttribution}
            </li>
          </ul>
        ) : null}
      </div>
      <span className="ultm8-field__hint" id={`${id}-hint`} aria-live="polite">
        {message ?? text.searchHint}
      </span>
    </div>
  );
}
