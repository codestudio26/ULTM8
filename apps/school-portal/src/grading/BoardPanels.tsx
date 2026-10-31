import React from 'react';
import { Link } from 'react-router-dom';
import { Badge, Button, Card, ErrorBanner, Modal, Spinner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { BeltChip } from './BeltChip';
import type { Rung } from './ladder';
import { type GradingBoardItem, type PromotionEvent, useFeeRequestAction, useRankHistory } from './gradingQueries';
import { useSkills } from '../skills/skillQueries';
import { formatMoney } from '../lib/money';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { feeRankName } from './feeRank';
import { eventRankDisplay, historyTypeLabel } from './historyLabels';

export const fullName = (i: { firstName: string; surname: string }) => `${i.firstName} ${i.surname}`.trim();

const initials = (i: { firstName: string; surname: string }) => `${i.firstName.charAt(0)}${i.surname.charAt(0)}`.toUpperCase();

function formatDay(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/** A student's initials in a grey circle (DESIGN.md → "Avatars"). Photos come
 * with the grading photo data (B6). */
export function Avatar({ person, size }: { person: { firstName: string; surname: string }; size: number }) {
  return (
    <span aria-hidden="true" className="ultm8-avatar" style={{ width: size, height: size, fontSize: Math.round(size * 0.38) }}>
      {initials(person)}
    </span>
  );
}

/** The fee tag on a card or row, first among the tags (Decisions 300, 307, 313). */
export function FeeTag({ item }: { item: GradingBoardItem }) {
  const t = useT();
  if (item.feeStatus === 'blocked') return <Badge variant="danger">{t('grading.board.fee.blocked')}</Badge>;
  if (item.feeStatus === 'waiting') return <Badge variant="warning">{t('grading.board.fee.waiting')}</Badge>;
  if (item.feeStatus === 'declined') return <Badge variant="danger">{t('grading.board.fee.declined')}</Badge>;
  if (item.feeStatus === 'toDecide') return <Badge variant="info">{t('grading.board.fee.toDecide')}</Badge>;
  return null;
}

function Tick({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
      <span aria-hidden="true" style={{ color: ok ? '#3a7556' : 'var(--text-secondary)', width: 14 }}>
        {ok ? '✓' : '○'}
      </span>
      <span>{children}</span>
    </li>
  );
}

/**
 * The right-hand student panel (DESIGN.md → "Grading Board: the student panel
 * never repeats the card"): name, Toward {next rank} with the ticks, the
 * promotion fee box, the skills for the next rank, the last 4 history entries,
 * then Promote and the link to the student's page. The card already shows the
 * belt, the progress bar and Move, so the panel doesn't.
 */
export function StudentPanel({
  item,
  schoolId,
  disciplineId,
  ladder,
  isOwner,
  canPromote,
  fee,
  performerName,
  onPromote,
  onDecide,
  onClose,
}: {
  item: GradingBoardItem;
  schoolId: string;
  disciplineId: string;
  ladder: Rung[];
  isOwner: boolean;
  canPromote: boolean;
  /** The School's promotion fee settings, when the fee is on. */
  fee: { currency: string | null } | null;
  performerName: (userId: string | null | undefined) => string;
  /** Opens the Promote dialog, optionally starting on a rank. */
  onPromote: (targetRungId?: string) => void;
  /** After a fee is cancelled (or a declined one waived): a coach decides. */
  onDecide: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const e = item.eligibility;
  const name = fullName(item);
  const rung = (id: string | null | undefined) => ladder.find((r) => r.id === id) ?? null;
  const next = rung(e.nextRungId);
  const skills = useSkills(disciplineId);
  const history = useRankHistory(item.studentId, schoolId, false);
  const waive = useFeeRequestAction('waive');
  const cancel = useFeeRequestAction('cancel');
  const dismiss = useFeeRequestAction('dismiss');
  const actionError = waive.error ?? cancel.error ?? dismiss.error;
  const request = item.feeRequest ?? null;
  const entries = (history.data?.items ?? []).filter((h: PromotionEvent) => h.studentRankId === item.studentRankId).slice(0, 4);
  const skillName = (id: string) => skills.data?.items.find((s) => s.id === id)?.name ?? t('grading.board.panel.skillFallback');
  const missing = new Set(e.missingSkillIds ?? []);
  const requiredSkills = e.requiredSkillIds ?? [];
  const nextPrice = next?.tier.promotionFeeMinor ?? null;
  const waiting = item.feeStatus === 'waiting';
  const amount = request ? formatMoney(request.amountMinor, request.currency ?? fee?.currency ?? null) : '';
  const rank = request ? feeRankName(request, t) : '';

  async function closeFee(action: 'waive' | 'cancel') {
    if (!request) return;
    const mutation = action === 'waive' ? waive : cancel;
    await mutation.mutateAsync(request.id);
    // Waiving a waiting promotion applies it; a cancelled fee whose promotion
    // couldn't apply goes to no coach (Decision 414 item 1); anything else leaves it to a coach.
    if (!(action === 'waive' && waiting) && item.feeStatus !== 'blocked') onDecide();
  }

  return (
    <Card>
      <section aria-label={t('grading.board.panel.aria', { name })}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <Avatar person={item} size={64} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 18, margin: 0 }}>
              {name}
            </h2>
          </div>
          <button type="button" className="ultm8-round-button" onClick={onClose} aria-label={t('grading.board.panel.close')}>
            ✕
          </button>
        </div>

        {actionError ? <ErrorBanner message={actionError instanceof ApiError ? actionError.message : t('common.tryAgain')} /> : null}

        {request && item.feeStatus ? (
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 10,
              background: item.feeStatus === 'declined' || item.feeStatus === 'blocked' ? 'var(--bg-danger)' : item.feeStatus === 'toDecide' ? '#e5ecf6' : 'var(--bg-warning)',
            }}
          >
            <FeeTag item={item} />
            <p style={{ margin: '8px 0 4px', fontWeight: 600 }}>
              {item.feeStatus === 'toDecide'
                ? t('grading.board.fee.noFeeFor', { rank })
                : t('grading.board.fee.amountFor', { amount, rank })}
            </p>
            <p className="ultm8-field__hint" style={{ margin: 0 }}>
              {item.feeStatus === 'blocked'
                ? t('grading.board.fee.blockedText', { name: item.firstName, rank })
                : item.feeStatus === 'waiting'
                ? t('grading.board.fee.waitingText', { name: item.firstName, rank })
                : item.feeStatus === 'declined'
                  ? t('grading.board.fee.declinedText', { name: item.firstName, rank })
                  : t('grading.board.fee.toDecideText', { name: item.firstName })}
            </p>
            <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
              {item.feeStatus !== 'toDecide' && isOwner ? (
                <>
                  {item.feeStatus !== 'blocked' ? (
                    <Button variant="secondary" onClick={() => closeFee('waive')} loading={waive.isPending}>
                      {t('grading.board.fee.waive')}
                    </Button>
                  ) : null}
                  <Button variant="secondary" onClick={() => closeFee('cancel')} loading={cancel.isPending}>
                    {t('grading.board.fee.cancel')}
                  </Button>
                </>
              ) : null}
              {item.feeStatus === 'toDecide' && canPromote ? (
                <>
                  <Button onClick={() => onPromote(request.toRungId)}>{t('grading.board.fee.promoteTo', { rank })}</Button>
                  <Button variant="secondary" onClick={() => dismiss.mutate(request.id)} loading={dismiss.isPending}>
                    {t('grading.board.fee.dontPromote')}
                  </Button>
                </>
              ) : null}
            </div>
          </div>
        ) : null}

        {e.hasNext && next ? (
          <div style={{ marginTop: 16 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('grading.board.panel.toward', { rank: next.name })}</h3>
            <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
              {!e.timeOnly && (e.requiredClasses ?? 0) > 0 ? (
                <Tick ok={e.classesOk !== false}>{t('grading.board.panel.classes', { counted: e.countedClasses ?? 0, required: e.requiredClasses ?? 0 })}</Tick>
              ) : null}
              {(e.requiredDays ?? 0) > 0 ? (
                <Tick ok={e.daysOk !== false}>{t('grading.board.panel.days', { elapsed: e.elapsedDays ?? 0, required: e.requiredDays ?? 0 })}</Tick>
              ) : null}
              {!e.timeOnly && requiredSkills.length > 0 ? (
                <Tick ok={e.skillsOk !== false}>
                  {t('grading.board.panel.skills', { signedOff: requiredSkills.length - missing.size, required: requiredSkills.length })}
                </Tick>
              ) : null}
            </ul>
            {fee && !request && nextPrice ? (
              <p className="ultm8-field__hint" style={{ margin: '8px 0 0' }}>
                {t('grading.board.fee.priceFor', { rank: next.name, amount: formatMoney(nextPrice, fee.currency) })}
              </p>
            ) : null}
            {!e.timeOnly && requiredSkills.length > 0 ? (
              <>
                <h3 style={{ fontSize: 15, margin: '16px 0 8px' }}>{t('grading.board.panel.skillsFor', { rank: next.name })}</h3>
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 4 }}>
                  {requiredSkills.map((id) => (
                    <Tick key={id} ok={!missing.has(id)}>
                      {skillName(id)}
                    </Tick>
                  ))}
                </ul>
              </>
            ) : null}
          </div>
        ) : null}

        <div style={{ marginTop: 16 }}>
          <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('grading.board.panel.history')}</h3>
          {history.isLoading ? (
            <Spinner />
          ) : entries.length === 0 ? (
            <p className="ultm8-field__hint" style={{ margin: 0 }}>
              {t('grading.board.panel.noHistory')}
            </p>
          ) : (
            <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 10 }}>
              {entries.map((h) => {
                const from = rung(h.fromStripeTierId);
                const to = rung(h.toStripeTierId);
                const labelKey = historyTypeLabel(h.type, eventRankDisplay(ladder, h));
                return (
                  <li key={h.id} style={{ borderTop: '1px solid var(--border)', paddingTop: 8 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <strong>{labelKey ? t(labelKey) : h.type}</strong>
                      <span className="ultm8-field__hint">{formatDay(h.effectiveDate)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '4px 0', flexWrap: 'wrap' }}>
                      {from && from.id !== to?.id ? (
                        <>
                          <BeltChip rung={from} />
                          <span aria-hidden="true">→</span>
                        </>
                      ) : null}
                      {to ? <BeltChip rung={to} /> : null}
                    </div>
                    <div className="ultm8-field__hint">
                      {from && from.id !== to?.id ? `${from.name} → ${to?.name ?? '—'}` : to?.name ?? '—'} · {performerName(h.performedById)}
                    </div>
                    {h.systemNote ? <div className="ultm8-field__hint">{h.systemNote}</div> : null}
                  </li>
                );
              })}
            </ol>
          )}
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
          {canPromote && e.hasNext && !waiting && item.active ? <Button onClick={() => onPromote()}>{t('grading.board.panel.promote')}</Button> : null}
          <Link to={`/students/${item.studentId}`} state={{ name }} className="ultm8-btn ultm8-btn--secondary">
            {t('grading.board.panel.openStudent')}
          </Link>
        </div>
      </section>
    </Card>
  );
}

/**
 * The Selection panel (DESIGN.md → "When the right panel shows"): "N selected",
 * one row per ticked student with their belt → next rank and a ✕, then
 * Promote N students and Clear selection; – makes it a pill.
 */
export function SelectionPanel({
  items,
  ladder,
  hiddenCount,
  onShowHidden,
  onOpen,
  onRemove,
  onPromote,
  onClear,
  onMinimise,
}: {
  items: GradingBoardItem[];
  ladder: Rung[];
  hiddenCount: number;
  onShowHidden: () => void;
  onOpen: (studentId: string) => void;
  onRemove: (studentId: string) => void;
  onPromote: () => void;
  onClear: () => void;
  onMinimise: () => void;
}) {
  const t = useT();
  const rung = (id: string | null | undefined) => ladder.find((r) => r.id === id) ?? null;
  return (
    <Card>
      <section aria-label={t('grading.board.selection.aria')}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 18, margin: 0, flex: 1 }}>
            {t('grading.board.selectedCount', { count: items.length })}
          </h2>
          <button type="button" className="ultm8-round-button" onClick={onMinimise} aria-label={t('grading.board.selection.minimise')}>
            –
          </button>
        </div>
        {hiddenCount > 0 ? (
          <p className="ultm8-field__hint">
            {t('grading.board.hiddenBySearch', { count: hiddenCount })}{' '}
            <Button variant="secondary" onClick={onShowHidden}>
              {t('grading.board.showThem')}
            </Button>
          </p>
        ) : null}
        <ul style={{ listStyle: 'none', padding: 0, margin: '12px 0', display: 'grid', gap: 8, maxHeight: '50vh', overflowY: 'auto' }}>
          {items.map((i) => {
            const from = rung(i.currentStripeId);
            const to = rung(i.eligibility.nextRungId);
            const name = fullName(i);
            return (
              <li key={i.studentId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <Avatar person={i} size={32} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <button
                    type="button"
                    onClick={() => onOpen(i.studentId)}
                    style={{ background: 'none', border: 0, padding: 0, font: 'inherit', fontWeight: 600, cursor: 'pointer', textAlign: 'left' }}
                  >
                    {name}
                  </button>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center', fontSize: 12 }} className="ultm8-field__hint">
                    {from ? <BeltChip rung={from} /> : null}
                    <span aria-hidden="true">→</span>
                    <span>{to?.name ?? '—'}</span>
                  </div>
                </div>
                <button type="button" className="ultm8-round-button" onClick={() => onRemove(i.studentId)} aria-label={t('grading.board.selection.removeAria', { name })}>
                  ✕
                </button>
              </li>
            );
          })}
        </ul>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button onClick={onPromote}>{t('grading.board.selection.promote', { count: items.length })}</Button>
          <Button variant="secondary" onClick={onClear}>
            {t('grading.board.selection.clear')}
          </Button>
        </div>
      </section>
    </Card>
  );
}

/** "Promote {name}?" after a fee is cancelled, or a declined one waived
 * (Decision 307): promoting is a coach's decision and never happens on its
 * own. Not now leaves "Promotion to decide". The board and the Ranks tab. */
export function DecideDialog({
  name,
  firstName,
  rank,
  from,
  to,
  canPromote,
  onPromote,
  onClose,
}: {
  name: string;
  firstName: string;
  /** The planned rank's name, from the fee request. */
  rank: string;
  from: Rung | null;
  to: Rung | null;
  canPromote: boolean;
  onPromote: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const toName = to?.name ?? rank;
  return (
    <Modal title={t('grading.board.decide.title', { name })} onClose={onClose}>
      <p style={{ color: '#2b4f80', marginTop: 0 }}>{t('grading.board.decide.cancelled', { rank: toName })}</p>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        {from ? <BeltChip rung={from} /> : null}
        <span>{from?.name}</span>
        <span aria-hidden="true">→</span>
        {to ? <BeltChip rung={to} /> : null}
        <span>{toName}</span>
      </div>
      <p className="ultm8-field__hint">{t('grading.board.decide.explanation', { name: firstName, rank: toName })}</p>
      <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
        <Button variant="secondary" onClick={onClose}>
          {t('grading.board.decide.notNow')}
        </Button>
        {canPromote ? <Button onClick={onPromote}>{t('grading.board.fee.promoteTo', { rank: toName })}</Button> : null}
      </div>
    </Modal>
  );
}
