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

  @ApiPropertyOptional({
    description:
      "Backlog §3.5: the welcome card on the front desk and the tablet shows the member's classes toward their next belt (default on, as before). Always in the response; leave it out of a save to keep it as it is.",
  })
  @IsOptional()
  @IsBoolean()
  showBeltProgress?: boolean;

  @ApiPropertyOptional({
    type: Number,
    enum: [7, 14],
    nullable: true,
    description:
      "Backlog §3.5: refuse check-in (CHECK_IN_PAYMENT_OVERDUE) to a member who still owes on a charge more than 7 or 14 days after its due date, in the School's time zone. Null (default): never refused for an overdue payment, as before. Always in the response; leave it out of a save to keep it as it is.",
  })
  @IsOptional() // null (No) and left out both skip the check below.
  @IsIn([7, 14])
  blockOverdueDays?: 7 | 14 | null;

  @ApiPropertyOptional({
    description:
      "Decision 422 item 2: a booking is needed to check in (default on, as before). Off (the owner's \"Check in without a booking\"): a member may check in to a Class they haven't booked, at every way in; the check-in first books a place by the booking's own rules (a full Class is refused with CLASS_FULL; membership, credits, waivers and the other check-in rules still apply). Always in the response; leave it out of a save to keep it as it is.",
  })
  @IsOptional()
  @IsBoolean()
  requireBooking?: boolean;

  @ApiPropertyOptional({
    description:
      'Decision 304 item 3: "Open mat uses a class credit" (default on). On: booking an open mat (a class whose every style has the class type "Open mat") takes a Class Pack or Friend Pass credit like any class. Off: it still needs a membership or pass that covers it, but takes no credit, and cancelling it gives nothing back. Always in the response; leave it out of a save to keep it as it is.',
  })
  @IsOptional()
  @IsBoolean()
  openMatUsesCredit?: boolean;

  @ApiProperty({ enum: [4, 6], description: "Length of the check-in codes ULTM8 generates here: staff kiosk codes and members' personal codes (default 4). Codes already issued keep their length. Decision 417: a School with more than 500 current Students has 6 and can't choose 4; its shorter codes are replaced." })
  @IsIn([4, 6])
  codeDigits!: number;
}
