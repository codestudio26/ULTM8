import React, { useState } from 'react';
import { Share, Text, View } from 'react-native';
import { Button, InlineError } from '../components/ui';
import { useBookingGuests } from './bookingQueries';
import { useT } from '../i18n/I18nProvider';

/**
 * A booking's guests (Waivers Q9): when the class asks for a waiver, each
 * guest's signing link to share and whether they have signed. The link text
 * is always shown and selectable, since sharing isn't available everywhere
 * (React Native Web without navigator.share).
 */
export function BookingGuests({ bookingId }: { bookingId: string }) {
  const t = useT();
  const query = useBookingGuests(bookingId);
  const [shareFailed, setShareFailed] = useState(false);

  if (query.isLoading) return null;
  if (query.error || !query.data) return <InlineError message={t('bookings.guests.loadError')} />;
  if (!query.data.waiverRequired || query.data.guests.length === 0) return null;

  async function share(link: string) {
    setShareFailed(false);
    try {
      await Share.share({ message: t('bookings.guests.shareMessage', { link }) });
    } catch {
      setShareFailed(true);
    }
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Text style={{ fontSize: 13, marginBottom: 4 }}>{t('bookings.guests.linksIntro')}</Text>
      {query.data.guests.map((g, i) => (
        <View key={g.attendeeId} style={{ paddingVertical: 6 }}>
          <Text style={{ fontWeight: '600', fontSize: 13 }}>{t('bookings.guests.guestNumber', { number: i + 1 })}</Text>
          {g.waiverStatus === 'SIGNED' ? (
            <Text style={{ color: '#188038', fontSize: 13 }}>{t('bookings.guests.signed', { name: g.guestFullName ?? '' })}</Text>
          ) : (
            <>
              <Text style={{ color: '#B06000', fontSize: 13 }}>{t('bookings.guests.unsigned')}</Text>
              {g.link ? (
                <>
                  <Text selectable style={{ color: '#5F6368', fontSize: 12, marginTop: 2 }}>
                    {g.link}
                  </Text>
                  <Button title={t('bookings.guests.share')} variant="secondary" onPress={() => share(g.link!)} />
                </>
              ) : (
                <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('bookings.guests.noLink')}</Text>
              )}
            </>
          )}
        </View>
      ))}
      {shareFailed ? <Text style={{ color: '#5F6368', fontSize: 12 }}>{t('bookings.guests.noShare')}</Text> : null}
    </View>
  );
}
