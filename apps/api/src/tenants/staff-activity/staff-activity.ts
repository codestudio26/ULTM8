import { Prisma } from '@prisma/client';

/**
 * The Staff page's activity log (Decision 408): what each row can say. The
 * portal turns each into a sentence; `details` carries what it needs.
 */
export const STAFF_ACTIONS = [
  'ROLE_GIVEN', // { role, branchName, manual? }
  'ROLE_REMOVED', // { role, branchName, self? } (self: they stepped down, Decision 433 item 6)
  'REMOVED_FROM_SCHOOL', // { removedRoles }
  'PAUSED', // { pausedRoles, byUltm8Support? } (support's pause has no actor, Decision 433 item 6)
  'UNPAUSED', // { restoredRoles, closedBranches }
  'ACCESS_CHANGED', // { changes: [{ switch, on }] }
  'DETAILS_CHANGED', // { displayName?, workPhone? } (only what changed; null = cleared)
  'MAIN_OWNER_HANDED_OVER', // targetUserId = the new main owner
  'INVITE_SENT', // { email, role, branchName }
  'INVITE_CANCELLED', // { email, role, branchName }
  'INVITE_ACCEPTED', // { role, branchName } — written by the invited person
  'OPEN_MAT_CHANGED', // { on }
  'SETTING_CHANGED', // { mustAcceptFirst }
  'CHARGE_ACCESS_CHANGED', // { changes: [{ switch: 'createCharges' | 'cancelCharges', on }] } (Decisions 303, 338)
  // Decision 315 item 13: a duplicate member merged into the kept one
  // (targetUserId). { keptName, duplicateId, duplicateName, moved, waiverSignaturesLeft }
  'MEMBERS_MERGED',
  // Decision 430 item 8: a parent's link to a child ended (targetUserId = the
  // parent). { studentId, studentName, guardianName }. GUARDIAN_REMOVED is the
  // owner's "Remove Guardian"; GUARDIAN_LEFT is the parent's own "Remove me".
  'GUARDIAN_REMOVED',
  'GUARDIAN_LEFT',
  // Decision 430 item 6: the owner invited another adult to be a child's
  // parent. { studentId, studentName, email }
  'GUARDIAN_INVITED',
] as const;
export type StaffAction = (typeof STAFF_ACTIONS)[number];

export interface StaffActivityEntry {
  schoolId: string;
  /** Null only for ULTM8 support's pause (Decision 433 item 6). */
  actorId: string | null;
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
