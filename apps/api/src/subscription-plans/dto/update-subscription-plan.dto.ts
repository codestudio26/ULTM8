import { PartialType } from '@nestjs/swagger';
import { CreateSubscriptionPlanDto } from './create-subscription-plan.dto';

/** PATCH /platform-admin/subscription-plans/:id body — every field optional, same
 * partial-update shape every other Update DTO in this codebase uses. `description`
 * has no explicit-null "clear" case the way e.g. UpdateFranchiseDto's optional
 * fields do — same reasoning UpdateTranslationDto's own header comment gives:
 * a reasonable-minimum scope call for a Platform-Admin-only authoring form, not a
 * confirmed requirement either way. Already-subscribed Franchises/Schools are
 * unaffected by an edit here — their own `subscriptionPlanId` FK just keeps pointing
 * at this same row; only future subscribers see the new price/description/features. */
export class UpdateSubscriptionPlanDto extends PartialType(CreateSubscriptionPlanDto) {}
