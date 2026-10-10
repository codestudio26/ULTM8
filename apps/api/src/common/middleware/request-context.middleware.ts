import { Injectable, NestMiddleware } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import { RequestContext } from '../request-context';

/**
 * Phase 47 — establishes the per-request AsyncLocalStorage store (see
 * RequestContext's own header comment) for every request, before Passport/
 * JwtStrategy ever runs. Registered globally in AppModule.configure(), not
 * main.ts — every e2e spec in this repo builds its own Nest application
 * directly from AppModule (`Test.createTestingModule({ imports: [AppModule] })`),
 * bypassing main.ts's bootstrap() entirely, so a main.ts-only `app.use(...)`
 * would silently never run under any of this codebase's own test suites.
 * AppModule-level registration is the one place guaranteed to apply everywhere
 * AppModule itself is used.
 */
@Injectable()
export class RequestContextMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    RequestContext.run(() => next());
  }
}
