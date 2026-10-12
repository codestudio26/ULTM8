import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SchoolsService } from '../tenants/schools/schools.service';
import { R2ClientService } from '../common/object-storage/r2-client.service';
import { PublicPhotoContentType, PublicPhotoEntityType, RequestPublicPhotoUploadUrlDto } from './dto/request-public-photo-upload-url.dto';

const EXTENSION_BY_CONTENT_TYPE: Record<PublicPhotoContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
};

@Injectable()
export class UploadsService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
    private readonly schoolsService: SchoolsService,
    private readonly r2Client: R2ClientService,
  ) {}

  /**
   * POST /uploads/public-photo-url — see UploadsModule's own header comment for
   * why this is one shared endpoint across five entity types rather than five
   * separate ones. Authorization mirrors each entity's OWN existing write gate
   * exactly (not a new, parallel permission model):
   *   - INSTRUCTOR/BRANCH/CLASS: School Owner/Manager at `dto.schoolId` — the
   *     same gate InstructorsService.create()/update(), BranchesService.update(),
   *     ClassesService.create()/update() already use.
   *   - FRANCHISE: Franchise Owner at `dto.franchiseId` — same gate
   *     FranchisesService.update() already uses.
   *   - USER: the caller's own row (self-service profile photo), or, on behalf
   *     of a Student (`dto.entityId` = that Student's own User id), Staff at
   *     `dto.schoolId` with that Student currently enrolled there — the EXACT
   *     same two checks SchoolsService.updateStudentProfile() already makes,
   *     deliberately re-derived here rather than imported (UsersModule exports
   *     only UsersService, not a reusable "assert Staff-on-behalf-of" helper,
   *     and TenantsModule already owns both checks this needs).
   *
   * `dto.entityId`, when given, is also checked to actually belong to
   * `dto.schoolId`/`dto.franchiseId` — a caller authorized at School A can't
   * otherwise request an upload URL keyed under School B's Branch/Class/
   * Instructor id (the object key alone wouldn't let them READ anything
   * cross-tenant — the bucket is public-GET by design — but it would let them
   * write into another School's own key namespace, which this closes). When
   * `dto.entityId` is omitted (creating a brand-new Instructor/Branch/Class/
   * Franchise row, whose real id doesn't exist yet), a fresh random id stands
   * in for it in the object key instead — this is public, non-legal-record
   * data, so (unlike the private signature/certification flows' objectExists()
   * check) there is deliberately no server-side "was this key ever actually
   * uploaded to" confirmation step later: the caller's own form simply never
   * sets photoUrl/logoUrl/bannerUrl to a URL whose PUT never succeeded. A
   * fabricated-but-never-uploaded public URL would 404 when viewed, the same
   * outcome a mistyped pasted URL already produces today — no worse than the
   * plain-text-field status quo this phase replaces.
   */
  async requestPublicPhotoUploadUrl(callerId: string, dto: RequestPublicPhotoUploadUrlDto) {
    const { scope, entityId } = await this.authorizeAndResolveScope(callerId, dto);
    const extension = EXTENSION_BY_CONTENT_TYPE[dto.contentType];
    const objectKey = `public-photos/${dto.entityType.toLowerCase()}/${scope}/${entityId}/${randomUUID()}.${extension}`;
    const uploadUrl = await this.r2Client.getPublicPhotoUploadUrl(objectKey, dto.contentType);
    const publicUrl = this.r2Client.getPublicPhotoUrl(objectKey);
    return { uploadUrl, publicUrl };
  }

  /** Returns the object-key's `scope` segment (the School or Franchise this
   * upload is authorized under, or — for USER — the target User's own id,
   * which doubles as both scope and entity there, unlike
   * Instructor/Branch/Class which are a real sub-id WITHIN a School) and
   * `entityId` segment, once every check below passes — throws otherwise.
   * Kept as one method (not a per-type class) since every branch is a short,
   * linear sequence of existing-service calls, not enough independent logic
   * to warrant a strategy-pattern split. */
  private async authorizeAndResolveScope(callerId: string, dto: RequestPublicPhotoUploadUrlDto): Promise<{ scope: string; entityId: string }> {
    switch (dto.entityType) {
      case PublicPhotoEntityType.INSTRUCTOR: {
        const schoolId = this.requireSchoolId(dto, 'INSTRUCTOR');
        await this.schoolsService.findOne(callerId, schoolId); // 404s if not visible/doesn't exist
        await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
        if (dto.entityId) {
          const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
            tx.instructor.findFirst({ where: { id: dto.entityId, schoolId }, select: { id: true } }),
          );
          if (!found) {
            throw new NotFoundException('Instructor profile not found at this School.');
          }
        }
        // No existing Instructor id yet (creating one) — a fresh random id
        // stands in instead (see this method's own header comment).
        return { scope: schoolId, entityId: dto.entityId ?? randomUUID() };
      }
      case PublicPhotoEntityType.BRANCH: {
        const schoolId = this.requireSchoolId(dto, 'BRANCH');
        await this.schoolsService.findOne(callerId, schoolId);
        await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
        if (dto.entityId) {
          await this.tenantAuth.assertBranchBelongsToSchool(callerId, dto.entityId, schoolId);
        }
        return { scope: schoolId, entityId: dto.entityId ?? randomUUID() };
      }
      case PublicPhotoEntityType.CLASS: {
        const schoolId = this.requireSchoolId(dto, 'CLASS');
        await this.schoolsService.findOne(callerId, schoolId);
        await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
        if (dto.entityId) {
          const found = await this.prismaApp.withTenantContext(callerId, (tx) =>
            tx.class.findFirst({ where: { id: dto.entityId, schoolId }, select: { id: true } }),
          );
          if (!found) {
            throw new NotFoundException('Class not found at this School.');
          }
        }
        return { scope: schoolId, entityId: dto.entityId ?? randomUUID() };
      }
      case PublicPhotoEntityType.FRANCHISE: {
        if (!dto.franchiseId) {
          // Unlike INSTRUCTOR/BRANCH/CLASS (which always nest under an
          // ALREADY-EXISTING School the caller already owns, even on
          // create), Franchise creation itself has no parent to anchor an
          // authorization check to — FranchisesService.create() is genuinely
          // self-service, with NO prior RoleGrant check at all, for exactly
          // this reason (see its own comment: "creator becomes
          // FRANCHISE_OWNER"). Mirrors that here: requesting an upload URL
          // for a not-yet-created Franchise's own logo/banner needs no
          // further gate either, since the create endpoint itself has none.
          // Scoped under the caller's own id (there is no franchiseId yet),
          // same "caller's own id stands in" shape the USER self-service
          // branch below already uses.
          return { scope: callerId, entityId: callerId };
        }
        await this.tenantAuth.assertFranchiseOwner(callerId, dto.franchiseId);
        if (dto.entityId && dto.entityId !== dto.franchiseId) {
          throw new BadRequestException('entityId must equal franchiseId for entityType FRANCHISE.');
        }
        // A Franchise has no separate sub-id distinct from the Franchise
        // itself (unlike Instructor/Branch/Class within a School) — scope
        // and entityId are the same value.
        return { scope: dto.franchiseId, entityId: dto.franchiseId };
      }
      case PublicPhotoEntityType.USER: {
        const targetUserId = dto.entityId ?? callerId;
        if (targetUserId === callerId) {
          // Self-service profile photo — no further gate needed. Same
          // "scope and entityId are the same value" shape as FRANCHISE above
          // — a User row has no separate sub-id of its own either.
          return { scope: targetUserId, entityId: targetUserId };
        }
        // Staff-on-behalf-of a Student — mirrors SchoolsService.updateStudentProfile()'s
        // own gate exactly (see this method's own header comment).
        if (!dto.schoolId) {
          throw new BadRequestException('schoolId is required when requesting an upload URL on behalf of another User.');
        }
        await this.schoolsService.findOne(callerId, dto.schoolId);
        await this.tenantAuth.assertStaffAtSchool(callerId, dto.schoolId);
        const enrolled = await this.prismaApp.withTenantContext(callerId, (tx) =>
          tx.roleGrant.findFirst({
            where: { userId: targetUserId, schoolId: dto.schoolId, role: 'STUDENT', revokedAt: null },
            select: { id: true },
          }),
        );
        if (!enrolled) {
          throw new NotFoundException('This person is not a Student at this School.');
        }
        return { scope: targetUserId, entityId: targetUserId };
      }
    }
  }

  private requireSchoolId(dto: RequestPublicPhotoUploadUrlDto, entityType: string): string {
    if (!dto.schoolId) {
      throw new BadRequestException(`schoolId is required for entityType ${entityType}.`);
    }
    return dto.schoolId;
  }
}
