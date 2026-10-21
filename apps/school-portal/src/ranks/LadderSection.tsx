import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Modal } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import type { SkillResponse } from '../skills/skillQueries';
import { BeltChip } from '../grading/BeltChip';
import { BeltEditorModal, type BeltValues } from './BeltEditorModal';
import { moveItem, useDragReorder } from './dragReorder';
import { type RankResponse, useArchiveRank, useCreateRank, useDeleteRank, useReorderRanks, useRungHolders, useUnarchiveRank, useUpdateRank } from './rankQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useT, type TranslateFn } from '../i18n/I18nProvider';

const stripesLabel = (t: TranslateFn, n: number) => (n === 0 ? t('ranks.ladder.noStripes') : t('ranks.ladder.stripes', { count: n }));

type Holder = { studentId: string; firstName: string; surname: string };

/**
 * The style's ladder (roadmap Phase 4, item 1; Decisions 152, 180): belts in
 * order, each with its rungs. Belts are reordered by dragging or with ↑/↓ and saved after a
 * confirmation that lists the students on the belts that move; their rung
 * stays the same, only its place in the ladder changes. Add and edit open the
 * belt editor. Owner only, like every ladder edit.
 */
export function LadderSection({ discipline, skills, ranks }: { discipline: DisciplineResponse; skills: SkillResponse[]; ranks: RankResponse[] }) {
  const holdersQuery = useRungHolders(discipline.id);
  const reorder = useReorderRanks(discipline.id);
  const createRank = useCreateRank(discipline.id);
  const saved = useMemo(() => [...ranks].sort((a, b) => a.order - b.order), [ranks]);
  const [order, setOrder] = useState<string[] | null>(null);
  const [confirming, setConfirming] = useState<Holder[] | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<RankResponse | null>(null);
  const [deleting, setDeleting] = useState<RankResponse | null>(null);
  const deleteRank = useDeleteRank(discipline.id);
  // Decision 226 — reversible alternative to Delete. Shown INLINE (badged),
  // not hidden-by-default the way the other 6 entities' list pages are: the
  // ladder's own "Save order" send every belt's id exactly once
  // (reorderRanks' own validation) — hiding an archived belt from `shown`
  // while leaving it out of a saved reorder would either drop it from the
  // ladder order entirely or need extra bookkeeping to splice it back in.
  // Same "show archived inline, badged" treatment MembershipPlansPage
  // already established as this codebase's other real precedent. Disclosed
  // deviation, not an oversight — see the PR description.
  const archiveRank = useArchiveRank(discipline.id);
  const unarchiveRank = useUnarchiveRank(discipline.id);
  const [error, setError] = useState<string | null>(null);
  const t = useT();

  const holders = useMemo(() => {
    const map = new Map<string, Holder[]>();
    for (const item of holdersQuery.data?.items ?? []) map.set(item.rungId, item.students);
    return map;
  }, [holdersQuery.data]);

  const shown = order ? order.map((id) => saved.find((r) => r.id === id)).filter((r): r is RankResponse => !!r) : saved;
  const changed = !!order && order.some((id, i) => saved[i]?.id !== id);
  const holdersOfBelt = (rank: RankResponse) => rank.stripeTiers.flatMap((t) => holders.get(t.id) ?? []);

  const drag = useDragReorder((from, to) => setOrder(moveItem(order ?? saved.map((r) => r.id), from, to)));

  function move(i: number, delta: number) {
    const ids = (order ?? saved.map((r) => r.id)).slice();
    const j = i + delta;
    if (j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    setOrder(ids);
  }

  async function saveOrder() {
    if (!order) return;
    setError(null);
    try {
      await reorder.mutateAsync(order);
      setOrder(null);
      setConfirming(null);
    } catch (err) {
      setConfirming(null);
      setError(err instanceof ApiError ? err.message : t('ranks.ladder.saveOrderFailed'));
    }
  }

  function askToSave() {
    if (!order) return;
    const moved = order.filter((id, i) => saved[i]?.id !== id).map((id) => saved.find((r) => r.id === id)!);
    const affected = moved.flatMap(holdersOfBelt);
    if (affected.length === 0) void saveOrder();
    else setConfirming(affected);
  }

  return (
    <Card>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 4 }}>
            {t('ranks.ladder.title')}
          </h2>
          <p style={{ margin: 0 }}>{t('ranks.ladder.description')}</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {changed ? (
            <>
              <Button onClick={askToSave} loading={reorder.isPending}>
                {t('ranks.ladder.saveOrder')}
              </Button>
              <Button variant="secondary" onClick={() => setOrder(null)}>
                {t('ranks.ladder.undo')}
              </Button>
            </>
          ) : null}
          <Button onClick={() => setAdding(true)}>{t('ranks.ladder.addRank')}</Button>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {shown.length === 0 ? (
        <EmptyState title={t('ranks.ladder.emptyTitle')} description={t('ranks.ladder.emptyDescription')} />
      ) : (
        <ol aria-label={t('ranks.ladder.title')} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {shown.map((rank, i) => {
            const tiers = [...rank.stripeTiers].sort((a, b) => a.order - b.order);
            const onBelt = holdersOfBelt(rank).length;
            return (
              <li
                key={rank.id}
                aria-label={`${i + 1}. ${rank.name}`}
                {...drag.targetProps(i)}
                style={{ border: `1px solid ${drag.over === i ? 'var(--fill-accent)' : 'var(--border)'}`, borderRadius: 8, padding: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                  <span {...drag.handleProps(i, rank.name)}>⠿</span>
                  <span style={{ width: 20, color: 'var(--text-secondary)' }}>{i + 1}</span>
                  {tiers[0] ? <BeltChip rung={{ id: tiers[0].id, rankId: rank.id, rank, tier: tiers[0], index: 0, name: tiers[0].name }} /> : null}
                  <strong style={{ flex: 1, minWidth: 120 }}>{rank.name}</strong>
                  {rank.archivedAt ? <Badge variant="default">{t('ranks.ladder.archived')}</Badge> : null}
                  <span className="ultm8-field__hint">
                    {stripesLabel(t, Math.max(0, ...tiers.map((tier) => tier.count)))}
                  </span>
                  {onBelt > 0 ? <Badge>{t('ranks.ladder.students', { count: onBelt })}</Badge> : null}
                  <Button variant="secondary" onClick={() => setEditing(rank)} aria-label={t('ranks.editAria', { name: rank.name })}>
                    {t('ranks.edit')}
                  </Button>
                  <Button variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('ranks.moveUpAria', { name: rank.name })}>
                    ↑
                  </Button>
                  <Button variant="secondary" onClick={() => move(i, 1)} disabled={i === shown.length - 1} aria-label={t('ranks.moveDownAria', { name: rank.name })}>
                    ↓
                  </Button>
                  {/* Decision 226 — reversible alternative to Delete below,
                      same School-Owner gate and "safe to remove" rule
                      (holders/history/declared), idempotent. */}
                  {rank.archivedAt ? (
                    <Button
                      variant="secondary"
                      onClick={() => { setError(null); unarchiveRank.mutateAsync(rank.id).catch((err) => setError(err instanceof ApiError ? err.message : t('ranks.ladder.unarchiveFailed'))); }}
                      aria-label={t('ranks.ladder.unarchiveAria', { name: rank.name })}
                    >
                      {t('ranks.ladder.unarchive')}
                    </Button>
                  ) : (
                    <Button
                      variant="secondary"
                      onClick={() => { setError(null); archiveRank.mutateAsync(rank.id).catch((err) => setError(err instanceof ApiError ? err.message : t('ranks.ladder.archiveFailed'))); }}
                      disabled={changed}
                      aria-label={t('ranks.ladder.archiveAria', { name: rank.name })}
                    >
                      {t('ranks.ladder.archive')}
                    </Button>
                  )}
                  <Button variant="secondary" onClick={() => setDeleting(rank)} disabled={changed} aria-label={t('ranks.ladder.deleteAria', { name: rank.name })}>
                    {t('ranks.ladder.delete')}
                  </Button>
                </div>
                <ul style={{ listStyle: 'none', padding: '6px 0 0 30px', margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                  {tiers.map((tier) => (
                    <li key={tier.id} className="ultm8-field__hint">
                      {tier.name}
                      {tier.timeOnly
                        ? ` · ${t('ranks.ladder.tierYears', { years: Math.round(((tier.minimumDaysInRank ?? 0) / 365) * 10) / 10 })}`
                        : tier.classCountMode === 'EACH_TYPE'
                          ? ` · ${(tier.classTypeRequirements as Array<{ classType: string; classesRequired: number }>).map((r) => `${r.classesRequired} ${r.classType}`).join(' + ')}`
                          : tier.classesRequired
                            ? ` · ${t('ranks.ladder.tierClasses', { count: tier.classesRequired })}`
                            : ''}
                      {(tier.requiredSkillIds?.length ?? 0) > 0 ? ` · ${t('ranks.ladder.tierSkills', { count: tier.requiredSkillIds!.length })}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
      {changed ? <p className="ultm8-field__hint">{t('ranks.ladder.unsavedOrder')}</p> : null}

      {deleting ? (
        <ConfirmDeleteModal
          title={t('ranks.ladder.deleteTitle', { name: deleting.name })}
          description={
            holdersOfBelt(deleting).length > 0
              ? t('ranks.ladder.deleteHeld', { count: holdersOfBelt(deleting).length })
              : t('ranks.ladder.deleteDescription')
          }
          onConfirm={() => deleteRank.mutateAsync(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {confirming ? (
        <Modal title={t('ranks.ladder.reorderTitle')} onClose={() => setConfirming(null)}>
          <p>{t('ranks.reorderAffected', { count: confirming.length })}</p>
          <ul>
            {confirming.map((h) => (
              <li key={h.studentId}>{`${h.firstName} ${h.surname}`.trim()}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button onClick={saveOrder} loading={reorder.isPending}>
              {t('ranks.ladder.saveOrder')}
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              {t('ranks.back')}
            </Button>
          </div>
        </Modal>
      ) : null}

      {adding ? (
        <BeltEditorModal
          title={t('ranks.ladder.addRank')}
          discipline={discipline}
          skills={skills}
          holders={holders}
          submitting={createRank.isPending}
          onSubmit={async (values: BeltValues) => {
            // A new belt goes at the top of the ladder; reorder it after.
            await createRank.mutateAsync({
              ...values,
              secondaryColour: values.secondaryColour ?? undefined,
              tagColour: values.tagColour ?? undefined,
              order: saved.length,
            });
            setAdding(false);
          }}
          onClose={() => setAdding(false)}
        />
      ) : null}
      {editing ? <EditBelt discipline={discipline} skills={skills} holders={holders} rank={editing} onClose={() => setEditing(null)} /> : null}
    </Card>
  );
}

function EditBelt({
  discipline,
  skills,
  holders,
  rank,
  onClose,
}: {
  discipline: DisciplineResponse;
  skills: SkillResponse[];
  holders: Map<string, Holder[]>;
  rank: RankResponse;
  onClose: () => void;
}) {
  const update = useUpdateRank(discipline.id, rank.id);
  const t = useT();
  return (
    <BeltEditorModal
      title={t('ranks.editAria', { name: rank.name })}
      discipline={discipline}
      initial={rank}
      skills={skills}
      holders={holders}
      submitting={update.isPending}
      onSubmit={async (values) => {
        await update.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
