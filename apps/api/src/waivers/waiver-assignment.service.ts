import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaClient } from '@prisma/client';

/** Same shape every `withTenantContext(...)` caller in this codebase already
 * uses for its own transaction client — see PrismaAppService.withTenantContext's
 * own signature. Declared here rather than imported, since PrismaAppService
 * doesn't currently export it as a standalone type. */
type TenantTx = Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>;

/**
 * v1.2 backend backlog ("Waivers page", gap 2) / product-owner decision: write an
 * explicit Unsigned `WaiverSignature` row at "assignment" time, not only when a
 * Student actually signs — closing the gap where `WaiversService.sign()` was the
 * ONLY code path that ever created a row, making a row's mere existence mean
 * "signed" (schema's own `status @default(SIGNED)`).
 *
 * There is no dedicated "assign a Waiver to a Student" action/entity anywhere in
 * this codebase (checked apps/api/src/waivers/ thoroughly before building anything
 * new here) — so "assignment" is wired into the two real, already-wired moments
 * this codebase has for "a Student should now have a row for this School's
 * Waiver":
 *   1. WaiversService.createWaiver() — a NEW Waiver meeting every Student already
 *      active at that School. This is the exact population
 *      WaiverSignatureRequestsProcessor already notifies ("Waiver assigned to a
 *      student" is read structurally there too, at Waiver-creation time, per that
 *      processor's own header comment) — this just also writes the row that
 *      notification implies, which nothing previously did.
 *   2. SchoolsService.join() (Decision 96, the one real, production-reachable
 *      path that creates a STUDENT RoleGrant through the actual API) — a
 *      NEWLY-JOINED Student meeting every Waiver that already exists at that
 *      School.
 * Both are genuinely real and already exercised in production today (unlike the
 * "no endpoint anywhere creates a STUDENT RoleGrant" gap
 * WaiverSignatureRequestsProcessor's own header comment flags as a separate,
 * larger, not-yet-closed problem — that comment predates Decision 96/Phase 38's
 * join() work and is now stale on that specific point; see this feature's own PR
 * description for the full account). No Student-roster-diff invention needed:
 * each call site already knows its own one-sided list (the School's Students, or
 * the School's Waivers) without needing to ask the other side.
 *
 * A dedicated, dependency-free provider (not a WaiversService method) ON PURPOSE:
 * WaiversModule already imports TenantsModule (for SchoolsService); the reverse
 * edge (TenantsModule importing WaiversModule, so SchoolsService.join() could call
 * a WaiversService method) would be circular. TenantsModule's own header comment
 * documents this codebase's established convention for exactly this shape —
 * "duplicate a stateless/config-only registration rather than add a cross-module
 * dependency edge" (WaiversModule/InstructorsModule's own R2ClientService) — this
 * follows that same convention as its own tiny module (WaiverAssignmentModule),
 * imported by both WaiversModule and TenantsModule, rather than introducing this
 * codebase's first forwardRef().
 */
@Injectable()
export class WaiverAssignmentService {
  /**
   * Creates an Unsigned `WaiverSignature` row for every (waiverId, studentId)
   * pair in the cross product that doesn't already hold one — i.e. every School
   * with more than one Waiver gets one row per Waiver for the Student, per the
   * backlog's own wording ("a row — or rows, if a School has more than one
   * Waiver — for a Student").
   *
   * `createMany({ skipDuplicates: true })` relies on the SAME partial unique
   * index (`WaiverSignature_one_non_expired_per_student_per_waiver`)
   * WaiversService.sign() already relies on — Postgres' `ON CONFLICT DO NOTHING`
   * with no conflict target named catches a violation of ANY unique constraint,
   * so a pair that already holds a Signed, Unsigned, Expired, or Pending row is
   * left completely untouched (an Expired row is excluded from that index on
   * purpose — see the model's own comment — so a re-assignment after an Expired
   * signature still gets a fresh Unsigned row, which is correct: that Student
   * genuinely needs to sign again). Only a genuinely missing pair gets a new
   * Unsigned row. Safe to call speculatively for exactly that reason — no
   * separate existence check needed first, and no TOCTOU window between a check
   * and this insert.
   *
   * Runs under the CALLER's own already-open transaction (`tx`) rather than
   * opening a second one — both real call sites already hold one open for their
   * own primary write (the new Waiver row; the new STUDENT RoleGrant row), and
   * this should commit or roll back atomically with that write, not succeed or
   * fail as an independent step.
   */
  async assignUnsignedRows(tx: TenantTx, schoolId: string, waiverIds: string[], studentIds: string[]): Promise<void> {
    if (waiverIds.length === 0 || studentIds.length === 0) return;
    const rows = waiverIds.flatMap((waiverId) =>
      studentIds.map((studentId) => ({
        id: randomUUID(),
        waiverId,
        studentId,
        schoolId,
        status: 'UNSIGNED' as const,
        // signerFullName/signatureText/signedById/signedDate deliberately
        // omitted — all four are nullable precisely so an Unsigned row can
        // state plainly that nobody has signed it yet (see the model's own
        // header comment), not populated with a placeholder value.
      })),
    );
    await tx.waiverSignature.createMany({ data: rows, skipDuplicates: true });
  }
}
