import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/** Decision 352 — one School's request to join a Franchise. */
export class FranchiseJoinRequestResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  franchiseId!: string;

  @ApiProperty()
  schoolId!: string;

  @ApiProperty({ description: 'The School\'s name when it asked.' })
  schoolName!: string;

  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'DECLINED', 'CANCELLED'] })
  status!: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'CANCELLED';

  @ApiProperty({ type: String, format: 'date-time' })
  createdAt!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  decidedAt!: string | null;
}

export class FranchiseJoinRequestListResponseDto {
  @ApiProperty({ type: [FranchiseJoinRequestResponseDto] })
  items!: FranchiseJoinRequestResponseDto[];
}

/** The School's latest request, or null if it has never asked. */
export class SchoolFranchiseJoinRequestResponseDto {
  @ApiPropertyOptional({ type: FranchiseJoinRequestResponseDto, nullable: true })
  request!: FranchiseJoinRequestResponseDto | null;
}

/** Decision 352 — a Franchise Owner closing their own Franchise re-types its
 * name, and proves their passcode through POST /auth/step-up/verify (sent as
 * the X-Step-Up-Token header). */
export class CloseOwnFranchiseDto {
  @ApiProperty({ description: "Must exactly match the Franchise's current name." })
  @IsString()
  @MinLength(1)
  confirmName!: string;
}
