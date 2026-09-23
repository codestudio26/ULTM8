import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Field-for-field match of the WaiverSignature Prisma model, EXCEPT
 * `signatureImageUrl`: not a stored column (the model only stores
 * `signatureImageKey`, an R2 object key) — this is a freshly-generated,
 * short-lived presigned GET URL, computed by WaiversService on every response
 * rather than a permanently public link. See R2ClientService's own header
 * comment for why. `null` when no drawn-signature image was ever captured
 * (typed-name-only signing remains valid). `signedById` (Phase 37) equals
 * `studentId` for an ordinary self-signed row — it differs only when a
 * Guardian signed on a linked minor's behalf, so a client can tell the two
 * cases apart without any other signal. */
export class WaiverSignatureResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  waiverId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiProperty({ description: 'The actual signer — equals studentId unless a Guardian signed on a linked minor\'s behalf.' })
  signedById!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  signerFullName!: string;

  @ApiProperty()
  signatureText!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Presigned R2 GET URL, valid for 15 minutes — null if no drawn-signature image was captured.' })
  signatureImageUrl!: string | null;

  @ApiProperty()
  signedDate!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class WaiverSignatureListResponseDto {
  @ApiProperty({ type: [WaiverSignatureResponseDto] })
  items!: WaiverSignatureResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
