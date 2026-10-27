import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsOptional } from 'class-validator';
import { CreateWaiverDto } from './create-waiver.dto';

export class UpdateWaiverDto extends PartialType(CreateWaiverDto) {
  /** Decision 354 (Waivers review W3b): when the wording changes, true means
   * "new terms": every signature so far expires and current students are asked
   * to sign again. Left out or false means "small fix": signatures stay. */
  @ApiPropertyOptional({ description: 'When the wording changes: true asks everyone to sign again (their signatures expire); false keeps the signatures (a small fix).' })
  @IsOptional()
  @IsBoolean()
  resign?: boolean;
}
