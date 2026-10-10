import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsUUID } from 'class-validator';

/**
 * POST /waivers/{id}/signature-upload-url body (Phase 37 — this route had no
 * body at all before now). `studentId` mirrors SignWaiverDto's own on-behalf-of
 * field exactly, for the same reason: a Guardian requesting an upload URL for a
 * linked minor's drawn signature needs the returned objectKey to be prefixed
 * with the MINOR's id (see WaiversService.requestSignatureUploadUrl()'s own
 * comment), not the Guardian's — otherwise the prefix sign() later validates
 * against would never match.
 */
export class RequestSignatureUploadUrlDto {
  @ApiPropertyOptional({ description: 'Guardian-only: request an upload URL on behalf of this linked minor Student instead of the caller.' })
  @IsOptional()
  @IsUUID()
  studentId?: string;
}
