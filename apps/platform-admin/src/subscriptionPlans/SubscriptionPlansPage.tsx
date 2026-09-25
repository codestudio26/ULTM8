import React, { useEffect, useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, Table, TextArea, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import {
  useCreateSubscriptionPlan,
  useSubscriptionPlans,
  useUpdateSubscriptionPlan,
  type CreateSubscriptionPlanInput,
  type SubscriptionPlanResponse,
} from './subscriptionPlanQueries';

/** Minimal minor-unit money display — same "first cut, not a finished i18n-aware
 * formatter" reasoning apps/school-portal/src/lib/money.ts's own header comment
 * gives; not shared from there since this is the only screen in this app showing
 * a currency amount today. SubscriptionPlan.price has no per-plan currency field —
 * it's always the single USD anchor currency (Decision 7). */
function formatPrice(minorUnits: number): string {
  return `$${(minorUnits / 100).toFixed(2)}`;
}

/** SubscriptionPlansModule's authoring UI (Phase 54's backend, Phase 55's UI) — Plan
 * CRUD for the platform-level Franchise/School billing relationship (ultm8-nestjs-
 * module §5), FULL_ADMIN-only server-side for every write (this screen's nav isn't
 * role-gated client-side — the backend is the real authorization boundary, same
 * convention every other screen in this app already follows). No delete action —
 * PlatformAdminSubscriptionPlansController has no DELETE route (an already-
 * subscribed Franchise/School has no confirmed, safe orphaning behavior — see
 * SubscriptionPlan's own schema.prisma comment).
 *
 * No screen/locale-style filters the way TranslationsPage has — a platform's
 * SubscriptionPlan set is a small, admin-curated list (a handful of tiers), not
 * content that grows unbounded the way per-screen/per-locale translations do.
 * Pagination/accumulation-into-one-list pattern otherwise mirrors TranslationsPage
 * exactly, including resetting to the first page after every create/update. */
export function SubscriptionPlansPage() {
  const [cursor, setCursor] = useState<string | null>(null);
  const [items, setItems] = useState<SubscriptionPlanResponse[]>([]);

  const query = useSubscriptionPlans(cursor);
  const createPlan = useCreateSubscriptionPlan();
  const updatePlan = useUpdateSubscriptionPlan();

  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlanResponse | null>(null);

  useEffect(() => {
    if (query.data) {
      setItems((prev) => (cursor === null ? query.data.items : [...prev, ...query.data.items]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  function resetToFirstPage() {
    setCursor(null);
  }

  return (
    <>
      <PageHeader
        title="Subscription Plans"
        subtitle="The platform-level billing tiers Franchises/Schools subscribe to — ULTM8's own revenue, not a School's Membership Plans. Adding and editing are Full Admin-only."
        actions={<Button onClick={() => setCreating(true)}>Add plan</Button>}
      />

      {query.error ? (
        <ErrorBanner message={query.error instanceof ApiError ? query.error.message : 'Could not load subscription plans.'} />
      ) : null}

      <Card>
        {query.isLoading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <EmptyState title="No subscription plans yet" description="Add one to start offering platform billing to Franchises/Schools." />
        ) : (
          <Table<SubscriptionPlanResponse>
            rows={items}
            columns={[
              { key: 'name', header: 'Name', render: (p) => p.name },
              { key: 'price', header: 'Price', render: (p) => `${formatPrice(p.price)} / month` },
              {
                key: 'description',
                header: 'Description',
                render: (p) => <span style={{ whiteSpace: 'pre-wrap' }}>{p.description ?? '—'}</span>,
              },
              {
                key: 'featureList',
                header: 'Features',
                render: (p) => (p.featureList.length ? p.featureList.join(', ') : '—'),
              },
              {
                key: 'actions',
                header: '',
                render: (p) => (
                  <Button variant="secondary" onClick={() => setEditing(p)}>
                    Edit
                  </Button>
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
        <SubscriptionPlanFormModal
          title="Add subscription plan"
          submitting={createPlan.isPending}
          onSubmit={async (values) => {
            await createPlan.mutateAsync(values);
            resetToFirstPage();
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <SubscriptionPlanFormModal
          title="Edit subscription plan"
          initial={editing}
          submitting={updatePlan.isPending}
          onSubmit={async (values) => {
            await updatePlan.mutateAsync({ id: editing.id, body: values });
            resetToFirstPage();
            setEditing(null);
          }}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </>
  );
}

function SubscriptionPlanFormModal({
  title,
  initial,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: SubscriptionPlanResponse;
  submitting: boolean;
  onSubmit: (values: CreateSubscriptionPlanInput) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? '',
    description: initial?.description ?? '',
    price: initial?.price?.toString() ?? '0',
    // One feature per line in the textarea — CreateSubscriptionPlanDto.featureList
    // is string[]; split/joined on submit rather than a tag-editor UI, same
    // reasonable-minimum-scope call TranslationsPage's own form makes for its
    // single-line fields.
    featureList: initial?.featureList?.join('\n') ?? '',
  });
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await onSubmit({
        name: form.name,
        description: form.description || undefined,
        price: Number(form.price),
        featureList: form.featureList
          .split('\n')
          .map((line) => line.trim())
          .filter((line) => line.length > 0),
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save this subscription plan.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Name" htmlFor="plan-name" hint='e.g. &quot;Growth&quot;.'>
          <TextField required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Description" htmlFor="plan-description">
          <TextArea rows={3} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <Field label="Price" htmlFor="plan-price" hint="Minor currency unit (e.g. cents), single USD anchor currency (Decision 7).">
          <TextField type="number" min={0} required value={form.price} onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
        </Field>
        <Field label="Feature list" htmlFor="plan-features" hint="One feature per line — shown as marketing bullets alongside the plan.">
          <TextArea rows={4} value={form.featureList} onChange={(e) => setForm((f) => ({ ...f, featureList: e.target.value }))} />
        </Field>
        <Button type="submit" fullWidth loading={submitting}>
          {initial ? 'Save' : 'Add'}
        </Button>
      </form>
    </Modal>
  );
}
