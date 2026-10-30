import React, { useState } from 'react';
import { ActivityIndicator, ScrollView, Switch, Text, View } from 'react-native';
import * as WebBrowser from 'expo-web-browser';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { Button, ErrorBanner, InlineError } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatMoney } from '../lib/formatMoney';
import { formatLocale } from '../i18n/format';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { StepUpPrompt } from '../auth/StepUpPrompt';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';
import {
  useInvalidateMemberCharges,
  useMemberCharges,
  useMemberRecurringCharges,
  useSetChargeAutoPay,
  useStartChargeCheckout,
  type Charge,
  type ChargeBalance,
  type ChargePayment,
  type MemberRecurringCharge,
  type MemberChargeSchool,
} from './chargeQueries';
import { RecurringChargesList } from './RecurringChargesList';

type Props = NativeStackScreenProps<AppStackParamList, 'MyCharges'>;
type T = ReturnType<typeof useT>;
type PayInApp = MemberChargeSchool['payInApp'];

/** A YYYY-MM-DD day, or the day of a timestamp, in the reader's language. */
function formatDay(dayOrIso: string): string {
  const day = dayOrIso.slice(0, 10);
  try {
    return new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day}T00:00:00.000Z`));
  } catch {
    return day;
  }
}

const rate = (bp: number) => String(bp / 100);
const Muted = ({ children }: { children: React.ReactNode }) => <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;

/** One Checkout at a time on this screen: which button started it. */
type Paying = { key: string; error: unknown | null; done: boolean };

/**
 * The member's invoices and receipts (v1.3 backlog §3.6; Decisions 303, 338):
 * the balance at the top, then each charge with its invoice number, price ex.
 * tax, tax and price inc. tax, its due date and status (cancelled ones greyed
 * out below, "Nothing to pay"), and a receipt for each payment. A Guardian
 * opens the same screen for a child.
 *
 * Step 2 (Decision 303 item 4, Decision 338 item 8): "Pay balance" at the top
 * and "Pay" on each open charge open a hosted Stripe Checkout in the browser,
 * as buying a membership does (Decision 243), with the School's card
 * surcharge shown first (Decision 406). The payment is confirmed by Stripe's
 * webhook, so the list is re-read when the browser closes and the payment
 * may show as "Payment processing" for a moment. The member (never a
 * Guardian for a child, who has no saved card) can turn on "Pay charges
 * automatically with my saved card", confirmed with their passcode.
 *
 * Step 3 (Decision 412): the recurring charges the School set up, read-only
 * (what, how much each time, how often, the next invoice date).
 */
export function MyChargesScreen({ route }: Props) {
  const { claims } = useAuth();
  const t = useT();
  const studentId = route.params?.studentId ?? claims?.sub ?? null;
  const forChild = !!route.params?.studentId;
  const charges = useMemberCharges(studentId);
  const recurring = useMemberRecurringCharges(studentId);
  const checkout = useStartChargeCheckout();
  const invalidate = useInvalidateMemberCharges();
  const [paying, setPaying] = useState<Paying | null>(null);

  if (charges.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (charges.error) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(charges.error, t('charges.loadFailed'))} />
      </View>
    );
  }
  const schools = charges.data?.schools ?? [];
  const recurringItems = recurring.data?.items ?? [];
  // A School whose recurring charge has made no invoice yet isn't in the charges list.
  const recurringOnly = [...new Set(recurringItems.map((r) => r.schoolId))].filter((id) => !schools.some((s) => s.schoolId === id));

  function pay(key: string, schoolId: string, target: { chargeId?: string; currency?: string }) {
    if (!studentId || checkout.isPending) return;
    setPaying({ key, error: null, done: false });
    checkout.mutate(
      { studentId, schoolId, ...target },
      {
        onSuccess: async (result) => {
          try {
            await WebBrowser.openAuthSessionAsync(result.checkoutUrl, 'ultm8-student://charge-payment/complete');
          } finally {
            setPaying({ key, error: null, done: true });
            invalidate();
          }
        },
        onError: (error) => setPaying({ key, error, done: false }),
      },
    );
  }

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {schools.length === 0 && recurringOnly.length === 0 ? <Muted>{t('charges.empty')}</Muted> : null}
      {schools.map((s) => (
        <SchoolCharges
          key={s.schoolId}
          school={s}
          studentId={studentId}
          forChild={forChild}
          showName={schools.length > 1}
          paying={paying}
          busy={checkout.isPending}
          onPay={pay}
          recurring={recurringItems.filter((r) => r.schoolId === s.schoolId)}
        />
      ))}
      {recurringOnly.map((schoolId) => {
        const items = recurringItems.filter((r) => r.schoolId === schoolId);
        return (
          <View key={schoolId} style={{ marginBottom: spacing[6] }}>
            {schools.length + recurringOnly.length > 1 ? (
              <Text style={{ fontSize: fontSize.headingSm, fontWeight: '700', marginBottom: spacing[2] }}>{items[0].schoolName}</Text>
            ) : null}
            <RecurringChargesList items={items} />
          </View>
        );
      })}
    </ScrollView>
  );
}

type PayFn = (key: string, schoolId: string, target: { chargeId?: string; currency?: string }) => void;

function SchoolCharges({
  school,
  studentId,
  forChild,
  showName,
  paying,
  busy,
  onPay,
  recurring,
}: {
  school: MemberChargeSchool;
  studentId: string | null;
  forChild: boolean;
  showName: boolean;
  paying: Paying | null;
  busy: boolean;
  onPay: PayFn;
  recurring: MemberRecurringCharge[];
}) {
  const t = useT();
  const owed = school.charges.filter((c) => c.status !== 'CANCELLED');
  const cancelled = school.charges.filter((c) => c.status === 'CANCELLED');
  return (
    <View style={{ marginBottom: spacing[6] }}>
      {showName ? <Text style={{ fontSize: fontSize.headingSm, fontWeight: '700', marginBottom: spacing[2] }}>{school.schoolName}</Text> : null}
      <Balance school={school} forChild={forChild} paying={paying} busy={busy} onPay={onPay} />
      {studentId && !forChild ? <AutoPay school={school} studentId={studentId} /> : null}
      {school.taxId ? <Muted>{t('charges.taxId', { taxId: school.taxId })}</Muted> : null}
      {school.receiptAddress ? <Muted>{t('charges.address', { address: school.receiptAddress })}</Muted> : null}
      {school.receiptPaymentInstructions ? <Muted>{t('charges.paymentInstructions', { instructions: school.receiptPaymentInstructions })}</Muted> : null}
      {school.charges.length > 0 ? <Text style={{ fontWeight: '700', marginTop: spacing[4], marginBottom: spacing[2] }}>{t('charges.invoicesHeading')}</Text> : null}
      {[...owed, ...cancelled].map((c) => (
        <ChargeRow key={c.id} charge={c} payInApp={school.payInApp} paying={paying} busy={busy} onPay={() => onPay(`charge-${c.id}`, school.schoolId, { chargeId: c.id })} />
      ))}
      <RecurringChargesList items={recurring} />
      {school.payments.length > 0 ? <Text style={{ fontWeight: '700', marginTop: spacing[4], marginBottom: spacing[2] }}>{t('charges.receiptsHeading')}</Text> : null}
      {school.payments.map((p) => (
        <ReceiptRow key={p.id} payment={p} />
      ))}
      {school.credits.map((c) => (
        <View key={c.id} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
          <Text style={{ fontWeight: '600' }}>{t('charges.creditGiven', { amount: formatMoney(c.amount, c.currency), date: formatDay(c.givenAt) })}</Text>
        </View>
      ))}
    </View>
  );
}

/** What happened to the Checkout this button started. */
function PayStatus({ paying, payKey }: { paying: Paying | null; payKey: string }) {
  const t = useT();
  if (!paying || paying.key !== payKey) return null;
  if (paying.error) return <InlineError message={getApiErrorMessage(paying.error, t('charges.pay.failed'))} />;
  if (paying.done) return <Muted>{t('charges.pay.submitted')}</Muted>;
  return null;
}

function Balance({ school, forChild, paying, busy, onPay }: { school: MemberChargeSchool; forChild: boolean; paying: Paying | null; busy: boolean; onPay: PayFn }) {
  const t = useT();
  const shown = school.balances.filter((b) => b.net !== 0);
  const payable = school.balances.filter((b) => b.payableAmount > 0);
  return (
    <View testID="charges-balance" style={{ backgroundColor: theme.surface1, borderRadius: radius.input, padding: spacing[4], borderWidth: 1, borderColor: theme.border }}>
      {shown.length === 0 ? <Text style={{ fontSize: fontSize.headingSm, fontWeight: '700' }}>{t('charges.nothingToPay')}</Text> : null}
      {shown.map((b) => (
        <View key={b.currency}>
          <Text style={{ fontSize: fontSize.headingSm, fontWeight: '700' }}>
            {b.net > 0
              ? t(forChild ? 'charges.childOwes' : 'charges.owes', { amount: formatMoney(b.net, b.currency) })
              : t('charges.inCredit', { amount: formatMoney(-b.net, b.currency) })}
          </Text>
          {b.overdue > 0 ? <Text style={{ color: theme.textDanger, fontWeight: '600' }}>{t('charges.overdue', { amount: formatMoney(b.overdue, b.currency) })}</Text> : null}
        </View>
      ))}
      {payable.length > 0 && school.payInApp.available
        ? payable.map((b) => <PayBalance key={b.currency} balance={b} schoolId={school.schoolId} paying={paying} busy={busy} onPay={onPay} />)
        : null}
      {payable.length > 0 && !school.payInApp.available ? (
        <Muted>{school.payInApp.blockedReason === 'RESTRICTED' ? t('charges.pay.restricted') : t('charges.payAtDesk')}</Muted>
      ) : null}
    </View>
  );
}

function PayBalance({ balance: b, schoolId, paying, busy, onPay }: { balance: ChargeBalance; schoolId: string; paying: Paying | null; busy: boolean; onPay: PayFn }) {
  const t = useT();
  const key = `balance-${schoolId}-${b.currency}`;
  return (
    <View style={{ marginTop: spacing[3] }}>
      <SurchargeLine amount={b.cardSurchargeAmount} currency={b.currency} />
      <Button
        title={t('charges.pay.balance', { amount: formatMoney(b.payableAmount + b.cardSurchargeAmount, b.currency) })}
        onPress={() => onPay(key, schoolId, { currency: b.currency })}
        loading={busy && paying?.key === key}
        disabled={busy}
      />
      <PayStatus paying={paying} payKey={key} />
    </View>
  );
}

/** Decision 406: the card surcharge, its own line, before paying. */
function SurchargeLine({ amount, currency }: { amount: number; currency: string }) {
  const t = useT();
  if (amount <= 0) return null;
  return <Muted>{t('charges.pay.surcharge', { amount: formatMoney(amount, currency) })}</Muted>;
}

/** "Pay charges automatically with my saved card" (Decision 338 item 8). */
function AutoPay({ school, studentId }: { school: MemberChargeSchool; studentId: string }) {
  const t = useT();
  const setAutoPay = useSetChargeAutoPay();
  const [steppingUp, setSteppingUp] = useState(false);
  const p = school.payInApp;
  if (!p.available) return null;
  if (!p.savedCard) {
    return (
      <View style={{ marginTop: spacing[3] }}>
        <Muted>{t('charges.autoPay.noCard')}</Muted>
      </View>
    );
  }

  function toggle(on: boolean) {
    if (setAutoPay.isPending) return;
    if (on) {
      setSteppingUp(true);
      return;
    }
    setAutoPay.mutate({ studentId, schoolId: school.schoolId, enabled: false });
  }

  return (
    <View style={{ marginTop: spacing[3] }} testID={`auto-pay-${school.schoolId}`}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <Text style={{ flex: 1, marginRight: spacing[2], fontWeight: '600' }}>{t('charges.autoPay.label')}</Text>
        <Switch value={p.autoPay} onValueChange={toggle} disabled={!p.canSetAutoPay || setAutoPay.isPending} accessibilityLabel={t('charges.autoPay.label')} />
      </View>
      <Muted>{t(p.autoPay ? 'charges.autoPay.onHint' : 'charges.autoPay.offHint')}</Muted>
      {setAutoPay.isError ? <InlineError message={getApiErrorMessage(setAutoPay.error, t('charges.autoPay.failed'))} /> : null}
      {steppingUp ? (
        <StepUpPrompt
          onCancel={() => setSteppingUp(false)}
          onVerified={(stepUpToken) => {
            setSteppingUp(false);
            setAutoPay.mutate({ studentId, schoolId: school.schoolId, enabled: true, stepUpToken });
          }}
        />
      ) : null}
    </View>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
      <Text style={{ color: theme.textSecondary, fontWeight: strong ? '700' : '400' }}>{label}</Text>
      <Text style={{ fontWeight: strong ? '700' : '400' }}>{value}</Text>
    </View>
  );
}

function ChargeRow({ charge: c, payInApp, paying, busy, onPay }: { charge: Charge; payInApp: PayInApp; paying: Paying | null; busy: boolean; onPay: () => void }) {
  const t = useT();
  const cancelled = c.status === 'CANCELLED';
  const statusColor = cancelled ? theme.textMuted : c.status === 'PAID' ? theme.textSuccess : c.overdue ? theme.textDanger : theme.textWarning;
  // Step 4 (Decision 338 item 3): a refunded charge says so.
  const statusKey = (c.refundStatus && !cancelled ? `charges.refundStatus.${c.refundStatus}` : `charges.status.${c.status}`) as TranslationKey;
  const key = `charge-${c.id}`;
  return (
    <View testID={`charge-${c.id}`} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border, opacity: cancelled ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '600', flex: 1, marginRight: spacing[2] }}>
          {c.lateFee ? t('charges.lateFee.label') : c.promotionFee ? t('charges.promotionFee.label') : c.description}
        </Text>
        <Text style={{ color: statusColor, fontWeight: '600' }}>{t(statusKey)}</Text>
      </View>
      <LateFeeFor charge={c} />
      {/* Backlog 3.6 step 6: an accepted promotion fee, with the grade and style it is for. */}
      {c.promotionFee ? <Muted>{t('charges.promotionFee.forRank', { rank: c.promotionFee.toRungName, style: c.promotionFee.disciplineName })}</Muted> : null}
      <Muted>
        {t('charges.invoice', { invoice: c.invoiceLabel })} · {t('charges.due', { date: formatDay(c.dueDate) })}
      </Muted>
      {c.discountAmount > 0 ? <Line label={t('charges.discount')} value={`− ${formatMoney(c.discountAmount, c.currency)}`} /> : null}
      <Line label={t('charges.exTax')} value={formatMoney(c.netAmount, c.currency)} />
      <Line label={t('charges.tax', { rate: rate(c.taxRateBasisPoints) })} value={formatMoney(c.taxAmount, c.currency)} />
      <Line label={t('charges.incTax')} value={formatMoney(c.grossAmount, c.currency)} strong />
      {cancelled ? (
        <Muted>{t(c.lateFee?.waived ? 'charges.lateFee.waivedOn' : 'charges.cancelledOn', { date: formatDay(c.cancelledAt ?? c.createdAt) })}</Muted>
      ) : (
        <>
          {c.refundedAmount > 0 ? <Line label={t('charges.refunded')} value={`− ${formatMoney(c.refundedAmount, c.currency)}`} /> : null}
          {c.paidAmount > 0 ? <Line label={t('charges.paid')} value={formatMoney(c.paidAmount, c.currency)} /> : null}
          {c.owedAmount > 0 ? <Line label={t('charges.stillOwed')} value={formatMoney(c.owedAmount, c.currency)} strong /> : null}
          {c.owedAmount > 0 && payInApp.available ? (
            <View style={{ marginTop: spacing[2] }}>
              <SurchargeLine amount={c.cardSurchargeAmount} currency={c.currency} />
              <Button
                title={t('charges.pay.charge', { amount: formatMoney(c.owedAmount + c.cardSurchargeAmount, c.currency) })}
                variant="secondary"
                onPress={onPay}
                loading={busy && paying?.key === key}
                disabled={busy}
              />
              <PayStatus paying={paying} payKey={key} />
            </View>
          ) : null}
        </>
      )}
    </View>
  );
}

/** Decision 413: a late fee says what it is for (its stored description is
 * the API's English, so the app writes its own line). */
function LateFeeFor({ charge: c }: { charge: Charge }) {
  const t = useT();
  const f = c.lateFee;
  if (!f) return null;
  return (
    <Muted>
      {f.forType === 'CHARGE'
        ? t('charges.lateFee.forInvoice', { invoice: f.forInvoiceLabel ?? '', description: f.forDescription ?? '', date: formatDay(f.forDueDate) })
        : t('charges.lateFee.forRenewal', { plan: f.forPlanTitle ?? '', amount: formatMoney(f.overdueAmount, f.overdueCurrency), date: formatDay(f.forDueDate) })}
    </Muted>
  );
}

function methodLabel(t: T, p: ChargePayment): string {
  if (p.channel === 'APP') return t('charges.method.app');
  if (p.channel === 'AUTOMATIC') return t('charges.method.automatic');
  const key = `charges.method.${p.paymentMethod}` as TranslationKey;
  const text = t(key);
  return text === key ? p.paymentMethod : text;
}

function ReceiptRow({ payment: p }: { payment: ChargePayment }) {
  const t = useT();
  if (p.status === 'PENDING' || p.status === 'FAILED') {
    const failed = p.status === 'FAILED';
    return (
      <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
        <Text style={{ fontWeight: '600', color: failed ? theme.textDanger : theme.textWarning }}>
          {t(failed ? 'charges.pay.autoFailed' : 'charges.pay.processing', { amount: formatMoney(p.amount + p.surchargeAmount, p.currency), date: formatDay(p.receivedAt) })}
        </Text>
        {p.invoiceLabel ? <Muted>{t('charges.toward', { invoices: p.invoiceLabel })}</Muted> : null}
      </View>
    );
  }
  return (
    <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontWeight: '600' }}>{t('charges.receipt', { amount: formatMoney(p.amount + p.surchargeAmount, p.currency), date: formatDay(p.receivedAt), method: methodLabel(t, p) })}</Text>
      {p.surchargeAmount > 0 ? <Muted>{t('charges.receiptSurcharge', { amount: formatMoney(p.surchargeAmount, p.currency) })}</Muted> : null}
      {p.allocations.length > 0 ? <Muted>{t('charges.toward', { invoices: p.allocations.map((a) => a.invoiceLabel).join(', ') })}</Muted> : null}
      {p.creditAmount > 0 ? <Muted>{t('charges.toCredit', { amount: formatMoney(p.creditAmount, p.currency) })}</Muted> : null}
      {p.refundStatus ? <Text style={{ fontWeight: '600', color: theme.textSecondary }}>{t(`charges.refundStatus.${p.refundStatus}` as TranslationKey)}</Text> : null}
      {p.refunds.map((r) => (
        <Muted key={r.id}>{t(`charges.refund.${r.kind}` as TranslationKey, { amount: formatMoney(r.amount, p.currency), date: formatDay(r.refundedAt) })}</Muted>
      ))}
    </View>
  );
}
