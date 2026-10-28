import { BadRequestException, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHmac } from 'crypto';

const TTL_SECONDS = Number(process.env.QR_ATTENDANCE_TOKEN_TTL_SECONDS ?? 20);

interface ClassQrPayload {
  classId: string;
}

interface StudentQrPayload {
  studentId: string;
}

/** Front-desk check-in review Q2 (28 Oct 2026): a scanned app QR is checked
 * once, and the desk gets this for the next few minutes instead. */
const DESK_LOOKUP_TTL_SECONDS = 300;

interface DeskLookupPayload {
  deskStudentId: string;
  schoolId: string;
  staffId: string;
  /** 'CODE': the student typed their personal check-in code (Decision 384),
   * recorded as PERSONAL_CODE. Absent: they showed their app QR. */
  via?: 'CODE';
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
  // Its own key, derived from the student one, so a desk lookup can never be
  // replayed as a student QR or the other way round (same reasoning as above).
  private readonly deskJwt = new JwtService({
    secret: process.env.QR_STUDENT_TOKEN_SECRET
      ? createHmac('sha256', process.env.QR_STUDENT_TOKEN_SECRET).update('front-desk-lookup').digest('hex')
      : undefined,
  });

  signClassToken(classId: string): { token: string; expiresAt: Date } {
    const token = this.classJwt.sign({ classId } satisfies ClassQrPayload, { expiresIn: TTL_SECONDS });
    return { token, expiresAt: new Date(Date.now() + TTL_SECONDS * 1000) };
  }

  /**
   * Decision 235 (POST-SPEC-55-DECISION-LOG.md) — a short, human-typeable
   * 6-digit fallback code for a Student with no working camera, "derived from
   * the same signed Class token... no new secret store needed." Read
   * literally (hash the exact JWT string the display screen currently holds),
   * that's unverifiable later without storing that specific token somewhere —
   * this codebase's JWTs are intentionally stateless (classJwt.verify() never
   * looks anything up). Interpreted instead as: the SAME signing input
   * (QR_CLASS_TOKEN_SECRET) and the SAME rotation cadence (TTL_SECONDS) as the
   * QR token, via a fixed time bucket rather than a specific token instance —
   * stateless (still no new secret store) and provably in lockstep with the
   * QR (same classId, same TTL window), without needing the exact JWT string
   * to still exist anywhere to verify against later. Flagged as an inferred
   * reading, not asserted as the only possible one.
   *
   * `Math.floor(now / TTL)` — every mint/verify call within the same
   * TTL_SECONDS window computes the identical bucket, matching how often the
   * QR token itself actually rotates (the display screen re-polls
   * GET /classes/{id}/qr-token every TTL_SECONDS).
   */
  deriveClassCheckInCode(classId: string): { code: string; expiresAt: Date } {
    const bucket = this.currentBucket();
    return { code: this.hmacCode(classId, bucket), expiresAt: new Date((bucket + 1) * TTL_SECONDS * 1000) };
  }

  /** Accepts the current bucket's code OR the immediately preceding one — the
   * same one-step grace a Student typing a 6-digit code (slower than a camera
   * scan) can plausibly straddle right at a rotation boundary. Never more than
   * one bucket back — widening this tolerance further would meaningfully cut
   * into the brute-force resistance this code's own 20s (default) rotation
   * window exists to provide. */
  verifyClassCheckInCode(classId: string, code: string): boolean {
    const bucket = this.currentBucket();
    return code === this.hmacCode(classId, bucket) || code === this.hmacCode(classId, bucket - 1);
  }

  private currentBucket(): number {
    return Math.floor(Date.now() / (TTL_SECONDS * 1000));
  }

  private hmacCode(classId: string, bucket: number): string {
    const secret = process.env.QR_CLASS_TOKEN_SECRET;
    if (!secret) {
      // Same "unconfigured dependency fails at first use, not at boot"
      // convention classJwt.sign()/verify() already follow for this exact
      // env var — explicit here because createHmac, unlike jsonwebtoken,
      // would otherwise silently accept an empty-string secret and produce a
      // real, exploitable, deterministic-and-guessable code instead of
      // failing loudly.
      throw new Error('QR_CLASS_TOKEN_SECRET is not set — cannot derive a check-in code.');
    }
    const digest = createHmac('sha256', secret).update(`${classId}:${bucket}`).digest();
    const num = digest.readUInt32BE(0) % 1_000_000;
    return num.toString().padStart(6, '0');
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

  /** A desk lookup: which student a scanned QR belonged to, for this School and
   * this staff member only, valid for DESK_LOOKUP_TTL_SECONDS. */
  signDeskLookup(payload: DeskLookupPayload): { token: string; expiresAt: Date } {
    const token = this.deskJwt.sign(payload, { expiresIn: DESK_LOOKUP_TTL_SECONDS });
    return { token, expiresAt: new Date(Date.now() + DESK_LOOKUP_TTL_SECONDS * 1000) };
  }

  verifyDeskLookup(token: string): DeskLookupPayload {
    try {
      const { deskStudentId, schoolId, staffId, via } = this.deskJwt.verify<DeskLookupPayload>(token);
      return { deskStudentId, schoolId, staffId, ...(via === 'CODE' ? { via } : {}) };
    } catch {
      throw new BadRequestException({ code: 'QR_LOOKUP_EXPIRED', message: 'This scan has expired. Ask the Student to show their QR again.' });
    }
  }
}
