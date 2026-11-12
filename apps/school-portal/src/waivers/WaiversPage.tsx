import React, { useEffect, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, ErrorBanner, Field, Modal, ModalActions, Spinner, TextField } from '@ultm8/ui';
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
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { Note, Pill, Tag, type TagKind } from './WaiversLook';
import { useT, type TranslateFn, type TranslationKey } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import './waivers.css';

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

/**
 * Waivers in the new look (Decision 453): the white page header, then the
 * Split-Pane Reader (the waivers list beside the selected waiver's text), and
 * the selected waiver's Signatures and Guest signatures in the right-hand
 * panel. Nothing is shown twice: the title, the Archived tag and the reading
 * time are on the list row, so the reader leaves them out (DESIGN.md →
 * "nothing shown twice"). On a phone the panel moves below, tapping a waiver
 * shrinks the list to it, and Export moves under ⋯ More.
 */
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
  // Phone only (DESIGN.md → "Phone layout"): tapping a waiver shrinks the
  // list to it; "Show all waivers (N)" brings the list back.
  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // Only the owner has this page; anyone else goes to their own home screen
  // (Waivers review W12, same as Staff/Instructors/Timetable).
  if (!schoolId) return <Navigate to="/" replace />;

  // Newest first (Waivers review W14: the API returns them in id order).
  const allWaivers = [...(data?.items ?? [])].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const archivedCount = allWaivers.filter((w) => w.archivedAt).length;
  const waivers = showArchived ? allWaivers : allWaivers.filter((w) => !w.archivedAt);
  const selected = waivers.find((w) => w.id === selectedId) ?? waivers[0];

  const header = (
    <NewLookPageHeader
      title={t('waivers.title')}
      subtitle={t('waivers.subtitle')}
      actions={
        <>
          {/* On a phone Export moves under ⋯ More (DESIGN.md → "Phone layout": toolbars). */}
          <div className="u8w-more">
            <button
              type="button"
              className="u8w-pill u8w-more__button"
              aria-label={t('waivers.list.moreActions')}
              aria-expanded={moreOpen}
              aria-controls="waivers-more"
              onClick={() => setMoreOpen((o) => !o)}
            >
              <span aria-hidden="true">⋯</span>
            </button>
            <div id="waivers-more" className="u8w-more__items" data-open={moreOpen ? 'true' : 'false'}>
              <Pill onClick={() => setExportingAll(true)}>{t('waivers.exportAll.button')}</Pill>
            </div>
          </div>
          <Pill onClick={() => navigate('/waivers/settings')}>{t('waivers.settings.open')}</Pill>
          <Pill primary onClick={() => setCreating(true)}>
            {t('waivers.addWaiver')}
          </Pill>
        </>
      }
    />
  );

  const pick = (id: string) => {
    setSelectedId(id);
    setCollapsed(true);
  };

  let body: React.ReactNode;
  if (isLoading) {
    body = <Spinner />;
  } else if (error) {
    body = <Note kind="error" message={error instanceof ApiError ? error.message : t('waivers.loadFailed')} />;
  } else {
    body = (
      <div className="u8w-split" data-collapsed={collapsed && !!selected ? 'true' : 'false'}>
        <div className="u8w-split__grid">
          <section className="u8w-card u8w-list" aria-label={t('waivers.title')}>
            {/* Decision 226 — archived Waivers are hidden by default. */}
            <div className="u8w-list__toolbar">
              <button type="button" className="u8w-chip" aria-pressed={showArchived} onClick={() => setShowArchived((v) => !v)}>
                {archivedCount ? t('waivers.showArchivedCount', { count: archivedCount }) : t('waivers.showArchived')}
              </button>
            </div>
            {waivers.length === 0 ? (
              <div className="u8w-empty">
                <p className="u8w-empty__title">{t('waivers.emptyTitle')}</p>
                <p>{t('waivers.emptyDescription')}</p>
              </div>
            ) : (
              <>
                <ul className="u8w-list__rows">
                  {waivers.map((w) => {
                    const isActive = w.id === selected?.id;
                    return (
                      <li key={w.id} data-sel={isActive ? 'true' : 'false'}>
                        <button type="button" className="u8w-row" aria-pressed={isActive} onClick={() => pick(w.id)}>
                          <span className="u8w-row__title">
                            {w.title}
                            {w.archivedAt ? <Tag>{t('waivers.archived')}</Tag> : null}
                          </span>
                          <span className="u8w-row__preview">{rowPreview(w.body)}</span>
                          <span className="u8w-row__meta">{estimateReading(w.body, t)}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
                <button type="button" className="u8w-list__show-all" onClick={() => setCollapsed(false)}>
                  {t('waivers.list.showAll', { count: waivers.length })}
                </button>
              </>
            )}
          </section>
  
          {selected ? (
            <section className="u8w-card u8w-reader" aria-label={selected.title}>
              <div className="u8w-reader__head">
                <p className="u8w-reader__updated">{t('waivers.lastUpdated', { date: formatUpdatedLabel(selected.updatedAt) })}</p>
                <div className="u8w-pair">
                  <Pill onClick={() => setEditing(selected)}>{t('waivers.edit')}</Pill>
                  {/* Decision 226 — School Owner/Manager only, idempotent;
                      always allowed since Decision 354 (signatures stay). */}
                  {selected.archivedAt ? (
                    <Pill
                      onClick={() => {
                        setActionError(null);
                        unarchiveWaiver.mutate(selected.id, { onError: (err) => setActionError(err instanceof ApiError ? err.message : t('waivers.unarchiveFailed')) });
                      }}
                    >
                      {t('waivers.unarchive')}
                    </Pill>
                  ) : (
                    <Pill
                      onClick={() => {
                        setActionError(null);
                        setConfirmingArchive(selected);
                      }}
                    >
                      {t('waivers.archive')}
                    </Pill>
                  )}
                </div>
              </div>
              <div className="u8w-reader__text">{selected.body}</div>
            </section>
          ) : null}
        </div>
      </div>
    );
  }

  const inspector =
    !isLoading && !error && selected ? (
      <>
        <SignaturesPanel schoolId={schoolId} waiver={selected} />
        <GuestSignaturesPanel schoolId={schoolId} waiverId={selected.id} />
      </>
    ) : undefined;

  return (
    <div className="u8w">
      {header}
      {exportingAll ? <SignedDocumentsExportModal schoolId={schoolId} onClose={() => setExportingAll(false)} /> : null}
      <NewLookPage inspector={inspector}>
        {actionError ? <Note kind="error" message={actionError} /> : null}
        {body}
      </NewLookPage>

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
          description={`${t('waivers.archiveConfirmDescription')} ${t('waivers.retention.note')}`}
          confirmLabel={t('waivers.archive')}
          genericErrorMessage={t('waivers.archiveFailed')}
          onConfirm={() => archiveWaiver.mutateAsync(confirmingArchive.id)}
          onClose={() => setConfirmingArchive(null)}
        />
      ) : null}

      {editing ? <EditWaiverModal schoolId={schoolId} waiver={editing} onClose={() => setEditing(null)} /> : null}
    </div>
  );
}

const SIGNATURE_STATUS_LABEL: Record<string, TranslationKey> = {
  SIGNED: 'waivers.signatures.statusSigned',
  UNSIGNED: 'waivers.signatures.statusUnsigned',
  EXPIRED: 'waivers.signatures.statusExpired',
  PENDING: 'waivers.signatures.statusPending',
};

/** Tag colour per status — SIGNED is the only unambiguously "good" state;
 * EXPIRED is the only unambiguously "bad" one. UNSIGNED/PENDING get the
 * neutral tag — an assignment-time row waiting to be signed is not itself a
 * problem, just incomplete. */
function statusTagKind(status: string): TagKind {
  if (status === 'SIGNED') return 'ok';
  if (status === 'EXPIRED') return 'bad';
  return 'plain';
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
  const canRemind = !waiver.archivedAt && !!summary && summary.unsigned + summary.pending > 0;

  const row = (s: WaiverSignatureResponse) => {
    const opens = s.status === 'SIGNED' || s.status === 'EXPIRED';
    return (
      <li key={s.id} className="u8w-sig">
        <button type="button" className="u8w-sig__open" disabled={!opens} onClick={() => setOpened(s)} data-opens={opens ? 'true' : 'false'}>
          <span className="u8w-sig__name">{signatureName(s, t)}</span>
          <span className="u8w-sig__meta">
            <span className="u8w-sig__date">{s.signedDate ? formatUpdatedLabel(s.signedDate) : '—'}</span>
            {s.needsDateOfBirth ? <Tag kind="warn">{t('waivers.retention.needsDateOfBirth')}</Tag> : null}
            <Tag kind={statusTagKind(s.status)}>{SIGNATURE_STATUS_LABEL[s.status] ? t(SIGNATURE_STATUS_LABEL[s.status]!) : s.status}</Tag>
          </span>
        </button>
        {canRecordPaper && isOpenEntry(s) ? (
          <Pill small onClick={() => setRecording(s)} aria-label={`${t('waivers.paper.record')}: ${signatureName(s, t)}`}>
            {t('waivers.paper.record')}
          </Pill>
        ) : null}
      </li>
    );
  };

  return (
    // `<h3>` stays a direct child of this div (not nested inside its own
    // row wrapper) — Playwright's waivers.spec.ts locates this whole panel
    // as `heading.locator('..')`, so wrapping the heading alone in a
    // sub-div would silently exclude everything else (the rollup line, the
    // list/empty-state below) from that locator's scope.
    <div className="u8w-signatures">
      <h3 className="u8n-inspector__label">{t('waivers.signatures.heading')}</h3>
      {summary && summary.total > 0 ? <p className="u8w-signatures__summary">{t('waivers.signatures.summary', { signed: summary.signed, total: summary.total })}</p> : null}
      {summary?.needsDateOfBirth ? (
        // Decision 426 item 4: kept until the child's date of birth is added.
        <p className="u8w-signatures__note">{t('waivers.retention.needsDateOfBirthSummary', { count: summary.needsDateOfBirth })}</p>
      ) : null}
      {!isLoading && !error && !nobody ? (
        <div className="u8w-signatures__tools">
          <div className="u8w-switch" role="group" aria-label={t('waivers.signatures.filterLabel')}>
            {(['all', 'signed', 'unsigned'] as const).map((key) => (
              <button key={key} type="button" className="u8w-switch__btn" aria-pressed={tab === key} onClick={() => setTab(key)}>
                {t(`waivers.signatures.tab_${key}` as TranslationKey)}
              </button>
            ))}
          </div>
          <label className="u8w-search" htmlFor="waiver-signatures-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              id="waiver-signatures-search"
              type="search"
              aria-label={t('waivers.signatures.search')}
              placeholder={t('waivers.signatures.search')}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
        </div>
      ) : null}
      {isLoading ? (
        <Spinner />
      ) : error ? (
        <Note kind="error" message={error instanceof ApiError ? error.message : t('waivers.signatures.loadFailed')} />
      ) : nobody ? (
        <p className="u8w-signatures__empty">{t('waivers.signatures.empty')}</p>
      ) : (
        <>
          {shown.length === 0 ? <p className="u8w-signatures__empty">{q ? t('waivers.signatures.noMatch') : t('waivers.signatures.noneInTab')}</p> : null}
          <ul className="u8w-sigs">{current.map(row)}</ul>
          {former.length > 0 ? (
            <>
              <h4 className="u8w-signatures__sub">{t('waivers.signatures.formerStudents')}</h4>
              <ul className="u8w-sigs">{former.map(row)}</ul>
            </>
          ) : null}
        </>
      )}
      {/* The panel's buttons sit under its content (DESIGN.md → "Side panel buttons sit under the content"). */}
      {list.hasNextPage || canRemind || remindNote ? (
        <div className="u8w-signatures__actions">
          {list.hasNextPage ? (
            <Pill onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>
              {t('waivers.signatures.loadMore')}
            </Pill>
          ) : null}
          {canRemind ? (
            <Pill onClick={sendReminders} loading={remind.isPending}>
              {t('waivers.remind.button')}
            </Pill>
          ) : null}
          {remindNote ? <Note kind={remindNote.ok ? 'success' : 'error'} message={remindNote.text} /> : null}
        </div>
      ) : null}
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
  // Decision 318 item 8: a child signed themselves, in their parent's app.
  const byChildOnParentsAccount = signature.signedViaGuardianId != null;
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
      <p style={value}>{signature.signerFullName ?? '—'}{byGuardian ? ` · ${t('waivers.signatureDetail.byGuardian')}` : ''}
        {byChildOnParentsAccount ? ` · ${t('waivers.signatureDetail.byChildOnParentsAccount')}` : ''}
      </p>
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
        <ModalActions>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" loading={record.isPending} disabled={!signerFullName.trim() || !signedDate || !photo}>
            {t('waivers.paper.save')}
          </Button>
        </ModalActions>
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
        </div>
        {/* The two choices stay above, each with what it means; Cancel sits
            in the dialog's button band. */}
        <ModalActions>
          <Button variant="secondary" onClick={() => setPending(null)}>
            {t('common.cancel')}
          </Button>
        </ModalActions>
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
