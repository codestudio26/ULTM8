import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { MERGE_BLOCKERS, MERGE_TABLES, type MergeBlockerCode } from '../member-merge-tables';

export class MergeDuplicateQueryDto {
  @ApiProperty({ description: 'The duplicate record: merged into the student in the path, then no longer a Student here.' })
  @IsUUID()
  duplicateId!: string;
}

export class MergeDuplicateDto {
  @ApiProperty({ description: 'The duplicate record: merged into the student in the path, then no longer a Student here.' })
  @IsUUID()
  duplicateId!: string;
}

export class MergePersonDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}

export class MergeBlockerDto {
  @ApiProperty({ enum: MERGE_BLOCKERS, enumName: 'MergeBlockerCode' })
  code!: MergeBlockerCode;

  @ApiProperty({ type: [String], description: 'Style names or class titles the reason is about, when there are any.' })
  details!: string[];
}

/** One count per table the merge handles (member-merge-tables.ts). */
export class MergeRecordCountsDto {}
for (const table of MERGE_TABLES) {
  ApiProperty({ type: Number })(MergeRecordCountsDto.prototype, table);
}

export class MergePreviewDto {
  @ApiProperty({ type: MergePersonDto, description: 'The record that is kept.' })
  kept!: MergePersonDto;

  @ApiProperty({ type: MergePersonDto, description: 'The record merged into it.' })
  duplicate!: MergePersonDto;

  @ApiProperty({ type: [MergeBlockerDto], description: 'Why the two records cannot be merged yet; empty when they can.' })
  blockers!: MergeBlockerDto[];

  @ApiProperty({ type: MergeRecordCountsDto, description: "The duplicate's rows at this School, per table." })
  records!: MergeRecordCountsDto;
}

export class MergeResultDto {
  @ApiProperty()
  keptStudentId!: string;

  @ApiProperty()
  duplicateStudentId!: string;

  @ApiProperty({ type: MergeRecordCountsDto, description: 'Rows moved to the kept record, per table.' })
  records!: MergeRecordCountsDto;

  @ApiProperty({ description: "Signed waivers both had signed: the duplicate's copy stays on the duplicate's record." })
  waiverSignaturesLeft!: number;
}
