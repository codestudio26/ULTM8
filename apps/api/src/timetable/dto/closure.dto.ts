import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

/** POST /schools/:schoolId/closures (Decision 319 §3, Decision 353 Q8). */
export class CreateClosureDto {
  @ApiProperty({ description: 'First closed date, YYYY-MM-DD (local).' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format.' })
  startDate!: string;

  @ApiProperty({ description: 'Last closed date, YYYY-MM-DD (local). The same as startDate for one day.' })
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format.' })
  endDate!: string;

  @ApiProperty({ description: 'Shown on the calendar and in the cancellation notice, e.g. "Christmas".' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reason!: string;

  @ApiPropertyOptional({ description: 'Close only this Branch. Left out, the whole School is closed.' })
  @IsOptional()
  @IsUUID()
  branchId?: string;
}

/** PATCH /closures/:id (Decision 431 item 11): any of the dates and the
 * reason. The Branch a closure covers doesn't change. */
export class UpdateClosureDto {
  @ApiPropertyOptional({ description: 'First closed date, YYYY-MM-DD (local).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'startDate must be in YYYY-MM-DD format.' })
  startDate?: string;

  @ApiPropertyOptional({ description: 'Last closed date, YYYY-MM-DD (local).' })
  @IsOptional()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'endDate must be in YYYY-MM-DD format.' })
  endDate?: string;

  @ApiPropertyOptional({ description: 'Shown on the calendar. Changing it tells nobody.' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  reason?: string;
}

export class ClosureResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() schoolId!: string;
  @ApiProperty({ type: String, nullable: true, description: 'Null: the whole School.' }) branchId!: string | null;
  @ApiProperty({ description: 'YYYY-MM-DD' }) startDate!: string;
  @ApiProperty({ description: 'YYYY-MM-DD' }) endDate!: string;
  @ApiProperty() reason!: string;
  @ApiProperty() createdAt!: string;
}

export class ClosureCreatedResponseDto extends ClosureResponseDto {
  @ApiProperty({ description: 'How many classes the closure cancelled.' }) cancelledClasses!: number;
}

export class RecreatableClassDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ type: String, nullable: true }) branchId!: string | null;
  @ApiProperty({ description: 'The class\'s local date, YYYY-MM-DD.' }) date!: string;
  @ApiProperty() startDate!: string;
  @ApiProperty() endDate!: string;
}

export class ClosureUpdatedResponseDto extends ClosureResponseDto {
  @ApiProperty({ description: 'How many classes on newly closed days were cancelled.' }) cancelledClasses!: number;
  @ApiProperty({
    type: [RecreatableClassDto],
    description: 'Classes this closure cancelled on days it no longer covers. They stay cancelled (students were told); POST /classes/{id}/recreate makes a one-off copy.',
  })
  recreatable!: RecreatableClassDto[];
}

export class ClosureListResponseDto {
  @ApiProperty({ type: [ClosureResponseDto] }) items!: ClosureResponseDto[];
}
