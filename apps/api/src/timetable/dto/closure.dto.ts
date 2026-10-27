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

export class ClosureListResponseDto {
  @ApiProperty({ type: [ClosureResponseDto] }) items!: ClosureResponseDto[];
}
