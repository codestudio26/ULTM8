import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsIn, IsInt, IsObject, IsOptional, IsString, Max, MaxLength, Min, ValidateNested } from 'class-validator';
import {
  IMPORT_KINDS,
  IMPORT_ROW_CODES,
  IMPORT_WARNING_CODES,
  MAX_IMPORT_ROWS,
  MAX_ROWS_PER_REQUEST,
  type ImportKind,
  type ImportRowCode,
  type ImportRowOutcome,
  type ImportWarningCode,
} from '../import-rows';

/** One spreadsheet row: its line in the file (the header is line 1) and its
 * cells by column name. */
export class ImportRowDto {
  @ApiProperty({ minimum: 2, maximum: MAX_IMPORT_ROWS + 1, description: 'The line in the file; the header row is line 1.' })
  @IsInt()
  @Min(2)
  @Max(MAX_IMPORT_ROWS + 1)
  rowNumber!: number;

  @ApiProperty({ type: 'object', additionalProperties: { type: 'string' }, description: 'Cells by column name, as the template names them.' })
  @IsObject()
  values!: Record<string, string>;
}

/** POST /schools/{schoolId}/imports/preview: what importing these rows would
 * do, without doing it. */
export class PreviewImportDto {
  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'ImportKind' })
  @IsIn(IMPORT_KINDS)
  kind!: ImportKind;

  @ApiProperty({ type: [ImportRowDto], maxItems: MAX_ROWS_PER_REQUEST })
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROWS_PER_REQUEST)
  rows!: ImportRowDto[];
}

/** POST /schools/{schoolId}/imports: starts an import; its rows follow in batches. */
export class StartImportDto {
  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'ImportKind' })
  @IsIn(IMPORT_KINDS)
  kind!: ImportKind;

  @ApiProperty({ minimum: 1, maximum: MAX_IMPORT_ROWS, description: `How many rows the file has (at most ${MAX_IMPORT_ROWS}).` })
  @IsInt()
  @Min(1)
  @Max(MAX_IMPORT_ROWS)
  totalRows!: number;

  @ApiPropertyOptional({ maxLength: 200 })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  fileName?: string;
}

/** POST /schools/{schoolId}/imports/{importId}/rows: the next batch. */
export class ImportRowsDto {
  @ApiProperty({ type: [ImportRowDto], maxItems: MAX_ROWS_PER_REQUEST })
  @ValidateNested({ each: true })
  @Type(() => ImportRowDto)
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ROWS_PER_REQUEST)
  rows!: ImportRowDto[];
}

export class ImportWarningDto {
  @ApiProperty({ enum: IMPORT_WARNING_CODES, enumName: 'ImportWarningCode' })
  code!: ImportWarningCode;

  @ApiProperty({ description: 'In English.' })
  message!: string;

  @ApiPropertyOptional({ description: 'BELT_NOT_SET: the style.' })
  style?: string;

  @ApiPropertyOptional({ description: "BELT_NOT_SET: why, in the API's own words." })
  reason?: string;
}

export class ImportRowResultDto {
  @ApiProperty()
  rowNumber!: number;

  @ApiProperty({ enum: ['READY', 'CREATED', 'SKIPPED', 'ERROR'], enumName: 'ImportRowOutcome', description: 'READY: a preview row that would be imported. CREATED: imported.' })
  outcome!: ImportRowOutcome;

  @ApiProperty({ enum: IMPORT_ROW_CODES, enumName: 'ImportRowCode', description: 'What will be or was done, or why the row is skipped or refused. FAILED: see message.' })
  code!: ImportRowCode;

  @ApiProperty({ type: String, nullable: true, description: 'The column the problem is in.' })
  column!: string | null;

  @ApiProperty({ description: 'In English; for FAILED, the reason the API gave.' })
  message!: string;

  @ApiProperty({ type: [ImportWarningDto] })
  warnings!: ImportWarningDto[];
}

export class ImportCountsDto {
  @ApiProperty({ description: 'Preview: rows that would be imported. Import: rows imported.' })
  ok!: number;

  @ApiProperty()
  skipped!: number;

  @ApiProperty()
  errors!: number;
}

export class ImportPreviewResponseDto {
  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'ImportKind' })
  kind!: ImportKind;

  @ApiProperty({ type: [ImportRowResultDto] })
  rows!: ImportRowResultDto[];

  @ApiProperty({ type: ImportCountsDto })
  counts!: ImportCountsDto;
}

export class ImportRowsResponseDto {
  @ApiProperty({ type: [ImportRowResultDto] })
  rows!: ImportRowResultDto[];
}

export class DataImportResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: IMPORT_KINDS, enumName: 'ImportKind' })
  kind!: ImportKind;

  @ApiProperty({ type: String, nullable: true })
  fileName!: string | null;

  @ApiProperty()
  totalRows!: number;

  @ApiProperty({ description: 'Rows sent so far.' })
  rowsDone!: number;

  @ApiProperty({ type: ImportCountsDto })
  counts!: ImportCountsDto;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty({ type: [ImportRowResultDto], description: 'Each row sent so far, in file order.' })
  rows!: ImportRowResultDto[];
}

/** The limits the portal shows and batches by. */
export class ImportLimitsDto {
  @ApiProperty()
  maxRows!: number;

  @ApiProperty()
  maxRowsPerRequest!: number;

  @ApiProperty({ description: 'Past attendance can be imported this many days back (Decision 317 item 4).' })
  attendanceMaxDaysBack!: number;

  @ApiProperty({ type: Object, description: 'Each kind\'s columns, in template order.', additionalProperties: { type: 'array', items: { type: 'string' } } })
  columns!: Record<ImportKind, string[]>;
}
