/** Title-cases a SCREAMING_SNAKE_CASE or single-word enum value for display —
 * e.g. "SUCCESSFUL" -> "Successful". Multi-word underscored values (e.g.
 * "TRIAL_MEMBERSHIP") are NOT handled specially here (returns
 * "Trial_membership") — none of this codebase's current call sites pass a
 * multi-word value through this helper; each uses its own explicit label map
 * (e.g. MembershipPlansPage's TYPE_LABELS) when the enum has multi-word
 * values, rather than this generic fallback. */
export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}
