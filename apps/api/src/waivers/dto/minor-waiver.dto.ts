import { ApiProperty } from '@nestjs/swagger';
import { WaiverResponseDto } from './waiver-response.dto';

/** Decision 428 (Student portal review M1) — one of a parent's child's
 * waivers, at one of the child's Schools, with whether the child has signed. */
export class MinorWaiverDto extends WaiverResponseDto {
  @ApiProperty()
  schoolName!: string;

  @ApiProperty({ type: String, nullable: true, description: "When the child's current signature was signed. Null when not signed." })
  signedDate!: string | null;
}

export class MinorWaiverListDto {
  @ApiProperty({ type: [MinorWaiverDto] })
  items!: MinorWaiverDto[];
}
