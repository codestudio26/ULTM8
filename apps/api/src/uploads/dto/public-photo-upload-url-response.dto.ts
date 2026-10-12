import { ApiProperty } from '@nestjs/swagger';

/** Response for POST /uploads/public-photo-url. Unlike the private-path
 * precedents (SignatureUploadUrlResponseDto/CertificationUploadUrlResponseDto),
 * there is no separate `objectKey` the caller passes back to a second
 * "confirm" endpoint — the public bucket's own GET needs no signature, so
 * `publicUrl` is immediately the real, permanent value the caller sets a
 * photoUrl/logoUrl/bannerUrl/profilePhotoUrl form field to once the PUT to
 * `uploadUrl` succeeds. See UploadsService's own header comment on why this
 * phase does not add a server-side objectExists()-style confirmation step for
 * this path the way sign()/completeMyProfile() do for the private one. */
export class PublicPhotoUploadUrlResponseDto {
  @ApiProperty({ description: 'Presigned PUT URL, valid for 5 minutes — upload the photo file directly here, with the exact Content-Type this endpoint was called with.' })
  uploadUrl!: string;

  @ApiProperty({ description: "The permanent, public URL to save onto the entity's photoUrl/logoUrl/bannerUrl/profilePhotoUrl field once the upload succeeds. Never expires or needs re-signing." })
  publicUrl!: string;
}
