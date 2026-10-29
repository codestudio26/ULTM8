import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { CORRECTION_NOTE_MAX } from '../rank-correction-rules';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || null : value);

/** Backlog 3.13 (Decision 299): the belt a student says they should have, in
 * one of their styles: any rung on that style's ladder, with a short note. */
export class CreateRankCorrectionDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  disciplineId!: string;

  @ApiProperty({ format: 'uuid', description: 'The grade they should have: a belt\'s plain grade or one of its stripes, on this style\'s ladder.' })
  @IsUUID()
  stripeTierId!: string;

  @ApiProperty({ maxLength: CORRECTION_NOTE_MAX, description: 'Why the recorded belt is wrong. Required.' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Say why your belt is wrong.' })
  @MaxLength(CORRECTION_NOTE_MAX)
  note!: string;
}

export class ReviewRankCorrectionDto {
  @ApiPropertyOptional({ maxLength: CORRECTION_NOTE_MAX, nullable: true, description: 'An optional note to the student.' })
  @IsOptional()
  @Transform(blankToNull)
  @IsString()
  @MaxLength(CORRECTION_NOTE_MAX)
  note?: string | null;
}

export class RankCorrectionListQueryDto {
  @ApiPropertyOptional({ enum: ['PENDING', 'ANSWERED'], description: 'Waiting (the default), or answered (newest 50).' })
  @IsOptional()
  @IsIn(['PENDING', 'ANSWERED'])
  status?: 'PENDING' | 'ANSWERED';

  @ApiPropertyOptional({ format: 'uuid', description: "Only this student's requests." })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

export class RankCorrectionRungDto {
  @ApiProperty() rankId!: string;
  @ApiProperty() rankName!: string;
  @ApiProperty({ type: String, nullable: true }) stripeTierId!: string | null;
  /** The grade's name, e.g. "Blue · 2 Stripes". Null when it no longer exists. */
  @ApiProperty({ type: String, nullable: true }) stripeName!: string | null;
}

export class RankCorrectionDto {
  @ApiProperty() id!: string;
  @ApiProperty() schoolId!: string;
  @ApiProperty() studentId!: string;
  @ApiProperty() firstName!: string;
  @ApiProperty() surname!: string;
  @ApiProperty() disciplineId!: string;
  @ApiProperty() disciplineName!: string;
  @ApiProperty({ type: RankCorrectionRungDto }) from!: RankCorrectionRungDto;
  @ApiProperty({ type: RankCorrectionRungDto }) requested!: RankCorrectionRungDto;
  @ApiProperty() note!: string;
  @ApiProperty({ enum: ['PENDING', 'APPROVED', 'REJECTED'] }) status!: 'PENDING' | 'APPROVED' | 'REJECTED';
  @ApiProperty({ type: String, nullable: true }) reviewNote!: string | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true }) reviewedAt!: Date | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: Date;
}

export class RankCorrectionListDto {
  @ApiProperty({ type: [RankCorrectionDto] }) items!: RankCorrectionDto[];
}
