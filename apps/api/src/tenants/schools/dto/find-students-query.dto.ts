import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional } from 'class-validator';

/** v1.2 backend backlog — the Students roster's Active/Inactive/All tabs.
 * Defaults to ACTIVE, matching this endpoint's behavior before this filter
 * existed (every existing caller keeps seeing exactly what it saw before). */
export enum StudentStatusFilterDto {
  ACTIVE = 'ACTIVE',
  INACTIVE = 'INACTIVE',
  ALL = 'ALL',
}

export class FindStudentsQueryDto {
  @ApiPropertyOptional({ enum: StudentStatusFilterDto, default: StudentStatusFilterDto.ACTIVE })
  @IsOptional()
  @IsEnum(StudentStatusFilterDto)
  status?: StudentStatusFilterDto;
}
