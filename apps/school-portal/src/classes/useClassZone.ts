import { useBranch } from '../branches/branchQueries';
import { useSchool } from '../schools/schoolQueries';
import { classZone } from '../lib/datetime';

/**
 * The clock a Class runs on, for showing its times (Decision 432 item 5): its
 * Branch's zone, else the School's, else UTC, as on the Classes page, not the
 * viewer's browser zone. An owner in New York sees Honolulu's 6am class at 6:00.
 */
export function useClassZone(cls: { schoolId: string; branchId?: string | null } | null | undefined): string {
  const branch = useBranch(cls?.branchId ?? null);
  const school = useSchool(cls?.schoolId ?? null);
  return classZone(branch.data?.timezone, school.data?.timezone);
}
