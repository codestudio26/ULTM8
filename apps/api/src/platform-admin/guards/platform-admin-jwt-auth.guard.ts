import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

/**
 * Gates every Platform Admin endpoint. Mirrors apps/api/src/auth/guards/jwt-auth.guard.ts
 * exactly in shape — the substance of the isolation is which named strategy it invokes
 * ('platform-admin-jwt', registered by PlatformAdminJwtStrategy), not this class itself.
 */
@Injectable()
export class PlatformAdminJwtAuthGuard extends AuthGuard('platform-admin-jwt') {}
