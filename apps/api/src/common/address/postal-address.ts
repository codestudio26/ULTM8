/**
 * Decision 276 — country-aware structured postal addresses.
 *
 * Pure data + logic, no React and no imports, so the exact same file can run in
 * the browser (school-portal, platform-admin) and in apps/api. apps/api keeps a
 * byte-identical copy at `apps/api/src/common/address/postal-address.ts`
 * (apps/api is built with plain `tsc`/`nest build` and doesn't import workspace
 * packages); `postal-address.spec.ts` there fails if the two copies drift apart.
 * Edit this file, then copy it over.
 *
 * Modelled on the per-country address metadata Google publishes for its own
 * address forms (libaddressinput), trimmed to what a school portal needs: which
 * fields a country uses, what they are called, which are required, and what a
 * valid postal code looks like. Countries not listed get DEFAULT_ADDRESS_FORMAT,
 * which shows every field and only requires the street line and city — the most
 * forgiving shape, so no country is ever blocked from entering an address.
 *
 * Labels are keys, not English text, so the UI can translate them.
 *
 * Google Places (Decision 212, deferred to v1.3 by Decision 267) is meant to fill
 * a `PostalAddress` from a suggestion; this module is the shape it fills, and
 * every rule below still applies to whatever it fills in.
 */

export type PostalAddressField = 'line1' | 'line2' | 'city' | 'region' | 'postalCode';

export interface PostalAddress {
  line1: string;
  line2: string;
  city: string;
  region: string;
  postalCode: string;
  /** ISO 3166-1 alpha-2, upper case ("GB", "AE"). Empty string = not chosen yet. */
  country: string;
}

export type CityLabelKey = 'city' | 'town' | 'post_town' | 'suburb' | 'district' | 'area';
export type RegionLabelKey =
  | 'state'
  | 'province'
  | 'county'
  | 'emirate'
  | 'prefecture'
  | 'region'
  | 'do_si'
  | 'oblast'
  | 'area';
export type PostalLabelKey = 'postal_code' | 'postcode' | 'zip' | 'pin' | 'eircode' | 'cep';

export interface AddressFormat {
  /** Omitted = the country doesn't use a city line (e.g. Singapore). */
  city?: CityLabelKey;
  /** Omitted = the country doesn't use a state/region line. */
  region?: RegionLabelKey;
  /** Omitted = the country has no postal codes. */
  postal?: PostalLabelKey;
  required: PostalAddressField[];
  /** Anchored regex source, matched case-insensitively against the normalised code. */
  postalPattern?: string;
  postalExample?: string;
  /** Fixed list of [stored value, display name]; the region must be one of them. */
  regions?: Array<[string, string]>;
  /**
   * How city/region/postcode are laid out after the street lines, in the
   * country's own order: %C city, %S region, %Z postal code; `\n` starts a new
   * line. Used to build the single-line `address` text every existing screen
   * still reads.
   */
  locality: string;
}

export const DEFAULT_ADDRESS_FORMAT: AddressFormat = {
  city: 'city',
  region: 'region',
  postal: 'postal_code',
  required: ['line1', 'city'],
  locality: '%C\n%S\n%Z',
};

const US_STATES: Array<[string, string]> = [
  ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'],
  ['CO', 'Colorado'], ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'],
  ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'],
  ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
  ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'],
  ['MO', 'Missouri'], ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'],
  ['NJ', 'New Jersey'], ['NM', 'New Mexico'], ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'],
  ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'],
  ['SC', 'South Carolina'], ['SD', 'South Dakota'], ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'],
  ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'], ['WV', 'West Virginia'], ['WI', 'Wisconsin'],
  ['WY', 'Wyoming'], ['AS', 'American Samoa'], ['GU', 'Guam'], ['MP', 'Northern Mariana Islands'], ['PR', 'Puerto Rico'],
  ['VI', 'U.S. Virgin Islands'], ['AA', 'Armed Forces (AA)'], ['AE', 'Armed Forces (AE)'], ['AP', 'Armed Forces (AP)'],
];

const CA_PROVINCES: Array<[string, string]> = [
  ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
  ['NL', 'Newfoundland and Labrador'], ['NT', 'Northwest Territories'], ['NS', 'Nova Scotia'], ['NU', 'Nunavut'],
  ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon'],
];

const AU_STATES: Array<[string, string]> = [
  ['ACT', 'Australian Capital Territory'], ['NSW', 'New South Wales'], ['NT', 'Northern Territory'], ['QLD', 'Queensland'],
  ['SA', 'South Australia'], ['TAS', 'Tasmania'], ['VIC', 'Victoria'], ['WA', 'Western Australia'],
];

const AE_EMIRATES: Array<[string, string]> = [
  ['Abu Dhabi', 'Abu Dhabi'], ['Ajman', 'Ajman'], ['Dubai', 'Dubai'], ['Fujairah', 'Fujairah'],
  ['Ras Al Khaimah', 'Ras Al Khaimah'], ['Sharjah', 'Sharjah'], ['Umm Al Quwain', 'Umm Al Quwain'],
];

const BR_STATES: Array<[string, string]> = [
  ['AC', 'Acre'], ['AL', 'Alagoas'], ['AP', 'Amapá'], ['AM', 'Amazonas'], ['BA', 'Bahia'], ['CE', 'Ceará'],
  ['DF', 'Distrito Federal'], ['ES', 'Espírito Santo'], ['GO', 'Goiás'], ['MA', 'Maranhão'], ['MT', 'Mato Grosso'],
  ['MS', 'Mato Grosso do Sul'], ['MG', 'Minas Gerais'], ['PA', 'Pará'], ['PB', 'Paraíba'], ['PR', 'Paraná'],
  ['PE', 'Pernambuco'], ['PI', 'Piauí'], ['RJ', 'Rio de Janeiro'], ['RN', 'Rio Grande do Norte'],
  ['RS', 'Rio Grande do Sul'], ['RO', 'Rondônia'], ['RR', 'Roraima'], ['SC', 'Santa Catarina'], ['SP', 'São Paulo'],
  ['SE', 'Sergipe'], ['TO', 'Tocantins'],
];

const MY_STATES: Array<[string, string]> = [
  ['Johor', 'Johor'], ['Kedah', 'Kedah'], ['Kelantan', 'Kelantan'], ['Kuala Lumpur', 'Kuala Lumpur'],
  ['Labuan', 'Labuan'], ['Melaka', 'Melaka'], ['Negeri Sembilan', 'Negeri Sembilan'], ['Pahang', 'Pahang'],
  ['Penang', 'Penang'], ['Perak', 'Perak'], ['Perlis', 'Perlis'], ['Putrajaya', 'Putrajaya'], ['Sabah', 'Sabah'],
  ['Sarawak', 'Sarawak'], ['Selangor', 'Selangor'], ['Terengganu', 'Terengganu'],
];

/** "Postcode then city" countries share one shape, differing only in the pattern. */
function zipFirst(postalPattern: string, postalExample: string): AddressFormat {
  return { city: 'city', postal: 'postal_code', required: ['line1', 'city', 'postalCode'], postalPattern, postalExample, locality: '%Z %C' };
}

export const ADDRESS_FORMATS: Record<string, AddressFormat> = {
  AE: { city: 'area', region: 'emirate', required: ['line1', 'region'], regions: AE_EMIRATES, locality: '%C\n%S' },
  AR: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city'], postalPattern: '^[A-Z]?\\d{4}(?:[A-Z]{3})?$', postalExample: 'C1070AAM', locality: '%Z %C\n%S' },
  AT: zipFirst('^\\d{4}$', '1010'),
  AU: { city: 'suburb', region: 'state', postal: 'postcode', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{4}$', postalExample: '2000', regions: AU_STATES, locality: '%C %S %Z' },
  BE: zipFirst('^\\d{4}$', '1000'),
  BH: { city: 'city', postal: 'postal_code', required: ['line1', 'city'], postalPattern: '^(?:\\d|1[0-2])\\d{2}$', postalExample: '317', locality: '%C %Z' },
  BR: { city: 'city', region: 'state', postal: 'cep', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}-?\\d{3}$', postalExample: '01310-100', regions: BR_STATES, locality: '%C-%S\n%Z' },
  CA: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^[ABCEGHJ-NPRSTVXY]\\d[ABCEGHJ-NPRSTV-Z] ?\\d[ABCEGHJ-NPRSTV-Z]\\d$', postalExample: 'K1A 0B1', regions: CA_PROVINCES, locality: '%C %S %Z' },
  CH: zipFirst('^\\d{4}$', '8001'),
  CN: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'region'], postalPattern: '^\\d{6}$', postalExample: '100000', locality: '%S %C\n%Z' },
  CZ: zipFirst('^\\d{3} ?\\d{2}$', '110 00'),
  DE: zipFirst('^\\d{5}$', '10115'),
  DK: zipFirst('^\\d{4}$', '1050'),
  EG: { city: 'city', region: 'region', postal: 'postal_code', required: ['line1', 'city'], postalPattern: '^\\d{5}$', postalExample: '11511', locality: '%C\n%S\n%Z' },
  ES: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}$', postalExample: '28001', locality: '%Z %C %S' },
  FI: zipFirst('^\\d{5}$', '00100'),
  FR: zipFirst('^\\d{2} ?\\d{3}$', '75001'),
  GB: { city: 'post_town', region: 'county', postal: 'postcode', required: ['line1', 'city', 'postalCode'], postalPattern: '^(?:GIR ?0AA|[A-Z]{1,2}\\d[A-Z\\d]? ?\\d[A-Z]{2})$', postalExample: 'SW1A 1AA', locality: '%C\n%S\n%Z' },
  HK: { city: 'district', region: 'area', required: ['line1'], locality: '%C\n%S' },
  ID: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'region'], postalPattern: '^\\d{5}$', postalExample: '10110', locality: '%C\n%S %Z' },
  IE: { city: 'town', region: 'county', postal: 'eircode', required: ['line1', 'city'], postalPattern: '^[\\dA-Z]{3} ?[\\dA-Z]{4}$', postalExample: 'D02 X285', locality: '%C\n%S\n%Z' },
  IN: { city: 'city', region: 'state', postal: 'pin', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{6}$', postalExample: '110001', locality: '%C %Z\n%S' },
  IT: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}$', postalExample: '00144', locality: '%Z %C %S' },
  JP: { city: 'city', region: 'prefecture', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{3}-?\\d{4}$', postalExample: '100-0001', locality: '%Z\n%S %C' },
  KR: { city: 'city', region: 'do_si', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}$', postalExample: '03051', locality: '%S %C\n%Z' },
  KW: { city: 'area', postal: 'postal_code', required: ['line1'], postalPattern: '^\\d{5}$', postalExample: '13001', locality: '%Z %C' },
  MX: { city: 'city', region: 'state', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}$', postalExample: '06000', locality: '%Z %C, %S' },
  MY: { city: 'city', region: 'state', postal: 'postcode', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}$', postalExample: '50000', regions: MY_STATES, locality: '%Z %C\n%S' },
  NL: zipFirst('^\\d{4} ?[A-Z]{2}$', '1012 AB'),
  NO: zipFirst('^\\d{4}$', '0150'),
  NZ: { city: 'city', postal: 'postcode', required: ['line1', 'city', 'postalCode'], postalPattern: '^\\d{4}$', postalExample: '6011', locality: '%C %Z' },
  OM: { city: 'city', postal: 'postal_code', required: ['line1'], postalPattern: '^\\d{3}$', postalExample: '133', locality: '%Z\n%C' },
  PH: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city'], postalPattern: '^\\d{4}$', postalExample: '1000', locality: '%C %Z\n%S' },
  PL: zipFirst('^\\d{2}-\\d{3}$', '00-950'),
  PT: zipFirst('^\\d{4}-\\d{3}$', '1000-001'),
  QA: { city: 'area', required: ['line1'], locality: '%C' },
  RU: { city: 'city', region: 'oblast', postal: 'postal_code', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{6}$', postalExample: '101000', locality: '%C\n%S\n%Z' },
  SA: { city: 'city', postal: 'postal_code', required: ['line1', 'city'], postalPattern: '^\\d{5}(?:-?\\d{4})?$', postalExample: '11564', locality: '%C %Z' },
  SE: zipFirst('^\\d{3} ?\\d{2}$', '111 22'),
  SG: { postal: 'postal_code', required: ['line1', 'postalCode'], postalPattern: '^\\d{6}$', postalExample: '238880', locality: '%Z' },
  TH: { city: 'district', region: 'province', postal: 'postal_code', required: ['line1', 'region'], postalPattern: '^\\d{5}$', postalExample: '10200', locality: '%C\n%S %Z' },
  TR: { city: 'district', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'region'], postalPattern: '^\\d{5}$', postalExample: '34000', locality: '%Z %C/%S' },
  US: { city: 'city', region: 'state', postal: 'zip', required: ['line1', 'city', 'region', 'postalCode'], postalPattern: '^\\d{5}(?:-\\d{4})?$', postalExample: '95014', regions: US_STATES, locality: '%C, %S %Z' },
  ZA: { city: 'city', region: 'province', postal: 'postal_code', required: ['line1', 'city', 'postalCode'], postalPattern: '^\\d{4}$', postalExample: '0083', locality: '%C\n%S\n%Z' },
};

/** Per-field length cap — same 500-char budget the old single `address` text had, split sensibly. */
export const POSTAL_ADDRESS_MAX_LENGTH: Record<PostalAddressField, number> = {
  line1: 200,
  line2: 200,
  city: 100,
  region: 100,
  postalCode: 20,
};

export const EMPTY_POSTAL_ADDRESS: PostalAddress = { line1: '', line2: '', city: '', region: '', postalCode: '', country: '' };

export function getAddressFormat(country: string | null | undefined): AddressFormat {
  return (country && ADDRESS_FORMATS[country.toUpperCase()]) || DEFAULT_ADDRESS_FORMAT;
}

/** Fields a country's form shows, in display order. Street lines are always shown. */
export function visibleAddressFields(format: AddressFormat): PostalAddressField[] {
  const fields: PostalAddressField[] = ['line1', 'line2'];
  if (format.city) fields.push('city');
  if (format.region) fields.push('region');
  if (format.postal) fields.push('postalCode');
  return fields;
}

function tidy(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * Trims every field, upper-cases the country and postal code, and blanks any
 * field the chosen country doesn't use (so switching country never leaves a
 * hidden, stale value behind). A region that matches a fixed list's display
 * name case-insensitively is swapped for that entry's stored value.
 */
export function normalizePostalAddress(input: Partial<PostalAddress> | null | undefined): PostalAddress {
  const country = tidy(input?.country).toUpperCase();
  const format = getAddressFormat(country);
  let region = format.region ? tidy(input?.region) : '';
  if (region && format.regions) {
    const match = format.regions.find(
      ([value, label]) => value.toLowerCase() === region.toLowerCase() || label.toLowerCase() === region.toLowerCase(),
    );
    if (match) region = match[0];
  }
  return {
    line1: tidy(input?.line1),
    line2: tidy(input?.line2),
    city: format.city ? tidy(input?.city) : '',
    region,
    postalCode: format.postal ? tidy(input?.postalCode).toUpperCase() : '',
    country,
  };
}

export function isPostalAddressEmpty(address: Partial<PostalAddress> | null | undefined): boolean {
  if (!address) return true;
  return !tidy(address.line1) && !tidy(address.line2) && !tidy(address.city) && !tidy(address.region) && !tidy(address.postalCode);
}

export type PostalAddressErrorCode = 'required' | 'invalid' | 'too_long';
export type PostalAddressErrors = Partial<Record<PostalAddressField | 'country', PostalAddressErrorCode>>;

/**
 * Validates an address that is meant to be saved. An all-blank address (no
 * street/city/region/postcode, whatever the country) means "no address" and is
 * valid — every address in the app is optional. Anything else needs a country
 * and that country's required fields, and a postal code in that country's shape.
 */
export function validatePostalAddress(input: Partial<PostalAddress> | null | undefined): PostalAddressErrors {
  const errors: PostalAddressErrors = {};
  if (isPostalAddressEmpty(input)) return errors;
  const address = normalizePostalAddress(input);
  if (!address.country) errors.country = 'required';
  else if (!/^[A-Z]{2}$/.test(address.country)) errors.country = 'invalid';
  const format = getAddressFormat(address.country);
  for (const field of Object.keys(POSTAL_ADDRESS_MAX_LENGTH) as PostalAddressField[]) {
    if (address[field].length > POSTAL_ADDRESS_MAX_LENGTH[field]) errors[field] = 'too_long';
    // Which fields are required depends on the country, so wait for one first.
    else if (!address[field] && !errors.country && format.required.includes(field)) errors[field] = 'required';
  }
  if (!errors.postalCode && address.postalCode && format.postalPattern && !new RegExp(format.postalPattern, 'i').test(address.postalCode)) {
    errors.postalCode = 'invalid';
  }
  if (!errors.region && address.region && format.regions && !format.regions.some(([value]) => value === address.region)) {
    errors.region = 'invalid';
  }
  return errors;
}

/**
 * One-line text for the address, in the country's own order, e.g.
 * "1600 Amphitheatre Pkwy, Mountain View, CA 94043, United States" or
 * "Unter den Linden 1, 10117 Berlin, Germany". This is what gets stored in the
 * existing `address` column, so every screen that already shows `address`
 * keeps working without knowing about the structured fields.
 */
export function formatPostalAddress(input: Partial<PostalAddress>, countryName?: string): string {
  const address = normalizePostalAddress(input);
  const values: Record<string, string> = { C: address.city, S: address.region, Z: address.postalCode };
  const format = getAddressFormat(address.country);
  const localityLines = format.locality.split('\n').map((line) => {
    // A separator is kept only between two filled values; one that follows an
    // empty value is dropped ("%C, %S %Z" with no state → "City, 12345").
    let out = '';
    let separator = '';
    let afterEmpty = false;
    for (const token of line.split(/(%[CSZ])/)) {
      if (!token) continue;
      if (/^%[CSZ]$/.test(token)) {
        const value = values[token[1]];
        if (value) {
          out += (out ? separator : '') + value;
          separator = '';
          afterEmpty = false;
        } else {
          afterEmpty = true;
        }
      } else if (!afterEmpty || !separator) {
        separator += token;
      }
    }
    return out.trim();
  });
  return [address.line1, address.line2, ...localityLines, countryName ?? address.country]
    .map((part) => part.trim())
    .filter(Boolean)
    .join(', ');
}
