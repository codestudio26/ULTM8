import React from 'react';
import { Switch, Text, View } from 'react-native';
import { fontSize, minTouchTarget, spacing } from '../theme/tokens';

/** "I have only one name" (Decision 433, TXT-8): on, the surname is left
 * empty and sent with `hasOnlyOneName: true`, so nobody types "." for one. */
export function OneNameSwitch({ value, onChange, label }: { value: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: spacing[2], minHeight: minTouchTarget, marginBottom: spacing[2] }}>
      <Switch value={value} onValueChange={onChange} accessibilityLabel={label} />
      <Text style={{ flex: 1, fontSize: fontSize.body }}>{label}</Text>
    </View>
  );
}
