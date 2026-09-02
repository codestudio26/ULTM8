import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { Prisma } from '@prisma/client';

/**
 * Standardized {error:{code,message}} envelope on every non-2xx response.
 * Decision 22 (docs/decisions/POST-SPEC-55-DECISION-LOG.md, §7 of Spec 55),
 * ultm8-nestjs-module §2.
 *
 * Hardening note (flagged during Phase 1 verification, fixed on request): a plain
 * `@Catch()` filter that falls back to `exception.message` for anything that isn't a
 * NestJS HttpException leaks whatever that message happens to contain — and Prisma's
 * own error messages routinely embed internal file paths, line numbers, and
 * connection-string detail (confirmed by hitting a DB-dependent endpoint with no
 * database configured: the raw response included `auth.service.js:130:49` and
 * `localhost:5432`). The fix below is to never surface a raw non-HttpException message
 * to the client — Prisma error classes get a specific, safe mapping; everything else
 * gets a fixed generic message. Full detail always still goes to the server log.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('ExceptionFilter');

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    const mapped = this.mapException(exception);

    if (mapped.logLevel !== 'none') {
      // Full detail server-side only — never in the response body.
      const detail = exception instanceof Error ? exception.stack ?? exception.message : exception;
      this.logger[mapped.logLevel](`${mapped.code}: ${String(detail)}`);
    }

    response.status(mapped.status).json({
      error: {
        code: mapped.code,
        message: mapped.message,
      },
    });
  }

  private mapException(exception: unknown): {
    status: number;
    code: string;
    message: string;
    logLevel: 'error' | 'warn' | 'none';
  } {
    // 1. NestJS HttpException (includes every class-validator 400) — unchanged
    // behavior, its own response body is already safe/intentional, never DB internals.
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      return {
        status,
        code: extractCode(body) ?? defaultCodeFor(status),
        message: extractMessage(body) ?? exception.message,
        // 4xx from validation/business logic is expected traffic, not worth an error log.
        logLevel: status >= 500 ? 'error' : 'none',
      };
    }

    // 2. Prisma errors — mapped to a safe status/message per error class. Never pass
    // exception.message through: Prisma embeds query snippets, file paths, and
    // connection details directly in it.
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        code: 'SERVICE_UNAVAILABLE',
        message: 'A required service is temporarily unavailable. Please try again shortly.',
        logLevel: 'error',
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.mapPrismaKnownRequestError(exception);
    }
    if (
      exception instanceof Prisma.PrismaClientValidationError ||
      exception instanceof Prisma.PrismaClientRustPanicError ||
      exception instanceof Prisma.PrismaClientUnknownRequestError
    ) {
      return {
        status: HttpStatus.INTERNAL_SERVER_ERROR,
        code: 'INTERNAL_ERROR',
        message: 'Internal server error',
        logLevel: 'error',
      };
    }

    // 3. Anything else unhandled — fixed generic message, always. Full detail logged,
    // never returned.
    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'INTERNAL_ERROR',
      message: 'Internal server error',
      logLevel: 'error',
    };
  }

  private mapPrismaKnownRequestError(exception: Prisma.PrismaClientKnownRequestError) {
    switch (exception.code) {
      case 'P2002': // unique constraint violation
        return {
          status: HttpStatus.CONFLICT,
          code: 'CONFLICT',
          message: 'A record with this value already exists.',
          logLevel: 'warn' as const,
        };
      case 'P2025': // record not found (update/delete on missing row)
        return {
          status: HttpStatus.NOT_FOUND,
          code: 'NOT_FOUND',
          message: 'Record not found.',
          logLevel: 'warn' as const,
        };
      case 'P2003': // foreign key constraint violation
        return {
          status: HttpStatus.BAD_REQUEST,
          code: 'BAD_REQUEST',
          message: 'This request references a record that does not exist.',
          logLevel: 'warn' as const,
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: 'INTERNAL_ERROR',
          message: 'Internal server error',
          logLevel: 'error' as const,
        };
    }
  }
}

function extractMessage(body: unknown): string | undefined {
  if (typeof body === 'string') return body;
  if (body && typeof body === 'object' && 'message' in body) {
    const m = (body as { message: unknown }).message;
    if (typeof m === 'string') return m;
    if (Array.isArray(m)) return m.join('; '); // class-validator error arrays
  }
  return undefined;
}

function extractCode(body: unknown): string | undefined {
  if (body && typeof body === 'object' && 'code' in body) {
    const c = (body as { code: unknown }).code;
    if (typeof c === 'string') return c;
  }
  return undefined;
}

function defaultCodeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'BAD_REQUEST';
    case HttpStatus.UNAUTHORIZED:
      return 'UNAUTHORIZED';
    case HttpStatus.FORBIDDEN:
      return 'FORBIDDEN';
    case HttpStatus.NOT_FOUND:
      return 'NOT_FOUND';
    case HttpStatus.CONFLICT:
      return 'CONFLICT';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'TOO_MANY_REQUESTS';
    case HttpStatus.SERVICE_UNAVAILABLE:
      return 'SERVICE_UNAVAILABLE';
    default:
      return 'INTERNAL_ERROR';
  }
}
