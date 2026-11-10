import { CallHandler, ExecutionContext, ForbiddenException, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable } from 'rxjs';
import { ACCESS_PAUSED, TenantAuthorizationService } from './tenant-authorization.service';

/** A route with a School in its path: `schools/:schoolId/...` or
 * SchoolsController's `schools/:id/...` (with or without the `v1` prefix). */
const SCHOOL_ROUTE = /^\/(?:v1\/)?schools\/:(schoolId|id)(?:\/|$)/;

/** Joining a School as a member with its join code is not a School page:
 * anyone can do it, and it is left as it was. */
const LEFT_AS_IS = new Set(['POST /schools/:id/join']);

/**
 * Decision 451 item 2 (R-1; Decision 449 item 6) — a coach or Branch Staff
 * member whose access to a School is paused (Decision 390) is told so on
 * every School page they open, not only the pages one of the owner's
 * switches guards: before any page code runs, a signed-in caller whose only
 * link to the School in the path is a paused staff role
 * (TenantAuthorizationService.isPausedOnly) gets 403 ACCESS_PAUSED. Nothing
 * of the page runs, so nothing is returned to them.
 *
 * Only the refusal a connected person sees changes: someone with no link to
 * the School, or a School that doesn't exist, is not paused there, so the
 * page answers them exactly as before (404 to a stranger). Anyone with a live
 * role at the School, or a live Guardian of one of its students, is not
 * "paused only" and is answered as before too.
 */
@Injectable()
export class PausedAccessInterceptor implements NestInterceptor {
  constructor(private readonly tenantAuth: TenantAuthorizationService) {}

  async intercept(context: ExecutionContext, next: CallHandler): Promise<Observable<unknown>> {
    if (context.getType() !== 'http') return next.handle();
    const req = context.switchToHttp().getRequest<Request & { user?: { sub?: unknown } }>();
    const routePath: unknown = (req.route as { path?: unknown } | undefined)?.path;
    const userId = req.user?.sub;
    if (typeof routePath !== 'string' || typeof userId !== 'string') return next.handle();
    const match = SCHOOL_ROUTE.exec(routePath);
    if (!match) return next.handle();
    if (LEFT_AS_IS.has(`${req.method} ${routePath.replace(/^\/v1/, '')}`)) return next.handle();
    const schoolId = req.params?.[match[1]];
    if (typeof schoolId === 'string' && (await this.tenantAuth.isPausedOnly(userId, schoolId))) {
      throw new ForbiddenException(ACCESS_PAUSED);
    }
    return next.handle();
  }
}
