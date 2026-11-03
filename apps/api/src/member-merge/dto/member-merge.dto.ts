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

/** Decision 422 item 8: a style both records have a belt in, and which belt is kept. */
export class MergeBeltKeptDto {
  @ApiProperty()
  disciplineId!: string;

  @ApiProperty({ description: 'The style, as the School named it.' })
  styleName!: string;

  @ApiProperty({ enum: ['KEPT', 'DUPLICATE'], enumName: 'MergeBeltKeptFrom', description: "Whose belt is kept: the duplicate's only when it is higher on the ladder (belt, then stripe or level step)." })
  keptFrom!: 'KEPT' | 'DUPLICATE';

  @ApiProperty({ description: 'The belt that is kept, as the ladder names it.' })
  keptBelt!: string;

  @ApiProperty({ description: "The other record's belt. Its promotions stay in the history, marked as coming from the merged record." })
  otherBelt!: string;

  @ApiProperty({ description: "Both are on the same rung: the kept member's belt is kept, with both records' classes toward the next rung." })
  sameRung!: boolean;
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

  @ApiProperty({ type: [MergeBeltKeptDto], description: 'Styles both records have a belt in: the higher one is kept (Decision 422 item 8).' })
  beltsKept!: MergeBeltKeptDto[];

  @ApiProperty({ description: 'Unanswered promotion fees for the belt that is not kept (or a second one in the same style) that the merge cancels.' })
  promotionFeesCancelled!: number;

  @ApiProperty({ description: 'Pending belt corrections about the belt that is not kept (or a second one in the same style) that the merge rejects.' })
  beltCorrectionsClosed!: number;
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

  @ApiProperty({ type: [MergeBeltKeptDto], description: 'Styles both records had a belt in, and which belt was kept (Decision 422 item 8).' })
  beltsKept!: MergeBeltKeptDto[];

  @ApiProperty({ description: 'Promotion fees the merge cancelled.' })
  promotionFeesCancelled!: number;

  @ApiProperty({ description: 'Belt corrections the merge rejected.' })
  beltCorrectionsClosed!: number;
}
