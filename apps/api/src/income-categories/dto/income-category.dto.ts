import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value);

/** Longest income category name (Decision 316 item 10 sets no limit; 60 fits
 * a CSV column and the pickers). */
export const INCOME_CATEGORY_NAME_MAX = 60;

export class IncomeCategoryNameDto {
  @ApiProperty({ maxLength: INCOME_CATEGORY_NAME_MAX })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: "An income category can't be empty." })
  @MaxLength(INCOME_CATEGORY_NAME_MAX, { message: 'An income category can be at most 60 characters.' })
  name!: string;
}

export class IncomeCategoryDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ description: 'How many membership plans, charges and recurring charges carry it. One in use cannot be deleted, only renamed.' })
  useCount!: number;
}

export class IncomeCategoryListDto {
  @ApiProperty({ type: [IncomeCategoryDto] })
  items!: IncomeCategoryDto[];
}
