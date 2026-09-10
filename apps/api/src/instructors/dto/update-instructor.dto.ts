import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsPhoneNumber, IsString, IsUUID, IsUrl, Min, MaxLength } from 'class-validator';
import { CreateInstructorDto } from './create-instructor.dto';

const NULLABLE_ON_UPDATE = ['branchId', 'photoUrl', 'beltRanking', 'phone', 'yearsOfExperience', 'bio'] as const;

/**
 * `userId` is deliberately excluded, not just made optional — a profile can't be
 * reassigned to a different User via PATCH; nothing in Spec 55 describes a
 * reassignment flow, and silently allowing it would let a School Owner/Manager move
 * one person's bio/photo/specializations onto another person's profile row by
 * accident. If reassignment is ever a real need, it's a deliberate, separate decision
 * to make (flag for Architect review), not a side effect of this DTO's shape.
 *
 * FOUND ON REVIEW (Phase 17, school-portal's own edit-Instructor form): the
 * remaining optional fields below are explicitly widened to accept `null`,
 * matching what InstructorsService.update() already does today — its Prisma call
 * forwards `dto.branchId`/`dto.photoUrl`/`dto.beltRanking`/`dto.phone`/
 * `dto.yearsOfExperience`/`dto.bio` straight through as `data.<field>` (no
 * ternary), so an explicit `null` already clears the column and `undefined`
 * already leaves it unchanged — that method's own comment already documents this
 * exact null/undefined distinction for `specializations` (the one deliberate
 * exception: NOT NULL on the Prisma model, rejected with a clear 400, `[]` to
 * clear instead). This DTO's type annotations simply hadn't caught up to what
 * the write path already supported, and nothing exercised the gap until
 * school-portal's edit form needed to actually clear one of these fields.
 */
export class UpdateInstructorDto extends PartialType(OmitType(CreateInstructorDto, ['userId', ...NULLABLE_ON_UPDATE] as const)) {
  @ApiPropertyOptional({ description: 'Branch to scope this profile to. Pass null to clear (make it School-wide).', type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  photoUrl?: string | null;

  @ApiPropertyOptional({ description: 'Plain display text (e.g. "Black Belt, 3rd Dan") — not a live reference into the grading system.', type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  beltRanking?: string | null;

  @ApiPropertyOptional({ description: "School-facing contact number, E.164 — distinct from this User's own login phone. Pass null to clear.", type: String, nullable: true })
  @IsOptional()
  @IsPhoneNumber(undefined, { message: 'phone must be a valid E.164 number' })
  phone?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  yearsOfExperience?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string | null;
}
