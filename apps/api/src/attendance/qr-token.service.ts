import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

const TTL_SECONDS = Number(process.env.QR_ATTENDANCE_TOKEN_TTL_SECONDS ?? 20);

interface ClassQrPayload {
  classId: string;
}

interface StudentQrPayload {
  studentId: string;
}

/**
 * Phase 51 (Decision 107, docs/decisions/POST-SPEC-55-DECISION-LOG.md) — mints
 * and verifies the two short-lived, rotating, signed tokens the QR check-in
 * design needs: one scoped to a Class (Staff displays it; a self-service
 * Student scans it), one scoped to a Student (the Student displays it on their
 * own device; an Instructor scans it for roll-call). This closes the
 * "photograph-and-send-remotely" spoofing vector SKILL.md §12 (Decision 66)
 * flags for the Class token, and applies the same rotating-token mitigation to
 * the Instructor-scan path Decision 71 left undesigned.
 *
 * TWO DELIBERATELY SEPARATE secrets/JwtService instances — never one shared
 * secret — so a captured Class token can never be replayed as a Student token
 * or vice versa, even if a bug elsewhere skipped a payload-shape check. Same
 * TTL for both (conceptually the same rotation window either way) — a
 * Developer-level placeholder, same tier of judgment call as
 * PLATFORM_ADMIN_IMPERSONATION_TTL_SECONDS's own 600s default (flagged there,
 * flagged here too — not asserted as a final, product-approved number).
 *
 * Manually constructs two JwtService instances rather than going through
 * JwtModule.register() (this codebase's usual per-module pattern, e.g.
 * PlatformAdminModule) — that pattern assumes exactly one JwtService per
 * module; this service genuinely needs two, independently keyed. Same
 * "unconfigured dependency doesn't crash boot" convention as every other
 * external-secret-backed service in this codebase (Stripe, Twilio, R2): an
 * unset secret only surfaces as a failure the first time sign()/verify() is
 * actually called, not at app startup.
 */
@Injectable()
export class QrTokenService {
  private readonly classJwt = new JwtService({ secret: process.env.QR_CLASS_TOKEN_SECRET });
  private readonly studentJwt = new JwtService({ secret: process.env.QR_STUDENT_TOKEN_SECRET });

  signClassToken(classId: string): { token: string; expiresAt: Date } {
    const token = this.classJwt.sign({ classId } satisfies ClassQrPayload, { expiresIn: TTL_SECONDS });
    return { token, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) };
  }

  /** Throws BadRequestException (expired/invalid/tampered) rather than
   * returning null — every call site needs the same rejection either way, so
   * there's no case that benefits from a caller re-deciding how to react. */
  verifyClassToken(token: string): string {
    try {
      return this.classJwt.verify<ClassQrPayload>(token).classId;
    } catch {
      throw new BadRequestException('This QR code has expired or is invalid — ask Staff to refresh it.');
    }
  }

  signStudentToken(studentId: string): { token: string; expiresAt: Date } {
    const token = this.studentJwt.sign({ studentId } satisfies StudentQrPayload, { expiresIn: TTL_SECONDS });
    return { token, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) };
  }

  verifyStudentToken(token: string): string {
    try {
      return this.studentJwt.verify<StudentQrPayload>(token).studentId;
    } catch {
      throw new BadRequestException('This QR code has expired or is invalid — ask the Student to refresh it.');
    }
  }
}
