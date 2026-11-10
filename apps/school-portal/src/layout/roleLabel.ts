import type { RoleGrantClaim } from '../auth/types';
import type { TranslateFn } from '../i18n/I18nProvider';
import { ROLE_LABELS } from '../lib/enumLabels';

/** Coaches review CP6: the role at the School being worked in (the switcher's
 * choice), so a coach at one School who is Branch Staff at another reads
 * right at each; a School-less grant (Franchise owner) always counts. Falls
 * back to every grant when none matches. */
export function roleLabel(allGrants: RoleGrantClaim[] | undefined, schoolId: string | null, t: TranslateFn): string {
  if (!allGrants?.length) return '';
  const here = schoolId ? allGrants.filter((g) => g.schoolId === schoolId || !g.schoolId) : [];
  const grants = here.length > 0 ? here : allGrants;
  if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return t('layout.roles.owner');
  if (grants.some((g) => g.role === 'BRANCH_STAFF')) return t('layout.roles.branchStaff');
  if (grants.some((g) => g.role === 'INSTRUCTOR')) return t('layout.roles.coach');
  // Decision 450 item 3: a Franchise owner reads "Franchise owner", never the raw code (the demo
  // showed "FRANCHISE_OWNER"); ahead of a student grant they may also hold,
  // since their franchise is what brings them to the portal.
  if (grants.some((g) => g.role === 'FRANCHISE_OWNER')) return t('lib.roles.franchiseOwner');
  if (grants.some((g) => g.role === 'STUDENT')) return t('layout.roles.student');
  // Any other role by its name; a code the API adds later and this catalogue
  // doesn't know yet is still shown as sent (enumLabels.ts).
  const role = grants[0].role;
  return ROLE_LABELS[role] ? t(ROLE_LABELS[role]!) : role;
}

