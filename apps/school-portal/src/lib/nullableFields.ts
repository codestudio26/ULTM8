/**
 * Shared by every CRUD form modal that reuses one values object for both
 * CREATE and UPDATE (Class/Instructor/TimetableSlot) — the UPDATE DTOs accept
 * `null` on certain optional fields to mean "clear this" (see e.g.
 * apps/api/src/classes/dto/update-class.dto.ts's own header comment on why),
 * but the CREATE DTOs don't declare that at all (there's nothing to clear on
 * a brand-new row). `nullsToUndefined` maps a form's `null`s back to
 * `undefined` for the CREATE call site only — the UPDATE call site passes the
 * same values straight through unchanged.
 */
export function nullsToUndefined<T extends object>(values: T): { [K in keyof T]: Exclude<T[K], null> } {
  const result = {} as { [K in keyof T]: Exclude<T[K], null> };
  for (const key of Object.keys(values) as (keyof T)[]) {
    const value = values[key];
    result[key] = (value === null ? undefined : value) as Exclude<T[typeof key], null>;
  }
  return result;
}
