import React from 'react';
import { View } from 'react-native';
import { theme, spacing } from '../theme/tokens';
import type { GradingRung } from './myGradingQueries';

/** Dark or white to suit a background colour (the level badge's dots). */
function inkOn(background: string): string {
  if (!/^#[0-9A-Fa-f]{6}$/.test(background)) return '#17181A';
  const n = parseInt(background.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.18 ? '#17181A' : '#FFFFFF';
}

/** A small picture of a rung: the belt's colours, or on a style shown as
 * Levels (Decision 290) a rounded badge in the level's colour with a dot per
 * step, filled up to this one. Decorative: the rung name is always shown next
 * to it. `small` is the size used in pick lists. */
export function BeltSwatch({ rung, small = false }: { rung: GradingRung; small?: boolean }) {
  const width = small ? 28 : 36;
  const height = small ? 10 : 14;
  if (rung.rankDisplay === 'LEVELS') {
    const ink = inkOn(rung.primaryColour);
    const dot = small ? 4 : 5;
    return (
      <View
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
        testID={`level-step-${rung.step}-of-${rung.steps}`}
        style={{
          width,
          height,
          borderRadius: height / 2,
          backgroundColor: rung.primaryColour,
          borderWidth: 1,
          borderColor: theme.borderStrong,
          marginRight: spacing[2],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 2,
        }}
      >
        {Array.from({ length: Math.min(rung.steps, 5) }, (_, i) => (
          <View key={i} style={{ width: dot, height: dot, borderRadius: dot / 2, borderWidth: 1, borderColor: ink, backgroundColor: i < rung.step ? ink : 'transparent' }} />
        ))}
      </View>
    );
  }
  return (
    <View
      accessibilityElementsHidden
      style={{
        width,
        height,
        borderRadius: small ? 2 : 3,
        backgroundColor: rung.primaryColour,
        borderWidth: 1,
        borderColor: rung.secondaryColour ?? theme.borderStrong,
        marginRight: spacing[2],
      }}
    />
  );
}
