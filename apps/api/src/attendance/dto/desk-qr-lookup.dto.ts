import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** POST /schools/{schoolId}/front-desk/qr-lookups body: the token in the
 * Student's app QR (GET /attendance/my-qr-token). */
export class DeskQrLookupDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  studentToken!: string;
}

/** Who the QR belongs to, and a lookup token to check them in with for the next
 * few minutes (front-desk check-in review Q2). */
export class DeskQrLookupResponseDto {
  @ApiProperty()
  lookupToken!: string;

  @ApiProperty()
  expiresAt!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;

  @ApiPropertyOptional({ nullable: true, type: String })
  profilePhotoUrl!: string | null;
}
