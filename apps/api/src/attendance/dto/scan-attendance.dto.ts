import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/**
 * POST /attendance/scan body. Accepts a `bookingId` directly — the literal,
 * minimal reading of "QR check-in only ever matches against an existing Booking"
 * (SKILL.md §9). The QR code's own generation/rotation mechanism (how the client
 * obtained this id) is explicitly unresolved as a screen/mechanism (§12) and is
 * not built this phase — see the Phase 13 kickoff prompt §2.
 */
export class ScanAttendanceDto {
  @ApiProperty()
  @IsUUID()
  bookingId!: string;
}
