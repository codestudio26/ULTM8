import React from 'react';
import { Image, Text, View } from 'react-native';
import { theme } from '../theme/tokens';
import { firstGrapheme } from '@ultm8/i18n';

/**
 * RN equivalent of apps/school-portal/src/lib/Avatar.tsx — same behavior (the
 * real photo once one is set, otherwise a colored initials monogram derived
 * from the person's own real name, never a generic silhouette), rebuilt with
 * RN `Image`/`View`/`Text` and this app's own `theme` tokens instead of CSS
 * custom properties, since that component is web-only (`<img>`/`<span>`).
 */
export function Avatar({
  firstName,
  surname,
  photoUrl,
  size = 40,
  color = theme.fillAccent,
}: {
  firstName: string;
  surname: string;
  photoUrl?: string | null;
  size?: number;
  color?: string;
}) {
  if (photoUrl) {
    return (
      <Image
        source={{ uri: photoUrl }}
        style={{ width: size, height: size, borderRadius: size / 2 }}
        accessibilityLabel=""
      />
    );
  }
  // Whole letters, never half a character (Decision 433, TXT-7).
  const initials = `${firstGrapheme(firstName)}${firstGrapheme(surname)}` || '?';
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: color,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ color: theme.onAccent, fontSize: Math.round(size * 0.4), fontWeight: '500' }}>{initials}</Text>
    </View>
  );
}
