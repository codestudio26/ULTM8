import React, { useMemo, useState } from 'react';
import { Badge, Button, Card, EmptyState, ErrorBanner, Modal } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import type { SkillResponse } from '../skills/skillQueries';
import { BeltChip } from '../grading/BeltChip';
import { BeltEditorModal, type BeltValues } from './BeltEditorModal';
import { moveItem, useDragReorder } from './dragReorder';
import { type RankResponse, useCreateRank, useDeleteRank, useReorderRanks, useRungHolders, useUpdateRank } from './rankQueries';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';

const stripesLabel = (n: number) => (n === 0 ? 'No stripes' : n === 1 ? '1 stripe' : `${n} stripes`);

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
  const [error, setError] = useState<string | null>(null);

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
      setError(err instanceof ApiError ? err.message : 'Could not save the new order — please try again.');
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
            Ladder
          </h2>
          <p style={{ margin: 0 }}>The belts in order, lowest first, each with its stripes and what it takes to be promoted into them.</p>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {changed ? (
            <>
              <Button onClick={askToSave} loading={reorder.isPending}>
                Save order
              </Button>
              <Button variant="secondary" onClick={() => setOrder(null)}>
                Undo
              </Button>
            </>
          ) : null}
          <Button onClick={() => setAdding(true)}>Add rank</Button>
        </div>
      </div>
      {error ? <ErrorBanner message={error} /> : null}

      {shown.length === 0 ? (
        <EmptyState title="No ranks yet" description="Add your first rank (belt), with its stripes, to start the ladder." />
      ) : (
        <ol aria-label="Ladder" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
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
                  <span className="ultm8-field__hint">
                    {stripesLabel(Math.max(0, ...tiers.map((t) => t.count)))}
                  </span>
                  {onBelt > 0 ? <Badge>{onBelt === 1 ? '1 student' : `${onBelt} students`}</Badge> : null}
                  <Button variant="secondary" onClick={() => setEditing(rank)} aria-label={`Edit ${rank.name}`}>
                    Edit
                  </Button>
                  <Button variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${rank.name} up`}>
                    ↑
                  </Button>
                  <Button variant="secondary" onClick={() => move(i, 1)} disabled={i === shown.length - 1} aria-label={`Move ${rank.name} down`}>
                    ↓
                  </Button>
                  <Button variant="secondary" onClick={() => setDeleting(rank)} disabled={changed} aria-label={`Delete ${rank.name}`}>
                    Delete
                  </Button>
                </div>
                <ul style={{ listStyle: 'none', padding: '6px 0 0 30px', margin: 0, display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                  {tiers.map((t) => (
                    <li key={t.id} className="ultm8-field__hint">
                      {t.name}
                      {t.timeOnly
                        ? ` · ${Math.round(((t.minimumDaysInRank ?? 0) / 365) * 10) / 10} years`
                        : t.classCountMode === 'EACH_TYPE'
                          ? ` · ${(t.classTypeRequirements as Array<{ classType: string; classesRequired: number }>).map((r) => `${r.classesRequired} ${r.classType}`).join(' + ')}`
                          : t.classesRequired
                            ? ` · ${t.classesRequired} classes`
                            : ''}
                      {(t.requiredSkillIds?.length ?? 0) > 0 ? ` · ${t.requiredSkillIds!.length} skill${t.requiredSkillIds!.length === 1 ? '' : 's'}` : ''}
                    </li>
                  ))}
                </ul>
              </li>
            );
          })}
        </ol>
      )}
      {changed ? <p className="ultm8-field__hint">The new order isn't saved yet.</p> : null}

      {deleting ? (
        <ConfirmDeleteModal
          title={`Delete ${deleting.name}?`}
          description={
            holdersOfBelt(deleting).length > 0
              ? `${holdersOfBelt(deleting).length} student(s) hold this belt, so it can't be deleted.`
              : 'Its stripes are deleted with it and the belts after it move up. A belt can only be deleted while nobody holds it and it isn\'t in anyone\'s grading history.'
          }
          onConfirm={() => deleteRank.mutateAsync(deleting.id)}
          onClose={() => setDeleting(null)}
        />
      ) : null}

      {confirming ? (
        <Modal title="Reorder belts?" onClose={() => setConfirming(null)}>
          <p>These students stay on their stripe, but its place in the ladder changes, so their next rank may change ({confirming.length}):</p>
          <ul>
            {confirming.map((h) => (
              <li key={h.studentId}>{`${h.firstName} ${h.surname}`.trim()}</li>
            ))}
          </ul>
          <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
            <Button onClick={saveOrder} loading={reorder.isPending}>
              Save order
            </Button>
            <Button variant="secondary" onClick={() => setConfirming(null)}>
              Back
            </Button>
          </div>
        </Modal>
      ) : null}

      {adding ? (
        <BeltEditorModal
          title="Add rank"
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
  return (
    <BeltEditorModal
      title={`Edit ${rank.name}`}
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
