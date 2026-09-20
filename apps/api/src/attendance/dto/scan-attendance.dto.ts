import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsUUID, MinLength } from 'class-validator';

/**
 * POST /attendance/scan body. Phase 51 (Decision 107) replaced the original
 * Phase 13 shape (a bare `bookingId`, since the QR code's own generation
 * mechanism didn't exist yet — see this repo's git history) with the actual
 * rotating-QR mechanism: `qrToken` is a short-lived, signed token scoped to
 * `classId`, minted by `GET /classes/{id}/qr-token` and rotated every
 * `QR_ATTENDANCE_TOKEN_TTL_SECONDS` (Staff displays it; a Student scans it).
 * The Student no longer needs to know their own bookingId — the server
 * resolves the caller's own UPCOMING Booking for `classId` directly. This is a
 * breaking change to an already-shipped endpoint with no production callers
 * yet (Track A never built a caller for the old shape; Track B hasn't reached
 * this feature) — a safe time to make it, not a later-stage API break.
 */
export class ScanAttendanceDto {
  @ApiProperty()
  @IsUUID()
  classId!: string;

  @ApiProperty({ description: 'The rotating token from GET /classes/{id}/qr-token.' })
  @IsString()
  @MinLength(1)
  qrToken!: string;
}
