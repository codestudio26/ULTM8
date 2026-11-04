import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/** Decision 428 (Student portal review M4) — `studentId`: a parent asking for
 * their child. */
export class ClassTicketPlansQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  studentId?: string;
}

/** The ids of the plans on sale that are this one-off Class's own ticket
 * (scoped to it). The plans themselves are on the School page's plan list. */
export class ClassTicketPlansDto {
  @ApiProperty({ type: [String] })
  planIds!: string[];
}
