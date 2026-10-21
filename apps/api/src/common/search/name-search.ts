/**
 * Decision 278 — the header Global Search's name matching for a person
 * (Student, Instructor): case-insensitive substring on first name, surname, or
 * the full name "first surname" ("jo" finds "John", "john sm" finds
 * "John Smith"). Only ever applied to rows the caller's own, unchanged list
 * query has already authorized — it narrows a result, it never widens one.
 *
 * Done in memory, not as a Prisma `contains` on the `user` relation: a
 * person's name lives on `User`, whose RLS visibility (user_self_or_shared_school)
 * does not cover every row these lists show (Decision 117), so a relation
 * filter would silently drop some of them; and Prisma cannot match a
 * concatenated full name.
 */
export function matchesPersonName(firstName: string | null | undefined, surname: string | null | undefined, search: string): boolean {
  const q = search.trim().toLocaleLowerCase();
  if (!q) return true;
  const first = (firstName ?? '').toLocaleLowerCase();
  const last = (surname ?? '').toLocaleLowerCase();
  return first.includes(q) || last.includes(q) || `${first} ${last}`.includes(q);
}

/** Trims a raw `search` query value; blank (or only spaces) means "no filter". */
export function trimSearch(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() : value;
}
