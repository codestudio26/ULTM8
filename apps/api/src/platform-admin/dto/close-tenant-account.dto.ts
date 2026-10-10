import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

/**
 * Request body for POST /platform-admin/schools/:id/close and
 * /platform-admin/franchises/:id/close. `confirmName` must match the target's
 * current `name` exactly — Decision 110's own recommendation names re-typing
 * the School/Franchise name as the confirmation step, "given the consequence"
 * (a 90-day countdown to a hard, largely unrecoverable purge). Checked in
 * TenantLifecycleService, not here — this DTO only validates that something
 * was sent, not that it matches (the target's real name isn't known at the
 * validation-pipe layer).
 */
export class CloseTenantAccountDto {
  @ApiProperty({ description: "Must exactly match the School/Franchise's current name — the required confirmation step for this action." })
  @IsString()
  @MinLength(1)
  confirmName!: string;
}
