import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** POST .../signatures/{signatureId}/paper-upload-url (Decision 354). */
export class PaperSignatureUploadUrlDto {
  @ApiProperty({ enum: ['image/jpeg', 'image/png'], description: 'The photo or scan of the signed paper.' })
  @IsIn(['image/jpeg', 'image/png'])
  contentType!: 'image/jpeg' | 'image/png';
}

/** POST .../signatures/{signatureId}/paper (Decision 354): a waiver signed on
 * paper, recorded by the Owner or a Manager. */
export class RecordPaperSignatureDto {
  @ApiProperty({ description: 'The name written on the paper: the student, or for a child the parent or guardian who signed.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  signerFullName!: string;

  @ApiProperty({ description: 'The date written on the paper (YYYY-MM-DD). Not in the future.' })
  @IsDateString({ strict: true })
  signedDate!: string;

  @ApiProperty({ description: 'objectKey from paper-upload-url, after the photo was uploaded.' })
  @IsString()
  imageKey!: string;
}

export class RemindResponseDto {
  @ApiProperty({ description: 'How many members were reminded.' })
  reminded!: number;
}
