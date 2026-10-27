import type { TranslationKey } from '../i18n/I18nProvider';

/** Catalogue keys for API enum values shown as text. A value missing here (one
 * the API adds later) is shown as sent. */
export const PAYMENT_METHOD_LABELS: Record<string, TranslationKey> = {
  STRIPE: 'lib.paymentMethod.stripe',
  CASH: 'lib.paymentMethod.cash',
  BANK_TRANSFER: 'lib.paymentMethod.bankTransfer',
  PIX: 'lib.paymentMethod.pix',
  CARD_TERMINAL: 'lib.paymentMethod.cardTerminal',
};

export const ROLE_LABELS: Record<string, TranslationKey> = {
  STUDENT: 'lib.roles.student',
  SCHOOL_OWNER_MANAGER: 'lib.roles.schoolOwnerManager',
  BRANCH_STAFF: 'lib.roles.branchStaff',
  INSTRUCTOR: 'lib.roles.instructor',
  FRANCHISE_OWNER: 'lib.roles.franchiseOwner',
  GUARDIAN: 'lib.roles.guardian',
};
