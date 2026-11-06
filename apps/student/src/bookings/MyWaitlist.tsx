import React, { useState } from 'react';
import { Text, View } from 'react-native';
import type { components } from '@ultm8/api-client';
import { Button, InlineError } from '../components/ui';
import { getApiErrorMessage, isWaiverRefusal } from '../lib/apiErrorMessage';
import { formatClassTimes } from '../lib/formatDate';
import { classZone, formatInZone } from '../lib/classTime';
import { useT } from '../i18n/I18nProvider';
import { SignWaiverButton } from '../waivers/SignWaiverButton';
import { useClaimWaitlist, useMyWaitlist, useWithdrawWaitlist } from './waitlistMutations';

type Entry = components['schemas']['MyWaitlistEntryDto'];

/** "My waitlist" at the top of My bookings (Decision 427, Student portal
 * review SP3). When a spot frees up the API offers it with a claim deadline
 * (status NOTIFIED); before this there was no way to claim it in the app, so
 * every offer expired and passed to the next person. */
export function MyWaitlist() {
  const t = useT();
  const waitlist = useMyWaitlist();
  const items = waitlist.data?.items ?? [];
  if (items.length === 0) return null;
  return (
    <View style={{ marginBottom: 16 }}>
      <Text accessibilityRole="header" style={{ fontSize: 16, fontWeight: '700', marginBottom: 4 }}>
        {t('bookings.waitlist.title')}
      </Text>
      {items.map((entry) => (
        <WaitlistRow key={entry.id} entry={entry} />
      ))}
    </View>
  );
}

function WaitlistRow({ entry }: { entry: Entry }) {
  const t = useT();
  const claim = useClaimWaitlist();
  const leave = useWithdrawWaitlist();
  const [error, setError] = useState<string | null>(null);
  // Decision 442 item 1: claiming was refused for want of a signed waiver.
  const [waiverNeeded, setWaiverNeeded] = useState(false);
  const offered = entry.status === 'NOTIFIED';

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    setWaiverNeeded(false);
    try {
      await action();
    } catch (err) {
      setError(getApiErrorMessage(err, fallback));
      setWaiverNeeded(isWaiverRefusal(err));
    }
  }

  return (
    <View style={{ paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#EEE' }}>
      <Text style={{ fontSize: 15, fontWeight: '600' }}>{entry.classTitle ?? t('bookings.myBookings.unknownClass')}</Text>
      {entry.classStartsAt ? <Text style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>{formatClassTimes(entry.classStartsAt, null, classZone(entry.classTimezone, null))}</Text> : null}
      {entry.schoolName ? <Text style={{ color: '#5F6368', fontSize: 12 }}>{entry.schoolName}</Text> : null}
      {offered ? (
        <Text style={{ color: '#188038', fontSize: 13, marginTop: 4 }}>
          {entry.claimByDeadline ? t('bookings.waitlist.spotFreeUntil', { date: formatInZone(entry.claimByDeadline, classZone(entry.classTimezone, null)) }) : t('bookings.waitlist.spotFree')}
        </Text>
      ) : (
        <Text style={{ color: '#5F6368', fontSize: 13, marginTop: 4 }}>{t('bookings.classRow.waitlistPosition', { position: entry.position })}</Text>
      )}
      {error ? <InlineError message={error} /> : null}
      {error && waiverNeeded ? <SignWaiverButton schoolId={entry.schoolId} /> : null}
      <View style={{ flexDirection: 'row', marginTop: 8, gap: 8 }}>
        {offered ? (
          <View style={{ flex: 1 }}>
            <Button
              title={t('bookings.waitlist.claim')}
              onPress={() => run(() => claim.mutateAsync(entry.id), t('bookings.waitlist.claimError'))}
              loading={claim.isPending}
            />
          </View>
        ) : null}
        <View style={{ flex: 1 }}>
          <Button
            title={t('bookings.classRow.leaveWaitlist')}
            variant="secondary"
            onPress={() => run(() => leave.mutateAsync(entry.id), t('bookings.classRow.leaveWaitlistError'))}
            loading={leave.isPending}
          />
        </View>
      </View>
    </View>
  );
}
