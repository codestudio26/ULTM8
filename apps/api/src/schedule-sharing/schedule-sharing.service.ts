import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { TenantAuthorizationService } from '../tenants/tenant-authorization.service';
import { calendarFeedToken, hashCalendarFeedToken, isLinkToken, newScheduleEmbedKey } from './calendar-feed-token';
import { buildCalendar, FeedClass } from './ical';
import { EmbedClass } from './embed-page';
import { UpdateScheduleSharingDto } from './schedule-sharing.dto';

/**
 * Decision 319 item 4: two schedule settings a School can choose.
 *
 * 1. "Google Calendar: staff see their classes in their Google Calendar."
 *    Built as a private calendar link per staff member (an iCal feed of the
 *    classes they teach) that Google Calendar subscribes to "From URL". It
 *    needs no Google account connection and no secret. The owner switches it
 *    on for the School; each staff member makes, copies, replaces or removes
 *    their own link on My Profile.
 * 2. "A schedule embed for the School's own website": a public page of the
 *    School's upcoming classes for an <iframe>, and the same data as JSON.
 *    The owner switches it on, gets the snippet, and can replace the link.
 *
 * Both public reads go through SECURITY DEFINER functions keyed by the
 * link's token (migration 20270217000002), so a link can only ever read the
 * one School (and, for a calendar link, the one person's classes) it names.
 */
@Injectable()
export class ScheduleSharingService {
  constructor(
    private readonly prismaApp: PrismaAppService,
    private readonly tenantAuth: TenantAuthorizationService,
  ) {}

  // ---------------------------------------------------------------------------
  // The owner: the two settings
  // ---------------------------------------------------------------------------

  async getSettings(callerId: string, schoolId: string) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    const school = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { staffCalendarFeedsEnabled: true, scheduleEmbedKey: true } }),
    );
    if (!school) throw new NotFoundException('School not found');
    return { staffCalendarFeedsEnabled: school.staffCalendarFeedsEnabled, scheduleEmbedKey: school.scheduleEmbedKey };
  }

  /** Turning the embed on makes a key (keeping one already there); off
   * removes it, so the old link stops working; `newEmbedKey` replaces it. */
  async updateSettings(callerId: string, schoolId: string, dto: UpdateScheduleSharingDto) {
    await this.tenantAuth.assertSchoolOwner(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const current = await this.getSettings(callerId, schoolId);
    let scheduleEmbedKey = current.scheduleEmbedKey;
    if (dto.scheduleEmbedEnabled === false) scheduleEmbedKey = null;
    else if (dto.newEmbedKey || (dto.scheduleEmbedEnabled === true && !scheduleEmbedKey)) scheduleEmbedKey = newScheduleEmbedKey();
    const updated = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.update({
        where: { id: schoolId },
        data: {
          ...(dto.staffCalendarFeedsEnabled !== undefined ? { staffCalendarFeedsEnabled: dto.staffCalendarFeedsEnabled } : {}),
          scheduleEmbedKey,
        },
        select: { staffCalendarFeedsEnabled: true, scheduleEmbedKey: true },
      }),
    );
    return updated;
  }

  // ---------------------------------------------------------------------------
  // A staff member: their own calendar link
  // ---------------------------------------------------------------------------

  async getMyFeed(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    const [school, feed] = await this.prismaApp.withTenantContext(callerId, (tx) =>
      Promise.all([
        tx.school.findUnique({ where: { id: schoolId }, select: { staffCalendarFeedsEnabled: true } }),
        tx.staffCalendarFeed.findUnique({ where: { schoolId_userId: { schoolId, userId: callerId } } }),
      ]),
    );
    return {
      enabled: school?.staffCalendarFeedsEnabled ?? false,
      feed: feed ? { token: calendarFeedToken(feed.id), createdAt: feed.createdAt.toISOString() } : null,
    };
  }

  /** Makes the caller's link, or replaces it (the old link stops working). */
  async createMyFeed(callerId: string, schoolId: string) {
    await this.tenantAuth.assertStaffAtSchool(callerId, schoolId);
    await this.tenantAuth.assertSchoolNotArchived(callerId, schoolId);
    const enabled = await this.prismaApp.withTenantContext(callerId, (tx) =>
      tx.school.findUnique({ where: { id: schoolId }, select: { staffCalendarFeedsEnabled: true } }),
    );
    if (!enabled?.staffCalendarFeedsEnabled) {
      throw new NotFoundException("Your School hasn't switched on calendar links.");
    }
    const id = randomUUID();
    const feed = await this.prismaApp.withTenantContext(callerId, async (tx) => {
      await tx.staffCalendarFeed.deleteMany({ where: { schoolId, userId: callerId } });
      return tx.staffCalendarFeed.create({ data: { id, schoolId, userId: callerId, tokenHash: hashCalendarFeedToken(calendarFeedToken(id)) } });
    });
    return { enabled: true, feed: { token: calendarFeedToken(feed.id), createdAt: feed.createdAt.toISOString() } };
  }

  async deleteMyFeed(callerId: string, schoolId: string) {
    await this.prismaApp.withTenantContext(callerId, (tx) => tx.staffCalendarFeed.deleteMany({ where: { schoolId, userId: callerId } }));
    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Public reads: the calendar link and the embed
  // ---------------------------------------------------------------------------

  /** The .ics text for a calendar link, or null (unknown, turned off, or the
   * person is no longer staff there). */
  async calendarFor(token: string): Promise<string | null> {
    if (!isLinkToken(token)) return null;
    const hash = hashCalendarFeedToken(token);
    const [feed] = await this.prismaApp.$queryRaw<Array<{ schoolName: string }>>`SELECT * FROM staff_calendar_feed(${hash})`;
    if (!feed) return null;
    const classes = await this.prismaApp.$queryRaw<FeedClass[]>`SELECT * FROM staff_calendar_feed_classes(${hash})`;
    return buildCalendar(feed.schoolName, classes);
  }

  /** The embed's School and classes, or null. */
  async embedFor(key: string): Promise<{ school: { schoolName: string; timezone: string | null; weekStartsOn: string }; classes: EmbedClass[] } | null> {
    if (!isLinkToken(key)) return null;
    const [school] = await this.prismaApp.$queryRaw<Array<{ schoolName: string; timezone: string | null; weekStartsOn: string }>>`SELECT * FROM schedule_embed(${key})`;
    if (!school) return null;
    const classes = await this.prismaApp.$queryRaw<EmbedClass[]>`SELECT * FROM schedule_embed_classes(${key})`;
    return { school, classes };
  }
}
