import { ForbiddenException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import { of } from 'rxjs';
import { PausedAccessInterceptor } from './paused-access.interceptor';
import type { TenantAuthorizationService } from './tenant-authorization.service';

/** Decision 451 item 2 (R-1): which requests the paused-access check looks at. */
describe('PausedAccessInterceptor', () => {
  const SCHOOL = '11111111-1111-4111-8111-111111111111';
  const USER = '22222222-2222-4222-8222-222222222222';

  function setup(pausedOnly: boolean) {
    const isPausedOnly = jest.fn(async () => pausedOnly);
    const interceptor = new PausedAccessInterceptor({ isPausedOnly } as unknown as TenantAuthorizationService);
    const next: CallHandler = { handle: jest.fn(() => of('page')) };
    const run = (req: Record<string, unknown>, type = 'http') =>
      interceptor.intercept({ getType: () => type, switchToHttp: () => ({ getRequest: () => req }) } as unknown as ExecutionContext, next);
    return { isPausedOnly, next, run };
  }
  const req = (path: string, params: Record<string, string>, method = 'GET', user: unknown = { sub: USER }) => ({ route: { path }, params, method, user });

  it.each([
    ['/v1/schools/:schoolId/students', { schoolId: SCHOOL }],
    ['/v1/schools/:id', { id: SCHOOL }],
    ['/v1/schools/:id/students/:studentId/profile', { id: SCHOOL, studentId: 'x' }],
  ])('refuses %s to someone whose only link is a paused staff role', async (path, params) => {
    const { run, isPausedOnly, next } = setup(true);
    await expect(run(req(path, params))).rejects.toBeInstanceOf(ForbiddenException);
    expect(isPausedOnly).toHaveBeenCalledWith(USER, SCHOOL);
    expect(next.handle).not.toHaveBeenCalled();
  });

  it('lets everyone else through to the page', async () => {
    const { run, next } = setup(false);
    await run(req('/v1/schools/:schoolId/students', { schoolId: SCHOOL }));
    expect(next.handle).toHaveBeenCalled();
  });

  it.each([
    ['a route without a School in its path', req('/v1/bookings/me', {})],
    ['the platform admin', req('/v1/platform-admin/schools/:id/close', { id: SCHOOL }, 'POST')],
    ['joining a School with its code', req('/v1/schools/:id/join', { id: SCHOOL }, 'POST')],
    ['nobody signed in', req('/v1/schools/:id', { id: SCHOOL }, 'GET', null)],
  ])('does not look at %s', async (_label, request) => {
    const { run, isPausedOnly, next } = setup(true);
    await run(request);
    expect(isPausedOnly).not.toHaveBeenCalled();
    expect(next.handle).toHaveBeenCalled();
  });

  it('does not look at anything but HTTP', async () => {
    const { run, isPausedOnly } = setup(true);
    await run(req('/v1/schools/:id', { id: SCHOOL }), 'rpc');
    expect(isPausedOnly).not.toHaveBeenCalled();
  });
});
