import { ApiProperty } from '@nestjs/swagger';

/** Response for POST /waivers/{id}/signature-upload-url — see WaiversService's
 * own requestSignatureUploadUrl() comment for the full flow. `objectKey` is what
 * the caller passes back as SignWaiverDto.signatureImageKey once the upload
 * itself (a PUT to `uploadUrl` with the exact same Content-Type this endpoint
 * was called with) succeeds. */
export class SignatureUploadUrlResponseDto {
  @ApiProperty({ description: 'Presigned PUT URL, valid for 5 minutes — upload the raster (PNG) signature image directly here.' })
  uploadUrl!: string;

  @ApiProperty({ description: 'Pass this back as signatureImageKey when calling POST /waivers/{id}/sign.' })
  objectKey!: string;
}
