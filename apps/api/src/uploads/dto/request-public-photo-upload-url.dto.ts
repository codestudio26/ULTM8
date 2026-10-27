import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsOptional, IsUUID } from 'class-validator';

/** Every entity whose photo/logo/banner field this phase wires up to a real
 * upload pipeline — see UploadsModule's own header comment for the full list
 * (Instructor.photoUrl, User.profilePhotoUrl, Branch.logoUrl/bannerUrl,
 * Franchise.logoUrl/bannerUrl, Class.bannerUrl). Deliberately an enum on ONE
 * shared endpoint rather than five separate per-entity ones (unlike the
 * existing private-path precedents, signature-upload-url/
 * certification-upload-url) — these five entities' own authorization gates
 * are each already a one-line call onto TenantAuthorizationService, so a
 * switch over this enum costs less than five near-identical controllers/DTOs/
 * response-DTOs would.
 */
export enum PublicPhotoEntityType {
  INSTRUCTOR = 'INSTRUCTOR',
  USER = 'USER',
  BRANCH = 'BRANCH',
  FRANCHISE = 'FRANCHISE',
  CLASS = 'CLASS',
  /** Decision 368 — the School's own logo (School.logoUrl), which the student app shows. */
  SCHOOL = 'SCHOOL',
}

const ALLOWED_CONTENT_TYPES = ['image/png', 'image/jpeg', 'image/webp'] as const;
export type PublicPhotoContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

/** POST /uploads/public-photo-url body. Which of `schoolId`/`franchiseId`/
 * `entityId` are actually required depends on `entityType` — see
 * UploadsService.requestPublicPhotoUploadUrl()'s own comment for the exact
 * per-type rules; class-validator can't express that cross-field dependency
 * declaratively here, so it's enforced in the service, same convention
 * UpdateFranchiseDto's own cross-field checks already use (service-level, not
 * decorator-level).
 */
export class RequestPublicPhotoUploadUrlDto {
  @ApiProperty({ enum: PublicPhotoEntityType })
  @IsEnum(PublicPhotoEntityType)
  entityType!: PublicPhotoEntityType;

  @ApiProperty({ enum: ALLOWED_CONTENT_TYPES })
  @IsIn(ALLOWED_CONTENT_TYPES)
  contentType!: PublicPhotoContentType;

  @ApiPropertyOptional({ description: 'Required for entityType INSTRUCTOR/BRANCH/CLASS, and for USER when acting on behalf of a Student.' })
  @IsOptional()
  @IsUUID()
  schoolId?: string;

  @ApiPropertyOptional({
    description:
      'For entityType FRANCHISE editing an EXISTING Franchise, this is required and must equal entityId. Omit both when creating a brand-new Franchise (mirrors POST /franchises itself, which needs no prior RoleGrant either).',
  })
  @IsOptional()
  @IsUUID()
  franchiseId?: string;

  @ApiPropertyOptional({
    description:
      "The existing Instructor/Branch/Class/Franchise row's own id, or the target Student's User id for entityType USER on-behalf-of. Omit when creating a brand-new entity (its id does not exist yet) or editing your own User row.",
  })
  @IsOptional()
  @IsUUID()
  entityId?: string;
}
