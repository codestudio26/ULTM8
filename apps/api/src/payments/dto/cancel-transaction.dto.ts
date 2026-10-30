import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, MaxLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** PATCH /transactions/{id}/cancel (Decision 338 item 1, last point): the
 * same reason as cancelling a charge, under the same School setting. */
export class CancelTransactionDto {
  @ApiPropertyOptional({ maxLength: 500, description: "For staff only; never sent to the member. Required unless the School's owner made it optional." })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500)
  reason?: string;
}
