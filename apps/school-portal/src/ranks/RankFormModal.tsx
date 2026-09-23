import React, { useState } from 'react';
import { Button, Checkbox, ErrorBanner, Field, Modal, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { SkillResponse } from '../skills/skillQueries';
import type { RankResponse, RankStripeTierInput } from './rankQueries';

interface StripeTierRow {
  count: string;
  colour: string;
  classesRequired: string;
  minimumDaysInRank: string;
  eligibleClassTypes: string;
}

const BLANK_TIER: StripeTierRow = { count: '', colour: '', classesRequired: '', minimumDaysInRank: '', eligibleClassTypes: '' };

export interface RankFormValues {
  primaryColour: string;
  /** `null` means "cleared" — UpdateRankDto accepts null on these fields to
   * mean exactly that (see that DTO's own header comment). */
  secondaryColour?: string | null;
  weeklyClassCountCap?: number | null;
  yearsInRankFlag: boolean;
  stripeTiers: RankStripeTierInput[];
  requiredSkillIds?: string[];
}

/** Fields match CreateRankDto/UpdateRankDto exactly —
 * apps/api/src/ranks/dto/create-rank.dto.ts. `order` is deliberately NOT a
 * field in this form at all: RanksService.createRank() requires a new Rank's
 * order to exactly equal the Discipline's existing Rank count (append-only),
 * and RanksService.updateRank() re-validates `order` against this Rank's
 * OTHER siblings' own (unchanged) orders — meaning the only value that can
 * ever pass on update is the Rank's own current order. There is no working
 * "reorder ranks" path through this API today; this form doesn't pretend
 * otherwise by exposing an editable field that would always be rejected
 * except as a no-op. Same reasoning for each stripe tier's own `order` — it's
 * derived from the tier's position in the array at submit time, not a field
 * a user edits directly (RanksService.updateRank() re-derives each tier's
 * stable identity from its `order` position, per that service's own
 * detailed comment on why — see there for the full FK-preservation
 * reasoning). */
export function RankFormModal({
  title,
  initial,
  skills,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  initial?: Partial<RankResponse>;
  skills: SkillResponse[];
  submitting: boolean;
  onSubmit: (values: RankFormValues) => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState({
    primaryColour: initial?.primaryColour ?? '',
    secondaryColour: initial?.secondaryColour ?? '',
    weeklyClassCountCap: initial?.weeklyClassCountCap?.toString() ?? '',
    yearsInRankFlag: initial?.yearsInRankFlag ?? false,
    requiredSkillIds: initial?.requiredSkillIds ?? [],
  });
  const [tiers, setTiers] = useState<StripeTierRow[]>(
    initial?.stripeTiers?.length
      ? initial.stripeTiers.map((t) => ({
          count: t.count.toString(),
          colour: t.colour,
          classesRequired: t.classesRequired?.toString() ?? '',
          minimumDaysInRank: t.minimumDaysInRank?.toString() ?? '',
          eligibleClassTypes: t.eligibleClassTypes.join(', '),
        }))
      : [BLANK_TIER],
  );
  const [error, setError] = useState<string | null>(null);

  function updateTier(index: number, patch: Partial<StripeTierRow>) {
    setTiers((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }

  function toggleSkill(skillId: string, checked: boolean) {
    setForm((f) => ({
      ...f,
      requiredSkillIds: checked ? [...f.requiredSkillIds, skillId] : f.requiredSkillIds.filter((id) => id !== skillId),
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    // Defensive backstop, not currently reachable through this form's own UI
    // (the last-remaining tier's Remove button is hidden by the same
    // `tiers.length > 1` condition below) — kept in case that condition ever
    // changes without this one being updated in step.
    if (tiers.length === 0) {
      setError('At least one stripe tier is required.');
      return;
    }
    if (tiers.some((t) => !t.count || !t.colour)) {
      setError('Every stripe tier needs a count and a colour.');
      return;
    }
    try {
      await onSubmit({
        primaryColour: form.primaryColour,
        secondaryColour: form.secondaryColour || null,
        weeklyClassCountCap: form.weeklyClassCountCap ? Number(form.weeklyClassCountCap) : null,
        yearsInRankFlag: form.yearsInRankFlag,
        stripeTiers: tiers.map((t, order) => ({
          order,
          count: Number(t.count),
          colour: t.colour,
          classesRequired: t.classesRequired ? Number(t.classesRequired) : undefined,
          minimumDaysInRank: t.minimumDaysInRank ? Number(t.minimumDaysInRank) : undefined,
          eligibleClassTypes: t.eligibleClassTypes
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean),
        })),
        requiredSkillIds: form.requiredSkillIds,
      });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Primary colour" htmlFor="rank-primaryColour">
          <TextField
            required
            value={form.primaryColour}
            onChange={(e) => setForm((f) => ({ ...f, primaryColour: e.target.value }))}
          />
        </Field>
        <Field label="Secondary colour" htmlFor="rank-secondaryColour" hint="For two-colour belts.">
          <TextField value={form.secondaryColour} onChange={(e) => setForm((f) => ({ ...f, secondaryColour: e.target.value }))} />
        </Field>
        <Field label="Weekly class count cap" htmlFor="rank-weeklyCap">
          <TextField
            type="number"
            min={0}
            value={form.weeklyClassCountCap}
            onChange={(e) => setForm((f) => ({ ...f, weeklyClassCountCap: e.target.value }))}
          />
        </Field>
        <Checkbox
          label="Black Belt and above (years-in-rank tracking)"
          checked={form.yearsInRankFlag}
          onChange={(e) => setForm((f) => ({ ...f, yearsInRankFlag: e.target.checked }))}
        />

        <div className="ultm8-field" style={{ marginTop: 16 }}>
          <p className="ultm8-field__label" style={{ marginBottom: 8 }}>
            Stripe tiers
          </p>
          <p className="ultm8-field__hint" style={{ marginBottom: 8 }}>
            Tiers can only be added or removed at the end of the list — see the
            hint on the Ranks page for why.
          </p>
          {tiers.map((tier, i) => (
            // Index-as-key is safe here ONLY because tiers can never be
            // removed from or inserted into the middle (see "Remove"'s own
            // guard below and "Add tier"'s append-only setTiers call) — every
            // existing row's index is therefore stable across edits, which is
            // what index keys require to be safe at all.
            <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, marginBottom: 8 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                <strong style={{ fontSize: 13 }}>Tier {i + 1}</strong>
                {tiers.length > 1 && i === tiers.length - 1 ? (
                  // FOUND ON REVIEW (2 of 6 review angles independently
                  // caught this): removing from the MIDDLE of the list would
                  // shift every later tier's array-index-derived `order`
                  // value down by one on submit. RanksService.updateRank()'s
                  // own upsert-by-order logic (see that method's own comment)
                  // has no way to tell "this position is still logically the
                  // same tier, just renumbered" from "a different tier now
                  // occupies this position" — it would silently overwrite an
                  // existing tier's stable id (and any Student's
                  // StudentRank.currentStripeId pointing at it) with a
                  // DIFFERENT tier's data, while deleting a tier the user
                  // never touched. The API has no per-tier id in its request
                  // shape to express "delete this specific one" any other
                  // way, so removal is restricted to the last tier only,
                  // where reindexing never reassigns an existing tier's
                  // identity.
                  <Button type="button" variant="danger" onClick={() => setTiers((rows) => rows.slice(0, -1))}>
                    Remove
                  </Button>
                ) : null}
              </div>
              <Field label="Count" htmlFor={`tier-${i}-count`}>
                <TextField
                  required
                  type="number"
                  min={0}
                  value={tier.count}
                  onChange={(e) => updateTier(i, { count: e.target.value })}
                />
              </Field>
              <Field label="Colour" htmlFor={`tier-${i}-colour`}>
                <TextField required value={tier.colour} onChange={(e) => updateTier(i, { colour: e.target.value })} />
              </Field>
              <Field label="Classes required" htmlFor={`tier-${i}-classesRequired`}>
                <TextField
                  type="number"
                  min={0}
                  value={tier.classesRequired}
                  onChange={(e) => updateTier(i, { classesRequired: e.target.value })}
                />
              </Field>
              <Field label="Minimum days in rank" htmlFor={`tier-${i}-minimumDays`}>
                <TextField
                  type="number"
                  min={0}
                  value={tier.minimumDaysInRank}
                  onChange={(e) => updateTier(i, { minimumDaysInRank: e.target.value })}
                />
              </Field>
              <Field label="Eligible class types" htmlFor={`tier-${i}-eligibleClassTypes`} hint="Comma-separated">
                <TextField value={tier.eligibleClassTypes} onChange={(e) => updateTier(i, { eligibleClassTypes: e.target.value })} />
              </Field>
            </div>
          ))}
          <Button type="button" variant="secondary" onClick={() => setTiers((rows) => [...rows, BLANK_TIER])}>
            Add tier
          </Button>
        </div>

        {skills.length > 0 ? (
          <div className="ultm8-field" style={{ marginTop: 16 }}>
            <p className="ultm8-field__label" style={{ marginBottom: 8 }}>
              Required skills
            </p>
            {skills.map((skill) => (
              <Checkbox
                key={skill.id}
                label={skill.name}
                checked={form.requiredSkillIds.includes(skill.id)}
                onChange={(e) => toggleSkill(skill.id, e.target.checked)}
              />
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </form>
    </Modal>
  );
}
