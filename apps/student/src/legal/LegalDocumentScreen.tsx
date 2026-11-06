import React from 'react';
import { ActivityIndicator, ScrollView, Text } from 'react-native';
import { ErrorBanner, Screen } from '../components/ui';
import { useT } from '../i18n/I18nProvider';
import { theme, fontSize, spacing } from '../theme/tokens';
import { useLegalDocument, type LegalSlug } from './legalPages';

/** One legal page, read in the app (Decision 440). Until the real text is
 * loaded on the server, it says the page is being prepared. */
export function LegalDocumentScreen({ route }: { route: { params: { slug: LegalSlug } } }) {
  const t = useT();
  const doc = useLegalDocument(route.params.slug);
  const content = doc.data?.content?.trim();
  return (
    <ScrollView contentContainerStyle={{ flexGrow: 1 }}>
      <Screen>
        {doc.isLoading ? <ActivityIndicator /> : null}
        {doc.isError ? <ErrorBanner message={t('legal.loadFailed')} /> : null}
        {doc.data && !content ? <Text style={{ fontSize: fontSize.body }}>{t('legal.beingPrepared')}</Text> : null}
        {doc.data && content ? (
          <>
            <Text style={{ color: theme.textSecondary, fontSize: fontSize.footnote, marginBottom: spacing[3] }}>
              {t('legal.version', { version: doc.data.version })}
            </Text>
            <Text style={{ fontSize: fontSize.body, lineHeight: 22 }}>{content}</Text>
          </>
        ) : null}
      </Screen>
    </ScrollView>
  );
}
