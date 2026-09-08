import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class DisciplineResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ type: [String] })
  classTypesOffered!: string[];

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class DisciplineListResponseDto {
  @ApiProperty({ type: [DisciplineResponseDto] })
  items!: DisciplineResponseDto[];

  @ApiPropertyOptional({ type: String, nullable: true })
  nextCursor!: string | null;
}
