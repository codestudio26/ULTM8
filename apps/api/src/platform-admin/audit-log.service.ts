import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaPlatformAdminService } from '../common/prisma/prisma-platform-admin.service';

/**
 * Disciplined string constants for AuditLogEntry.action — see that model's own
 * schema comment for why this is a plain string column, not a DB enum. Every
 * call site should reach for one of these, not a freehand string, so the set of
 * actions that actually exist stays discoverable in one place even though the
 * column itself isn't a closed enum.
 */
export const AuditAction = {
  VIEW_SCHOOL: 'VIEW_SCHOOL',
  VIEW_FRANCHISE: 'VIEW_FRANCHISE',
  CREATE_ADMIN_USER: 'CREATE_ADMIN_USER',
  LIST_ADMIN_USERS: 'LIST_ADMIN_USERS',
  REVOKE_ADMIN_USER: 'REVOKE_ADMIN_USER',
  VIEW_PAYMENT_ACCOUNT: 'VIEW_PAYMENT_ACCOUNT',
  ROTATE_PAYMENT_ACCOUNT_CREDENTIAL: 'ROTATE_PAYMENT_ACCOUNT_CREDENTIAL',
  // Phase 43 (Decision 102) — the session-START event only. Every individual
  // read taken DURING an active session is not separately audit-logged here —
  // see PlatformAdminImpersonationService's own header comment for why that's a
  // deliberate, flagged scope boundary, not an oversight.
  START_IMPERSONATION_SESSION: 'START_IMPERSONATION_SESSION',
  // Phase 49 — TranslationsModule. Non-tenant, Platform-Admin-authored content
  // (same category as CREATE_ADMIN_USER above) — schoolId/franchiseId both
  // correctly omitted on every call site, not guessed at.
  CREATE_TRANSLATION: 'CREATE_TRANSLATION',
  UPDATE_TRANSLATION: 'UPDATE_TRANSLATION',
  DELETE_TRANSLATION: 'DELETE_TRANSLATION',
  // Phase 54 — SubscriptionPlansModule. Non-tenant, Platform-Admin-authored content,
  // same category as CREATE_TRANSLATION above. No DELETE_SUBSCRIPTION_PLAN — this
  // module builds no delete path (see SubscriptionPlan's own schema.prisma comment).
  CREATE_SUBSCRIPTION_PLAN: 'CREATE_SUBSCRIPTION_PLAN',
  UPDATE_SUBSCRIPTION_PLAN: 'UPDATE_SUBSCRIPTION_PLAN',
  // Phase 56 (Decision 110) — TenantLifecycleModule. The only trigger for
  // soft-archive per that decision's own part 2 — never fired by a lapsed
  // subscription. See TenantLifecycleService's own header comment for scope.
  CLOSE_SCHOOL_ACCOUNT: 'CLOSE_SCHOOL_ACCOUNT',
  REACTIVATE_SCHOOL_ACCOUNT: 'REACTIVATE_SCHOOL_ACCOUNT',
  CLOSE_FRANCHISE_ACCOUNT: 'CLOSE_FRANCHISE_ACCOUNT',
  REACTIVATE_FRANCHISE_ACCOUNT: 'REACTIVATE_FRANCHISE_ACCOUNT',
} as const;
export type AuditAction = (typeof AuditAction)[keyof typeof AuditAction];

export interface RecordAuditLogInput {
  adminUserId: string;
  action: AuditAction;
  targetType: string;
  targetId: string;
  schoolId?: string | null;
  franchiseId?: string | null;
  details?: Prisma.InputJsonValue;
}

/**
 * Writes an AuditLogEntry row — the confirmed "who, when, what, on which tenant"
 * record for every Platform Admin action that touches tenant data
 * (ultm8-tenant-isolation SKILL.md §6). Deliberately the only way a caller in this
 * codebase writes to that table — no other service should call
 * `prisma.auditLogEntry.create` directly, so this stays the one place the actual
 * shape of an entry is decided.
 *
 * `record()` does not swallow a write failure — if the audit write fails, the
 * caller's own action should fail too (an admin action nobody can prove happened
 * is worse than a temporarily-unavailable admin action), so this deliberately
 * does NOT wrap the insert in a try/catch. Call it from inside the same
 * transaction/request as the action it's recording, not fire-and-forget.
 */
@Injectable()
export class AuditLogService {
  constructor(private readonly prismaPlatformAdmin: PrismaPlatformAdminService) {}

  async record(input: RecordAuditLogInput): Promise<void> {
    await this.prismaPlatformAdmin.auditLogEntry.create({
      data: {
        adminUserId: input.adminUserId,
        action: input.action,
        targetType: input.targetType,
        targetId: input.targetId,
        schoolId: input.schoolId ?? null,
        franchiseId: input.franchiseId ?? null,
        details: input.details,
      },
    });
  }
}
