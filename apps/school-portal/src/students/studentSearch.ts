import { foldForSearch } from '@ultm8/i18n';
import type { StudentSummary } from './studentQueries';

/** Students list search (Decision 371, Students Q2): every word typed must
 * start a word of the name, or appear in the email. Case, accents and spelling
 * variants don't matter: the one search fold the API uses too (Decision 433,
 * TXT-1), so Hindi, Tamil and Japanese names that differ by a mark stay
 * different. A name typed whole without its spaces ("佐藤翔太", "AlMansouri")
 * also matches, in either order. */
export function matchesSearch(student: Pick<StudentSummary, 'firstName' | 'surname' | 'email'>, query: string): boolean {
  const folded = foldForSearch(query);
  const words = folded.split(' ').filter(Boolean);
  if (words.length === 0) return true;
  const first = foldForSearch(student.firstName);
  const last = foldForSearch(student.surname ?? '');
  const nameWords = `${first} ${last}`.split(' ').filter(Boolean);
  const email = foldForSearch(student.email ?? '');
  if (words.every((w) => nameWords.some((n) => n.startsWith(w)) || email.includes(w))) return true;
  const compact = folded.replace(/ /g, '');
  return [`${first}${last}`, `${last}${first}`].some((name) => name.replace(/ /g, '').startsWith(compact));
}
