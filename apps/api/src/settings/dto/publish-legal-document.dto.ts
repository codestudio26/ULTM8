import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** POST /platform-admin/legal-documents/{slug}/versions body (Decision 171). The
 * text must come from counsel; this endpoint only stores and versions it. */
export class PublishLegalDocumentDto {
  @ApiPropertyOptional({ description: "New title. Keeps the document's current title when left out." })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @ApiProperty({ description: 'The full text of this version.' })
  @IsString()
  @MinLength(1)
  @MaxLength(200_000)
  content!: string;
}

export class LegalDocumentVersionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  slug!: string;

  @ApiProperty()
  version!: number;

  @ApiProperty({ description: 'What a consent records as its policyVersion, e.g. privacy-statement@3.' })
  policyVersion!: string;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  content!: string;

  @ApiProperty()
  publishedByAdminId!: string;

  @ApiProperty()
  publishedAt!: string;
}
