import React, { useState } from 'react';
import { Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useCreateWaiver, useUpdateWaiver, useWaivers, type WaiverResponse } from './waiverQueries';
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

              {/* Signatures — proposed, not real. See docs/decisions/POST-SPEC-55-DECISION-LOG.md
                  Decision 125 and docs/v1.2-backend-backlog.md ("Waivers page") for the full
                  finding: there is no staff-facing endpoint to list WaiverSignature rows at
                  all, and even if one existed, a WaiverSignature row only ever represents
                  "signed" today (status defaults to SIGNED; nothing ever creates an
                  Unsigned/Pending row) — so "who hasn't signed yet" can't be answered from
                  WaiverSignature alone without also resolving the Student roster, which has
                  its own separate, larger gap (no real Student-enrollment path in production
                  yet). Shown here, visibly inert, rather than silently omitted. */}
              <div
                title="Not available yet — no staff-facing endpoint exists to list who has signed this Waiver, and the underlying WaiverSignature model has no concept of an 'unsigned' row today. See docs/v1.2-backend-backlog.md."
                style={{
                  marginTop: 24,
                  padding: '14px 18px',
                  border: '1px dashed var(--border-strong)',
                  borderRadius: 'var(--radius-md)',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
              >
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>
                  Signatures
                </span>
                <span style={{ fontSize: 14, color: 'var(--text-muted)' }}>
                  Not available yet — see docs/v1.2-backend-backlog.md
                </span>
              </div>
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
