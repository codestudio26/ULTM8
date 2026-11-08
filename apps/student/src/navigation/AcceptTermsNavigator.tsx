import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { AcceptTermsScreen } from '../legal/AcceptTermsScreen';
import { LegalDocumentScreen } from '../legal/LegalDocumentScreen';
import { LEGAL_PAGES } from '../legal/legalPages';
import { useT } from '../i18n/I18nProvider';
import type { AcceptTermsStackParamList } from './types';

const Stack = createNativeStackNavigator<AcceptTermsStackParamList>();

/** Decision 448 item 8: while the session waits for the Terms and Privacy
 * tick, only the step and the two pages it links to are reachable. */
export function AcceptTermsNavigator() {
  const t = useT();
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="AcceptTerms" component={AcceptTermsScreen} />
      <Stack.Screen
        name="LegalDocument"
        component={LegalDocumentScreen}
        options={({ route }) => ({ headerShown: true, title: t(LEGAL_PAGES[route.params.slug]) })}
      />
    </Stack.Navigator>
  );
}
