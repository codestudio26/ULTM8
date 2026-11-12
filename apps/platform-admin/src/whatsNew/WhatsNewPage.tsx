import React, { useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, Spinner, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { NewLookPageHeader } from '../layout/NewLookPage';
import '../layout/adminLook.css';
import { useDeleteWhatsNewPost, useSaveWhatsNewPost, useWhatsNewPosts, type ProductUpdate } from './whatsNewQueries';

/** The School Portal's languages besides English (the API checks the same list). */
const LANGUAGES = ['pt-BR', 'es', 'ar', 'fr', 'de', 'it', 'nl', 'pl', 'ru', 'tr', 'ja', 'ko', 'zh-CN', 'th'] as const;

function languageName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

type Draft = { title: string; body: string; translations: Record<string, { title: string; body: string }> };

function draftOf(post: ProductUpdate | null): Draft {
  const translations: Draft['translations'] = {};
  for (const t of post?.translations ?? []) translations[t.locale] = { title: t.title, body: t.body };
  return { title: post?.title ?? '', body: post?.body ?? '', translations };
}

/**
 * Decision 318 item 3: "What's new" posts, written here by ULTM8 HQ and shown
 * to School owners and staff in the School Portal, in their language (English
 * when a post has no translation in it). A post shows as soon as it is saved.
 * Writing, editing and deleting are Full Admin only server-side (others see
 * that refusal here); every change is audit-logged.
 */
export function WhatsNewPage() {
  const { data, isLoading, error } = useWhatsNewPosts();
  const remove = useDeleteWhatsNewPost();
  const [editing, setEditing] = useState<ProductUpdate | 'new' | null>(null);
  const [deleting, setDeleting] = useState<ProductUpdate | null>(null);
  const items = data?.items ?? [];

  return (
    <div className="u8a">
      <NewLookPageHeader
        title="What's new"
        subtitle="News for School owners and staff, shown in the School Portal in their language (English when there is no translation). A post shows as soon as it is saved. Full Admins only; every change is recorded in the audit log."
        actions={<Button onClick={() => setEditing('new')}>New post</Button>}
      />
      {error ? <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load the posts.'} /> : null}
      {remove.error ? <ErrorBanner message={remove.error instanceof ApiError ? remove.error.message : 'Could not delete the post.'} /> : null}
      {isLoading ? (
        <Spinner />
      ) : items.length === 0 ? (
        <Card>
          <EmptyState title="No posts yet" description="Owners and staff see nothing under What's new until a post is written here." />
        </Card>
      ) : (
        items.map((post) => (
          <Card key={post.id}>
            <article data-testid="whats-new-post">
              <h2 className="u8a-card__title">{post.title}</h2>
              <p className="u8a-post__body">{post.body}</p>
              <p className="u8a-small">
                Posted {new Date(post.createdAt).toLocaleString()} ·{' '}
                {post.translations.length === 0 ? 'English only' : `Also in ${post.translations.map((t) => languageName(t.locale)).join(', ')}`}
              </p>
              <div className="u8a-buttons u8a-buttons--start">
                <Button variant="secondary" onClick={() => setEditing(post)}>
                  Edit
                </Button>
                <Button variant="secondary" onClick={() => setDeleting(post)}>
                  Delete
                </Button>
              </div>
            </article>
          </Card>
        ))
      )}

      {editing ? <PostForm post={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}

      {deleting ? (
        <Modal title={`Delete "${deleting.title}"?`} onClose={() => setDeleting(null)}>
          <p>Owners and staff stop seeing it straight away, in every language.</p>
          <div className="u8a-buttons">
            <Button variant="secondary" onClick={() => setDeleting(null)}>
              Back
            </Button>
            <Button variant="danger" loading={remove.isPending} onClick={() => remove.mutate(deleting.id, { onSettled: () => setDeleting(null) })}>
              Delete
            </Button>
          </div>
        </Modal>
      ) : null}
    </div>
  );
}

function PostForm({ post, onClose }: { post: ProductUpdate | null; onClose: () => void }) {
  const save = useSaveWhatsNewPost();
  const [draft, setDraft] = useState<Draft>(draftOf(post));
  const [problem, setProblem] = useState<string | null>(null);

  function setTranslation(locale: string, key: 'title' | 'body', value: string) {
    setDraft((d) => {
      const current = d.translations[locale] ?? { title: '', body: '' };
      return { ...d, translations: { ...d.translations, [locale]: { ...current, [key]: value } } };
    });
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    setProblem(null);
    const translations = [];
    for (const locale of LANGUAGES) {
      const t = draft.translations[locale];
      const title = t?.title.trim() ?? '';
      const body = t?.body.trim() ?? '';
      if (!title && !body) continue;
      if (!title || !body) {
        setProblem(`${languageName(locale)}: give both a title and the text, or leave both empty.`);
        return;
      }
      translations.push({ locale, title, body });
    }
    save.mutate({ id: post?.id ?? null, body: { title: draft.title.trim(), body: draft.body.trim(), translations } }, { onSuccess: onClose });
  }

  return (
    <Modal title={post ? 'Edit post' : 'New post'} onClose={onClose} wide>
      <form onSubmit={submit}>
        {problem ? <ErrorBanner message={problem} /> : null}
        {save.error ? <ErrorBanner message={save.error instanceof ApiError ? save.error.message : 'Could not save the post.'} /> : null}
        <Field label="Title (English)" htmlFor="whats-new-title">
          <TextField id="whats-new-title" required maxLength={200} value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} />
        </Field>
        <Field label="Text (English)" htmlFor="whats-new-body" hint="Plain text. Line breaks are kept.">
          <TextArea id="whats-new-body" required maxLength={5000} rows={6} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
        </Field>
        <h3 className="u8a-form-heading">Translations</h3>
        <p className="u8a-intro">Optional. A language left empty shows the English.</p>
        {LANGUAGES.map((locale) => (
          <details key={locale} className="u8a-details" open={!!draft.translations[locale]?.title}>
            <summary>{languageName(locale)}</summary>
            <Field label={`Title (${languageName(locale)})`} htmlFor={`whats-new-title-${locale}`}>
              <TextField
                id={`whats-new-title-${locale}`}
                maxLength={200}
                value={draft.translations[locale]?.title ?? ''}
                onChange={(e) => setTranslation(locale, 'title', e.target.value)}
              />
            </Field>
            <Field label={`Text (${languageName(locale)})`} htmlFor={`whats-new-body-${locale}`}>
              <TextArea
                id={`whats-new-body-${locale}`}
                maxLength={5000}
                rows={4}
                value={draft.translations[locale]?.body ?? ''}
                onChange={(e) => setTranslation(locale, 'body', e.target.value)}
              />
            </Field>
          </details>
        ))}
        <div className="u8a-buttons">
          <Button variant="secondary" type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={save.isPending} disabled={!draft.title.trim() || !draft.body.trim()}>
            {post ? 'Save' : 'Post'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
