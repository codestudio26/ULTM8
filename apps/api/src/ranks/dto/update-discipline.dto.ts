import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsOptional, IsString, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { CreateDisciplineDto } from './create-discipline.dto';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** One class type renamed (Decision 309): its classes, timetable slots and
 * rungs follow the new name. */
export class ClassTypeRenameDto {
  @ApiProperty({ description: 'The class type as it is now.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  from!: string;

  @ApiProperty({ description: 'Its new name. Must also be in classTypesOffered.' })
  @Transform(trim)
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  to!: string;
}

export class UpdateDisciplineDto extends PartialType(CreateDisciplineDto) {
  @ApiPropertyOptional({
    type: [ClassTypeRenameDto],
    description:
      'Class types renamed in this edit (Decision 309). Send with classTypesOffered. Without it, a class type that classes, slots or rungs use cannot be removed (409).',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => ClassTypeRenameDto)
  renameClassTypes?: ClassTypeRenameDto[];
}
