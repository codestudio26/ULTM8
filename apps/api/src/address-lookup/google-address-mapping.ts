import { getAddressFormat, normalizePostalAddress, type PostalAddress } from '../common/address/postal-address';

/**
 * Turns a Google Places (New) Place Details result into our structured
 * address (Decision 276's `PostalAddress`), so a chosen suggestion fills the
 * same fields a person would otherwise type (Decision 212).
 *
 * Google describes an address as a list of typed components
 * (`street_number`, `route`, `locality`, `postal_town`,
 * `administrative_area_level_1`, …). Which component is the "city", which is
 * the "region" and how the street line is put together differ by country, so
 * the rules below follow each country's own convention, then the result goes
 * through `normalizePostalAddress` so it obeys exactly the same per-country
 * rules as a typed address (fields the country doesn't use are dropped, fixed
 * region lists use their stored value). Anything Google doesn't give stays
 * blank for the person to fill in.
 */

export interface GoogleAddressComponent {
  longText?: string;
  shortText?: string;
  types?: string[];
  languageCode?: string;
}

export interface GooglePlaceDetails {
  id?: string;
  formattedAddress?: string;
  /** Google's own microformat markup; its `street-address` span is the street line in the country's own form. */
  adrFormatAddress?: string;
  addressComponents?: GoogleAddressComponent[];
}

/** Countries where the house number follows the street name ("Unter den Linden 1"). */
const NUMBER_AFTER_STREET = new Set([
  'AR', 'AT', 'BA', 'BE', 'BG', 'BO', 'CH', 'CL', 'CO', 'CR', 'CZ', 'DE', 'DK', 'EC', 'EE', 'ES', 'FI', 'GR', 'HR', 'HU',
  'IS', 'IT', 'LT', 'LV', 'MX', 'NL', 'NO', 'PE', 'PL', 'PT', 'PY', 'RO', 'RS', 'RU', 'SE', 'SI', 'SK', 'TR', 'UA', 'UY', 'VE', 'BR',
]);
/** …and of those, the ones that write a comma between them ("Avenida Paulista, 1578"). */
const COMMA_BEFORE_NUMBER = new Set(['BR', 'ES', 'IT', 'CL', 'CO', 'MX', 'PE']);
/** Block-based addresses with no street name in most places (Japan, Korea, China, Taiwan). */
const BLOCK_ADDRESS = new Set(['JP', 'KR', 'CN', 'TW']);

function component(components: GoogleAddressComponent[], type: string, form: 'long' | 'short' = 'long'): string {
  const found = components.find((c) => c.types?.includes(type));
  const text = form === 'short' ? found?.shortText ?? found?.longText : found?.longText ?? found?.shortText;
  return (text ?? '').trim();
}

function first(components: GoogleAddressComponent[], types: string[], form: 'long' | 'short' = 'long'): string {
  for (const type of types) {
    const value = component(components, type, form);
    if (value) return value;
  }
  return '';
}

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", '#39': "'", nbsp: ' ' };

/** The text of Google's `<span class="street-address">…</span>`, or ''. */
export function streetFromAdrFormat(adr: string | undefined): string {
  if (!adr) return '';
  const match = /<span class="street-address">([\s\S]*?)<\/span>/.exec(adr);
  if (!match) return '';
  return match[1]
    .replace(/<[^>]*>/g, '')
    .replace(/&(#?\w+);/g, (whole, name: string) => ENTITIES[name] ?? (/^#\d+$/.test(name) ? String.fromCodePoint(Number(name.slice(1))) : whole))
    .replace(/\s+/g, ' ')
    .trim();
}

function streetLine(components: GoogleAddressComponent[], country: string): string {
  const number = component(components, 'street_number');
  const route = component(components, 'route');
  if (route) {
    if (!number) return route;
    if (NUMBER_AFTER_STREET.has(country)) return `${route}${COMMA_BEFORE_NUMBER.has(country) ? ', ' : ' '}${number}`;
    return `${number} ${route}`;
  }
  // No street name: a building name or number on its own (e.g. a UK premise).
  return [component(components, 'premise'), number].filter(Boolean).join(' ');
}

/** Japan/Korea/China/Taiwan: the block, then the building ("丸の内1丁目9-1"). */
function blockLine(components: GoogleAddressComponent[], ja: boolean): string {
  const parts = [
    'sublocality_level_1',
    'sublocality_level_2',
    'sublocality_level_3',
    'sublocality_level_4',
    'sublocality_level_5',
    'premise',
  ]
    .map((type) => component(components, type))
    .filter(Boolean);
  if (!ja) return parts.join(' ');
  // Written together, with a hyphen only between two numbers ("1丁目" + "9" + "1" → "1丁目9-1").
  return parts.reduce((line, part) => line + (/[0-9０-９]$/.test(line) && /^[0-9０-９]/.test(part) ? '-' : '') + part, '');
}

export function mapGooglePlaceToPostalAddress(place: GooglePlaceDetails): PostalAddress {
  const components = place.addressComponents ?? [];
  const country = component(components, 'country', 'short').toUpperCase();
  const format = getAddressFormat(country);
  const adrStreet = streetFromAdrFormat(place.adrFormatAddress);

  let line1: string;
  if (BLOCK_ADDRESS.has(country)) {
    // Google's own street line is already in the country's form; the components
    // are the fallback.
    const ja = components.some((c) => c.languageCode === 'ja' || c.languageCode?.startsWith('zh') || c.languageCode === 'ko');
    line1 = adrStreet || blockLine(components, ja);
  } else {
    line1 = streetLine(components, country) || adrStreet;
  }

  const lineTwoParts = [component(components, 'subpremise')];
  // Brazilian addresses name the neighbourhood (bairro); it has no field of its own here.
  if (country === 'BR') lineTwoParts.push(first(components, ['sublocality_level_1', 'sublocality', 'neighborhood']));
  const line2 = lineTwoParts.filter(Boolean).join(', ');

  let city: string;
  if (country === 'GB' || country === 'IE') city = first(components, ['postal_town', 'locality']);
  else if (country === 'AE') city = first(components, ['sublocality_level_1', 'sublocality', 'neighborhood', 'locality']);
  else city = first(components, ['locality', 'postal_town', 'administrative_area_level_3', 'sublocality_level_1']);

  let region: string;
  if (country === 'GB') region = component(components, 'administrative_area_level_2');
  else if (format.regions) {
    // A fixed list: try the short form ("CA", "NSW", "SP") then the full name;
    // normalizePostalAddress swaps a matching name for the stored value.
    const short = component(components, 'administrative_area_level_1', 'short');
    const long = component(components, 'administrative_area_level_1', 'long');
    const known = (v: string) => format.regions!.some(([value, label]) => [value, label].some((x) => x.toLowerCase() === v.toLowerCase()));
    region = [short, long].find((v) => v && known(v)) ?? long;
  } else region = component(components, 'administrative_area_level_1');

  return normalizePostalAddress({
    line1,
    line2,
    city,
    region,
    postalCode: component(components, 'postal_code'),
    country,
  });
}
