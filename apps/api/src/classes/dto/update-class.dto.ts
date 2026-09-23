import { ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, IsUUID, IsUrl, Min, MaxLength } from 'class-validator';
import { CreateClassDto } from './create-class.dto';

const NULLABLE_ON_UPDATE = ['branchId', 'instructorId', 'bannerUrl', 'description', 'capacity', 'cancellationCharge'] as const;

/**
 * FOUND ON REVIEW (Phase 17, school-portal's own edit-Class form): every
 * optional field this class inherits unchanged from `PartialType(CreateClassDto)`
 * is typed `T | undefined` only — there was never a way for a PATCH caller to
 * explicitly CLEAR one of these (unassign a Branch/Instructor, remove a banner,
 * etc.), only to leave it alone (omit) or set a new value. That's not a new
 * business decision: ClassesService.update()'s own Prisma call already forwards
 * `dto.branchId`/`dto.instructorId`/`dto.bannerUrl`/`dto.description`/
 * `dto.capacity`/`dto.cancellationCharge` straight through as `data.<field>` with
 * no ternary — Prisma already treats an explicit `null` there as "clear this
 * column" and `undefined` as "leave unchanged", so the write path has supported
 * this all along. The DTO's own type annotation just undersold it, and nothing
 * exercised the gap until school-portal's edit form needed to actually unassign a
 * Branch/Instructor from an existing Class. Fixed here by explicitly widening
 * these specific fields to accept `null`, matching InstructorsService.update()'s
 * OWN already-explicit convention for the identical situation (see that file's
 * update() comment on why `specializations` is the one deliberate exception —
 * NOT NULL on the Prisma model, so it stays array-only, `[]` to clear).
 *
 * Deliberately NOT widened here: `title`/`activities`/`startDate`/`endDate`
 * (required — nothing to "clear", only to replace) or `bookingEndAt`/
 * `qrAttendanceEndAt`/`refundFeeDate` (ClassesService.update() converts these via
 * `dto.X ? new Date(dto.X) : undefined` — a falsy check that would swallow an
 * explicit `null` the same as an omitted field, so declaring null-support here
 * without ALSO fixing that ternary would be a lie the type checker can't catch;
 * left as a separate, real, flagged gap rather than silently half-fixed).
 */
export class UpdateClassDto extends PartialType(OmitType(CreateClassDto, NULLABLE_ON_UPDATE)) {
  @ApiPropertyOptional({ description: 'Branch to scope this Class to. Pass null to clear (make it School-wide).', type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  branchId?: string | null;

  @ApiPropertyOptional({ description: 'A User holding an active INSTRUCTOR RoleGrant at this School. Pass null to unassign.', type: String, nullable: true })
  @IsOptional()
  @IsUUID()
  instructorId?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @IsUrl()
  bannerUrl?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Pass null to clear (unlimited).', minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  capacity?: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "Minor currency unit (e.g. cents). Pass null to clear." })
  @IsOptional()
  @IsInt()
  @Min(0)
  cancellationCharge?: number | null;
}
