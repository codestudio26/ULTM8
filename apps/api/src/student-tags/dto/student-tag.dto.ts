import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

/** Longest tag name (backlog 5.4; not set by a decision). */
export const TAG_NAME_MAX = 40;

export class SchoolTagNameDto {
  @ApiProperty({ maxLength: TAG_NAME_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A tag can't be empty." })
  @MaxLength(TAG_NAME_MAX, { message: 'A tag can be at most 40 characters.' })
  name!: string;
}

/** Tag a student with a tag from the School's list (`tagId`), or with a new
 * one typed while tagging (`name`; an existing tag of that name is reused). */
export class AddStudentTagDto {
  @ApiPropertyOptional({ description: "A tag from the School's list." })
  @IsOptional()
  @IsUUID()
  tagId?: string;

  @ApiPropertyOptional({ maxLength: TAG_NAME_MAX, description: "A new tag, added to the School's list. Send this or tagId." })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A tag can't be empty." })
  @MaxLength(TAG_NAME_MAX, { message: 'A tag can be at most 40 characters.' })
  name?: string;
}

export class StudentTagDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class StudentTagListDto {
  @ApiProperty({ type: [StudentTagDto] })
  items!: StudentTagDto[];
}

export class SchoolTagDto extends StudentTagDto {
  @ApiProperty({ description: 'How many students have this tag.' })
  studentCount!: number;
}

export class SchoolTagListDto {
  @ApiProperty({ type: [SchoolTagDto] })
  items!: SchoolTagDto[];
}

export class TaggedStudentsDto {
  @ApiProperty({ type: [String], description: 'The students with this tag that the caller covers.' })
  studentIds!: string[];
}
