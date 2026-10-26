import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import { Button, ErrorBanner, Screen } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { theme, spacing, fontSize, fontWeight } from '../theme/tokens';
import { useEnrolledSchoolIds } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import { useEnrolledSchoolNames } from '../waivers/waiverQueries';
import { useCreateSetupSession, useDeletePaymentMethod, usePaymentMethodsForSchools } from './paymentMethodQueries';

/**
 * Decision 234's own saved-payment-method dependency. Off Home, alongside
 * Waivers/My Memberships — grouped by School, same reasoning WaiversScreen's
 * own header comment gives: a multi-School Student has one saved card per
 * School (a Stripe Customer lives inside exactly one connected account,
 * StudentPaymentMethod's own schema.prisma comment), not one merged value.
 *
 * Card collection is a HOSTED Stripe Checkout Session (mode: 'setup'), opened
 * in the device's own browser via `WebBrowser.openAuthSessionAsync` — this
 * app has no Stripe SDK dependency and is plain Expo-managed with no custom
 * native dev client (Decision 113), so an embedded Stripe Elements/card-field
 * integration isn't buildable here; PaymentsService.createSetupSession's own
 * header comment has the full account. `openAuthSessionAsync` auto-closes the
 * browser once Stripe redirects back to this app's own `ultm8-student://`
 * scheme (app.json), the standard Expo pattern for a hosted OAuth-shaped flow.
 *
 * FLAGGED, not fully closed: the real confirmation is the `checkout.session.
 * completed` webhook (StripeWebhookProcessingProcessor), which can land a
 * moment after the browser closes — the single refetch below right after the
 * browser session ends may occasionally still show the old status for a few
 * seconds. Revisiting this screen (or a manual pull-to-refresh, if one is
 * added later) always shows the settled state; no infinite-poll/retry loop
 * was added for this narrow, self-resolving window.
 */
export function PaymentMethodsScreen() {
  const t = useT();
  const schoolIds = useEnrolledSchoolIds();
  const schoolNames = useEnrolledSchoolNames(schoolIds);
  const results = usePaymentMethodsForSchools(schoolIds);

  if (schoolIds.length === 0) {
    return (
      <Screen>
        <Text style={{ color: theme.textSecondary }}>{t('payments.methods.notEnrolled')}</Text>
      </Screen>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {schoolIds.map((schoolId, i) => (
        <SchoolPaymentMethodRow
          key={schoolId}
          schoolId={schoolId}
          schoolName={schoolNames.get(schoolId) ?? schoolId}
          result={results[i]}
        />
      ))}
    </ScrollView>
  );
}

function SchoolPaymentMethodRow({
  schoolId,
  schoolName,
  result,
}: {
  schoolId: string;
  schoolName: string;
  result: { data?: { hasSavedPaymentMethod: boolean; brand?: string; last4?: string }; isLoading: boolean; error: unknown; refetch: () => void };
}) {
  const t = useT();
  const createSetupSession = useCreateSetupSession(schoolId);
  const deletePaymentMethod = useDeletePaymentMethod(schoolId);
  const [error, setError] = useState<string | null>(null);

  async function handleAddOrUpdate() {
    setError(null);
    try {
      const { checkoutUrl } = await createSetupSession.mutateAsync();
      await WebBrowser.openAuthSessionAsync(checkoutUrl, 'ultm8-student://payment-methods/complete');
      result.refetch();
    } catch (err) {
      setError(getApiErrorMessage(err, t('payments.methods.setupFailed')));
    }
  }

  async function handleRemove() {
    setError(null);
    try {
      await deletePaymentMethod.mutateAsync();
    } catch (err) {
      setError(getApiErrorMessage(err, t('payments.methods.removeFailed')));
    }
  }

  return (
    <View style={{ marginBottom: spacing[4], paddingBottom: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontSize: fontSize.body, fontWeight: fontWeight.emphasis, color: theme.textPrimary }}>{schoolName}</Text>
      {error ? <ErrorBanner message={error} /> : null}
      {result.isLoading ? (
        <ActivityIndicator style={{ marginTop: spacing[2] }} />
      ) : result.error ? (
        <ErrorBanner message={getApiErrorMessage(result.error, t('payments.methods.loadFailed'))} />
      ) : (
        <>
          <Text style={{ color: theme.textSecondary, marginTop: spacing[1], marginBottom: spacing[2] }}>
            {result.data?.hasSavedPaymentMethod
              ? result.data.brand && result.data.last4
                ? t('payments.methods.cardSummary', { brand: result.data.brand.toUpperCase(), last4: result.data.last4 })
                : t('payments.methods.cardSaved')
              : t('payments.methods.noCard')}
          </Text>
          <View style={{ flexDirection: 'row', gap: spacing[2] }}>
            <Button
              title={result.data?.hasSavedPaymentMethod ? t('payments.methods.updateCard') : t('payments.methods.addCard')}
              variant="secondary"
              onPress={handleAddOrUpdate}
              loading={createSetupSession.isPending}
            />
            {result.data?.hasSavedPaymentMethod ? (
              <Button title={t('payments.methods.remove')} variant="destructive" onPress={handleRemove} loading={deletePaymentMethod.isPending} />
            ) : null}
          </View>
        </>
      )}
    </View>
  );
}
