import { Logger } from '@nestjs/common';
import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Job } from 'bullmq';
import { WAIVER_SIGNATURE_REQUESTS_QUEUE } from './queue.constants';

/**
 * Consumes the `waiver-signature-requests` queue (Phase 10) — Spec 55 §9's
 * confirmed job: "Waiver assigned to a student... waiverSchool status list
 * (Pending/Signed/Unsigned/Expired) and Notification samples ('...has invited you
 * to sign the following waiver')." Enqueued by WaiversService.createWaiver() —
 * "assignment" is read structurally this phase (Waiver.schoolId), so this fires
 * once per Waiver created for a School, not per-Student — see WaiversService's own
 * comment and the Phase 10 kickoff prompt §2.1/§2.3 for the full reasoning trail.
 *
 * Deliberate no-op logger this phase, same precedent Phase 8's own
 * stripe-webhook-processing.processor.ts established for its first version:
 * NotificationsModule doesn't exist yet (Phase 12+, gated behind Booking per the
 * roadmap) — there is no real notification-fanout mechanism to call. Log-and-
 * record rather than build a speculative, untested notification pipeline ahead of
 * anything actually consuming it.
 */
@Processor(WAIVER_SIGNATURE_REQUESTS_QUEUE)
export class WaiverSignatureRequestsProcessor extends WorkerHost {
  private readonly logger = new Logger(WaiverSignatureRequestsProcessor.name);

  async process(job: Job<{ waiverId: string; schoolId: string }>): Promise<void> {
    const { waiverId, schoolId } = job.data;
    // TODO(Phase 12+, once NotificationsModule exists): fan out a real
    // notification to every Student at this School — Spec 55 §9's own sample
    // text: "...has invited you to sign the following waiver".
    this.logger.log(`Waiver ${waiverId} (School ${schoolId}) created — no notification pipeline yet (Phase 10 scope), recorded only.`);
  }
}
