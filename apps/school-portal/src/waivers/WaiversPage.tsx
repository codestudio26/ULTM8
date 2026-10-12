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

/**
 * v1.2 backend backlog — real data for "who HAS signed, with what status."
 * Deliberately does NOT attempt "who hasn't signed yet" (a roster diff) —
 * that's a separate, still-open product decision this panel doesn't guess
 * at; see docs/v1.2-backend-backlog.md.
 */
function SignaturesPanel({ schoolId, waiverId }: { schoolId: string; waiverId: string }) {
  const { data, isLoading, error } = useWaiverSignatures(schoolId, waiverId);
  const items = data?.items ?? [];

  return (
    <div style={{ marginTop: 24 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 8px', color: 'var(--text-primary)' }}>Signatures</h3>
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
              <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{s.signerFullName}</span>
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{formatUpdatedLabel(s.signedDate)}</span>
                <Badge variant={s.status === 'SIGNED' ? 'success' : s.status === 'EXPIRED' ? 'danger' : undefined}>{s.status}</Badge>
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
