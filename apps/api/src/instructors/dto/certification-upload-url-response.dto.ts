import { ApiProperty } from '@nestjs/swagger';

/** Response for POST /instructors/me/certification-upload-url — same
 * uploadUrl/objectKey shape as WaiversService's own SignatureUploadUrlResponseDto. */
export class CertificationUploadUrlResponseDto {
  @ApiProperty({ description: 'Presigned PUT URL, valid for 5 minutes — upload the certification file directly here, with the exact Content-Type this endpoint was called with.' })
  uploadUrl!: string;

  @ApiProperty({ description: 'Pass this back as certificationKey when calling PATCH /instructors/me/profile.' })
  objectKey!: string;
}
