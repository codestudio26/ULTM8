import React, { useState } from 'react';
import { Text, View } from 'react-native';
import { Button, Field, InlineError, TextField } from '../components/ui';
import { getApiErrorMessage } from '../lib/apiErrorMessage';
import { formatDateOnly } from '../lib/formatDate';
import { formatMoney } from '../lib/formatMoney';
import { useT } from '../i18n/I18nProvider';
import { addDays, useFreezeAction, useRequestFreeze, type FreezableMembership } from './freezeQueries';

type Freeze = { id: string; status: 'REQUESTED' | 'APPROVED'; startsAt: string; endsAt: string };

/** The freeze line a membership shows (Decision 404): frozen until the day
 * the member is back, a freeze to come, or a request waiting. */
export function FreezeStatusLine({ freeze, frozen }: { freeze: Freeze | null | undefined; frozen: boolean }) {
  const t = useT();
  if (!freeze) return null;
  const text = frozen
    ? t('memberships.myMemberships.freeze.frozenUntil', { date: formatDateOnly(freeze.endsAt) })
    : freeze.status === 'APPROVED'
      ? t('memberships.myMemberships.freeze.approved', { start: formatDateOnly(freeze.startsAt), end: formatDateOnly(freeze.endsAt) })
      : t('memberships.myMemberships.freeze.requested', { start: formatDateOnly(freeze.startsAt), end: formatDateOnly(freeze.endsAt) });
  return <Text style={{ color: '#1A73E8', fontSize: 12, marginTop: 2 }}>{text}</Text>;
}

/**
 * Decision 404: the member, or a Guardian for their child, asks the School to
 * freeze a membership, withdraws the request, or ends a freeze early. The
 * dates are typed as YYYY-MM-DD, as other dates in this app are until it has
 * a date picker. The School approves or declines; at least 7 days, starting
 * today or later, within the School's maximum.
 */
export function FreezeControls({ item }: { item: FreezableMembership }) {
  const t = useT();
  const request = useRequestFreeze();
  const action = useFreezeAction();
  const [form, setForm] = useState<{ startsAt: string; endsAt: string } | null>(null);
  const [confirmingEnd, setConfirmingEnd] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const freeze = item.freeze ?? null;

  async function send() {
    if (!form || request.isPending) return;
    setError(null);
    try {
      await request.mutateAsync({ membershipId: item.membershipId, startsAt: form.startsAt.trim(), endsAt: form.endsAt.trim() });
      setForm(null);
    } catch (err) {
      setError(getApiErrorMessage(err, t('memberships.myMemberships.freeze.failed')));
    }
  }

  async function act(kind: 'cancel' | 'end') {
    if (!freeze || action.isPending) return;
    setError(null);
    setConfirmingEnd(false);
    try {
      await action.mutateAsync({ freezeId: freeze.id, action: kind });
    } catch (err) {
      setError(getApiErrorMessage(err, t('memberships.myMemberships.freeze.actionFailed')));
    }
  }

  return (
    <View style={{ marginTop: 6 }} testID={`freeze-${item.membershipId}`}>
      <FreezeStatusLine freeze={freeze} frozen={item.frozen} />
      {error ? <InlineError message={error} /> : null}
      {!freeze && !form ? (
        <View style={{ marginTop: 8 }}>
          <Button
            title={t('memberships.myMemberships.freeze.request')}
            variant="secondary"
            onPress={() => setForm({ startsAt: item.today, endsAt: addDays(item.today, 30) })}
          />
        </View>
      ) : null}
      {!freeze && form ? (
        <View style={{ marginTop: 8 }}>
          <Field label={t('memberships.myMemberships.freeze.startLabel')}>
            <TextField value={form.startsAt} onChangeText={(v) => setForm({ ...form, startsAt: v })} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          </Field>
          <Field label={t('memberships.myMemberships.freeze.endLabel')}>
            <TextField value={form.endsAt} onChangeText={(v) => setForm({ ...form, endsAt: v })} autoCapitalize="none" placeholder="YYYY-MM-DD" />
          </Field>
          <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('memberships.myMemberships.freeze.hint', { days: item.maxDaysPer12Months })}</Text>
          {item.feeAmount ? (
            <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
              {t('memberships.myMemberships.freeze.fee', { amount: formatMoney(item.feeAmount, item.currency) })}
            </Text>
          ) : null}
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('memberships.myMemberships.freeze.notNow')} variant="secondary" onPress={() => setForm(null)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('memberships.myMemberships.freeze.send')} onPress={send} loading={request.isPending} />
            </View>
          </View>
        </View>
      ) : null}
      {freeze?.status === 'REQUESTED' ? (
        <View style={{ marginTop: 8 }}>
          <Button title={t('memberships.myMemberships.freeze.withdraw')} variant="secondary" onPress={() => act('cancel')} loading={action.isPending} />
        </View>
      ) : null}
      {freeze?.status === 'APPROVED' && !confirmingEnd ? (
        <View style={{ marginTop: 8 }}>
          <Button title={t('memberships.myMemberships.freeze.endEarly')} variant="secondary" onPress={() => setConfirmingEnd(true)} />
        </View>
      ) : null}
      {freeze?.status === 'APPROVED' && confirmingEnd ? (
        <View style={{ marginTop: 8 }}>
          <Text style={{ color: '#C5221F', fontSize: 13 }}>{t('memberships.myMemberships.freeze.endConfirm')}</Text>
          <View style={{ flexDirection: 'row', marginTop: 10, gap: 8 }}>
            <View style={{ flex: 1 }}>
              <Button title={t('memberships.myMemberships.freeze.keep')} variant="secondary" onPress={() => setConfirmingEnd(false)} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title={t('memberships.myMemberships.freeze.endYes')} variant="destructive" onPress={() => act('end')} loading={action.isPending} />
            </View>
          </View>
        </View>
      ) : null}
    </View>
  );
}
