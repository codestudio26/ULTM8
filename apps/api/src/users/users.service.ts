import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { CONTACT_FIELDS, UpdateUserDto } from './dto/update-user.dto';
import { addressWriteData } from '../common/address/postal-address.dto';

/**
 * `SELECT` shape shared by getMe/updateMe — explicit, not `findUnique({ where })`'s
 * default "every column" — so `passcodeHash` (a bcrypt hash of the login credential)
 * can never leak into a response just because a future field gets added to the User
 * model and this code isn't touched. See UserResponseDto's own header comment.
 */
const SELF_PROFILE_SELECT = {
  id: true,
  email: true,
  phone: true,
  phoneVerifiedAt: true,
  firstName: true,
  surname: true,
  username: true,
  dateOfBirth: true,
  gender: true,
  nationality: true,
  language: true,
  currency: true,
  address: true,
  addressLine1: true,
  addressLine2: true,
  addressCity: true,
  addressRegion: true,
  addressPostalCode: true,
  addressCountry: true,
  profilePhotoUrl: true,
  weightCategory: true,
  kimonoSize: true,
  beltSize: true,
  secondaryPhone: true,
  secondaryEmail: true,
  emergencyContactName: true,
  emergencyContactPhone: true,
  emergencyContactRelationship: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly prismaJobs: PrismaJobsService,
  ) {}

  /**
   * `user_self_or_shared_school`'s existing self-visibility clause ("id" = the
   * caller's own current_user_id) already covers this — no new RLS needed. Still
   * routed through `withTenantContext` like every other query in this codebase, not a
   * bypass, so the same connection-level tenant-context machinery applies uniformly.
   */
  async getMe(callerId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.findUnique({ where: { id: callerId }, select: SELF_PROFILE_SELECT }),
    );
    // Should be unreachable in practice — a valid JWT implies the User row exists — but
    // checked explicitly rather than assumed, same defensive convention every other
    // service's findOne uses.
    if (!found) {
      throw new NotFoundException('User not found');
    }
    return found;
  }

  /**
   * A Student's full profile for a Staff member editing it on their behalf
   * (SchoolsService.getStudentProfile, Decision 341 S9). Read under the
   * caller's own context: `user_self_or_shared_school` shows staff the User
   * rows of the students whose STUDENT grant they can see. Authorization is
   * the caller's job, as for updateProfileFor.
   */
  async getProfileFor(callerId: string, targetUserId: string) {
    const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.findUnique({ where: { id: targetUserId }, select: SELF_PROFILE_SELECT }),
    );
    if (!found) {
      throw new NotFoundException('User not found');
    }
    return found;
  }

  /**
   * Partial update of the caller's own row only — `email`/`phone` are deliberately
   * absent from UpdateUserDto (see its own header comment), and `id` in the WHERE
   * clause is always `callerId`, never a route/body-supplied id, so there's no path
   * for this to touch any row but the caller's own even before RLS's WITH CHECK
   * (`"id" = current_setting('app.current_user_id', true)`) is reached.
   */
  async updateMe(callerId: string, dto: UpdateUserDto) {
    // A child's contacts are kept by staff or their Guardian, never the child
    // (Decision 315 item 5 with the Guardian rules of §14). A Guardian-managed
    // child has no login today (Decision 175); this holds if one ever does.
    if (CONTACT_FIELDS.some((f) => dto[f] !== undefined)) {
      const guardian = await this.prismaJobs.guardianLink.findFirst({ where: { studentId: callerId, revokedAt: null }, select: { id: true } });
      if (guardian) {
        throw new ForbiddenException("A child's contact details are changed by their Guardian or the School.");
      }
    }
    return this.updateProfileFor(callerId, callerId, dto);
  }

  /**
   * Shared by `updateMe` (targetUserId === callerId) and, as of the v1.2 backend
   * backlog's Student Detail "Edit" gap, `SchoolsService.updateStudentProfile`
   * (targetUserId === the Student being edited, callerId === the Staff member acting
   * on their behalf). Deliberately the SAME validation and the SAME field set for
   * both callers — `UpdateStudentProfileDto` reuses `UpdateUserDto` outright (see its
   * own header comment) rather than this method special-casing who's calling it.
   *
   * Still routed through `withTenantContext(callerId, ...)`, never a different
   * connection identity, so the caller's own RLS context — not the target's — governs
   * every query here. For the Staff-on-behalf-of case this relies on the narrow,
   * additive `user_staff_update_student_profile` RLS policy (see that migration's own
   * comment) alongside the pre-existing self-only `user_self_or_shared_school` WITH
   * CHECK — SchoolsService.updateStudentProfile re-derives the same
   * Staff-at-this-School + active-Student-at-this-School facts in the app layer
   * BEFORE this is ever reached (TenantAuthorizationService.assertStaffAtSchool + its
   * own active-STUDENT-RoleGrant check), per this project's defense-in-depth
   * convention — this method does not re-check authorization itself.
   */
  async updateProfileFor(callerId: string, targetUserId: string, dto: UpdateUserDto) {
    // firstName/surname/dateOfBirth are NOT NULL on User, but `@IsOptional()` on
    // UpdateUserDto only skips validation for `undefined`, not an explicit `null`
    // (class-validator's own IsOptional behavior) — so `{"firstName": null}` would
    // otherwise reach Prisma as a literal null and hit a NOT NULL violation the global
    // exception filter doesn't map to a clean 400 (HttpExceptionFilter only handles
    // P2002/P2025/P2003). dateOfBirth's existing `? ... : undefined` ternary below
    // makes this worse, not better, for that one field: it silently treats an explicit
    // null the same as "omitted" (a no-op) instead of either applying it or rejecting
    // it — the caller gets a 200 that looks like it worked but changed nothing.
    // Rejected explicitly here rather than guessing at a silent reinterpretation.
    if (dto.firstName === null) {
      throw new BadRequestException('firstName cannot be null.');
    }
    if (dto.surname === null) {
      throw new BadRequestException('surname cannot be null.');
    }
    if (dto.dateOfBirth === null) {
      throw new BadRequestException('dateOfBirth cannot be null.');
    }

    // `username` is @unique but nullable — pre-checked explicitly (same convention
    // AuthService.register()/RoleGrantsService.create()/InstructorsService.create()
    // all use) so a duplicate PATCH gets a specific message instead of falling through
    // to HttpExceptionFilter's generic P2002 "A record with this value already
    // exists." Only checked when a real value is supplied — null/undefined never
    // collide with anything.
    //
    // Checked through prismaAuth, like AuthService.register()'s own duplicate check,
    // and ignoring capitals (sign-in review A8): under the caller's RLS context a
    // username held at another School was invisible, so it fell through to the
    // generic P2002 message, and "Taken" never matched "taken". Only an id comes
    // back, never another account's details.
    if (dto.username) {
      const duplicate = await this.prismaAuth.user.findFirst({
        where: { username: { equals: dto.username, mode: 'insensitive' }, id: { not: targetUserId } },
        select: { id: true },
      });
      if (duplicate) {
        throw new ConflictException('This username is already taken.');
      }
    }

    return this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.user.update({
        where: { id: targetUserId },
        data: {
          firstName: dto.firstName,
          surname: dto.surname,
          username: dto.username,
          dateOfBirth: dto.dateOfBirth ? new Date(dto.dateOfBirth) : undefined,
          gender: dto.gender,
          nationality: dto.nationality,
          language: dto.language,
          currency: dto.currency,
          ...addressWriteData(dto),
          profilePhotoUrl: dto.profilePhotoUrl,
          // Decision 220/246 — plain pass-through, same as gender/nationality/
          // language/currency/address above: `undefined` (omitted) leaves the
          // existing value alone, an explicit `null` clears it (these are nullable
          // on `User`), never special-cased like firstName/surname/dateOfBirth.
          weightCategory: dto.weightCategory,
          kimonoSize: dto.kimonoSize,
          beltSize: dto.beltSize,
          // Decision 315 item 5: same pass-through (null clears).
          secondaryPhone: dto.secondaryPhone,
          secondaryEmail: dto.secondaryEmail,
          emergencyContactName: dto.emergencyContactName,
          emergencyContactPhone: dto.emergencyContactPhone,
          emergencyContactRelationship: dto.emergencyContactRelationship,
        },
        select: SELF_PROFILE_SELECT,
      }),
    );
  }
}
