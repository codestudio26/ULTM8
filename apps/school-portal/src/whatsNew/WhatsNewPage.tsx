import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useI18n } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

/** The portal languages the API knows; anything else reads English. */
const READER_LOCALES = ['en-GB', 'pt-BR', 'es', 'ar', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'ja', 'ko', 'zh-CN', 'th'] as const;
type ReaderLocale = (typeof READER_LOCALES)[number];

/** GET /whats-new (Decision 318 item 3): newest first, in the reader's language. */
export function useWhatsNew(locale: string) {
  const asked = (READER_LOCALES as readonly string[]).includes(locale) ? (locale as ReaderLocale) : 'en-GB';
  return useInfiniteQuery({
    queryKey: ['whats-new', asked],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => unwrap(apiClient.GET('/v1/whats-new', { params: { query: { locale: asked, cursor: pageParam } } })),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
}

/**
 * "What's new" (Decision 318 item 3): news about ULTM8, written by ULTM8 HQ
 * in Platform Admin, for School owners and staff, in their language (English
 * when a post has no translation in it). The same posts for every School.
 */
export function WhatsNewPage() {
  const { t, locale } = useI18n();
  const query = useWhatsNew(locale);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <>
      <PageHeader title={t('whatsNew.title')} subtitle={t('whatsNew.subtitle')} />
      {query.error ? <ErrorBanner message={query.error instanceof ApiError ? query.error.message : t('whatsNew.loadFailed')} /> : null}
      {query.isLoading ? (
        <Spinner />
      ) : items.length === 0 && !query.error ? (
        <Card>
          <EmptyState title={t('whatsNew.empty')} />
        </Card>
      ) : (
        items.map((post) => (
          <Card key={post.id}>
            <article data-testid="whats-new-post" lang={post.locale}>
              <h2 style={{ fontSize: 18, margin: '0 0 4px' }}>{post.title}</h2>
              <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 12px' }}>
                {t('whatsNew.postedOn', { date: dateOf(post.createdAt) })}
                {post.locale !== locale && locale !== 'en-GB' ? ` · ${t('whatsNew.inEnglish')}` : null}
              </p>
              <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{post.body}</p>
            </article>
          </Card>
        ))
      )}
      {query.hasNextPage ? (
        <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
          {t('whatsNew.loadMore')}
        </Button>
      ) : null}
    </>
  );
}
