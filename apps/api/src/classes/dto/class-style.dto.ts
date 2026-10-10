import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

/** One style (Discipline) a class or timetable slot belongs to, with its class
 * type (Decisions 143, 152, 170). */
export class ClassStyleInputDto {
  @ApiProperty({ description: 'A style (Discipline) of this School.' })
  @IsUUID()
  disciplineId!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description: "A class type from this style's classTypesOffered. Required when the style lists class types; not allowed when it lists none.",
  })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  classType?: string | null;
}

export class ClassStyleResponseDto {
  @ApiProperty()
  disciplineId!: string;

  @ApiProperty({ type: String, nullable: true })
  classType!: string | null;
}
