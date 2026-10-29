import { Prisma } from '@prisma/client';

/**
 * The Staff page's activity log (Decision 408): what each row can say. The
 * portal turns each into a sentence; `details` carries what it needs.
 */
export const STAFF_ACTIONS = [
  'ROLE_GIVEN', // { role, branchName, manual? }
  'ROLE_REMOVED', // { role, branchName }
  'REMOVED_FROM_SCHOOL', // { removedRoles }
  'PAUSED', // { pausedRoles }
  'UNPAUSED', // { restoredRoles, closedBranches }
  'ACCESS_CHANGED', // { changes: [{ switch, on }] }
  'DETAILS_CHANGED', // { displayName?, workPhone? } (only what changed; null = cleared)
  'MAIN_OWNER_HANDED_OVER', // targetUserId = the new main owner
  'INVITE_SENT', // { email, role, branchName }
  'INVITE_CANCELLED', // { email, role, branchName }
  'INVITE_ACCEPTED', // { role, branchName } — written by the invited person
  'OPEN_MAT_CHANGED', // { on }
  'SETTING_CHANGED', // { mustAcceptFirst }
] as const;
export type StaffAction = (typeof STAFF_ACTIONS)[number];

export interface StaffActivityEntry {
  schoolId: string;
  actorId: string;
  targetUserId?: string | null;
  action: StaffAction;
  details?: Prisma.InputJsonValue;
}

/**
 * Writes one row, inside the caller's own transaction so the change and its
 * row commit together. createMany: it returns nothing, and the person
 * accepting an invite may write their row but not read the log back.
 */
export async function recordStaffActivity(tx: Prisma.TransactionClient, entry: StaffActivityEntry): Promise<void> {
  await tx.staffActivity.createMany({
    data: [
      {
        schoolId: entry.schoolId,
        actorId: entry.actorId,
        targetUserId: entry.targetUserId ?? null,
        action: entry.action,
        details: entry.details,
      },
    ],
  });
}
