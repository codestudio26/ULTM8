/**
 * Decision 441 item 7: an address shows its country in the reader's language.
 *
 * The API stores an address's one-line text once, when it is saved, ending in
 * the country's English name ("Rua Augusta, 1500, São Paulo-SP, 01304-001,
 * Brazil"; apps/api `addressWriteData`). The text stays as stored; this swaps
 * that last part for the country's name in the reader's language when it is
 * shown ("…, Brasil"). The country is known from `countryCode` (the stored
 * `addressCountry`) when the screen has it, else from the English name itself.
 *
 * Anything else is left exactly as it is: an English reader, a last part that
 * isn't a country's English name (an address typed as free text), or an engine
 * without `Intl.DisplayNames` (some builds of the member app's engine).
 */

let englishNames: Intl.DisplayNames | null | undefined;
let codesByEnglishName: Map<string, string> | undefined;

function english(): Intl.DisplayNames | null {
  if (englishNames === undefined) {
    try {
      englishNames = new Intl.DisplayNames(['en'], { type: 'region', fallback: 'none' });
    } catch {
      englishNames = null;
    }
  }
  return englishNames;
}

function regionName(names: Intl.DisplayNames, code: string): string | undefined {
  try {
    return names.of(code) ?? undefined;
  } catch {
    return undefined;
  }
}

/** Every two-letter region the engine names, by its English name. */
function codeForEnglishName(name: string): string | undefined {
  const names = english();
  if (!names) return undefined;
  if (!codesByEnglishName) {
    codesByEnglishName = new Map();
    const A = 'A'.charCodeAt(0);
    for (let i = 0; i < 26; i++) {
      for (let j = 0; j < 26; j++) {
        const code = String.fromCharCode(A + i, A + j);
        const found = regionName(names, code);
        if (found && found !== code && !codesByEnglishName.has(found)) codesByEnglishName.set(found, code);
      }
    }
  }
  return codesByEnglishName.get(name);
}

export function localizeAddressCountry(address: string, locale: string | null | undefined, countryCode?: string | null): string;
export function localizeAddressCountry(address: string | null | undefined, locale: string | null | undefined, countryCode?: string | null): string | null | undefined;
export function localizeAddressCountry(address: string | null | undefined, locale: string | null | undefined, countryCode?: string | null): string | null | undefined {
  if (!address || !locale || /^en\b/i.test(locale)) return address;
  const cut = address.lastIndexOf(', ');
  if (cut < 0) return address;
  const last = address.slice(cut + 2);
  const names = english();
  if (!names) return address;
  const given = countryCode?.toUpperCase();
  const code = given && regionName(names, given) === last ? given : codeForEnglishName(last);
  if (!code) return address;
  let local: string | undefined;
  try {
    local = regionName(new Intl.DisplayNames([locale], { type: 'region', fallback: 'none' }), code);
  } catch {
    return address;
  }
  return local ? `${address.slice(0, cut + 2)}${local}` : address;
}
