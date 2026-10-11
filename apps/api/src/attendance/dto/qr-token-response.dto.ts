import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Response for GET /classes/{id}/qr-token and GET /attendance/my-qr-token —
 * same shape for both, since a display screen only ever needs the token to
 * render and the timestamp to know when to fetch a fresh one.
 *
 * `code` (Decision 235) is only ever populated for the Class-scoped token
 * (GET /classes/{id}/qr-token) — the Class-QR display screen shows it as
 * text alongside the QR; the Student's own personal token
 * (GET /attendance/my-qr-token) has no code equivalent, nothing scans it. */
export class QrTokenResponseDto {
  @ApiProperty()
  token!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiPropertyOptional()
  code?: string;
}
