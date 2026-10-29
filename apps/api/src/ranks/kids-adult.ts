/** Backlog 3.20 (Decisions 281, 285, 298): Kids and Adult programs. A Kids
 * style links to its Adult style; from the Kids style's "Ready for Adult from
 * age" a kid may be graded into Adult. Refusals carry codes the portal words
 * itself. */
export const ADULT_NOT_LINKED = {
  code: 'ADULT_NOT_LINKED',
  message: 'This style has no Adult program. Link one on the Disciplines page first.',
};
export const ADULT_TOO_YOUNG = {
  code: 'ADULT_TOO_YOUNG',
  message: "This student hasn't reached the style's \"Ready for Adult from age\" yet. To grade them into Adult earlier, lower that age in Grading → Settings first.",
};
export const ADULT_ALREADY = {
  code: 'ADULT_ALREADY',
  message: 'This student already has a rank in the Adult program.',
};
export const ADULT_FIRST_BELT = {
  code: 'ADULT_FIRST_BELT',
  message: "Pick an adult rank above the Adult program's first belt.",
};

/** Whether someone born on `dateOfBirth` is at least `age` years old on `today` (YYYY-MM-DD). */
export function hasReachedAge(dateOfBirth: Date | null, age: number, today: string): boolean {
  if (!dateOfBirth) return false;
  const [y, m, d] = today.split('-').map(Number);
  const born = dateOfBirth.toISOString().slice(0, 10).split('-').map(Number);
  const years = y - born[0] - (m < born[1] || (m === born[1] && d < born[2]) ? 1 : 0);
  return years >= age;
}
