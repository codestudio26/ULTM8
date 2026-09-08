import { CodeNameOption } from './code-name-option';

/**
 * Spec 55 §11.2 (quoted, not paraphrased): "6 currencies observed: GBP, EUR, USD,
 * BRL, AED, MYR." Explicitly tagged **observed**, not confirmed — same caveat as
 * LANGUAGES in ./languages.ts, and the same underlying ambiguity `User.currency`'s
 * own schema comment flags ("one of the 6 confirmed currencies... stored as free
 * text pending a confirmed canonical code list, not specified anywhere"). See the
 * Phase 7 kickoff prompt for the full reasoning.
 *
 * ISO 4217 codes — the values themselves are quoted directly from Spec 55, this is
 * just the standard 3-letter form they're already written in.
 */
export const CURRENCIES: readonly CodeNameOption[] = [
  { code: 'GBP', name: 'British Pound' },
  { code: 'EUR', name: 'Euro' },
  { code: 'USD', name: 'US Dollar' },
  { code: 'BRL', name: 'Brazilian Real' },
  { code: 'AED', name: 'UAE Dirham' },
  { code: 'MYR', name: 'Malaysian Ringgit' },
];
