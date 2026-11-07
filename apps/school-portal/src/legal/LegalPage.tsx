import React from 'react';
import { Link, useParams } from 'react-router-dom';
import { AuthCard, ErrorBanner, Spinner } from '@ultm8/ui';
import { useT } from '../i18n/I18nProvider';
import { LEGAL_PAGES, isLegalSlug, useLegalDocument } from './legalPages';

/**
 * A legal page, open to everyone signed in or not (Decision 444). The text
 * comes from the API (GET /v1/legal/:slug) and is shown as written. Until the
 * real text is loaded the page says it is being prepared.
 */
export function LegalPage() {
  const t = useT();
  const { slug = '' } = useParams<{ slug: string }>();
  const known = isLegalSlug(slug) ? slug : null;
  const doc = useLegalDocument(known);

  if (!known) {
    return (
      <AuthCard title={t('legal.notFound')}>
        <Link to="/login">{t('legal.backToSignIn')}</Link>
      </AuthCard>
    );
  }

  const content = doc.data?.content?.trim();
  return (
    <AuthCard title={t(LEGAL_PAGES[known])} subtitle={doc.data && content ? t('legal.version', { version: doc.data.version }) : undefined}>
      {doc.isLoading ? <Spinner /> : null}
      {doc.isError ? <ErrorBanner message={t('legal.loadFailed')} /> : null}
      {doc.data && !content ? <p>{t('legal.beingPrepared')}</p> : null}
      {content ? (
        <div data-testid="legal-content" style={{ whiteSpace: 'pre-wrap', lineHeight: 1.5 }}>
          {content}
        </div>
      ) : null}
    </AuthCard>
  );
}
