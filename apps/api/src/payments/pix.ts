import { BadRequestException } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

/**
 * Decision 448 item 5: Pix is a Brazilian payment scheme, so it exists only at
 * a School in Brazil (its address country BR, the rule the member app's "Pix"
 * wording already follows through school_card_payments(), Decision 437). A
 * payment recorded as Pix at any other School is refused: a desk sale of a
 * membership or Class Pack (MembershipsService.recordDeskSale) and a desk
 * payment toward charges (ChargesService.recordPayment). A member's own order
 * is never recorded as Pix (cash or bank transfer, Decision 441), so it has
 * nothing to refuse. Past Pix rows are left as they are.
 */
export async function assertPixAllowed(db: Pick<Prisma.TransactionClient, 'school'>, schoolId: string, method: string): Promise<void> {
  if (method !== 'PIX') return;
  const school = await db.school.findUnique({ where: { id: schoolId }, select: { addressCountry: true } });
  if (school?.addressCountry?.toUpperCase() !== 'BR') {
    throw new BadRequestException('Pix can only be used by a School in Brazil. Choose another way to pay.');
  }
}
