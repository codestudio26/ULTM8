import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

/**
 * POST /classes/{id}/attendance-scan body (Phase 51, Decision 107 — Decision
 * 71's own mechanics, previously undesigned). Two modes, discriminated purely
 * by whether `studentToken` is present:
 *
 * - Scan mode (`studentToken` set): the Instructor scanned the Student's own
 *   rotating personal token (from `GET /attendance/my-qr-token`) — recorded as
 *   `checkInMethod: INSTRUCTOR_SCAN`.
 * - Manual mode (`studentToken` omitted): Staff confirms presence by name
 *   alone, no token, no camera involved anywhere — recorded as
 *   `checkInMethod: INSTRUCTOR_MANUAL`. This is the deliberate camera-free
 *   fallback for a Student whose camera-tier ConsentRecord is Withdrawn (or
 *   who has an accessibility need blocking a QR scan) — see
 *   AttendanceService.instructorScan()'s own comment for why the consent gate
 *   applies to scan mode but not this one.
 */
export class InstructorScanDto {
  @ApiProperty()
  @IsUUID()
  studentId!: string;

  @ApiPropertyOptional({ description: 'The Student\'s own token from GET /attendance/my-qr-token. Omit for a manual, camera-free confirmation.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  studentToken?: string;
}
