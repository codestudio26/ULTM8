import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiOkResponse, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaAppService } from '../common/prisma/prisma-app.service';
import { NOTIFICATION_FANOUT_QUEUE } from '../jobs/queue.constants';

const CHECK_TIMEOUT_MS = 3000;

function withTimeout<T>(p: Promise<T>): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), CHECK_TIMEOUT_MS)),
  ]);
}

/**
 * GET /v1/health — the hosting platform's health check (render.yaml
 * healthCheckPath). Public and unthrottled, and it reveals nothing beyond
 * "ok"/"down" per dependency: no versions, hosts or error text.
 *
 * The DB check runs `SELECT 1` as ultm8_app, so it also proves the scoped
 * role's password works, not just that Postgres is up. Redis is pinged through
 * the BullMQ client the job queues use (a queue length read).
 */
@ApiTags('health')
@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaAppService,
    @InjectQueue(NOTIFICATION_FANOUT_QUEUE) private readonly queue: Queue,
  ) {}

  @Get()
  @HttpCode(200)
  @ApiOkResponse({ description: 'Database and Redis are reachable.' })
  async check() {
    const [db, redis] = await Promise.all([
      withTimeout(this.prisma.$queryRaw`SELECT 1`).then(() => 'ok' as const, () => 'down' as const),
      withTimeout(this.queue.count()).then(() => 'ok' as const, () => 'down' as const),
    ]);
    const body = { status: db === 'ok' && redis === 'ok' ? 'ok' : 'down', db, redis };
    if (body.status !== 'ok') throw new ServiceUnavailableException(body);
    return body;
  }
}
