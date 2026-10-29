import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateStudentNoteDto {
  @ApiProperty({ maxLength: 2000 })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A note can't be empty." })
  @MaxLength(2000)
  body!: string;

  @ApiPropertyOptional({ description: 'Shown to the student in the app (a child: to their Guardian). Off by default.' })
  @IsOptional()
  @IsBoolean()
  showToMember?: boolean;
}

export class UpdateStudentNoteDto {
  @ApiPropertyOptional({ maxLength: 2000 })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "A note can't be empty." })
  @MaxLength(2000)
  body?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  showToMember?: boolean;
}

export class MyStudentNotesQueryDto {
  @ApiPropertyOptional({ description: "A Guardian's child; leave out for your own notes." })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class StudentNoteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  showToMember!: boolean;

  @ApiPropertyOptional({ type: String, nullable: true, description: "The author's name; null once their account is gone." })
  authorName!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  authorId!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  editedAt!: string | null;

  @ApiProperty({ description: 'Whether the caller may edit or delete it: its author, or a School owner.' })
  canEdit!: boolean;
}

export class StudentNoteListDto {
  @ApiProperty({ type: [StudentNoteDto] })
  items!: StudentNoteDto[];
}

export class MemberNoteDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  schoolName!: string;

  @ApiProperty()
  body!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  authorName!: string | null;

  @ApiProperty()
  createdAt!: string;
}

export class MemberNoteListDto {
  @ApiProperty({ type: [MemberNoteDto] })
  items!: MemberNoteDto[];
}
