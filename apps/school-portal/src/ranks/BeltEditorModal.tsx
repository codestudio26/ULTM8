import React, { useState } from 'react';
import { Badge, Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import type { SkillResponse } from '../skills/skillQueries';
import { moveItem, useDragReorder } from './dragReorder';
import type { RankResponse, RankStripeTierInput } from './rankQueries';
import { useT } from '../i18n/I18nProvider';

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

/** The API's own name for a rung left unnamed (RanksService.generatedTierName).
 * Deliberately not translated: it previews the name the API will store. */
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
  const t = useT();

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
    if (!name.trim()) return t('ranks.editor.nameRequired');
    if (!primaryColour.trim()) return t('ranks.editor.colourRequired');
    if (rungs.length === 0) return t('ranks.editor.lineRequired');
    for (const [i, r] of rungs.entries()) {
      const label = r.name.trim() || t('ranks.editor.stripeLine', { number: i + 1 });
      if (r.segments.some((s) => !(Number(s.count) >= 1) || !s.colour.trim())) return t('ranks.editor.segmentInvalid', { label });
      if (!r.timeOnly && r.mode === 'EACH_TYPE' && r.types.length === 0) return t('ranks.editor.typesRequired', { label });
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
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
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
      <Modal title={t('ranks.editor.reorderTitle')} onClose={() => setConfirming(null)}>
        <p>{t('ranks.reorderAffected', { count: confirming.length })}</p>
        <ul>
          {confirming.map((h) => (
            <li key={h.studentId}>{`${h.firstName} ${h.surname}`.trim()}</li>
          ))}
        </ul>
        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="button" loading={submitting} onClick={save}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={() => setConfirming(null)}>
            {t('ranks.back')}
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        <Field label={t('ranks.editor.rankName')} htmlFor="belt-name" hint={t('ranks.editor.rankNameHint')}>
          <TextField required maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Field label={t('ranks.editor.baseColour')} htmlFor="belt-colour">
            <TextField type="color" value={/^#[0-9a-fA-F]{6}$/.test(primaryColour) ? primaryColour : '#ffffff'} onChange={(e) => setPrimaryColour(e.target.value)} />
          </Field>
          <Field label={t('ranks.editor.secondaryColour')} htmlFor="belt-colour-2" hint={t('ranks.editor.secondaryColourHint')}>
            <TextField value={secondaryColour} placeholder={t('ranks.editor.secondaryColourPlaceholder')} onChange={(e) => setSecondaryColour(e.target.value)} />
          </Field>
          <Field label={t('ranks.editor.tagColour')} htmlFor="belt-tag" hint={t('ranks.editor.tagColourHint')}>
            <TextField value={tagColour} placeholder="#000000" onChange={(e) => setTagColour(e.target.value)} />
          </Field>
        </div>

        <h3 style={{ fontSize: 15, margin: '8px 0' }}>{t('ranks.editor.stripesHeading')}</h3>
        <p className="ultm8-field__hint" style={{ marginTop: 0 }}>
          {t('ranks.editor.stripesHint')}
        </p>
        <ol style={{ listStyle: 'none', padding: 0, margin: 0, display: 'grid', gap: 8 }}>
          {rungs.map((r, i) => {
            const held = r.id ? holders.get(r.id) ?? [] : [];
            const label = r.name.trim() || generatedName(name || 'Rank', total(r.segments));
            const open = openKey === r.key;
            return (
              <li
                key={r.key}
                aria-label={t('ranks.editor.lineAria', { number: i + 1, label })}
                {...drag.targetProps(i)}
                style={{ border: `1px solid ${drag.over === i ? 'var(--fill-accent)' : 'var(--border)'}`, borderRadius: 8, padding: 10 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span {...drag.handleProps(i, label)}>⠿</span>
                  <strong style={{ flex: 1, minWidth: 140 }}>
                    {i + 1}. {label}
                  </strong>
                  {r.timeOnly ? <Badge variant="accent">{t('ranks.editor.timeOnlyBadge')}</Badge> : null}
                  {held.length > 0 ? <Badge>{t('ranks.editor.onStripe', { count: held.length })}</Badge> : null}
                  <Button type="button" variant="secondary" onClick={() => setOpenKey(open ? null : r.key)} aria-expanded={open} aria-label={open ? t('ranks.editor.closeAria', { name: label }) : t('ranks.editAria', { name: label })}>
                    {open ? t('ranks.editor.close') : t('ranks.edit')}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => move(i, -1)} disabled={i === 0} aria-label={t('ranks.moveUpAria', { name: label })}>
                    ↑
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => move(i, 1)} disabled={i === rungs.length - 1} aria-label={t('ranks.moveDownAria', { name: label })}>
                    ↓
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => setRungs((rs) => rs.filter((x) => x.key !== r.key))}
                    disabled={held.length > 0 || rungs.length === 1}
                    aria-label={held.length > 0 ? t('ranks.editor.cantRemoveAria', { label, count: held.length }) : t('ranks.editor.removeAria', { label })}
                    title={held.length > 0 ? t('ranks.editor.heldTitle') : undefined}
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
            {t('ranks.editor.addStripe')}
          </Button>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 16 }}>
          <Button type="submit" loading={submitting}>
            {t('common.save')}
          </Button>
          <Button type="button" variant="secondary" onClick={onClose}>
            {t('common.cancel')}
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
  const t = useT();
  const id = (f: string) => `rung-${index}-${f}`;
  const setSegment = (i: number, patch: Partial<Segment>) => onChange({ segments: r.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  return (
    <div style={{ marginTop: 12 }}>
      <Field label={t('ranks.editor.stripeName')} htmlFor={id('name')} hint={t('ranks.editor.stripeNameHint', { name: generatedName(beltName || 'Rank', total(r.segments)) })}>
        <TextField maxLength={100} value={r.name} onChange={(e) => onChange({ name: e.target.value })} />
      </Field>

      <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
        <legend className="ultm8-field__label">{t('ranks.editor.stripesCount', { count: total(r.segments) })}</legend>
        {r.segments.map((s, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <Field label={t('ranks.editor.number')} htmlFor={id(`seg-${i}-count`)}>
              <TextField type="number" min={1} max={12} value={s.count} onChange={(e) => setSegment(i, { count: e.target.value })} />
            </Field>
            <Field label={t('ranks.editor.colour')} htmlFor={id(`seg-${i}-colour`)}>
              <TextField type="color" value={/^#[0-9a-fA-F]{6}$/.test(s.colour) ? s.colour : '#ffffff'} onChange={(e) => setSegment(i, { colour: e.target.value })} />
            </Field>
            <div style={{ paddingBottom: 12 }}>
              <Button type="button" variant="secondary" onClick={() => onChange({ segments: r.segments.filter((_, j) => j !== i) })} aria-label={t('ranks.editor.removeGroupAria', { number: i + 1 })}>
                {t('ranks.editor.remove')}
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="secondary" onClick={() => onChange({ segments: [...r.segments, { count: '1', colour: '#ffffff' }] })}>
          {r.segments.length ? t('ranks.editor.addStripesAnotherColour') : t('ranks.editor.addStripes')}
        </Button>
      </fieldset>

      <Checkbox
        label={t('ranks.editor.timeOnlyLabel')}
        checked={r.timeOnly}
        onChange={(e) => onChange({ timeOnly: e.target.checked })}
      />
      {r.timeOnly ? (
        <>
          <p className="ultm8-field__hint">{t('ranks.editor.timeOnlyHint')}</p>
          <Field label={t('ranks.editor.minYears')} htmlFor={id('years')}>
            <TextField type="number" min={0} max={30} step={0.5} value={r.years} onChange={(e) => onChange({ years: e.target.value })} />
          </Field>
        </>
      ) : (
        <>
          <Field label={t('ranks.editor.whichClasses')} htmlFor={id('mode')}>
            <SelectField
              value={r.mode}
              onChange={(e) => onChange({ mode: e.target.value as RungDraft['mode'] })}
              options={[
                { value: 'ANY_TYPE', label: t('ranks.editor.modeAnyType') },
                { value: 'EACH_TYPE', label: t('ranks.editor.modeEachType') },
              ]}
            />
          </Field>
          <Picker
            legend={t('ranks.editor.typesLegend')}
            options={types.map((type) => ({ value: type, label: type }))}
            value={r.types}
            onChange={(v) => onChange({ types: v })}
            empty={t('ranks.editor.noTypesEveryClassCounts')}
          />
          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
            {r.mode === 'EACH_TYPE' ? (
              r.types.map((type) => (
                <Field key={type} label={t('ranks.editor.typeClasses', { type })} htmlFor={id(`type-${type}`)}>
                  <TextField type="number" min={0} value={r.perType[type] ?? ''} onChange={(e) => onChange({ perType: { ...r.perType, [type]: e.target.value } })} />
                </Field>
              ))
            ) : (
              <Field label={t('ranks.editor.classesRequired')} htmlFor={id('classes')}>
                <TextField type="number" min={0} value={r.classesRequired} onChange={(e) => onChange({ classesRequired: e.target.value })} />
              </Field>
            )}
            <Field label={t('ranks.editor.minDays')} htmlFor={id('days')}>
              <TextField type="number" min={0} value={r.minimumDays} onChange={(e) => onChange({ minimumDays: e.target.value })} />
            </Field>
            <Field label={t('ranks.editor.weeklyCap')} htmlFor={id('cap')} hint={t('ranks.editor.weeklyCapHint')}>
              <TextField type="number" min={0} value={r.weeklyCap} onChange={(e) => onChange({ weeklyCap: e.target.value })} />
            </Field>
          </div>
        </>
      )}

      <Picker
        legend={r.timeOnly ? t('ranks.editor.skillsOptional') : t('ranks.editor.requiredSkills')}
        options={skills.map((s) => ({ value: s.id, label: s.name }))}
        value={r.skills}
        onChange={(v) => onChange({ skills: v })}
        empty={t('ranks.editor.noSkills')}
      />
      <Picker
        legend={t('ranks.editor.unlocks')}
        options={types.map((type) => ({ value: type, label: type }))}
        value={r.unlocks}
        onChange={(v) => onChange({ unlocks: v })}
        empty={t('ranks.editor.noTypes')}
      />
    </div>
  );
}
