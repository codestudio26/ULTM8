import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { AdminJwtPayload } from '../interfaces/admin-jwt-payload.interface';

/**
 * Pulls the validated Platform Admin token claims (set on `req.user` by
 * PlatformAdminJwtStrategy.validate()) into a handler parameter. Only meaningful
 * behind PlatformAdminJwtAuthGuard — mirrors
 * apps/api/src/common/decorators/current-user.decorator.ts, deliberately not reused
 * (that one's return type is the tenant JwtPayload shape, not AdminJwtPayload).
 */
export const CurrentAdminUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AdminJwtPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.user;
  },
);
