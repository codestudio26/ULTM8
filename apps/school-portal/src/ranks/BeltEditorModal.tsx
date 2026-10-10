import React, { useState } from 'react';
import { Badge, Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import type { SkillResponse } from '../skills/skillQueries';
import { moveItem, useDragReorder } from './dragReorder';
import type { RankResponse, RankStripeTierInput } from './rankQueries';

type Holder = { studentId: string; firstName: string; surname: string };

interface Segment {
  count: string;
  colour: string;
}

interface RungDraft {
  key: string;
  id?: string;
  name: string;
  segments: Segment[];
  timeOnly: boolean;
  years: string;
  classesRequired: string;
  minimumDays: string;
  mode: 'ANY_TYPE' | 'EACH_TYPE';
  types: string[];
  perType: Record<string, string>;
  weeklyCap: string;
  unlocks: string[];
  skills: string[];
}

export interface BeltValues {
  name: string;
  primaryColour: string;
  secondaryColour: string | null;
  tagColour: string | null;
  stripeTiers: RankStripeTierInput[];
}

let nextKey = 0;
const newKey = () => `rung-${nextKey++}`;

function blankRung(): RungDraft {
  return {
    key: newKey(),
    name: '',
    segments: [],
    timeOnly: false,
    years: '',
    classesRequired: '',
    minimumDays: '',
    mode: 'ANY_TYPE',
    types: [],
    perType: {},
    weeklyCap: '',
    unlocks: [],
    skills: [],
  };
}

function draftFrom(t: RankResponse['stripeTiers'][number]): RungDraft {
  const reqs = (t.classTypeRequirements ?? []) as Array<{ classType: string; classesRequired: number }>;
  const segments = ((t.stripeSegments ?? []) as Array<{ count: number; colour: string }>).map((s) => ({ count: String(s.count), colour: s.colour }));
  return {
    key: newKey(),
    id: t.id,
    name: t.name,
    segments,
    timeOnly: t.timeOnly,
    years: t.timeOnly && t.minimumDaysInRank ? String(Math.round((t.minimumDaysInRank / 365) * 10) / 10) : '',
    classesRequired: t.classesRequired?.toString() ?? '',
    minimumDays: !t.timeOnly && t.minimumDaysInRank ? String(t.minimumDaysInRank) : '',
    mode: t.classCountMode,
    types: t.eligibleClassTypes,
    perType: Object.fromEntries(reqs.map((r) => [r.classType, String(r.classesRequired)])),
    weeklyCap: t.weeklyClassCountCap?.toString() ?? '',
    unlocks: t.bookingUnlocksClassTypes ?? [],
    skills: t.requiredSkillIds ?? [],
  };
}

/** The API's own name for a rung left unnamed (RanksService.generatedTierName). */
const generatedName = (belt: string, count: number) => (count === 0 ? belt : `${belt} · ${count} Stripe${count === 1 ? '' : 's'}`);
const total = (segments: Segment[]) => segments.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

function toInput(r: RungDraft, order: number): RankStripeTierInput {
  const count = total(r.segments);
  const segments = r.segments.filter((s) => Number(s.count) > 0).map((s) => ({ count: Number(s.count), colour: s.colour }));
  return {
    ...(r.id ? { id: r.id } : {}),
    order,
    count,
    colour: segments[0]?.colour ?? '#FFFFFF',
    stripeSegments: segments,
    ...(r.name.trim() ? { name: r.name.trim() } : {}),
    timeOnly: r.timeOnly,
    classesRequired: r.timeOnly ? undefined : r.mode === 'EACH_TYPE' ? undefined : num(r.classesRequired),
    minimumDaysInRank: r.timeOnly ? (num(r.years) !== undefined ? Math.round((num(r.years) as number) * 365) : undefined) : num(r.minimumDays),
    weeklyClassCountCap: r.timeOnly ? undefined : num(r.weeklyCap),
    eligibleClassTypes: r.timeOnly ? [] : r.types,
    classCountMode: r.timeOnly ? 'ANY_TYPE' : r.mode,
    classTypeRequirements: !r.timeOnly && r.mode === 'EACH_TYPE' ? r.types.map((t) => ({ classType: t, classesRequired: Number(r.perType[t] || 0) })) : [],
    bookingUnlocksClassTypes: r.unlocks,
    requiredSkillIds: r.skills,
  };
}

/** A small checkbox list of names (class types, skills). */
function Picker({ legend, options, value, onChange, empty }: { legend: string; options: Array<{ value: string; label: string }>; value: string[]; onChange: (v: string[]) => void; empty: string }) {
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
      <legend className="ultm8-field__label">{legend}</legend>
      {options.length === 0 ? (
        <p className="ultm8-field__hint" style={{ margin: 0 }}>
          {empty}
        </p>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
          {options.map((o) => (
            <Checkbox
              key={o.value}
              label={o.label}
              checked={value.includes(o.value)}
              onChange={(e) => onChange(e.target.checked ? [...value, o.value] : value.filter((v) => v !== o.value))}
            />
          ))}
        </div>
      )}
    </fieldset>
  );
}

/**
 * Add or edit a belt and its rungs (roadmap Phase 4, item 1; Decisions 127,
 * 128, 140, 149, 152, 165, 173, 180). Per rung: its name, its stripes (mixed
 * colours allowed), "time in rank only" with the years, or the classes and
 * minimum days to be promoted into it, which class types count (any of the
 * ticked types, or a number for each), the weekly cap, which class types it
 * unlocks for booking, and its required skills. Rungs reorder within the
 * belt and keep their students; a rung someone holds can't be removed. The
 * prototype's labels are kept.
 */
export function BeltEditorModal({
  title,
  discipline,
  initial,
  skills,
  holders,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  discipline: DisciplineResponse;
  initial?: RankResponse;
  skills: SkillResponse[];
  holders: Map<string, Holder[]>;
  submitting: boolean;
  onSubmit: (values: BeltValues) => Promise<void>;
  onClose: () => void;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [primaryColour, setPrimaryColour] = useState(initial?.primaryColour ?? '#FFFFFF');
  const [secondaryColour, setSecondaryColour] = useState(initial?.secondaryColour ?? '');
  const [tagColour, setTagColour] = useState(initial?.tagColour ?? '');
  const [rungs, setRungs] = useState<RungDraft[]>(() =>
    initial?.stripeTiers.length ? [...initial.stripeTiers].sort((a, b) => a.order - b.order).map(draftFrom) : [blankRung()],
  );
  const [openKey, setOpenKey] = useState<string | null>(rungs.length === 1 ? rungs[0].key : null);
  const [confirming, setConfirming] = useState<Holder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const types = discipline.classTypesOffered;
  const originalOrder = (initial?.stripeTiers ?? []).slice().sort((a, b) => a.order - b.order).map((t) => t.id);
  const update = (key: string, patch: Partial<RungDraft>) => setRungs((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, delta: number) =>
    setRungs((rs) => {
      const j = i + delta;
      if (j < 0 || j >= rs.length) return rs;
      const next = [...rs];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  const drag = useDragReorder((from, to) => setRungs((rs) => moveItem(rs, from, to)));

  /** Students on rungs whose position in this belt changes (Decision 152). */
  function affectedByMove(): Holder[] {
    const out: Holder[] = [];
    rungs.forEach((r, i) => {
      if (r.id && originalOrder.indexOf(r.id) !== i) out.push(...(holders.get(r.id) ?? []));
    });
    return out;
  }

  function validate(): string | null {
    if (!name.trim()) return 'Give this rank a name.';
    if (!primaryColour.trim()) return 'Pick a base colour.';
    if (rungs.length === 0) return 'A belt needs at least one line: the plain belt or a stripe.';
    for (const [i, r] of rungs.entries()) {
      const label = r.name.trim() || `Stripe line ${i + 1}`;
      if (r.segments.some((s) => !(Number(s.count) >= 1) || !s.colour.trim())) return `${label}: each group of stripes needs a number (1 or more) and a colour.`;
      if (!r.timeOnly && r.mode === 'EACH_TYPE' && r.types.length === 0) return `${label}: tick the class types that each need their own number.`;
    }
    return null;
  }

  async function save() {
    setError(null);
    try {
      await onSubmit({
        name: name.trim(),
        primaryColour: primaryColour.trim(),
        secondaryColour: secondaryColour.trim() || null,
        tagColour: tagColour.trim() || null,
        stripeTiers: rungs.map(toInput),
      });
    } catch (err) {
      setConfirming(null);
      setError(err instanceof ApiError ? err.message : 'Something went wrong — please try again.');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    const affected = affectedByMove();
    if (affected.length > 0) {
      setConfirming(affected);
      return;
    }
    await save();
  }

  if (confirming) {
    return (
      <Modal title="Reorder stripes?" onClose={() => setConfirming(null)}>
        <p>
          These students stay on their stripe, but its place in the ladder changes, so their next rank may change ({confirming.length}):
        </p>
        <ul>
          {confirming.map((h) => (
            <li key={h.studentId}>{`${h.firstName} ${h.surname}`.trim()}</li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="button" loading={submitting} onClick={save}>
            Save
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
            Back
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label="Rank name" htmlFor="belt-name" hint='e.g. "Blue Belt". Stripe names are made from it unless you type your own.'>
          <TextField required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label="Base colour" htmlFor="belt-colour">
            <TextField type="color" value={/^#[0-9a-fA-F]{6}$/.test(primaryColour) ? primaryColour : '#ffffff'} onChange={(e) => setPrimaryColour(e.target.value)} />
          </Field>
          <Field label="Secondary colour (optional)" htmlFor="belt-colour-2" hint="For a two-tone belt.">
            <TextField value={secondaryColour} placeholder="none" onChange={(e) => setSecondaryColour(e.target.value)} />
          </Field>
          <Field label="Tag colour (optional)" htmlFor="belt-tag" hint="Where the stripes go. Black when empty.">
            <TextField value={tagColour} placeholder="#000000" onChange={(e) => setTagColour(e.target.value)} />
          </Field>
        </div>

        <h3 style={{ fontSize: 15, margin: '8px 0' }}>Stripes</h3>
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          The plain belt, then each stripe, lowest first. Each line's requirements are what it takes to be promoted into it.
        </p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rungs.map((r, i) => {
            const held = r.id ? holders.get(r.id) ?? [] : [];
            const label = r.name.trim() || generatedName(name || 'Rank', total(r.segments));
            const open = openKey === r.key;
            return (
              <li
                key={r.key}
                aria-label={`Stripe line ${i + 1}: ${label}`}
                {...drag.targetProps(i)}
                style={{ border: `1px solid ${drag.over === i ? 'var(--fill-accent)' : 'var(--border)'}`, borderRadius: 8, padding: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span {...drag.handleProps(i, label)}>⠿</span>
                  <strong style={{ flex: 1, minWidth: 140 }}>
                    {i + 1}. {label}
                  </strong>
                  {r.timeOnly ? <Badge variant="accent">Time in rank only</Badge> : null}
                  {held.length > 0 ? <Badge>{held.length} on this stripe</Badge> : null}
                  <Button type="button" variant="secondary" onClick={() => setOpenKey(open ? null : r.key)} aria-expanded={open} aria-label={`${open ? 'Close' : 'Edit'} ${label}`}>
                    {open ? 'Close' : 'Edit'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={`Move ${label} up`}>
                    ↑
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => move(i, 1)} disabled={i === rungs.length - 1} aria-label={`Move ${label} down`}>
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setRungs((rs) => rs.filter((x) => x.key !== r.key))}
                    disabled={held.length > 0 || rungs.length === 1}
                    aria-label={held.length > 0 ? `${label} can't be removed: ${held.length} student(s) on it` : `Remove ${label}`}
                    title={held.length > 0 ? 'Students hold this stripe. Move them to another rank first.' : undefined}
                  >
                    ✕
                  </Button>
                </div>
                {open ? <RungFields r={r} index={i} types={types} skills={skills} beltName={name} onChange={(patch) => update(r.key, patch)} /> : null}
              </li>
            );
          })}
        </ol>
        <div style={{ marginTop: 8 }}>
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              const r = blankRung();
              setRungs((rs) => [...rs, r]);
              setOpenKey(r.key);
            }}
          >
            Add stripe
          </Button>
        </div>

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

function RungFields({
  r,
  index,
  types,
  skills,
  beltName,
  onChange,
}: {
  r: RungDraft;
  index: number;
  types: string[];
  skills: SkillResponse[];
  beltName: string;
  onChange: (patch: Partial<RungDraft>) => void;
}) {
  const id = (f: string) => `rung-${index}-${f}`;
  const setSegment = (i: number, patch: Partial<Segment>) => onChange({ segments: r.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div style={{ marginTop: 12 }}>
      <Field label="Stripe name" htmlFor={id('name')} hint={`Leave empty for "${generatedName(beltName || 'Rank', total(r.segments))}".`}>
        <TextField maxLength={100} value={r.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
        <legend className="ultm8-field__label">Stripes ({total(r.segments)})</legend>
        {r.segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label="Number" htmlFor={id(`seg-${i}-count`)}>
              <TextField type="number" min={1} max={12} value={s.count} onChange={(e) => setSegment(i, { count: e.target.value })} />
            </Field>
            <Field label="Colour" htmlFor={id(`seg-${i}-colour`)}>
              <TextField type="color" value={/^#[0-9a-fA-F]{6}$/.test(s.colour) ? s.colour : '#ffffff'} onChange={(e) => setSegment(i, { colour: e.target.value })} />
            </Field>
            <div style={{ paddingBottom: 12 }}>
              <Button type="button" variant="secondary" onClick={() => onChange({ segments: r.segments.filter((_, j) => j !== i) })} aria-label={`Remove stripe group ${i + 1}`}>
                Remove
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => onChange({ segments: [...r.segments, { count: '1', colour: '#ffffff' }] })}>
          {r.segments.length ? 'Add stripes of another colour' : 'Add stripes'}
        </Button>
      </fieldset>

      <Checkbox
        label="Time in rank only — a student leaves this rank after a set number of years. Classes are not counted and skills are optional."
        checked={r.timeOnly}
        onChange={(e) => onChange({ timeOnly: e.target.checked })}
      />
      {r.timeOnly ? (
        <>
          <p className="ultm8-field__hint">Promotion into this rank uses the class, day and skill requirements of the rank just below it.</p>
          <Field label="Min. years in rank" htmlFor={id('years')}>
            <TextField type="number" min={0} max={30} step={0.5} value={r.years} onChange={(e) => onChange({ years: e.target.value })} />
          </Field>
        </>
      ) : (
        <>
          <Field label="Which classes count" htmlFor={id('mode')}>
            <SelectField
              value={r.mode}
              onChange={(e) => onChange({ mode: e.target.value as RungDraft['mode'] })}
              options={[
                { value: 'ANY_TYPE', label: 'Any of the ticked class types (or every class when none is ticked)' },
                { value: 'EACH_TYPE', label: 'A number for each ticked class type' },
              ]}
            />
          </Field>
          <Picker
            legend="Class types that count"
            options={types.map((t) => ({ value: t, label: t }))}
            value={r.types}
            onChange={(v) => onChange({ types: v })}
            empty="This style has no class types; every class counts."
          />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {r.mode === 'EACH_TYPE' ? (
              r.types.map((t) => (
                <Field key={t} label={`${t} classes`} htmlFor={id(`type-${t}`)}>
                  <TextField type="number" min={0} value={r.perType[t] ?? ''} onChange={(e) => onChange({ perType: { ...r.perType, [t]: e.target.value } })} />
                </Field>
              ))
            ) : (
              <Field label="Classes required" htmlFor={id('classes')}>
                <TextField type="number" min={0} value={r.classesRequired} onChange={(e) => onChange({ classesRequired: e.target.value })} />
              </Field>
            )}
            <Field label="Min. days in rank" htmlFor={id('days')}>
              <TextField type="number" min={0} value={r.minimumDays} onChange={(e) => onChange({ minimumDays: e.target.value })} />
            </Field>
            <Field label="Weekly cap" htmlFor={id('cap')} hint="Most classes a week that count. Empty: no cap.">
              <TextField type="number" min={0} value={r.weeklyCap} onChange={(e) => onChange({ weeklyCap: e.target.value })} />
            </Field>
          </div>
        </>
      )}

      <Picker
        legend={r.timeOnly ? 'Skills (optional)' : 'Required skills'}
        options={skills.map((s) => ({ value: s.id, label: s.name }))}
        value={r.skills}
        onChange={(v) => onChange({ skills: v })}
        empty="This style has no skills yet."
      />
      <Picker
        legend="Unlocks booking for"
        options={types.map((t) => ({ value: t, label: t }))}
        value={r.unlocks}
        onChange={(v) => onChange({ unlocks: v })}
        empty="This style has no class types."
      />
    </div>
  );
}
