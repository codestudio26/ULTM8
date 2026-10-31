import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/** The words the export's index and documents use, which the portal sends in
 * the reader's language (as it does for the student-list CSV). Each one left
 * out is written in English. */
export const SIGNED_DOCUMENT_LABEL_DEFAULTS = {
  member: 'Member',
  document: 'Document',
  version: 'Version',
  signedAt: 'Signed at',
  signedBy: 'Signed by',
  file: 'File',
  guardian: 'Guardian',
  onPaper: 'On paper',
  guest: 'Guest',
  signedName: 'Signed name',
  signature: 'Signature',
  recordedBy: 'Recorded by',
  textSigned: 'Text signed',
  notRecorded: "The wording signed wasn't kept for this signature.",
  imageMissing: "The signature image couldn't be found.",
  expired: 'Expired',
} as const;
export type SignedDocumentLabels = Record<keyof typeof SIGNED_DOCUMENT_LABEL_DEFAULTS, string>;

export class SignedDocumentLabelsDto implements Partial<SignedDocumentLabels> {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) member?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) document?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) version?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) signedAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) signedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) file?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) guardian?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) onPaper?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) guest?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) signedName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) signature?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) recordedBy?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) textSigned?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) notRecorded?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) imageMissing?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) expired?: string;
}

export class CreateSignedDocumentExportDto {
  @ApiPropertyOptional({ type: SignedDocumentLabelsDto, description: "The index's column headings and the documents' words, in the reader's language." })
  @IsOptional()
  @ValidateNested()
  @Type(() => SignedDocumentLabelsDto)
  labels?: SignedDocumentLabelsDto;
}

export class SignedDocumentExportDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: ['PENDING', 'RUNNING', 'READY', 'FAILED', 'EXPIRED'], enumName: 'SignedDocumentExportStatus' })
  status!: 'PENDING' | 'RUNNING' | 'READY' | 'FAILED' | 'EXPIRED';

  @ApiPropertyOptional({ type: Number, nullable: true, description: 'Signed documents in the ZIP, once it is made.' })
  documentCount!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true, description: "The ZIP's size in bytes, once it is made." })
  sizeBytes!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'Who asked for it; null once their account is gone.' })
  requestedByName!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  finishedAt!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, description: 'When the ZIP is deleted (24 hours after it is made).' })
  expiresAt!: string | null;
}

export class LatestSignedDocumentExportDto {
  @ApiPropertyOptional({ type: SignedDocumentExportDto, nullable: true, description: "The School's most recent export, or null." })
  export!: SignedDocumentExportDto | null;
}

export class SignedDocumentExportDownloadDto {
  @ApiProperty({ description: 'A link that downloads the ZIP. It works for 5 minutes.' })
  url!: string;
}
