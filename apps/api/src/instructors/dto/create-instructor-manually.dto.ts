import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { NormalizeEmail } from '../../common/decorators/normalize-email.decorator';

/**
 * Decision 1/230 — Instructor "Add Manually": a real User + RoleGrant +
 * Instructor profile created immediately, from just a name and email, no
 * invite/acceptance step. Deliberately a separate DTO from CreateInstructorDto
 * — that one profiles a User who already holds an INSTRUCTOR RoleGrant
 * (`InstructorsService.create()`); this one creates the User and the grant
 * too, a materially different operation, not a variant of the same one.
 *
 * Everything else about the person (phone, dateOfBirth, address, activities,
 * certification, consent) is deliberately NOT collected here — the product
 * owner's own answer was "only Name and Email are required at creation...
 * everything else is left blank and the instructor fills it in themselves
 * after their first login."
 */
export class CreateInstructorManuallyDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  surname!: string;

  @ApiProperty()
  @NormalizeEmail()
  @IsEmail()
  email!: string;

  @ApiPropertyOptional({ description: 'Required when the School has branches (Decision 169) — same rule RoleGrantsService.create() already applies for an INSTRUCTOR grant.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}
