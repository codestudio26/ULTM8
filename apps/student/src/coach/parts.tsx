import React from 'react';
import { Text, View } from 'react-native';
import { theme, spacing, fontSize, radius } from '../theme/tokens';

/** A titled card, as the School Portal's coach screens use. */
export function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View
      accessibilityLabel={title}
      style={{ marginBottom: spacing[6], backgroundColor: theme.surface1, borderRadius: radius.button, padding: spacing[4], borderWidth: 1, borderColor: theme.border }}
    >
      <Text accessibilityRole="header" style={{ fontSize: fontSize.headingSm, fontWeight: '600', marginBottom: spacing[3], color: theme.textPrimary }}>
        {title}
      </Text>
      {children}
    </View>
  );
}

export function Muted({ children }: { children: React.ReactNode }) {
  return <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote }}>{children}</Text>;
}
