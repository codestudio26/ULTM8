import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min, ValidateIf } from 'class-validator';

/** A School's check-in rules (Decision 394; Decision 317 item 1; handover
 * F9). Each default is what check-in did before the rules existed. */
export class CheckInRulesDto {
  @ApiProperty({ description: 'Minutes before a Class starts that check-in opens (default 30).' })
  @IsInt()
  @Min(0)
  @Max(1440)
  opensMinutesBeforeStart!: number;

  @ApiPropertyOptional({
    type: Number,
    nullable: true,
    description: 'Minutes after a Class starts that check-in closes (0 = at the start). Null (default): when the Class ends, or at its own check-in end time.',
  })
  @ValidateIf((_, v) => v !== null)
  @IsInt()
  @Min(0)
  @Max(1440)
  closesMinutesAfterStart!: number | null;

  @ApiProperty({ description: "A signed waiver for the School is needed to check in, whatever the Class says (default off: only a Class that needs a waiver asks for one, at booking)." })
  @IsBoolean()
  requireWaiver!: boolean;

  @ApiProperty({ description: 'Members with a home Branch may check in at the School\'s other Branches (default on).' })
  @IsBoolean()
  otherBranches!: boolean;

  @ApiProperty({ description: 'Visitors may check in on their visit pass (default on; Decision 391).' })
  @IsBoolean()
  visitors!: boolean;

  @ApiProperty({ description: 'The front desk may check someone in to several Classes at once (default on; Decision 378).' })
  @IsBoolean()
  severalClasses!: boolean;

  @ApiPropertyOptional({
    description: 'Members whose membership is frozen may still check in (default off; Decision 404). Always in the response; leave it out of a save to keep it as it is.',
  })
  @IsOptional()
  @IsBoolean()
  frozenMembers?: boolean;

  @ApiProperty({ enum: [4, 6], description: "Length of the check-in codes ULTM8 generates here: staff kiosk codes and members' personal codes (default 4). Codes already issued keep their length. Decision 417: a School with more than 500 current Students has 6 and can't choose 4; its shorter codes are replaced." })
  @IsIn([4, 6])
  codeDigits!: number;
}
