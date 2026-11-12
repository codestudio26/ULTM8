import React from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, ErrorBanner, Spinner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useI18n } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import './whatsNew.css';

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
 *
 * New look (Decision 460 item 17): the shell's header and a white card per
 * post (the Billing pages' pieces). The same posts, order and "Load more".
 */
export function WhatsNewPage() {
  const { t, locale } = useI18n();
  const query = useWhatsNew(locale);
  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const dateOf = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'long', year: 'numeric' });

  return (
    <BillingPage>
      <NewLookPageHeader title={t('whatsNew.title')} subtitle={t('whatsNew.subtitle')} />
      {query.error ? <ErrorBanner message={query.error instanceof ApiError ? query.error.message : t('whatsNew.loadFailed')} /> : null}
      {query.isLoading ? (
        <Spinner />
      ) : items.length === 0 && !query.error ? (
        <BillingCard>
          <EmptyState title={t('whatsNew.empty')} />
        </BillingCard>
      ) : (
        items.map((post) => (
          <BillingCard key={post.id}>
            <article data-testid="whats-new-post" lang={post.locale} className="u8wn-post">
              <h2 className="u8b-card__title u8wn-post__title">{post.title}</h2>
              <p className="u8b-note u8wn-post__date">
                {t('whatsNew.postedOn', { date: dateOf(post.createdAt) })}
                {post.locale !== locale && locale !== 'en-GB' ? ` · ${t('whatsNew.inEnglish')}` : null}
              </p>
              <p className="u8wn-post__body">{post.body}</p>
            </article>
          </BillingCard>
        ))
      )}
      {query.hasNextPage ? (
        <div className="u8wn-more">
          <Button variant="secondary" loading={query.isFetchingNextPage} onClick={() => query.fetchNextPage()}>
            {t('whatsNew.loadMore')}
          </Button>
        </div>
      ) : null}
    </BillingPage>
  );
}
