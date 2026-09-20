import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Min, MaxLength } from 'class-validator';
import { LessonFormat } from '@prisma/client';

/**
 * Field list verified against Spec 55 §6.1's confirmed Lesson row (quoted): "Title,
 * category, duration, instructor, description, linked skill(s), format
 * (Prerecorded/Live), videoRef...". `schoolId` is a route param
 * (`/schools/:schoolId/curriculum/lessons`), not a body field — same convention as
 * CreateDisciplineDto.
 *
 * Route itself is a Developer-level addition, same class as Discipline/Skill's own
 * CRUD (see CreateSkillDto's own comment) — Spec 55's own §7 endpoint table names
 * `CRUD /admin/curriculum/lessons`, which this project resolved directly with the
 * user as a spec-internal contradiction (see Lesson's own schema.prisma comment,
 * Decision 104) — authoring is tenant-side, not Platform Admin.
 *
 * `skillIds` requires at least one — Decision 58's own text ("each tagged with the
 * specific skill they teach") never describes an untagged Lesson.
 *
 * `captionStatus`/`captionTrackRef`/`videoRef` are deliberately NOT accepted here —
 * no video-hosting/captioning pipeline is built yet (Decision 101 picked vendors,
 * didn't build the integration); a Lesson is created with captionStatus defaulting
 * to PENDING and videoRef/captionTrackRef null until that pipeline exists in a
 * later phase. Do not add a client-writable videoRef here as a stand-in — that
 * would let a caller point captionStatus/videoRef at arbitrary values with nothing
 * behind them.
 */
export class CreateLessonDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiPropertyOptional({ description: 'Plain field only — Spec 55\'s own "Belongs to a Category" relationship note has no corresponding Category entity anywhere else in the document; treated as a doc inconsistency, not built as a relation.' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  category?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  @Min(1)
  durationSeconds?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiProperty({ enum: LessonFormat })
  @IsEnum(LessonFormat)
  format!: LessonFormat;

  @ApiPropertyOptional({ description: 'A User holding an active INSTRUCTOR RoleGrant at this School — validated the same way Class.instructorId is (TenantAuthorizationService.assertValidInstructor), not a separate Instructor-profile FK.' })
  @IsOptional()
  @IsUUID('4')
  instructorId?: string;

  @ApiProperty({ type: [String], minItems: 1, description: 'Skill ids this Lesson teaches — must all belong to this School.' })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsUUID('4', { each: true })
  skillIds!: string[];
}
