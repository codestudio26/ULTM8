import { ApiProperty } from '@nestjs/swagger';

/** Response for GET /classes/{id}/qr-token and GET /attendance/my-qr-token —
 * same shape for both, since a display screen only ever needs the token to
 * render and the timestamp to know when to fetch a fresh one. */
export class QrTokenResponseDto {
  @ApiProperty()
  token!: string;

  @ApiProperty()
  expiresAt!: string;
}
