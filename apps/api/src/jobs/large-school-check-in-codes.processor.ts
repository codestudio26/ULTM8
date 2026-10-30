import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectQueue, Processor, WorkerHost } from '@nestjs/bullmq';
import { Job, Queue } from 'bullmq';
import { PrismaJobsService } from '../common/prisma/prisma-jobs.service';
import { enforceLargeSchoolCodes, largeSchoolIds } from '../front-desk/check-in-code';
import { LARGE_SCHOOL_CHECK_IN_CODES_QUEUE } from './queue.constants';

/** Every 15 minutes: a School rarely grows by much more than that between runs,
 * and a code given out in between already checks the School's size itself. */
const CRON_EVERY_15_MINUTES = '*/15 * * * *';
const REPEATABLE_JOB_ID = 'large-school-check-in-codes';

/** Same fixed-jobId / not-awaited / bounded-retry registration as every other
 * scheduler in this directory (see ChargeAutoPayScheduler). */
@Injectable()
export class LargeSchoolCheckInCodesScheduler implements OnModuleInit {
  private readonly logger = new Logger(LargeSchoolCheckInCodesScheduler.name);
  private static readonly REGISTRATION_RETRY_DELAYS_MS = [1_000, 5_000, 15_000, 30_000, 60_000];

  constructor(@InjectQueue(LARGE_SCHOOL_CHECK_IN_CODES_QUEUE) private readonly queue: Queue) {}

  onModuleInit() {
    void this.registerWithRetry();
  }

  private async registerWithRetry(): Promise<void> {
    for (const delayMs of [0, ...LargeSchoolCheckInCodesScheduler.REGISTRATION_RETRY_DELAYS_MS]) {
      if (delayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
      try {
        await this.queue.add('sweep', {}, { repeat: { pattern: CRON_EVERY_15_MINUTES }, jobId: REPEATABLE_JOB_ID });
        return;
      } catch (err) {
        this.logger.warn(`Failed to register the repeatable large-school-check-in-codes job (retrying): ${err}`);
      }
    }
    this.logger.error(
      'Failed to register the repeatable large-school-check-in-codes job after all retries — a School past 500 Students ' +
        'still moves to 6-digit codes the next time a code is given out there, but not on its own.',
    );
  }
}

/**
 * Decision 417 (stress test round 4 Q1): a School with more than 500 current
 * Students moves to 6-digit check-in codes, and its shorter member and staff
 * codes are replaced (the member's Student page and the staff's own code
 * screen show the new ones). Runs as ultm8_jobs: a cross-School sweep with no caller.
 */
@Processor(LARGE_SCHOOL_CHECK_IN_CODES_QUEUE)
export class LargeSchoolCheckInCodesProcessor extends WorkerHost {
  private readonly logger = new Logger(LargeSchoolCheckInCodesProcessor.name);

  constructor(private readonly prismaJobs: PrismaJobsService) {
    super();
  }

  async process(_job: Job): Promise<{ schools: number; replaced: number }> {
    let replaced = 0;
    const schoolIds = await largeSchoolIds(this.prismaJobs);
    for (const schoolId of schoolIds) {
      try {
        replaced += (await enforceLargeSchoolCodes(this.prismaJobs, schoolId)).replaced;
      } catch (err) {
        this.logger.error(`large-school-check-in-codes: School ${schoolId} failed: ${err}`);
      }
    }
    if (replaced > 0) this.logger.log(`large-school-check-in-codes: ${replaced} code(s) replaced across ${schoolIds.length} large School(s).`);
    return { schools: schoolIds.length, replaced };
  }
}
