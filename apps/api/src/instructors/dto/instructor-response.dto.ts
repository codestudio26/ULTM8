import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PostalAddressColumnsResponseDto } from '../../common/address/postal-address.dto';

/**
 * Response shape — see class-response.dto.ts's header comment (including why every
 * nullable field passes an explicit `type` alongside `nullable: true`, without which
 * openapi-typescript silently generates `Record<string, never>` for it). Field-for-field
 * match of the Instructor Prisma model.
 */
export class InstructorResponseDto extends PostalAddressColumnsResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  userId!: string;

  /** Resolved via PrismaAuthService (see resolveUserNames.ts) — not a raw Instructor
   * column. Added so the Instructors list and any picker built on it can show a real
   * name instead of a truncated userId. */
  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  /** Resolved via resolveUserNames.ts alongside firstName/surname — not a raw
   * Instructor column. */
  @ApiProperty()
  email!: string;

  /** Whether the linked User still holds an active (non-revoked) INSTRUCTOR RoleGrant
   * at this School — resolved from RoleGrant.revokedAt, not a raw Instructor column
   * (Instructor itself is never the source of truth for role-holding). */
  @ApiProperty({ enum: ['ACTIVE', 'REVOKED'] })
  status!: 'ACTIVE' | 'REVOKED';

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  branchId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  photoUrl!: string | null;

  @ApiProperty({ type: [String] })
  specializations!: string[];

  @ApiProperty({ type: [String], description: "The School's styles this instructor specialises in (Decision 152)." })
  specializationStyleIds!: string[];

  @ApiPropertyOptional({ type: String, nullable: true })
  phone!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  yearsOfExperience!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  bio!: string | null;

  /** Decision 1/217 — distinct from User.address, same "deliberately separate"
   * treatment as `phone` above. */
  @ApiPropertyOptional({ type: String, nullable: true })
  address!: string | null;

  /** Decision 1/217 — deliberately distinct from `specializations` above (that
   * one is School-style-scoped); this is the Instructor's own free-text
   * activities list. */
  @ApiProperty({ type: [String] })
  activities!: string[];

  /** Decision 1/217/218 — R2 object key, never a direct URL (presigned-only
   * access, same convention as WaiverSignature.signatureImageKey). */
  @ApiPropertyOptional({ type: String, nullable: true })
  certificationKey!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Set once this Instructor has consented to holding a certification record.' })
  certificationConsentedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — set when this Instructor profile has been archived. Null when active. Never touches the underlying User or their INSTRUCTOR RoleGrant.' })
  archivedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — 90 days after archivedAt; the scheduled purge sweep hard-deletes this profile once this elapses.' })
  purgeAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Decision 226 — set by the purge sweep once actually purged.' })
  purgedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class InstructorListResponseDto {
  @ApiProperty({ type: [InstructorResponseDto] })
  items!: InstructorResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Cursor for the next page, or null if this is the last page.' })
  nextCursor!: string | null;
}
