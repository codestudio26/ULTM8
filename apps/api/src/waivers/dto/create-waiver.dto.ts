import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Waivers review W4: spaces alone are not a title or a text.
const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Field list verified against skills/ultm8-domain-rules/SKILL.md §13's confirmed
 * Waiver row — "title, body text, per-school assignment." schoolId is a route
 * param (`/schools/:schoolId/waivers`), not a body field, same convention as
 * CreateMembershipPlanDto/CreateClassDto.
 */
export class CreateWaiverDto {
  @ApiProperty()
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'The waiver document body text.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(20000)
  body!: string;
}
