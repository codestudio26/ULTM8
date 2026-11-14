import { useAuth } from '../auth/AuthContext';
import { useBranches } from '../branches/branchQueries';

/**
 * Who may start front-desk mode, and where: the owner, or Branch Staff for
 * their own Branch (handover F1). A School with no open Branches runs it for
 * the whole School (CI4). Shared by the Start page and Check-in's
 * "Front-desk mode" button, so the button shows only to those who can start.
 */
export function useFrontDeskStart(schoolId: string | null) {
  const { claims } = useAuth();
  const branchQuery = useBranches(schoolId);
  const myGrants = (claims?.grants ?? []).filter((g) => g.schoolId === schoolId);
  const isOwner = myGrants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER');
  const staffBranchIds = myGrants.filter((g) => g.role === 'BRANCH_STAFF').map((g) => g.branchId ?? null);
  const canStartAt = (id: string | null) => isOwner || staffBranchIds.some((b) => b === null || b === id);
  const allOpen = (branchQuery.data?.items ?? []).filter((b) => !b.archivedAt);
  const branches = allOpen.filter((b) => canStartAt(b.id));
  const wholeSchool = branchQuery.isSuccess && allOpen.length === 0;
  const allowed = wholeSchool ? canStartAt(null) : branches.length > 0;
  return { branchQuery, branches, wholeSchool, allowed };
}
