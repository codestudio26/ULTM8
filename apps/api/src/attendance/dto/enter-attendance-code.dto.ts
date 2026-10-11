import { ApiProperty } from '@nestjs/swagger';
import { IsNumberString, IsUUID, Length } from 'class-validator';

/** POST /attendance/code body (Decision 235) — same shape as
 * ScanAttendanceDto, with `code` (the 6-digit fallback) in place of
 * `qrToken`. `code` is validated as exactly 6 digits here; QrTokenService
 * itself still re-derives and compares it server-side, this is just input
 * shape validation. */
export class EnterAttendanceCodeDto {
  @ApiProperty()
  @IsUUID()
  classId!: string;

  @ApiProperty({ description: 'The 6-digit fallback code shown on the Class-QR display screen.' })
  @IsNumberString()
  @Length(6, 6)
  code!: string;
}
