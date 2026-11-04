import React from 'react';
import { Pressable, Text, View } from 'react-native';

/** One of a child's Schools to pick, as chips when there are several (the same
 * look as ChildBookingScreen's), or just the name when there is one. */
export function ChildSchoolPicker({
  schools,
  selectedId,
  onSelect,
}: {
  schools: { schoolId: string; name: string }[];
  selectedId: string | null;
  onSelect: (schoolId: string) => void;
}) {
  if (schools.length === 1) {
    return <Text style={{ color: '#5F6368', fontSize: 13, marginBottom: 6 }}>{schools[0]!.name}</Text>;
  }
  if (schools.length === 0) return null;
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 8 }}>
      {schools.map((s) => (
        <Pressable
          key={s.schoolId}
          onPress={() => onSelect(s.schoolId)}
          accessibilityRole="button"
          accessibilityState={{ selected: s.schoolId === selectedId }}
          style={{
            paddingVertical: 6,
            paddingHorizontal: 12,
            borderRadius: 16,
            borderWidth: 1,
            borderColor: s.schoolId === selectedId ? '#1A73E8' : '#DADCE0',
            backgroundColor: s.schoolId === selectedId ? '#E8F0FE' : 'transparent',
          }}
        >
          <Text>{s.name}</Text>
        </Pressable>
      ))}
    </View>
  );
}
