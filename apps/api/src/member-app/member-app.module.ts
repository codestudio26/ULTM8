import { Module } from '@nestjs/common';
import { MemberAppController } from './member-app.controller';

/** Decision 318 item 7: member app switches (the read for the student app;
 * each switch is enforced by the feature's own service). */
@Module({
  controllers: [MemberAppController],
})
export class MemberAppModule {}
