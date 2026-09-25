import React, { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, Table } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { nullsToUndefined } from '../lib/nullableFields';
import { useDiscipline } from './disciplineQueries';
import { useCreateSkill, useSkills, useUpdateSkill, type SkillResponse } from '../skills/skillQueries';
import { SkillFormModal } from '../skills/SkillFormModal';
import { useCreateRank, useRanks, useUpdateRank, type RankResponse } from '../ranks/rankQueries';
import { RankFormModal } from '../ranks/RankFormModal';

/** A Discipline's own Skills and Ranks catalog. Reached via a "Manage
 * skills" link from DisciplinesPage's own table — both Skill and Rank CRUD
 * are nested under a Discipline (`/styles/:disciplineId/skills`,
 * `/styles/:disciplineId/ranks`), so there's no School-wide list to build a
 * standalone top-level page against for either. */
export function DisciplineDetailPage() {
  const { id } = useParams<{ id: string }>();
  const disciplineId = id ?? null;
  const { data: discipline, isLoading: disciplineLoading, error: disciplineError } = useDiscipline(disciplineId);
  const { data: skillData, isLoading: skillsLoading, error: skillsError } = useSkills(disciplineId);
  const { data: rankData, isLoading: ranksLoading, error: ranksError } = useRanks(disciplineId);
  const createSkill = useCreateSkill(disciplineId ?? '');
  const createRank = useCreateRank(disciplineId ?? '');
  const [creatingSkill, setCreatingSkill] = useState(false);
  const [editingSkill, setEditingSkill] = useState<SkillResponse | null>(null);
  const [creatingRank, setCreatingRank] = useState(false);
  const [editingRank, setEditingRank] = useState<RankResponse | null>(null);

  if (!disciplineId) return null;
  if (disciplineLoading || skillsLoading || ranksLoading) return <Spinner />;
  if (disciplineError) {
    return <ErrorBanner message={disciplineError instanceof ApiError ? disciplineError.message : 'Could not load this Discipline.'} />;
  }
  if (skillsError) {
    return <ErrorBanner message={skillsError instanceof ApiError ? skillsError.message : 'Could not load Skills.'} />;
  }
  if (ranksError) {
    return <ErrorBanner message={ranksError instanceof ApiError ? ranksError.message : 'Could not load Ranks.'} />;
  }

  const skills = skillData?.items ?? [];
  const ranks = rankData?.items ?? [];

  return (
    <>
      <PageHeader
        title={discipline?.name ?? 'Discipline'}
        subtitle={discipline?.classTypesOffered.length ? discipline.classTypesOffered.join(', ') : undefined}
      />

      <div style={{ marginBottom: 24 }}>
        <Card>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
            <div>
              <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 4 }}>
                Skills
              </h2>
              <p style={{ margin: 0 }}>Named Skills a Student can be signed off on within this Discipline.</p>
            </div>
            <Button onClick={() => setCreatingSkill(true)}>Add skill</Button>
          </div>
          {skills.length === 0 ? (
            <EmptyState title="No Skills yet" description="Add your first Skill to get started." />
          ) : (
            <Table<SkillResponse>
              rows={skills}
              columns={[
                { key: 'name', header: 'Name', render: (s) => s.name },
                { key: 'description', header: 'Description', render: (s) => s.description ?? '—' },
                {
                  key: 'actions',
                  header: '',
                  render: (s) => (
                    <Button variant="secondary" onClick={() => setEditingSkill(s)}>
                      Edit
                    </Button>
                  ),
                },
              ]}
            />
          )}
        </Card>
      </div>

      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
          <div>
            <h2 className="ultm8-page-header__title" style={{ fontSize: 16, marginBottom: 4 }}>
              Ranks
            </h2>
            <p style={{ margin: 0 }}>The ordered belt ladder, each with its own stripe tiers and required Skills.</p>
            {/* FOUND ON REVIEW: the equivalent EmptyState hint below only
                shows before the first Rank exists — exactly when this stops
                being obvious. Kept visible permanently here instead, not
                just in a code comment or a message that disappears the
                moment it'd actually matter (inserting a new belt between two
                existing ones later). */}
            <p className="ultm8-field__hint" style={{ margin: '4px 0 0' }}>
              Ranks can only be added at the end of the ladder — there's no way to insert or reorder one later yet.
            </p>
          </div>
          <Button onClick={() => setCreatingRank(true)}>Add rank</Button>
        </div>
        {ranks.length === 0 ? (
          <EmptyState title="No Ranks yet" description="Add your first Rank to get started. Ranks are appended to the end of the ladder — add them in order." />
        ) : (
          <Table<RankResponse>
            rows={ranks}
            columns={[
              { key: 'order', header: '#', render: (r) => r.order + 1 },
              {
                key: 'colour',
                header: 'Colour',
                render: (r) => (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <ColourSwatch hex={r.primaryColour} />
                    {r.secondaryColour ? <ColourSwatch hex={r.secondaryColour} /> : null}
                  </div>
                ),
              },
              { key: 'tiers', header: 'Stripe tiers', render: (r) => r.stripeTiers.length },
              { key: 'skills', header: 'Required skills', render: (r) => r.requiredSkillIds.length },
              {
                key: 'yearsInRank',
                header: '',
                render: (r) => (r.yearsInRankFlag ? <Badge variant="accent">Black Belt+</Badge> : null),
              },
              {
                key: 'actions',
                header: '',
                render: (r) => (
                  <Button variant="secondary" onClick={() => setEditingRank(r)}>
                    Edit
                  </Button>
                ),
              },
            ]}
          />
        )}
      </Card>

      {creatingSkill ? (
        <SkillFormModal
          title="Add skill"
          submitting={createSkill.isPending}
          onSubmit={async (values) => {
            // Create has nothing to "clear" — map the form's null back to
            // undefined (omitted), since CreateSkillDto doesn't accept null.
            await createSkill.mutateAsync(nullsToUndefined(values));
            setCreatingSkill(false);
          }}
          onClose={() => setCreatingSkill(false)}
        />
      ) : null}

      {editingSkill ? (
        <EditSkillModal disciplineId={disciplineId} skill={editingSkill} onClose={() => setEditingSkill(null)} />
      ) : null}

      {creatingRank ? (
        <RankFormModal
          title="Add rank"
          skills={skills}
          submitting={createRank.isPending}
          onSubmit={async (values) => {
            // `order` isn't part of RankFormValues (see RankFormModal's own
            // header comment on why it's never user-editable) — computed
            // here instead as the current Rank count, the only value
            // RanksService.createRank() will actually accept (append-only).
            // `nullsToUndefined` covers the remaining nullable fields, same
            // as every other CREATE call site in this codebase.
            await createRank.mutateAsync({ ...nullsToUndefined(values), order: ranks.length });
            setCreatingRank(false);
          }}
          onClose={() => setCreatingRank(false)}
        />
      ) : null}

      {editingRank ? (
        <EditRankModal disciplineId={disciplineId} skills={skills} rank={editingRank} onClose={() => setEditingRank(null)} />
      ) : null}
    </>
  );
}

/** `primaryColour`/`secondaryColour` are free text (RankFormModal's own field is a
 * plain TextField, not a color picker) — usually a CSS-recognized name ("White",
 * "Black") but not guaranteed to be. An unparseable value is safe here: CSS silently
 * ignores an invalid `background`, so the dot just renders empty rather than erroring. */
function ColourSwatch({ hex }: { hex: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
      <span
        aria-hidden="true"
        style={{
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: hex,
          border: '1px solid var(--border-strong)',
          flex: 'none',
        }}
      />
      <span style={{ fontSize: 'var(--font-size-caption)', color: 'var(--text-secondary)' }}>{hex}</span>
    </span>
  );
}

function EditSkillModal({ disciplineId, skill, onClose }: { disciplineId: string; skill: SkillResponse; onClose: () => void }) {
  const updateSkill = useUpdateSkill(disciplineId, skill.id);
  return (
    <SkillFormModal
      title="Edit skill"
      initial={skill}
      submitting={updateSkill.isPending}
      onSubmit={async (values) => {
        // Passed straight through, null included — UpdateSkillDto accepts
        // null on description to mean "clear it".
        await updateSkill.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}

function EditRankModal({
  disciplineId,
  skills,
  rank,
  onClose,
}: {
  disciplineId: string;
  skills: SkillResponse[];
  rank: RankResponse;
  onClose: () => void;
}) {
  const updateRank = useUpdateRank(disciplineId, rank.id);
  return (
    <RankFormModal
      title="Edit rank"
      initial={rank}
      skills={skills}
      submitting={updateRank.isPending}
      onSubmit={async (values) => {
        // Passed straight through, nulls included — UpdateRankDto accepts
        // null on secondaryColour/weeklyClassCountCap to mean "clear it".
        // `order` is deliberately omitted (not sent at all) rather than
        // echoed back — see RankFormModal's own header comment on why this
        // Rank's own current order is the only value the backend would
        // accept anyway; omitting it (vs. re-sending the same value) means
        // one less thing to keep in sync if that ever changes.
        await updateRank.mutateAsync(values);
        onClose();
      }}
      onClose={onClose}
    />
  );
}
