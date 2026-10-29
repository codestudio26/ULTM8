import React from 'react';
import { Text, View } from 'react-native';
import { Avatar } from '../components/Avatar';
import { formatDate } from '../lib/formatDate';
import { theme } from '../theme/tokens';
import { useT } from '../i18n/I18nProvider';
import type { MembershipCard } from './attendanceQueries';

/**
 * The digital membership card (backlog 3.11, Decision 398), one per School:
 * the School, the student's photo and name, their personal check-in code (for
 * the desk when the QR can't be scanned) and the memberships in effect now.
 * The card has no QR of its own; the live QR above it is the one to scan.
 */
export function MembershipCards({ cards }: { cards: MembershipCard[] }) {
  const t = useT();
  return (
    <View style={{ alignSelf: 'stretch', gap: 12 }}>
      {cards.map((card) => (
        <View
          key={card.schoolId}
          accessibilityLabel={t('attendance.membershipCard.label', { school: card.schoolName })}
          style={{ borderWidth: 1, borderColor: theme.border, borderRadius: 14, padding: 16, backgroundColor: theme.surface1, gap: 10 }}
        >
          <Text style={{ fontWeight: '700', fontSize: 15 }}>{card.schoolName}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <Avatar firstName={card.firstName} surname={card.surname} photoUrl={card.photoUrl} size={48} />
            <View>
              <Text style={{ fontWeight: '700', fontSize: 16 }}>{`${card.firstName} ${card.surname}`.trim()}</Text>
              <Text style={{ fontSize: 12, color: theme.textMuted }}>{t('attendance.membershipCard.codeLabel')}</Text>
              <Text style={{ fontSize: 22, letterSpacing: 4, fontVariant: ['tabular-nums'] }}>{card.checkInCode}</Text>
            </View>
          </View>
          {card.memberships.length === 0 ? (
            <Text style={{ color: theme.textMuted }}>{t('attendance.membershipCard.noMembership')}</Text>
          ) : (
            card.memberships.map((m, i) => (
              <Text key={`${m.title}-${i}`}>
                {m.classesRemaining !== null && m.classesRemaining !== undefined
                  ? `${m.title} · ${t('attendance.membershipCard.classesLeft', { count: m.classesRemaining })}`
                  : m.expiryDate
                    ? `${m.title} · ${t('attendance.membershipCard.until', { date: formatDate(m.expiryDate) })}`
                    : m.title}
              </Text>
            ))
          )}
        </View>
      ))}
    </View>
  );
}
