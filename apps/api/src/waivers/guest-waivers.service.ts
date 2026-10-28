import { BadRequestException, ConflictException, GoneException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash, randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { PrismaAuthService } from '../common/prisma/prisma-auth.service';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { resolveUserNames } from '../common/prisma/resolve-user-names';
import { decodeDescCursor, encodeDescCursor, resolveLimit } from '../common/pagination/cursor-paginate';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { SignGuestWaiversDto } from './dto/guest-waiver.dto';
import { guestWaiverLink, hashGuestWaiverToken } from './guest-waiver-token';

type LinkRow = {
  attendeeId: string;
  bookingId: string;
  bookingStatus: string;
  bookedById: string;
  schoolId: string;
  schoolName: string;
  schoolArchivedAt: Date | null;
  branchId: string | null;
  classId: string;
  classTitle: string;
  classStartsAt: Date;
  classEndsAt: Date;
};

type LinkWaiverRow = { id: string; title: string; body: string; version: number; signed: boolean };

type WaiverStatus = 'SIGNED' | 'UNSIGNED' | 'NONE';

/** A guest waiver token is 32 bytes of HMAC, base64url (guest-waiver-token.ts). */
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;

const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/** Whole years between a date of birth and `at` (UTC calendar dates). */
function ageOn(dob: Date, at: Date): number {
  let age = at.getUTCFullYear() - dob.getUTCFullYear();
  const beforeBirthday =
    at.getUTCMonth() < dob.getUTCMonth() || (at.getUTCMonth() === dob.getUTCMonth() && at.getUTCDate() < dob.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * Guests on a booking (Waivers Q9). A guest is a seat on someone's booking,
 * paid for with one of the booker's Friend Passes, and has no account. Each
 * seat gets a link (guest-waiver-token.ts) the booker shares; the guest opens
 * it, types their name and date of birth and signs the School's current
 * waivers. A guest under 18 is signed for by a parent or guardian. The booking
 * isn't blocked: staff see on the class page which guests haven't signed.
 */
@Injectable()
export class GuestWaiversService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly prismaJobs: PrismaJobsService,
    private readonly prismaAuth: PrismaAuthService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  // ---------------------------------------------------------------------------
  // The signing page: public, the token is the only key.
  // ---------------------------------------------------------------------------

  private async findLink(token: string): Promise<{ hash: string; link: LinkRow }> {
    if (!TOKEN_SHAPE.test(token)) throw new NotFoundException('This waiver link is not valid.');
    const hash = hashGuestWaiverToken(token);
    const rows = await this.prismaApp.$queryRaw<LinkRow[]>`SELECT * FROM guest_waiver_link(${hash})`;
    if (!rows[0]) throw new NotFoundException('This waiver link is not valid.');
    return { hash, link: rows[0] };
  }

  private isOpen(link: LinkRow, now = new Date()): boolean {
    return link.bookingStatus === 'UPCOMING' && link.classEndsAt > now && !link.schoolArchivedAt;
  }

  async page(token: string) {
    const { hash, link } = await this.findLink(token);
    const open = this.isOpen(link);
    const waivers = open ? await this.prismaApp.$queryRaw<LinkWaiverRow[]>`SELECT * FROM guest_waiver_link_waivers(${hash})` : [];
    const earlier = await this.prismaApp.withGuestWaiverToken(hash, (tx) =>
      tx.guestWaiverSignature.findFirst({ where: { bookingAttendeeId: link.attendeeId }, orderBy: { signedAt: 'asc' }, select: { guestFullName: true } }),
    );
    return {
      schoolName: link.schoolName,
      classTitle: link.classTitle,
      classStartsAt: link.classStartsAt.toISOString(),
      classEndsAt: link.classEndsAt.toISOString(),
      status: open ? ('OPEN' as const) : ('CLOSED' as const),
      waivers: waivers.map((w) => ({ id: w.id, title: w.title, body: w.body, version: Number(w.version), signed: w.signed })),
      guestFullName: earlier?.guestFullName ?? null,
    };
  }

  async sign(token: string, dto: SignGuestWaiversDto) {
    const { hash, link } = await this.findLink(token);
    if (!this.isOpen(link)) {
      throw new GoneException('This waiver link has closed: the booking was cancelled, the class has ended or the School has closed.');
    }

    const dob = new Date(`${dto.guestDateOfBirth}T00:00:00.000Z`);
    const now = new Date();
    if (Number.isNaN(dob.getTime()) || isoDate(dob) !== dto.guestDateOfBirth || dob > now || dob.getUTCFullYear() < 1900) {
      throw new BadRequestException('Enter a real date of birth.');
    }
    const byGuardian = ageOn(dob, now) < 18;
    if (byGuardian && dto.signerFullName.trim().toLowerCase() === dto.guestFullName.trim().toLowerCase()) {
      throw new BadRequestException("A guest under 18 needs a parent or guardian to sign for them. Enter the parent or guardian's name.");
    }

    const waivers = await this.prismaApp.$queryRaw<LinkWaiverRow[]>`SELECT * FROM guest_waiver_link_waivers(${hash})`;
    const unsigned = waivers.filter((w) => !w.signed);
    if (unsigned.length === 0) throw new ConflictException('This guest has already signed every waiver.');
    const sent = new Map(dto.waivers.map((w) => [w.waiverId, w.version]));
    const matches = sent.size === dto.waivers.length && sent.size === unsigned.length && unsigned.every((w) => sent.get(w.id) === Number(w.version));
    if (!matches) {
      throw new ConflictException('The waivers were changed while you were reading them. Please read them again before signing.');
    }

    try {
      const result = await this.prismaApp.withGuestWaiverToken(hash, (tx) =>
        tx.guestWaiverSignature.createMany({
          data: unsigned.map((w) => ({
            id: randomUUID(),
            schoolId: link.schoolId,
            branchId: link.branchId,
            bookingAttendeeId: link.attendeeId,
            bookingId: link.bookingId,
            bookedById: link.bookedById,
            waiverId: w.id,
            classId: link.classId,
            classTitle: link.classTitle,
            classStartsAt: link.classStartsAt,
            guestFullName: dto.guestFullName,
            guestDateOfBirth: dob,
            signerFullName: dto.signerFullName,
            signatureText: dto.signatureText,
            signedByGuardian: byGuardian,
            signedWaiverTitle: w.title,
            signedWaiverBody: w.body,
            signedWaiverSha256: createHash('sha256').update(w.body, 'utf8').digest('hex'),
            signedWaiverVersion: Number(w.version),
          })),
        }),
      );
      return { signed: result.count };
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('This guest has already signed. Reload the page to see it.');
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------------------
  // The booker and staff: who has signed, and the links to share.
  // ---------------------------------------------------------------------------

  /** Each seat's status against the School's current waivers. Read through
   * ultm8_jobs: the caller is already checked as the booker or staff for the
   * class, and Branch Staff and Instructors can't read guest signatures
   * themselves (only whether a guest has signed). */
  private async statuses(schoolId: string, attendeeIds: string[]) {
    const [current, signatures] = await Promise.all([
      this.prismaJobs.waiver.findMany({ where: { schoolId, archivedAt: null }, select: { id: true } }),
      attendeeIds.length
        ? this.prismaJobs.guestWaiverSignature.findMany({
            where: { bookingAttendeeId: { in: attendeeIds } },
            select: { bookingAttendeeId: true, waiverId: true, guestFullName: true, signedAt: true },
            orderBy: { signedAt: 'asc' },
          })
        : Promise.resolve([]),
    ]);
    const currentIds = current.map((w) => w.id);
    const out = new Map<string, { waiverStatus: WaiverStatus; guestFullName: string | null }>();
    for (const id of attendeeIds) {
      const mine = signatures.filter((s) => s.bookingAttendeeId === id);
      const signedIds = new Set(mine.map((s) => s.waiverId));
      const waiverStatus: WaiverStatus = currentIds.length === 0 ? 'NONE' : currentIds.every((w) => signedIds.has(w)) ? 'SIGNED' : 'UNSIGNED';
      out.set(id, { waiverStatus, guestFullName: mine[0]?.guestFullName ?? null });
    }
    return out;
  }

  /** The caller's roles at the School that may hand out a guest's link. */
  private async mayShareLinks(callerId: string, schoolId: string, branchId: string | null): Promise<boolean> {
    const grant = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.roleGrant.findFirst({
        where: {
          userId: callerId,
          schoolId,
          revokedAt: null,
          OR: [{ role: 'SCHOOL_OWNER_MANAGER' }, { role: 'BRANCH_STAFF', ...(branchId ? { OR: [{ branchId: null }, { branchId }] } : {}) }],
        },
        select: { id: true },
      }),
    );
    return !!grant;
  }

  private shape(
    booking: { id: string; studentId: string; attendees: Array<{ id: string; guestTokenHash: string | null }> },
    waiverRequired: boolean,
    statuses: Map<string, { waiverStatus: WaiverStatus; guestFullName: string | null }>,
    showLinks: boolean,
  ) {
    return {
      bookingId: booking.id,
      waiverRequired,
      guests: booking.attendees.map((a) => ({
        attendeeId: a.id,
        // A seat booked before guest links existed has no link.
        link: showLinks && a.guestTokenHash ? guestWaiverLink(a.id) : null,
        waiverStatus: statuses.get(a.id)?.waiverStatus ?? 'NONE',
        guestFullName: statuses.get(a.id)?.guestFullName ?? null,
      })),
    };
  }

  /** One booking's guests: for the booker, or staff for the class. */
  async bookingGuests(callerId: string, bookingId: string) {
    const booking = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findUnique({
        where: { id: bookingId },
        include: { attendees: { select: { id: true, guestTokenHash: true }, orderBy: { createdAt: 'asc' } }, class: { select: { termsWaiverRequired: true } } },
      }),
    );
    if (!booking) throw new NotFoundException('Booking not found');
    const isBooker = booking.studentId === callerId;
    if (!isBooker) await this.tenantAuth.assertStaffAtSchool(callerId, booking.schoolId, booking.branchId);
    const showLinks = isBooker || (await this.mayShareLinks(callerId, booking.schoolId, booking.branchId));
    const statuses = await this.statuses(booking.schoolId, booking.attendees.map((a) => a.id));
    return this.shape(booking, booking.class.termsWaiverRequired, statuses, showLinks);
  }

  /** The class page: every Upcoming booking with guests, for staff. */
  async classGuests(callerId: string, classId: string) {
    const cls = await this.prismaApp.withTenantContext(callerId, (tx) => tx.class.findUnique({ where: { id: classId }, select: { schoolId: true, branchId: true, termsWaiverRequired: true } }));
    if (!cls) throw new NotFoundException('Class not found');
    await this.tenantAuth.assertStaffAtSchool(callerId, cls.schoolId, cls.branchId);
    const bookings = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.booking.findMany({
        where: { classId, status: 'UPCOMING', attendees: { some: {} } },
        include: { attendees: { select: { id: true, guestTokenHash: true }, orderBy: { createdAt: 'asc' } } },
        orderBy: { createdAt: 'asc' },
      }),
    );
    const showLinks = await this.mayShareLinks(callerId, cls.schoolId, cls.branchId);
    const statuses = await this.statuses(cls.schoolId, bookings.flatMap((b) => b.attendees.map((a) => a.id)));
    return { waiverRequired: cls.termsWaiverRequired, bookings: bookings.map((b) => this.shape(b, cls.termsWaiverRequired, statuses, showLinks)) };
  }

  /** The caller's own Friend Passes at a School that can still pay for a guest. */
  async myFriendPasses(callerId: string, schoolId: string) {
    const now = new Date();
    const memberships = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.membership.findMany({
        where: {
          studentId: callerId,
          schoolId,
          status: 'ACTIVE',
          membershipPlan: { type: 'FRIEND_PASS' },
          AND: [{ OR: [{ expiryDate: null }, { expiryDate: { gt: now } }] }, { OR: [{ classesRemaining: null }, { classesRemaining: { gt: 0 } }] }],
        },
        select: { id: true, scopedClassId: true, expiryDate: true },
        orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
      }),
    );
    return { items: memberships.map((m) => ({ membershipId: m.id, scopedClassId: m.scopedClassId, expiryDate: m.expiryDate?.toISOString() ?? null })) };
  }

  // ---------------------------------------------------------------------------
  // The Waivers page: guest signatures on a waiver, School Owner/Manager only.
  // ---------------------------------------------------------------------------

  private async assertOwnedWaiver(callerId: string, schoolId: string, waiverId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const waiver = await this.prismaApp.withTenantContext(callerId, (tx) => tx.waiver.findFirst({ where: { id: waiverId, schoolId }, select: { id: true } }));
    if (!waiver) throw new NotFoundException('Waiver not found');
  }

  private async toSignatureDtos<T extends { bookedById: string | null }>(rows: T[]) {
    const names = await resolveUserNames(this.prismaAuth, rows.map((r) => r.bookedById).filter((id): id is string => !!id));
    return rows.map((r) => {
      const name = r.bookedById ? names.get(r.bookedById) : undefined;
      return { row: r, bookedByName: name ? `${name.firstName} ${name.surname}`.trim() : null };
    });
  }

  private summary(r: {
    id: string;
    guestFullName: string;
    guestDateOfBirth: Date;
    signerFullName: string;
    signatureText: string;
    signedByGuardian: boolean;
    classTitle: string;
    classStartsAt: Date;
    signedAt: Date;
    signedWaiverVersion: number;
  }, bookedByName: string | null) {
    return {
      id: r.id,
      guestFullName: r.guestFullName,
      guestDateOfBirth: isoDate(r.guestDateOfBirth),
      signerFullName: r.signerFullName,
      signatureText: r.signatureText,
      signedByGuardian: r.signedByGuardian,
      classTitle: r.classTitle,
      classStartsAt: r.classStartsAt.toISOString(),
      bookedByName,
      signedAt: r.signedAt.toISOString(),
      signedWaiverVersion: r.signedWaiverVersion,
    };
  }

  /** Newest first. */
  async listSignatures(callerId: string, schoolId: string, waiverId: string, cursor?: string, limit?: number) {
    await this.assertOwnedWaiver(callerId, schoolId, waiverId);
    const take = resolveLimit(limit);
    let after: { sortValue: Date; id: string } | null = null;
    if (cursor) {
      try {
        after = decodeDescCursor(cursor);
      } catch {
        throw new BadRequestException('cursor is not valid.');
      }
    }
    const rows = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.guestWaiverSignature.findMany({
        where: {
          waiverId,
          schoolId,
          ...(after ? { OR: [{ signedAt: { lt: after.sortValue } }, { signedAt: after.sortValue, id: { lt: after.id } }] } : {}),
        },
        orderBy: [{ signedAt: 'desc' }, { id: 'desc' }],
        take: take + 1,
        select: {
          id: true,
          guestFullName: true,
          guestDateOfBirth: true,
          signerFullName: true,
          signatureText: true,
          signedByGuardian: true,
          classTitle: true,
          classStartsAt: true,
          signedAt: true,
          signedWaiverVersion: true,
          bookedById: true,
        },
      }),
    );
    const page = rows.slice(0, take);
    const named = await this.toSignatureDtos(page);
    const last = page[page.length - 1];
    return {
      items: named.map(({ row, bookedByName }) => this.summary(row, bookedByName)),
      nextCursor: rows.length > take && last ? encodeDescCursor(last.signedAt, last.id) : null,
    };
  }

  /** One guest signature with the wording that was signed. */
  async getSignature(callerId: string, schoolId: string, waiverId: string, signatureId: string) {
    await this.assertOwnedWaiver(callerId, schoolId, waiverId);
    const row = await this.prismaApp.withTenantContext(callerId, (tx) => tx.guestWaiverSignature.findFirst({ where: { id: signatureId, waiverId, schoolId } }));
    if (!row) throw new NotFoundException('Guest signature not found');
    const [{ bookedByName }] = await this.toSignatureDtos([row]);
    return {
      ...this.summary(row, bookedByName),
      signedWaiverTitle: row.signedWaiverTitle,
      signedWaiverBody: row.signedWaiverBody,
      signedWaiverSha256: row.signedWaiverSha256,
    };
  }
}
