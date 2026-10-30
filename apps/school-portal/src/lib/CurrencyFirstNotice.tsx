import { Link } from 'react-router-dom';
import { useT } from '../i18n/I18nProvider';

/** Where the School's currency is set: the School page's currency field. */
export const SCHOOL_CURRENCY_SETTING_PATH = '/school#edit-currency';

/**
 * Decision 414 item 6 — currency first. Until the School has set its currency
 * on the School page, no price can be saved anywhere; every form with a price
 * shows this, with its price fields off, and links to the setting.
 */
export function CurrencyFirstNotice() {
  const t = useT();
  return (
    <div className="ultm8-banner ultm8-banner--warning" role="status" data-testid="currency-first">
      <strong>{t('common.currencyFirst.title')}</strong> {t('common.currencyFirst.body')}{' '}
      <Link to={SCHOOL_CURRENCY_SETTING_PATH}>{t('common.currencyFirst.link')}</Link>
    </div>
  );
}
