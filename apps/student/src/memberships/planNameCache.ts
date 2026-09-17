/** `MembershipResponseDto` has no denormalized plan title, only `membershipPlanId` —
 * found on review as the second occurrence of this "raw FK shown to the user"
 * limitation (after Booking's `classId`, Slice 1). Unlike that one, a cheap partial
 * fix is available here without a backend change: `AcademyDetailScreen` already
 * fetches every plan's `id`+`title` for any Academy a Student browses
 * (`academy.membershipPlans`), so this is a small in-memory cache populated there,
 * read from `MyMembershipsScreen`. Not persisted (cleared on app restart) and not a
 * guarantee — a Membership from a plan the Student never browsed via this screen
 * still falls back to the raw id, same as before this existed. */
const planNames = new Map<string, string>();

export function rememberPlanNames(plans: { id: string; title: string }[]): void {
  for (const plan of plans) {
    planNames.set(plan.id, plan.title);
  }
}

export function getRememberedPlanName(planId: string): string | undefined {
  return planNames.get(planId);
}
