import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayNotEmpty, ArrayUnique, IsArray, IsUUID } from 'class-validator';

/** Reorder a style's belts (Decision 180): every belt of the style, once, in
 * the new order. Stripes are reordered within their belt with PATCH /ranks/{id}. */
export class ReorderRanksDto {
  @ApiProperty({ type: [String], description: 'Every belt id of this style, in the new order.' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(500)
  @ArrayUnique()
  @IsUUID('all', { each: true })
  rankIds!: string[];
}

export class RungHolderDto {
  @ApiProperty()
  studentId!: string;

  @ApiProperty()
  firstName!: string;

  @ApiProperty()
  surname!: string;
}

export class RungHoldersDto {
  @ApiProperty({ description: 'The rung (stripe tier id).' })
  rungId!: string;

  @ApiProperty({ type: [RungHolderDto] })
  students!: RungHolderDto[];
}

export class RungHoldersResponseDto {
  @ApiProperty({ type: [RungHoldersDto], description: 'Only rungs that someone holds.' })
  items!: RungHoldersDto[];
}
