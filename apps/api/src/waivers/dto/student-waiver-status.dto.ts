import { ApiProperty } from '@nestjs/swagger';

export class WaiverToSignDto {
  @ApiProperty()
  waiverId!: string;

  @ApiProperty()
  title!: string;
}

/** GET /students/{id}/waiver-status — one Student's waivers at one School, for
 * the front desk's welcome card (handover F4; product owner, 28 Oct 2026). */
export class StudentWaiverStatusDto {
  /** Whether they hold a signed waiver that counts here: the same check booking
   * a class that requires a waiver makes. */
  @ApiProperty()
  signed!: boolean;

  /** The School's current waivers they haven't signed, oldest first. */
  @ApiProperty({ type: [WaiverToSignDto] })
  toSign!: WaiverToSignDto[];
}
