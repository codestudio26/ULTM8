import React, { useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCreateWaiver, useUpdateWaiver, useWaivers, useWaiverSignatures, type WaiverResponse } from './waiverQueries';
import { WaiverFormModal } from './WaiverFormModal';

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
function estimateReading(body: string): string {
  const words = body.trim().split(/\s+/).length;
  const minutes = Math.max(1, Math.round(words / 200));
  return `${words} words · ~${minutes} min read`;
}

function formatUpdatedLabel(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

export function WaiversPage() {
  const schoolId = useOwnedSchoolId();
  const { data, isLoading, error } = useWaivers(schoolId);
  const createWaiver = useCreateWaiver(schoolId ?? '');
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WaiverResponse | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  if (!schoolId) return null;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load Waivers.'} />;

  const waivers = data?.items ?? [];
  const selected = waivers.find((w) => w.id === selectedId) ?? waivers[0];

  return (
    <>
      <PageHeader
        title="Waivers"
        subtitle="Liability waivers Students sign before joining your School."
        actions={<Button onClick={() => setCreating(true)}>Add waiver</Button>}
      />

      {waivers.length === 0 ? (
        <Card>
          <EmptyState title="No Waivers yet" description="Add your first Waiver to get started." />
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
                  <span style={{ fontSize: 14, fontWeight: 600, color: isActive ? 'var(--text-accent)' : 'var(--text-primary)' }}>
                    {w.title}
                  </span>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{rowPreview(w.body)}</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{estimateReading(w.body)}</span>
                </button>
              );
            })}
          </div>

          {selected ? (
            <div style={{ flex: 1, minWidth: 0 }}>
            <Card>
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16, marginBottom: 16 }}>
                <div>
                  <h2 style={{ margin: '0 0 4px', fontSize: 20, fontWeight: 600, color: 'var(--text-primary)' }}>{selected.title}</h2>
                  <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)' }}>
                    {estimateReading(selected.body)} · Last updated {formatUpdatedLabel(selected.updatedAt)}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => setEditing(selected)}>
                  Edit
                </Button>
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
          title="Add waiver"
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
      <h3 style={{ fontSize: 15, margin: '0 0 4px', color: 'var(--text-primary)' }}>Signatures</h3>
      {summary && summary.total > 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '0 0 8px' }}>
          {summary.signed} of {summary.total} signed
        </p>
      ) : null}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load signatures.'} />
      ) : items.length === 0 ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>No one has signed this Waiver yet.</p>
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
              <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{s.signerFullName ?? s.studentName ?? 'Unknown Student'}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.signedDate ? formatUpdatedLabel(s.signedDate) : '—'}</span>
                <Badge variant={statusBadgeVariant(s.status)}>{s.status}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EditWaiverModal({ schoolId, waiver, onClose }: { schoolId: string; waiver: WaiverResponse; onClose: () => void }) {
  const updateWaiver = useUpdateWaiver(schoolId, waiver.id);
  return (
    <WaiverFormModal
      title="Edit waiver"
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
