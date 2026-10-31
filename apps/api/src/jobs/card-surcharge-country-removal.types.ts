/**
 * Payload of the `card-surcharge-country-removal` queue (Decision 419 item 3):
 * its one producer (CardSurchargeService.removeCountry) and its one consumer
 * (CardSurchargeCountryRemovalProcessor) both import this.
 */
export interface CardSurchargeCountryRemovalJobData {
  /** The country taken off the allow-list (ISO 3166-1 alpha-2, upper case). */
  countryCode: string;
  /** When it was taken off, ISO 8601. A Subscription Stripe created after
   * this is left alone (only possible once the country was added back). */
  removedAt: string;
}
