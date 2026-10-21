import React, { useState } from 'react';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useArchiveWaiver, useCreateWaiver, useUnarchiveWaiver, useUpdateWaiver, useWaivers, useWaiverSignatures, type WaiverResponse } from './waiverQueries';
import { WaiverFormModal } from './WaiverFormModal';
import { useT, type TranslateFn, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';

/** Short list-row preview — Waiver.body can run up to 20,000 characters
 * (CreateWaiverDto's own MaxLength), far too long even for a list row. The
 * full text is read in the reader pane instead (see below). */
function rowPreview(body: string): string {
  const flat = body.replace(/\s+/g, ' ').trim();
  return flat.length > 70 ? `${flat.slice(0, 70)}…` : flat;
}

/** Real, client-computed word-count/reading-time estimate — Waiver.body's own
 * length, no backend field needed. Same convention as this session's Waivers
 * concept exploration (Concept 3 — Split-Pane Reader, picked by the user). */
function estimateReading(body: string, t: TranslateFn): string {
  const words = body.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${t('waivers.wordCount', { count: words })} · ${t('waivers.readingTime', { count: minutes })}`;
}

function formatUpdatedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale() ?? 'en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function WaiversPage() {
  const t = useT();
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useWaivers(schoolId);
  const createWaiver = useCreateWaiver(schoolId ?? '');
  const archiveWaiver = useArchiveWaiver(schoolId ?? '');
  const unarchiveWaiver = useUnarchiveWaiver(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WaiverResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  // Decision 226 — archived Waivers are excluded by default, same
  // "excluded by default, visible via a filter" convention this build
  // applies to every one of the 7 entities; the full list (including
  // archived) is always fetched (useWaivers passes includeArchived: true)
  // so this toggle/count never needs a second request.
  const [showArchived, setShowArchived] = useState(false);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('waivers.loadFailed')} />;

  const allWaivers = data?.items ?? [];
  const archivedCount = allWaivers.filter((w) => w.archivedAt).length;
  const waivers = showArchived ? allWaivers : allWaivers.filter((w) => !w.archivedAt);
  const selected = waivers.find((w) => w.id === selectedId) ?? waivers[0];

  return (
    <>
      <PageHeader
        title={t('waivers.title')}
        subtitle={t('waivers.subtitle')}
        actions={<Button onClick={() => setCreating(true)}>{t('waivers.addWaiver')}</Button>}
      />

      {actionError ? <ErrorBanner message={actionError} /> : null}

      {/* Decision 226 — archived Waivers are hidden by default. */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <Checkbox label={archivedCount ? t('waivers.showArchivedCount', { count: archivedCount }) : t('waivers.showArchived')} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
      </div>

      {waivers.length === 0 ? (
        <Card>
          <EmptyState title={t('waivers.emptyTitle')} description={t('waivers.emptyDescription')} />
        </Card>
      ) : (
        <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start' }}>
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {waivers.map((w) => {
              const isActive = w.id === selected?.id;
              return (
                <button
                  key={w.id}
                  onClick={() => setSelectedId(w.id)}
                  style={{
                    textAlign: 'left',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 4,
                    padding: '12px 14px',
                    borderRadius: 'var(--radius-md)',
                    border: 'none',
                    background: isActive ? 'var(--bg-accent)' : 'var(--surface-1)',
                    cursor: 'pointer',
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600, color: isActive ? 'var(--text-accent)' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                    {w.title}
                    {w.archivedAt ? <Badge variant="default">{t('waivers.archived')}</Badge> : null}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{rowPreview(w.body)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{estimateReading(w.body, t)}</span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <div style={{ flex: 1, minWidth: 0 }}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                    {selected.title}
                    {selected.archivedAt ? <Badge variant="default">{t('waivers.archived')}</Badge> : null}
                  </h2>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                    {estimateReading(selected.body, t)} · {t('waivers.lastUpdated', { date: formatUpdatedLabel(selected.updatedAt) })}
                  </p>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button variant="secondary" onClick={() => setEditing(selected)}>
                    {t('waivers.edit')}
                  </Button>
                  {/* Decision 226 — School Owner/Manager only, idempotent,
                      blocked (409) by any WaiverSignature row (signed or
                      unsigned-assignment). */}
                  {selected.archivedAt ? (
                    <Button
                      variant="secondary"
                      onClick={() => { setActionError(null); unarchiveWaiver.mutate(selected.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('waivers.unarchiveFailed')) }); }}
                    >
                      {t('waivers.unarchive')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => { setActionError(null); archiveWaiver.mutate(selected.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('waivers.archiveFailed')) }); }}
                    >
                      {t('waivers.archive')}
                    </Button>
                  )}
                </div>
              </div>

              <div
                style={{
                  whiteSpace: 'pre-line',
                  maxWidth: '70ch',
                  fontSize: 14,
                  lineHeight: 1.6,
                  color: 'var(--text-primary)',
                }}
              >
                {selected.body}
              </div>

              <SignaturesPanel schoolId={schoolId} waiverId={selected.id} />
            </Card>
            </div>
          ) : null}
        </div>
      )}

      {creating ? (
        <WaiverFormModal
          title={t('waivers.addWaiver')}
          submitting={createWaiver.isPending}
          onSubmit={async (values) => {
            await createWaiver.mutateAsync(values);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {editing ? (
        <EditWaiverModal schoolId={schoolId} waiver={editing} onClose={() => setEditing(null)} />
      ) : null}
    </>
  );
}

/** Badge color per status — SIGNED is the only unambiguously "good" state;
 * EXPIRED is the only unambiguously "bad" one. UNSIGNED/PENDING get the
 * neutral/default badge — an assignment-time row waiting to be signed is
 * not itself a problem, just incomplete. */
const SIGNATURE_STATUS_LABEL: Record<string, TranslationKey> = {
  SIGNED: 'waivers.signatures.statusSigned',
  UNSIGNED: 'waivers.signatures.statusUnsigned',
  EXPIRED: 'waivers.signatures.statusExpired',
  PENDING: 'waivers.signatures.statusPending',
};

function statusBadgeVariant(status: string): 'success' | 'danger' | undefined {
  if (status === 'SIGNED') return 'success';
  if (status === 'EXPIRED') return 'danger';
  return undefined;
}

/**
 * v1.2 backend backlog — real data for "who HAS signed, AND who hasn't,
 * with what status." Previously only showed who HAS signed (`sign()` was the
 * only code path that ever wrote a WaiverSignature row, so a row's mere
 * existence meant "signed") — now that the backend writes an explicit
 * Unsigned row at assignment time (WaiverAssignmentService), this same
 * endpoint's response already includes those rows too; this panel now
 * renders them distinctly (their own badge color, their own fallback name —
 * `studentName`, since an Unsigned row has no `signerFullName` yet) and
 * surfaces the backlog's own "Recommended display shape" rollup
 * ("12 of 40 signed") above the roster.
 */
function SignaturesPanel({ schoolId, waiverId }: { schoolId: string; waiverId: string }) {
  const t = useT();
  const { data, isLoading, error } = useWaiverSignatures(schoolId, waiverId);
  const items = data?.items ?? [];
  const summary = data?.summary;

  return (
    // `<h3>` stays a direct child of this div (not nested inside its own
    // row wrapper) — Playwright's waivers.spec.ts locates this whole panel
    // as `heading.locator('..')`, so wrapping the heading alone in a
    // sub-div would silently exclude everything else (the rollup line, the
    // list/empty-state below) from that locator's scope.
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 4px', color: 'var(--text-primary)' }}>{t('waivers.signatures.heading')}</h3>
      {summary && summary.total > 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          {t('waivers.signatures.summary', { signed: summary.signed, total: summary.total })}
        </p>
      ) : null}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : t('waivers.signatures.loadFailed')} />
      ) : items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('waivers.signatures.empty')}</p>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {items.map((s) => (
            <li
              key={s.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                padding: '8px 12px',
                borderRadius: 'var(--radius-md)',
                background: 'var(--surface-1)',
              }}
            >
              <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{s.signerFullName ?? s.studentName ?? t('waivers.signatures.unknownStudent')}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.signedDate ? formatUpdatedLabel(s.signedDate) : '—'}</span>
                <Badge variant={statusBadgeVariant(s.status)}>{SIGNATURE_STATUS_LABEL[s.status] ? t(SIGNATURE_STATUS_LABEL[s.status]!) : s.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditWaiverModal({ schoolId, waiver, onClose }: { schoolId: string; waiver: WaiverResponse; onClose: () => void }) {
  const t = useT();
  const updateWaiver = useUpdateWaiver(schoolId, waiver.id);
  return (
    <WaiverFormModal
      title={t('waivers.editWaiver')}
      initial={waiver}
      submitting={updateWaiver.isPending}
      onSubmit={async (values) => {
        await updateWaiver.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
