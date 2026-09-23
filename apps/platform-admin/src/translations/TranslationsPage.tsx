import React, { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import {
  useCreateTranslation,
  useDeleteTranslation,
  useTranslations,
  useUpdateTranslation,
  type CreateTranslationInput,
  type TranslationResponse,
} from './translationQueries';

/** The Translation CMS (Phase 49's backend, Phase 50's authoring UI) — Screen · label
 * key · locale · content, per ultm8-nestjs-module §5 and docs/ultm8-blueprint.html's
 * own term glossary. FULL_ADMIN-only server-side for every write (this screen's nav
 * isn't role-gated client-side — the backend is the real authorization boundary, same
 * convention every other screen in this app already follows); the list itself reads
 * Phase 49's public GET /translations, since no separate admin-only list endpoint
 * exists (see PlatformAdminTranslationsController's own header comment for why).
 *
 * Pagination is cursor-based (Decision 22/70) but this component set has no shared
 * Pagination control yet, so this screen accumulates pages into one flat list behind
 * a "Load more" button, and resets to the first page after every create/update/delete
 * rather than trying to keep already-fetched, now-inactive pages reactively in sync
 * with a background invalidation — a reasonable-minimum scope call for an internal
 * admin tool, not a load-bearing design decision. */
export function TranslationsPage() {
  const [filterInputs, setFilterInputs] = useState({ screen: '', locale: '' });
  const [appliedFilters, setAppliedFilters] = useState({ screen: '', locale: '' });
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<TranslationResponse[]>([]);

  const query = useTranslations({ screen: appliedFilters.screen || undefined, locale: appliedFilters.locale || undefined }, cursor);
  const createTranslation = useCreateTranslation();
  const updateTranslation = useUpdateTranslation();
  const deleteTranslation = useDeleteTranslation();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<TranslationResponse | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Tracked per-row, not off deleteTranslation.variables — see AdminUsersPage's own
  // "FOUND ON REVIEW" comment for why a shared mutation instance's own `variables`
  // isn't safe to key a per-row spinner off when more than one row could be in
  // flight (it can't happen here today, since every Delete button is disabled while
  // any one is pending, but this keeps the same safe pattern rather than reasoning
  // about why it's currently fine).
  const [deletingId, setDeletingId] = useState<string | null>(null);

  useEffect(() => {
    if (query.data) {
      setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  function resetToFirstPage() {
    setCursor(null);
  }

  function applyFilters(e: React.FormEvent) {
    e.preventDefault();
    setAppliedFilters(filterInputs);
    setCursor(null);
  }

  async function handleDelete(t: TranslationResponse) {
    setActionError(null);
    setDeletingId(t.id);
    try {
      await deleteTranslation.mutateAsync(t.id);
      resetToFirstPage();
    } catch (err) {
      setActionError(err instanceof ApiError ? err.message : 'Could not delete this translation.');
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <>
      <PageHeader
        title="Translations"
        subtitle="Screen · label key · locale · content — the i18n copy behind every translated screen. Adding, editing, and removing are all Full Admin-only."
        actions={<Button onClick={() => setCreating(true)}>Add translation</Button>}
      />

      <Card>
        <form onSubmit={applyFilters} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <Field label="Screen" htmlFor="filter-screen">
            <TextField
              placeholder="e.g. login"
              value={filterInputs.screen}
              onChange={(e) => setFilterInputs((f) => ({ ...f, screen: e.target.value }))}
            />
          </Field>
          <Field label="Locale" htmlFor="filter-locale">
            <TextField
              placeholder="e.g. en"
              value={filterInputs.locale}
              onChange={(e) => setFilterInputs((f) => ({ ...f, locale: e.target.value }))}
            />
          </Field>
          <Button type="submit" variant="secondary">
            Filter
          </Button>
        </form>
      </Card>

      {actionError ? <ErrorBanner message={actionError} /> : null}
      {query.error ? (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Could not load translations.'} />
      ) : null}

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No translations found" description="Add one, or adjust the screen/locale filters above." />
        ) : (
          <Table<TranslationResponse>
            rows={items}
            columns={[
              { key: 'screen', header: 'Screen', render: (t) => t.screen },
              { key: 'labelKey', header: 'Label key', render: (t) => t.labelKey },
              { key: 'locale', header: 'Locale', render: (t) => t.locale },
              {
                key: 'content',
                header: 'Content',
                render: (t) => <span style={{ whiteSpace: 'pre-wrap' }}>{t.content}</span>,
              },
              {
                key: 'actions',
                header: '',
                render: (t) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <Button variant="secondary" onClick={() => setEditing(t)} disabled={deletingId !== null}>
                      Edit
                    </Button>
                    <Button variant="danger" onClick={() => handleDelete(t)} disabled={deletingId !== null} loading={deletingId === t.id}>
                      Delete
                    </Button>
                  </div>
                ),
              },
            ]}
          />
        )}
      </Card>

      {query.data?.nextCursor ? (
        <Button variant="secondary" onClick={() => setCursor(query.data!.nextCursor ?? null)} loading={query.isFetching}>
          Load more
        </Button>
      ) : null}

      {creating ? (
        <TranslationFormModal
          title="Add translation"
          submitting={createTranslation.isPending}
          onSubmit={async (values) => {
            await createTranslation.mutateAsync(values);
            resetToFirstPage();
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <TranslationFormModal
          title="Edit translation"
          initial={editing}
          submitting={updateTranslation.isPending}
          onSubmit={async (values) => {
            await updateTranslation.mutateAsync({ id: editing.id, body: values });
            resetToFirstPage();
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function TranslationFormModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: TranslationResponse;
  submitting: boolean;
  onSubmit: (values: CreateTranslationInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    screen: initial?.screen ?? '',
    labelKey: initial?.labelKey ?? '',
    locale: initial?.locale ?? '',
    content: initial?.content ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit(form);
    } catch (err) {
      // Surfaces the server's own 409 (duplicate screen/labelKey/locale, on both
      // create and update) directly — not re-derived or guessed at client-side.
      setError(err instanceof ApiError ? err.message : 'Could not save this translation.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Screen" htmlFor="translation-screen" hint="The app screen this label belongs to (e.g. &quot;login&quot;).">
          <TextField required value={form.screen} onChange={(e) => setForm((f) => ({ ...f, screen: e.target.value }))} />
        </Field>
        <Field label="Label key" htmlFor="translation-label-key" hint="The label key within that screen (e.g. &quot;welcomeMessage&quot;).">
          <TextField required value={form.labelKey} onChange={(e) => setForm((f) => ({ ...f, labelKey: e.target.value }))} />
        </Field>
        <Field label="Locale" htmlFor="translation-locale" hint="Free text — no canonical language code list is confirmed yet (domain-rules §1).">
          <TextField required value={form.locale} onChange={(e) => setForm((f) => ({ ...f, locale: e.target.value }))} />
        </Field>
        <Field label="Content" htmlFor="translation-content">
          <TextArea required rows={4} value={form.content} onChange={(e) => setForm((f) => ({ ...f, content: e.target.value }))} />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          {initial ? 'Save' : 'Add'}
        </Button>
      </form>
    </Modal>
  );
}
