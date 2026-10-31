import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBanner, Field, Modal, PageHeader, Spinner, SuccessBanner, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import {
  PAPER_PHOTO_TYPES,
  useArchiveWaiver,
  useCreateWaiver,
  useRecordPaperSignature,
  useRemindWaiver,
  useUnarchiveWaiver,
  useUpdateWaiver,
  useWaivers,
  useWaiverSettings,
  useWaiverSignature,
  useWaiverSignatures,
  useWaiverSignatureSummary,
  type WaiverResponse,
  type WaiverSignatureResponse,
} from './waiverQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { WaiverFormModal } from './WaiverFormModal';
import { GuestSignaturesPanel } from './GuestSignaturesPanel';
import { SignedDocumentsExportModal } from './SignedDocumentsExportModal';
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
  const navigate = useNavigate();
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
  const [confirmingArchive, setConfirmingArchive] = useState<WaiverResponse | null>(null);
  // Decision 315 item 13: a ZIP of every signed document at the School.
  const [exportingAll, setExportingAll] = useState(false);

  // Only the owner has this page; anyone else goes to their own home screen
  // (Waivers review W12, same as Staff/Instructors/Timetable).
  if (!schoolId) return <Navigate to="/" replace />;
  if (isLoading) return <Spinner />;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('waivers.loadFailed')} />;

  // Newest first (Waivers review W14: the API returns them in id order).
  const allWaivers = [...(data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const archivedCount = allWaivers.filter((w) => w.archivedAt).length;
  const waivers = showArchived ? allWaivers : allWaivers.filter((w) => !w.archivedAt);
  const selected = waivers.find((w) => w.id === selectedId) ?? waivers[0];

  return (
    <>
      <PageHeader
        title={t('waivers.title')}
        subtitle={t('waivers.subtitle')}
        actions={
          <div style={{ display: 'flex', gap: 8 }}>
            <Button variant="secondary" onClick={() => setExportingAll(true)}>
              {t('waivers.exportAll.button')}
            </Button>
            <Button variant="secondary" onClick={() => navigate('/waivers/settings')}>
              {t('waivers.settings.open')}
            </Button>
            <Button onClick={() => setCreating(true)}>{t('waivers.addWaiver')}</Button>
          </div>
        }
      />
      {exportingAll ? <SignedDocumentsExportModal schoolId={schoolId} onClose={() => setExportingAll(false)} /> : null}

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
                  {/* Decision 226 — School Owner/Manager only, idempotent;
                      always allowed since Decision 354 (signatures stay). */}
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
                      onClick={() => { setActionError(null); setConfirmingArchive(selected); }}
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

              <SignaturesPanel schoolId={schoolId} waiver={selected} />
              <GuestSignaturesPanel schoolId={schoolId} waiverId={selected.id} />
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
            const created = await createWaiver.mutateAsync(values);
            setSelectedId(created.id);
            setShowArchived(false);
            setCreating(false);
          }}
          onClose={() => setCreating(false)}
        />
      ) : null}

      {confirmingArchive ? (
        <ConfirmDeleteModal
          title={t('waivers.archiveConfirmTitle', { title: confirmingArchive.title })}
          description={t('waivers.archiveConfirmDescription')}
          confirmLabel={t('waivers.archive')}
          genericErrorMessage={t('waivers.archiveFailed')}
          onConfirm={() => archiveWaiver.mutateAsync(confirmingArchive.id)}
          onClose={() => setConfirmingArchive(null)}
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
 * Who has signed, and who still needs to. Unsigned entries are only for
 * current students; a signature from someone who has left stays, under
 * "Former students" (Waivers review W1). Tabs and A-to-Z order (W8, W14).
 * Opening a signature shows exactly what was signed (W3). The first 100,
 * then "Load more"; the server sorts, filters and searches, current students
 * before former ones (Decision 418).
 */
type SignatureTab = 'all' | 'signed' | 'unsigned';
const SEARCH_DEBOUNCE_MS = 300;

function signatureName(s: WaiverSignatureResponse, t: TranslateFn): string {
  return s.studentName ?? s.signerFullName ?? t('waivers.signatures.unknownStudent');
}

function SignaturesPanel({ schoolId, waiver }: { schoolId: string; waiver: WaiverResponse }) {
  const t = useT();
  const [tab, setTab] = useState<SignatureTab>('all');
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setQ(search.trim()), SEARCH_DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [search]);
  const list = useWaiverSignatures(schoolId, waiver.id, { filter: tab === 'all' ? undefined : tab, q });
  const { data, isLoading, error } = list;
  const settings = useWaiverSettings(schoolId);
  const remind = useRemindWaiver(schoolId, waiver.id);
  const [opened, setOpened] = useState<WaiverSignatureResponse | null>(null);
  const [recording, setRecording] = useState<WaiverSignatureResponse | null>(null);
  const [remindNote, setRemindNote] = useState<{ ok: boolean; text: string } | null>(null);
  // Decision 354: paper signatures (if the School allows them) and reminders
  // are for current students' unsigned entries on a waiver still in use.
  const canRecordPaper = !waiver.archivedAt && !!settings.data?.waiverPaperSignaturesAllowed;
  const isOpenEntry = (s: WaiverSignatureResponse) => !s.formerStudent && (s.status === 'UNSIGNED' || s.status === 'PENDING');

  async function sendReminders() {
    setRemindNote(null);
    try {
      const { reminded } = await remind.mutateAsync();
      setRemindNote({ ok: true, text: reminded > 0 ? t('waivers.remind.sent', { count: reminded }) : t('waivers.remind.none') });
    } catch (err) {
      setRemindNote({ ok: false, text: err instanceof ApiError ? err.message : t('waivers.remind.failed') });
    }
  }
  // The totals are the whole roster's, whatever the tab or search.
  const summary = data?.pages[0]?.summary;
  const shown = data?.pages.flatMap((page) => page.items) ?? [];
  const narrowed = tab !== 'all' || q !== '';
  // Nobody on the list at all: no tabs or search to offer.
  const nobody = !narrowed && shown.length === 0;
  const current = shown.filter((s) => !s.formerStudent);
  const former = shown.filter((s) => s.formerStudent);

  const row = (s: WaiverSignatureResponse) => (
    <li key={s.id} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <button
        type="button"
        disabled={s.status !== 'SIGNED' && s.status !== 'EXPIRED'}
        onClick={() => setOpened(s)}
        style={{
          width: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
          padding: '8px 12px',
          border: 'none',
          borderRadius: 'var(--radius-md)',
          background: 'var(--surface-1)',
          textAlign: 'left',
          cursor: s.status === 'SIGNED' || s.status === 'EXPIRED' ? 'pointer' : 'default',
        }}
      >
        <span style={{ fontSize: 14, color: 'var(--text-primary)' }}>{signatureName(s, t)}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.signedDate ? formatUpdatedLabel(s.signedDate) : '—'}</span>
          <Badge variant={statusBadgeVariant(s.status)}>{SIGNATURE_STATUS_LABEL[s.status] ? t(SIGNATURE_STATUS_LABEL[s.status]!) : s.status}</Badge>
        </span>
      </button>
      {canRecordPaper && isOpenEntry(s) ? (
        <Button variant="secondary" onClick={() => setRecording(s)} aria-label={`${t('waivers.paper.record')}: ${signatureName(s, t)}`}>
          {t('waivers.paper.record')}
        </Button>
      ) : null}
    </li>
  );

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
      {!waiver.archivedAt && summary && summary.unsigned + summary.pending > 0 ? (
        <div style={{ marginBottom: 8 }}>
          <Button variant="secondary" onClick={sendReminders} loading={remind.isPending}>
            {t('waivers.remind.button')}
          </Button>
        </div>
      ) : null}
      {remindNote ? remindNote.ok ? <SuccessBanner message={remindNote.text} /> : <ErrorBanner message={remindNote.text} /> : null}
      {!isLoading && !error && !nobody ? (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <div className="ultm8-view-toggle" role="group" aria-label={t('waivers.signatures.filterLabel')}>
            {(['all', 'signed', 'unsigned'] as const).map((key) => (
              <button
                key={key}
                type="button"
                className={['ultm8-view-toggle__btn', tab === key ? 'ultm8-view-toggle__btn--active' : ''].join(' ').trim()}
                aria-pressed={tab === key}
                onClick={() => setTab(key)}
              >
                {t(`waivers.signatures.tab_${key}` as TranslationKey)}
              </button>
            ))}
          </div>
          <div style={{ minWidth: 200, flex: '1 1 200px', maxWidth: 320 }}>
            <TextField
              id="waiver-signatures-search"
              type="search"
              aria-label={t('waivers.signatures.search')}
              placeholder={t('waivers.signatures.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
      ) : null}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <ErrorBanner message={error instanceof ApiError ? error.message : t('waivers.signatures.loadFailed')} />
      ) : nobody ? (
        <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{t('waivers.signatures.empty')}</p>
      ) : (
        <>
          {shown.length === 0 ? (
            <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: 0 }}>{q ? t('waivers.signatures.noMatch') : t('waivers.signatures.noneInTab')}</p>
          ) : null}
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{current.map(row)}</ul>
          {former.length > 0 ? (
            <>
              <h4 style={{ fontSize: 13, margin: '16px 0 8px', color: 'var(--text-secondary)' }}>{t('waivers.signatures.formerStudents')}</h4>
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>{former.map(row)}</ul>
            </>
          ) : null}
          {list.hasNextPage ? (
            <div style={{ marginTop: 12 }}>
              <Button variant="secondary" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
                {t('waivers.signatures.loadMore')}
              </Button>
            </div>
          ) : null}
        </>
      )}
      {opened ? <SignatureDetailModal schoolId={schoolId} signature={opened} waiver={waiver} onClose={() => setOpened(null)} /> : null}
      {recording ? <PaperSignatureModal schoolId={schoolId} waiver={waiver} signature={recording} onClose={() => setRecording(null)} /> : null}
    </div>
  );
}

/** One signature, as signed: who, when, the typed and drawn signature, and
 * the wording they agreed to (Waivers review W3). Signatures from before
 * copies were kept say so rather than showing today's text. */
function SignatureDetailModal({ schoolId, signature, waiver, onClose }: { schoolId: string; signature: WaiverSignatureResponse; waiver: WaiverResponse; onClose: () => void }) {
  const t = useT();
  const detail = useWaiverSignature(schoolId, waiver.id, signature.id);
  const signedBody = detail.data?.signedWaiverBody;
  const byGuardian = signature.signedById !== null && signature.signedById !== signature.studentId;
  const onPaper = signature.method === 'PAPER';
  const recordedByName = detail.data?.recordedByName;
  // Only signatures with a kept copy can tell; updatedAt also moves on
  // archive/unarchive, so it can't stand in for older ones.
  const editedSince = signature.signedWaiverVersion != null && signature.signedWaiverVersion !== waiver.version;
  const label = { fontSize: 12, color: 'var(--text-muted)', margin: 0 };
  const value = { fontSize: 14, color: 'var(--text-primary)', margin: '2px 0 12px' };
  return (
    <Modal title={t('waivers.signatureDetail.title', { name: signatureName(signature, t) })} onClose={onClose} wide>
      <p style={label}>{t('waivers.signatureDetail.signedName')}</p>
      <p style={value}>{signature.signerFullName ?? '—'}{byGuardian ? ` · ${t('waivers.signatureDetail.byGuardian')}` : ''}</p>
      {onPaper ? (
        <p style={value}>{recordedByName ? t('waivers.paper.recordedBy', { name: recordedByName }) : t('waivers.paper.recorded')}</p>
      ) : (
        <>
          <p style={label}>{t('waivers.signatureDetail.signature')}</p>
          <p style={value}>{signature.signatureText ?? '—'}</p>
        </>
      )}
      {signature.signatureImageUrl ? (
        <img
          src={signature.signatureImageUrl}
          alt={onPaper ? t('waivers.paper.photoAlt') : t('waivers.signatureDetail.drawnAlt')}
          style={{ maxWidth: onPaper ? '100%' : 320, background: '#fff', borderRadius: 'var(--radius-md)', marginBottom: 12 }}
        />
      ) : null}
      <p style={label}>{t('waivers.signatureDetail.signedOn')}</p>
      <p style={value}>{signature.signedDate ? formatUpdatedLabel(signature.signedDate) : '—'}</p>
      <p style={label}>{t('waivers.signatureDetail.textSigned')}</p>
      {editedSince ? <p style={{ ...value, color: 'var(--text-secondary)' }}>{t('waivers.signatureDetail.editedSince')}</p> : null}
      {detail.isLoading ? (
        <Spinner />
      ) : detail.error ? (
        <ErrorBanner message={detail.error instanceof ApiError ? detail.error.message : t('waivers.signatures.loadFailed')} />
      ) : signedBody != null ? (
        <div style={{ whiteSpace: 'pre-line', maxWidth: '70ch', fontSize: 14, lineHeight: 1.6, color: 'var(--text-primary)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: 12 }}>
          <strong>{signature.signedWaiverTitle}</strong>
          {'\n\n'}
          {signedBody}
        </div>
      ) : (
        <p style={value}>{t('waivers.signatureDetail.notRecorded')}</p>
      )}
    </Modal>
  );
}

/** Record a waiver signed on paper (Decision 354): who signed, when, and a
 * photo of the paper. Kept with the staff member who recorded it. */
function PaperSignatureModal({ schoolId, waiver, signature, onClose }: { schoolId: string; waiver: WaiverResponse; signature: WaiverSignatureResponse; onClose: () => void }) {
  const t = useT();
  const record = useRecordPaperSignature(schoolId, waiver.id);
  const today = new Date();
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const [signerFullName, setSignerFullName] = useState(signature.studentName ?? '');
  const [signedDate, setSignedDate] = useState(todayIso);
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!photo || !PAPER_PHOTO_TYPES.includes(photo.type as (typeof PAPER_PHOTO_TYPES)[number])) {
      setError(t('waivers.paper.photoType'));
      return;
    }
    try {
      await record.mutateAsync({ signatureId: signature.id, signerFullName: signerFullName.trim(), signedDate, photo, uploadFailed: t('waivers.paper.uploadFailed') });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : err instanceof Error ? err.message : t('common.tryAgain'));
    }
  }

  return (
    <Modal title={t('waivers.paper.title', { name: signatureName(signature, t) })} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 0 }}>{t('waivers.paper.intro')}</p>
        <Field label={t('waivers.paper.signerName')} htmlFor="paper-signer" hint={t('waivers.paper.signerHint')}>
          <TextField id="paper-signer" required value={signerFullName} onChange={(e) => setSignerFullName(e.target.value)} />
        </Field>
        <Field label={t('waivers.paper.date')} htmlFor="paper-date">
          <TextField id="paper-date" type="date" required max={todayIso} value={signedDate} onChange={(e) => setSignedDate(e.target.value)} />
        </Field>
        <Field label={t('waivers.paper.photo')} htmlFor="paper-photo" hint={t('waivers.paper.photoHint')}>
          <input id="paper-photo" type="file" accept="image/jpeg,image/png" onChange={(e) => setPhoto(e.target.files?.[0] ?? null)} />
        </Field>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={record.isPending} disabled={!signerFullName.trim() || !signedDate || !photo}>
            {t('waivers.paper.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Editing a waiver people have signed asks, when the wording changes,
 * whether it is a small fix or new terms everyone signs again (Decision 354,
 * Waivers review W3b). */
function EditWaiverModal({ schoolId, waiver, onClose }: { schoolId: string; waiver: WaiverResponse; onClose: () => void }) {
  const t = useT();
  const updateWaiver = useUpdateWaiver(schoolId, waiver.id);
  const signatureSummary = useWaiverSignatureSummary(schoolId, waiver.id);
  const [pending, setPending] = useState<{ title: string; body: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const signedCount = signatureSummary.data?.signed ?? 0;

  async function saveWith(values: { title: string; body: string }, resign: boolean) {
    setError(null);
    try {
      await updateWaiver.mutateAsync({ ...values, ...(resign ? { resign: true } : {}) });
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    }
  }

  if (pending) {
    return (
      <Modal title={t('waivers.resign.title')} onClose={() => setPending(null)}>
        {error ? <ErrorBanner message={error} /> : null}
        <p style={{ marginTop: 0 }}>{t('waivers.resign.body', { count: signedCount })}</p>
        <div style={{ display: 'grid', gap: 12 }}>
          <div>
            <Button variant="secondary" loading={updateWaiver.isPending} onClick={() => saveWith(pending, false)}>
              {t('waivers.resign.keep')}
            </Button>
            <p className="ultm8-field__hint" style={{ margin: '4px 0 0' }}>{t('waivers.resign.keepHint')}</p>
          </div>
          <div>
            <Button loading={updateWaiver.isPending} onClick={() => saveWith(pending, true)}>
              {t('waivers.resign.resign')}
            </Button>
            <p className="ultm8-field__hint" style={{ margin: '4px 0 0' }}>{t('waivers.resign.resignHint')}</p>
          </div>
          <div>
            <Button variant="secondary" onClick={() => setPending(null)}>
              {t('common.cancel')}
            </Button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <WaiverFormModal
      title={t('waivers.editWaiver')}
      initial={waiver}
      submitting={updateWaiver.isPending}
      onSubmit={async (values) => {
        const wordingChanged = values.title !== waiver.title || values.body !== waiver.body;
        if (wordingChanged && signedCount > 0) {
          setPending(values);
          return;
        }
        await updateWaiver.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
