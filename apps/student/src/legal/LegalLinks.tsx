import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { NavigationContext } from '@react-navigation/native';
import { useT } from '../i18n/I18nProvider';
import { theme, fontSize, spacing, minTouchTarget } from '../theme/tokens';
import { LEGAL_PAGES, type LegalSlug } from './legalPages';

/** Links that open each legal page in the app (Decision 444). Works from the
 * signed-out and the signed-in screens: both stacks have a LegalDocument screen. */
export function LegalLinks({ slugs }: { slugs: LegalSlug[] }) {
  const t = useT();
  // The context, not useNavigation(), so a screen rendered on its own (tests) doesn't throw.
  type Nav = { navigate: (screen: 'LegalDocument', params: { slug: LegalSlug }) => void } | undefined;
  const navigation = React.useContext(NavigationContext as unknown as React.Context<Nav>);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', columnGap: spacing[4] }}>
      {slugs.map((slug) => (
        <Pressable
          key={slug}
          accessibilityRole="link"
          onPress={() => navigation?.navigate('LegalDocument', { slug })}
          style={{ minHeight: minTouchTarget, justifyContent: 'center' }}
        >
          <Text style={{ color: theme.textAccent, fontSize: fontSize.footnote, textDecorationLine: 'underline' }}>{t(LEGAL_PAGES[slug])}</Text>
        </Pressable>
      ))}
    </View>
  );
}
