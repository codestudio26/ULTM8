import { CanActivate, createParamDecorator, ExecutionContext, HttpException, Injectable, SetMetadata, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FRONT_DESK_LOCKED, FrontDeskSessionContext, FrontDeskSessionsService } from './front-desk-sessions.service';

const ALLOW_WHILE_LOCKED = 'frontDeskAllowWhileLocked';

/** A kiosk route a locked tablet can still reach (Decision 417): its own
 * session info, and a staff code to carry on or leave. */
export const AllowWhileLocked = () => SetMetadata(ALLOW_WHILE_LOCKED, true);

/**
 * The only guard that accepts a locked tablet's token (Decision 380). Checks
 * the token and that its session is still live, and puts the session on the
 * request. A staff login token is refused here, and the tablet's token is
 * refused everywhere else (JwtStrategy can't verify it). A tablet locked by
 * wrong member codes reaches only the @AllowWhileLocked routes (Decision 417).
 */
@Injectable()
export class FrontDeskSessionGuard implements CanActivate {
  constructor(
    private readonly sessions: FrontDeskSessionsService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'FRONT_DESK_SESSION_ENDED', message: 'This front-desk session has ended. Ask a member of staff to start it again.' });
    }
    const session = await this.sessions.authenticate(header.slice('Bearer '.length));
    if (session.lockedAt && !this.reflector.getAllAndOverride<boolean>(ALLOW_WHILE_LOCKED, [context.getHandler(), context.getClass()])) {
      throw new HttpException(FRONT_DESK_LOCKED, 423); // 423 Locked
    }
    req.frontDeskSession = session;
    return true;
  }
}

/** The live session FrontDeskSessionGuard found. */
export const FrontDeskSession = createParamDecorator((_data: unknown, ctx: ExecutionContext): FrontDeskSessionContext => ctx.switchToHttp().getRequest().frontDeskSession);
