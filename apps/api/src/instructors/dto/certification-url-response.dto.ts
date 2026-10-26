import { ApiProperty } from '@nestjs/swagger';

/** Response for GET /instructors/:id/certification-url (Decision 312). */
export class CertificationUrlResponseDto {
  @ApiProperty({ description: 'Presigned GET URL for the uploaded certification file, valid for 15 minutes.' })
  url!: string;
}
