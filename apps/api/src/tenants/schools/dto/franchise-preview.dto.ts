import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Decision 368 (School Settings review, Q4) — GET /schools/:id/franchise-preview. */
export class FranchisePreviewQueryDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Enter the Franchise ID exactly as the Franchise Owner gave it.' })
  franchiseId!: string;
}

/** Only the Franchise's id and name, for the School Owner to confirm before asking to join. */
export class FranchisePreviewResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;
}
