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
 * cases apart without any other signal.
 *
 * v1.2 backend backlog ("Waivers page", gap 2): `signedById`/`signerFullName`/
 * `signatureText`/`signedDate` are now nullable — null on an Unsigned
 * "assignment" row that nobody has signed yet (schema.prisma's own
 * WaiverSignature header comment has the full account). `studentName` is new
 * and NOT a stored column: the enrolled Student's own name
 * (`firstName + surname`), only populated by
 * `GET /schools/{schoolId}/waivers/{id}/signatures` (the one caller that
 * needs a fallback label for an Unsigned row, which has no `signerFullName`
 * of its own yet) — `null` from every other endpoint on this controller. */
export class WaiverSignatureResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  waiverId!: string;

  @ApiProperty()
  studentId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The actual signer — equals studentId unless a Guardian signed on a linked minor\'s behalf. Null until this row is actually signed.',
  })
  signedById!: string | null;

  @ApiProperty()
  schoolId!: string;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Null until this row is actually signed.' })
  signerFullName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Null until this row is actually signed.' })
  signatureText!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Presigned R2 GET URL, valid for 15 minutes — null if no drawn-signature image was captured.' })
  signatureImageUrl!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Null until this row is actually signed.' })
  signedDate!: string | null;

  @ApiProperty({ description: 'Signed / Unsigned / Expired / Pending — see skills/ultm8-domain-rules/SKILL.md §13.' })
  status!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: 'The enrolled Student\'s own name (firstName + surname) — only populated by the Signatures-panel endpoint (GET .../waivers/{id}/signatures); null from every other endpoint. Not a stored column.',
  })
  studentName?: string | null;

  @ApiPropertyOptional({ description: 'Signatures panel only: true when this student has since left the School. Their signature is kept as a legal record.' })
  formerStudent?: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The Waiver title as it was when signed. Null when not signed, or signed before copies were kept.' })
  signedWaiverTitle!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'The Waiver text exactly as it was when signed. Null when not signed, or signed before copies were kept. Left out of the Signatures list; read one signature to get it.' })
  signedWaiverBody?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'SHA-256 (hex) of signedWaiverBody.' })
  signedWaiverSha256!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'The Waiver version that was signed.' })
  signedWaiverVersion!: number | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

/** The rollup count the v1.2 backend backlog's own "Recommended display
 * shape" named — "12 of 40 signed" — expandable, client-side, into the full
 * per-Student roster `WaiverSignatureListResponseDto.items` already carries.
 * `total` is every row regardless of status, not just signed+unsigned. */
export class WaiverSignatureSummaryDto {
  @ApiProperty()
  total!: number;

  @ApiProperty()
  signed!: number;

  @ApiProperty()
  unsigned!: number;

  @ApiProperty()
  expired!: number;

  @ApiProperty()
  pending!: number;
}

export class WaiverSignatureListResponseDto {
  @ApiProperty({ type: [WaiverSignatureResponseDto] })
  items!: WaiverSignatureResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;

  /** Only set by GET .../waivers/{id}/signatures (the Signatures-panel
   * endpoint) — undefined on GET /waivers/me, which has no "roster" concept
   * to roll up. */
  @ApiPropertyOptional({ type: WaiverSignatureSummaryDto })
  summary?: WaiverSignatureSummaryDto;
}
