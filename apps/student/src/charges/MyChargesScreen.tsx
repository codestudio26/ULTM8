import React from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import { ErrorBanner } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatMoney } from '../lib/formatMoney';
import { formatLocale } from '../i18n/format';
import { theme, spacing, fontSize, radius } from '../theme/tokens';
import type { AppStackParamList } from '../navigation/types';
import { useAuth } from '../auth/AuthContext';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';
import { useMemberCharges, type Charge, type ChargeBalance, type ChargePayment, type MemberChargeSchool } from './chargeQueries';

type Props = NativeStackScreenProps<AppStackParamList, 'MyCharges'>;
type T = ReturnType<typeof useT>;

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

/**
 * The member's invoices and receipts (v1.3 backlog §3.6, step 1; Decisions
 * 303, 338): the balance at the top, then each charge with its invoice
 * number, price ex. tax, tax and price inc. tax, its due date and status
 * (cancelled ones greyed out below, "Nothing to pay"), and a receipt for each
 * payment taken at the desk. A Guardian opens the same screen for a child.
 * Read-only: paying in the app is a later step.
 */
export function MyChargesScreen({ route }: Props) {
  const { claims } = useAuth();
  const t = useT();
  const studentId = route.params?.studentId ?? claims?.sub ?? null;
  const forChild = !!route.params?.studentId;
  const charges = useMemberCharges(studentId);

  if (charges.isLoading) return <ActivityIndicator style={{ marginTop: spacing[6] }} />;
  if (charges.error) {
    return (
      <View style={{ padding: spacing[4] }}>
        <ErrorBanner message={getApiErrorMessage(charges.error, t('charges.loadFailed'))} />
      </View>
    );
  }
  const schools = charges.data?.schools ?? [];

  return (
    <ScrollView style={{ backgroundColor: theme.surface0 }} contentContainerStyle={{ padding: spacing[4] + spacing[1] }}>
      {schools.length === 0 ? <Muted>{t('charges.empty')}</Muted> : null}
      {schools.map((s) => (
        <SchoolCharges key={s.schoolId} school={s} forChild={forChild} showName={schools.length > 1} />
      ))}
    </ScrollView>
  );
}

function SchoolCharges({ school, forChild, showName }: { school: MemberChargeSchool; forChild: boolean; showName: boolean }) {
  const t = useT();
  const owed = school.charges.filter((c) => c.status !== 'CANCELLED');
  const cancelled = school.charges.filter((c) => c.status === 'CANCELLED');
  return (
    <View style={{ marginBottom: spacing[6] }}>
      {showName ? <Text style={{ fontSize: fontSize.headingSm, fontWeight: '700', marginBottom: spacing[2] }}>{school.schoolName}</Text> : null}
      <Balance balances={school.balances} forChild={forChild} />
      {school.taxId ? <Muted>{t('charges.taxId', { taxId: school.taxId })}</Muted> : null}
      {school.charges.length > 0 ? <Text style={{ fontWeight: '700', marginTop: spacing[4], marginBottom: spacing[2] }}>{t('charges.invoicesHeading')}</Text> : null}
      {[...owed, ...cancelled].map((c) => (
        <ChargeRow key={c.id} charge={c} />
      ))}
      {school.payments.length > 0 ? <Text style={{ fontWeight: '700', marginTop: spacing[4], marginBottom: spacing[2] }}>{t('charges.receiptsHeading')}</Text> : null}
      {school.payments.map((p) => (
        <ReceiptRow key={p.id} payment={p} />
      ))}
    </View>
  );
}

function Balance({ balances, forChild }: { balances: ChargeBalance[]; forChild: boolean }) {
  const t = useT();
  const shown = balances.filter((b) => b.net !== 0);
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
      {shown.some((b) => b.net > 0) ? <Muted>{t('charges.payAtDesk')}</Muted> : null}
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

function ChargeRow({ charge: c }: { charge: Charge }) {
  const t = useT();
  const cancelled = c.status === 'CANCELLED';
  const statusColor = cancelled ? theme.textMuted : c.status === 'PAID' ? theme.textSuccess : c.overdue ? theme.textDanger : theme.textWarning;
  return (
    <View testID={`charge-${c.id}`} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border, opacity: cancelled ? 0.55 : 1 }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
        <Text style={{ fontWeight: '600', flex: 1, marginRight: spacing[2] }}>{c.description}</Text>
        <Text style={{ color: statusColor, fontWeight: '600' }}>{t(`charges.status.${c.status}` as TranslationKey)}</Text>
      </View>
      <Muted>
        {t('charges.invoice', { invoice: c.invoiceLabel })} · {t('charges.due', { date: formatDay(c.dueDate) })}
      </Muted>
      {c.discountAmount > 0 ? <Line label={t('charges.discount')} value={`− ${formatMoney(c.discountAmount, c.currency)}`} /> : null}
      <Line label={t('charges.exTax')} value={formatMoney(c.netAmount, c.currency)} />
      <Line label={t('charges.tax', { rate: rate(c.taxRateBasisPoints) })} value={formatMoney(c.taxAmount, c.currency)} />
      <Line label={t('charges.incTax')} value={formatMoney(c.grossAmount, c.currency)} strong />
      {cancelled ? (
        <Muted>{t('charges.cancelledOn', { date: formatDay(c.cancelledAt ?? c.createdAt) })}</Muted>
      ) : (
        <>
          {c.paidAmount > 0 ? <Line label={t('charges.paid')} value={formatMoney(c.paidAmount, c.currency)} /> : null}
          {c.owedAmount > 0 ? <Line label={t('charges.stillOwed')} value={formatMoney(c.owedAmount, c.currency)} strong /> : null}
        </>
      )}
    </View>
  );
}

function methodLabel(t: T, method: string): string {
  const key = `charges.method.${method}` as TranslationKey;
  const text = t(key);
  return text === key ? method : text;
}

function ReceiptRow({ payment: p }: { payment: ChargePayment }) {
  const t = useT();
  return (
    <View style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border }}>
      <Text style={{ fontWeight: '600' }}>{t('charges.receipt', { amount: formatMoney(p.amount, p.currency), date: formatDay(p.receivedAt), method: methodLabel(t, p.paymentMethod) })}</Text>
      {p.allocations.length > 0 ? <Muted>{t('charges.toward', { invoices: p.allocations.map((a) => a.invoiceLabel).join(', ') })}</Muted> : null}
      {p.creditAmount > 0 ? <Muted>{t('charges.toCredit', { amount: formatMoney(p.creditAmount, p.currency) })}</Muted> : null}
    </View>
  );
}
