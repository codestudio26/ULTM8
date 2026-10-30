import React from 'react';
import { Text, View } from 'react-native';
import { formatMoney } from '../lib/formatMoney';
import { formatLocale } from '../i18n/format';
import { theme, spacing, fontSize } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import type { TranslationKey } from '../i18n/types';
import type { MemberRecurringCharge } from './chargeQueries';

function formatDay(day: string): string {
  try {
    return new Intl.DateTimeFormat(formatLocale(), { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(`${day.slice(0, 10)}T00:00:00.000Z`));
  } catch {
    return day;
  }
}

const Muted = ({ children }: { children: React.ReactNode }) => <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;

/**
 * The recurring charges the School set up for the member (Decision 412),
 * read-only: what, how much each time (at today's tax rate), how often, the
 * next invoice date and when it ends. Each occurrence shows in the invoices
 * list as a normal charge once it is made. Stopped and ended ones are greyed.
 */
export function RecurringChargesList({ items }: { items: MemberRecurringCharge[] }) {
  const t = useT();
  if (items.length === 0) return null;
  return (
    <View testID="recurring-charges">
      <Text style={{ fontWeight: '700', marginTop: spacing[4], marginBottom: spacing[2] }}>{t('charges.recurring.heading')}</Text>
      {items.map((r) => {
        const active = r.status === 'ACTIVE';
        return (
          <View key={r.id} testID={`recurring-${r.id}`} style={{ paddingVertical: spacing[3], borderBottomWidth: 1, borderBottomColor: theme.border, opacity: active ? 1 : 0.55 }}>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
              <Text style={{ fontWeight: '600', flex: 1, marginRight: spacing[2] }}>{r.description}</Text>
              {!active ? <Text style={{ color: theme.textMuted, fontWeight: '600' }}>{t(`charges.recurring.status.${r.status}` as TranslationKey)}</Text> : null}
            </View>
            <Text>
              {t('charges.recurring.amount', { amount: formatMoney(r.estimate.grossAmount, r.currency) })} · {t(`charges.recurring.every.${r.frequency}` as TranslationKey)}
            </Text>
            {active && r.nextDate ? <Muted>{t('charges.recurring.next', { date: formatDay(r.nextDate) })}</Muted> : null}
            {active && r.endDate ? <Muted>{t('charges.recurring.endsOn', { date: formatDay(r.endDate) })}</Muted> : null}
            {r.maxOccurrences ? <Muted>{t('charges.recurring.payments', { done: r.createdCount, count: r.maxOccurrences })}</Muted> : null}
            {active ? <Muted>{r.taxExempt ? t('charges.noTax') : t('charges.recurring.taxNote')}</Muted> : null}
          </View>
        );
      })}
    </View>
  );
}
