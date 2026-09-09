import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/**
 * Field list verified against skills/ultm8-domain-rules/SKILL.md §13's confirmed
 * Waiver row — "title, body text, per-school assignment." schoolId is a route
 * param (`/schools/:schoolId/waivers`), not a body field, same convention as
 * CreateMembershipPlanDto/CreateClassDto.
 */
export class CreateWaiverDto {
  @ApiProperty()
  @IsString()
  @MaxLength(200)
  title!: string;

  @ApiProperty({ description: 'The waiver document body text.' })
  @IsString()
  @MaxLength(20000)
  body!: string;
}
