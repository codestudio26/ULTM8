/**
 * Decision 407 — `metadata.purpose` on the setup-mode Checkout Session a School
 * Owner opens to save the franchise-fee card (FranchiseFeesService.
 * createCardSetupSession). The checkout.session.completed handler tells it
 * apart from a Student saving their own card (Decision 238) by this value.
 */
export const FRANCHISE_FEE_CARD_PURPOSE = 'FRANCHISE_FEE_CARD';
