import type { StudentSummary } from './studentQueries';

/** Students list search (Decision 371, Students Q2): every word typed must
 * start a word of the name, or appear in the email. Case and accents don't
 * matter. */
export function matchesSearch(student: Pick<StudentSummary, 'firstName' | 'surname' | 'email'>, query: string): boolean {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const nameWords = fold(`${student.firstName} ${student.surname}`).split(/\s+/);
  const email = fold(student.email);
  return words.every((w) => nameWords.some((n) => n.startsWith(w)) || email.includes(w));
}

function fold(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();
}
