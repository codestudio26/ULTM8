import { ForbiddenException } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

type Reader = Pick<PrismaClient, 'user'>;

/** Sent with a code, so the apps show their own wording. */
export const ACCOUNT_CLOSING = {
  code: 'ACCOUNT_CLOSING',
  message: 'This account is being deleted, so it can no longer book, check in or buy.',
} as const;

/**
 * "Delete my account" rule 2 (product owner, 6 Nov 2026): from the moment a
 * member asks for their account to be deleted it is locked — it can't book,
 * check in or buy, whoever does it for them (the front desk, a coach's scan,
 * the locked tablet). Their own sessions are already refused by JwtStrategy;
 * this covers the ways in that don't use the member's session. Read on the
 * jobs connection, after the caller's own access checks, like the BASELINE
 * consent gate beside it.
 */
export async function assertAccountNotClosing(db: Reader, studentId: string): Promise<void> {
  const user = await db.user.findUnique({ where: { id: studentId }, select: { deletionRequestedAt: true, erasedAt: true } });
  if (user && (user.deletionRequestedAt || user.erasedAt)) {
    throw new ForbiddenException(ACCOUNT_CLOSING);
  }
}
