import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** The multipart body of an upload: one file, field name "file". */
export class UploadMemberFileDto {
  @ApiProperty({ type: 'string', format: 'binary', description: 'A PDF, JPG or PNG file, up to 10 MB.' })
  file!: unknown;
}

export class MemberFileDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ description: 'The name the file was uploaded with.' })
  fileName!: string;

  @ApiProperty({ enum: ['application/pdf', 'image/jpeg', 'image/png'] })
  contentType!: string;

  @ApiProperty({ description: 'Size in bytes.' })
  sizeBytes!: number;

  @ApiPropertyOptional({ type: String, nullable: true, description: "Who uploaded it; null once their account is gone." })
  uploadedByName!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class MemberFileListDto {
  @ApiProperty({ type: [MemberFileDto] })
  items!: MemberFileDto[];
}

export class MemberFileDownloadDto {
  @ApiProperty({ description: 'A link that downloads the file. It works for 5 minutes.' })
  url!: string;
}
