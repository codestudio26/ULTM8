import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

/**
 * Connection authenticated as the `ultm8_auth` Postgres role — SELECT-only on `User`,
 * nothing else (see migration.sql). This exists solely for the pre-authentication
 * credential-lookup path (login-by-email, registration's already-taken check), which
 * inherently has no tenant/user context to set yet. Never use this for anything but
 * finding a User by email/phone — it deliberately cannot write anything, and its RLS
 * policy deliberately has no tenant restriction (see the user_auth_lookup policy).
 */
@Injectable()
export class PrismaAuthService extends PrismaClient {
  constructor() {
    const url = process.env.DATABASE_URL_AUTH;
    if (!url) {
      // eslint-disable-next-line no-console
      console.warn(
        '[PrismaAuthService] DATABASE_URL_AUTH is not set — login/registration lookups will fail until it is.',
      );
    }
    super(url ? { datasourceUrl: url } : undefined);
  }
}
