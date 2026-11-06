import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, ErrorBanner, Field, Modal, SelectField, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useT } from '../i18n/I18nProvider';
import { localCountryNames } from '../lib/countryNames';
import { guessDefaultCountry } from '../lib/phoneCountry';
import { STRIPE_CONNECT_RETURN_KEY } from '../franchises/franchiseQueries';
import { useConnectSchoolStripe, useSchoolConnectStatus, useSchoolPaymentAccount } from './stripeConnectQueries';

/** Where the School page's Stripe card is; the setup checklist links here. */
export const STRIPE_CONNECT_ANCHOR = 'stripe-connect';

/**
 * Decision 441 item 6 — the School owner connects the School's Stripe account
 * through Stripe's own onboarding, instead of ULTM8 support doing it (the
 * existing payment-account endpoints, as the Franchise page does, Decision
 * 407). Shows Connected (Stripe has confirmed the account is ready), Action
 * needed (onboarding started but not finished, or Stripe wants more details)
 * or Not connected. The first time, the owner picks the country of the
 * business's bank account: Stripe needs it and it can't be changed later.
 *
 * Decision 437: where Stripe can't onboard the School, the button is hidden
 * and the card says members pay by cash or bank transfer. A School whose
 * payment account is for cash or bank transfer can't connect Stripe here.
 * Stripe's return and refresh links come back to this card
 * (StripeConnectReturnPage), which reads the status again.
 */
export function StripeConnectCard({ schoolId, schoolName, defaultCountry }: { schoolId: string; schoolName: string; defaultCountry: string | null }) {
  const t = useT();
  const { data, isLoading, error: statusError } = useSchoolConnectStatus(schoolId);
  const { data: paymentAccount, isLoading: accountLoading } = useSchoolPaymentAccount(schoolId);
  const connect = useConnectSchoolStripe(schoolId);
  const [askingCountry, setAskingCountry] = useState(false);
  const [country, setCountry] = useState(defaultCountry ?? guessDefaultCountry() ?? '');
  const [error, setError] = useState<string | null>(null);
  const allowed = data?.connectCountries;
  const countries = useMemo(() => {
    const all = localCountryNames();
    return allowed ? all.filter((c) => allowed.includes(c.value)) : all;
  }, [allowed]);
  const stripeAccountId = paymentAccount?.provider === 'STRIPE' ? paymentAccount.id : null;
  const otherProvider = !!paymentAccount && !stripeAccountId;
  const connectAvailable = data?.connectAvailable !== false;
  const canConnect = connectAvailable && !otherProvider;

  async function start(chosenCountry: string) {
    setError(null);
    try {
      const url = await connect.mutateAsync({ paymentAccountId: stripeAccountId, accountTitle: schoolName, country: chosenCountry });
      try {
        sessionStorage.setItem(STRIPE_CONNECT_RETURN_KEY, `/school#${STRIPE_CONNECT_ANCHOR}`);
      } catch {
        // No storage: Stripe's return lands on the default page instead.
      }
      window.location.assign(url);
    } catch (err) {
      setAskingCountry(false);
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  const status = data?.status;
  const hint =
    status === 'CONNECTED'
      ? t('schools.stripeConnect.connectedHint')
      : !connectAvailable
        ? t('schools.stripeConnect.unavailableHint')
        : otherProvider
          ? t('schools.stripeConnect.otherProviderHint')
          : status === 'ACTION_NEEDED'
            ? t('schools.stripeConnect.actionNeededHint')
            : t('schools.stripeConnect.notConnectedHint');
  return (
    <div id={STRIPE_CONNECT_ANCHOR} data-testid="school-stripe-connect">
      <Card>
        <h2 style={{ fontSize: 18, margin: '0 0 8px' }}>{t('schools.stripeConnect.title')}</h2>
        {error ? <ErrorBanner message={error} /> : null}
        {isLoading || accountLoading ? (
          <Spinner />
        ) : statusError ? (
          <ErrorBanner message={statusError instanceof ApiError ? statusError.message : t('schools.stripeConnect.statusLoadFailed')} />
        ) : status ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
            <span data-testid="school-stripe-connect-status">
              {status === 'CONNECTED' ? (
                <Badge variant="success">{t('schools.stripeConnect.connected')}</Badge>
              ) : status === 'ACTION_NEEDED' ? (
                <Badge variant="warning">{t('schools.stripeConnect.actionNeeded')}</Badge>
              ) : (
                <Badge>{t('schools.stripeConnect.notConnected')}</Badge>
              )}
            </span>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, margin: 0 }} data-testid="school-stripe-connect-hint">
              {hint}
            </p>
            {status !== 'CONNECTED' && canConnect ? (
              <Button
                type="button"
                onClick={() => {
                  if (stripeAccountId) {
                    void start('');
                    return;
                  }
                  if (allowed && !allowed.includes(country)) setCountry('');
                  setAskingCountry(true);
                }}
                loading={connect.isPending}
              >
                {status === 'ACTION_NEEDED' ? t('schools.stripeConnect.continue') : t('schools.stripeConnect.connect')}
              </Button>
            ) : null}
          </div>
        ) : null}
      </Card>
      {askingCountry ? (
        <Modal title={t('schools.stripeConnect.countryTitle')} onClose={() => setAskingCountry(false)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void start(country);
            }}
          >
            <Field label={t('schools.stripeConnect.countryLabel')} htmlFor="school-stripe-connect-country" hint={t('schools.stripeConnect.countryHint')}>
              <SelectField
                id="school-stripe-connect-country"
                required
                value={country}
                onChange={(e) => setCountry(e.target.value)}
                options={[{ value: '', label: t('schools.stripeConnect.chooseCountry') }, ...countries]}
              />
            </Field>
            <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
              <Button type="submit" loading={connect.isPending} disabled={!country}>
                {t('schools.stripeConnect.goToStripe')}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setAskingCountry(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          </form>
        </Modal>
      ) : null}
    </div>
  );
}
