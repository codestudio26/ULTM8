import { CanActivate, createParamDecorator, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { FrontDeskSessionContext, FrontDeskSessionsService } from './front-desk-sessions.service';

/**
 * The only guard that accepts a locked tablet's token (Decision 380). Checks
 * the token and that its session is still live, and puts the session on the
 * request. A staff login token is refused here, and the tablet's token is
 * refused everywhere else (JwtStrategy can't verify it).
 */
@Injectable()
export class FrontDeskSessionGuard implements CanActivate {
  constructor(private readonly sessions: FrontDeskSessionsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();
    const header = req.headers?.authorization as string | undefined;
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'FRONT_DESK_SESSION_ENDED', message: 'This front-desk session has ended. Ask a member of staff to start it again.' });
    }
    req.frontDeskSession = await this.sessions.authenticate(header.slice('Bearer '.length));
    return true;
  }
}

/** The live session FrontDeskSessionGuard found. */
export const FrontDeskSession = createParamDecorator((_data: unknown, ctx: ExecutionContext): FrontDeskSessionContext => ctx.switchToHttp().getRequest().frontDeskSession);
