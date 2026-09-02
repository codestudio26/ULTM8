/**
 * Regression test for the DB-error leak found during Phase 1 verification: hitting a
 * DB-dependent endpoint with no database configured returned the raw Prisma error in
 * the response body, including an internal file path (`auth.service.js:130:49`) and
 * connection details (`localhost:5432`). Asserts the global exception filter now
 * returns only {error:{code,message}} — nothing else — for every error class that can
 * reach it, and that none of the safe messages leak path/stack/connection detail.
 *
 * Self-contained: uses a throwaway controller that deliberately throws each error
 * type, rather than the real app (which needs a live DB/Twilio to construct some of
 * its providers) — this targets the filter itself, not any particular route.
 */
import { Controller, Get, INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { Prisma } from '@prisma/client';
import { HttpExceptionFilter } from '../src/common/filters/http-exception.filter';

@Controller('test-errors')
class ThrowingController {
  @Get('unhandled')
  throwUnhandled(): never {
    throw new Error(
      'internal detail: /Users/dev/secret-path/auth.service.ts:130:49 db-password=hunter2',
    );
  }

  @Get('prisma-init')
  throwPrismaInit(): never {
    throw new Prisma.PrismaClientInitializationError(
      "Can't reach database server at `localhost:5432`.\nPlease make sure your database server is running at `localhost:5432`.",
      '5.20.0',
    );
  }

  @Get('prisma-unique')
  throwPrismaUnique(): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`email`)', {
      code: 'P2002',
      clientVersion: '5.20.0',
    });
  }

  @Get('prisma-not-found')
  throwPrismaNotFound(): never {
    throw new Prisma.PrismaClientKnownRequestError('An operation failed because it depends on one or more records that were required but not found.', {
      code: 'P2025',
      clientVersion: '5.20.0',
    });
  }
}

describe('Global exception filter — no internal detail leaks (regression)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ThrowingController],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  function assertEnvelopeShape(body: any) {
    expect(Object.keys(body)).toEqual(['error']);
    expect(Object.keys(body.error).sort()).toEqual(['code', 'message']);
    expect(typeof body.error.code).toBe('string');
    expect(typeof body.error.message).toBe('string');
  }

  it('never leaks a raw unhandled Error message (paths, secrets, stack)', async () => {
    const res = await request(app.getHttpServer()).get('/test-errors/unhandled');
    expect(res.status).toBe(500);
    assertEnvelopeShape(res.body);
    expect(res.body.error.message).toBe('Internal server error');
    expect(res.body.error.message).not.toMatch(/secret|password|hunter2|\.ts:|\/Users\//i);
  });

  it('maps a Prisma initialization error to a safe 503, no connection details', async () => {
    const res = await request(app.getHttpServer()).get('/test-errors/prisma-init');
    expect(res.status).toBe(503);
    assertEnvelopeShape(res.body);
    expect(res.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(res.body.error.message).not.toMatch(/localhost|5432|database server/i);
  });

  it('maps a Prisma unique-constraint error (P2002) to a safe 409', async () => {
    const res = await request(app.getHttpServer()).get('/test-errors/prisma-unique');
    expect(res.status).toBe(409);
    assertEnvelopeShape(res.body);
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).not.toMatch(/email|constraint|fields/i);
  });

  it('maps a Prisma not-found error (P2025) to a safe 404', async () => {
    const res = await request(app.getHttpServer()).get('/test-errors/prisma-not-found');
    expect(res.status).toBe(404);
    assertEnvelopeShape(res.body);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
