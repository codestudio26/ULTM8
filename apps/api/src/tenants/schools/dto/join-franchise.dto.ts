import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

/** Request body for POST /schools/:id/join-franchise (Phase 16b-i, Decision 98) — see
 * SchoolsService.joinFranchise's own header comment for the full account. */
export class JoinFranchiseDto {
  @ApiProperty()
  @IsUUID()
  franchiseId!: string;
}
