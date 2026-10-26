import React, { useState } from 'react';
import { Badge, Button, Checkbox, ErrorBanner, Field, Modal, SelectField, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import type { DisciplineResponse } from '../disciplines/disciplineQueries';
import type { SkillResponse } from '../skills/skillQueries';
import { BeltChip } from '../grading/BeltChip';
import { moveItem, useDragReorder } from './dragReorder';
import type { RankResponse, RankStripeTierInput } from './rankQueries';
import { formatMoney } from '../lib/money';
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
  /** Promotion fee in major units ("40" = 40.00); empty = free. */
  price: string;
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
    price: '',
  };
}

/** The next stripe grade: one more stripe than `prev` in its last colour,
 * and the same numbers and class types (not its skills) — DESIGN.md → "New
 * stripe grades copy the previous grade's numbers and class types". */
function nextGrade(prev: RungDraft | undefined): RungDraft {
  if (!prev) return blankRung();
  const last = prev.segments[prev.segments.length - 1];
  const segments = last
    ? [...prev.segments.slice(0, -1), { count: String((Number(last.count) || 0) + 1), colour: last.colour }]
    : [{ count: '1', colour: '#FFFFFF' }];
  return {
    ...blankRung(),
    segments,
    timeOnly: prev.timeOnly,
    years: prev.years,
    classesRequired: prev.classesRequired,
    minimumDays: prev.minimumDays,
    mode: prev.mode,
    types: [...prev.types],
    perType: { ...prev.perType },
    weeklyCap: prev.weeklyCap,
  };
}

function draftFrom(t: RankResponse['stripeTiers'][number], keepId: boolean): RungDraft {
  const reqs = (t.classTypeRequirements ?? []) as Array<{ classType: string; classesRequired: number }>;
  const segments = ((t.stripeSegments ?? []) as Array<{ count: number; colour: string }>).map((s) => ({ count: String(s.count), colour: s.colour }));
  return {
    key: newKey(),
    id: keepId ? t.id : undefined,
    name: keepId ? t.name : '',
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
    price: t.promotionFeeMinor ? String(t.promotionFeeMinor / 100) : '',
  };
}

/** The API's own name for a rung left unnamed (RanksService.generatedTierName).
 * Deliberately not translated: it previews the name the API will store. */
const generatedName = (belt: string, count: number) => (count === 0 ? belt : `${belt} · ${count} Stripe${count === 1 ? '' : 's'}`);
const total = (segments: Segment[]) => segments.reduce((sum, s) => sum + (Number(s.count) || 0), 0);
const num = (v: string) => (v.trim() === '' ? undefined : Number(v));

function toInput(r: RungDraft, order: number, withPrice: boolean): RankStripeTierInput {
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
    // Only while the School's fee is on: the API refuses a price otherwise (Decision 307).
    ...(withPrice ? { promotionFeeMinor: r.price.trim() === '' ? null : Math.round(Number(r.price) * 100) } : {}),
  };
}

/** Whether a grade says what it takes (classes or days), for "Ready to save". */
function saysWhatItTakes(r: RungDraft): boolean {
  if (r.timeOnly) return (num(r.years) ?? 0) > 0;
  const classes = r.mode === 'EACH_TYPE' ? r.types.some((t) => Number(r.perType[t] || 0) > 0) : (num(r.classesRequired) ?? 0) > 0;
  return classes || (num(r.minimumDays) ?? 0) > 0;
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

function Chapter({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} style={{ borderTop: '1px solid var(--border)', paddingTop: 12, marginTop: 12 }}>
      <h3 style={{ fontSize: 15, margin: '0 0 10px', display: 'flex', gap: 10, alignItems: 'baseline' }}>
        <span style={{ color: 'var(--text-secondary)', fontVariantNumeric: 'tabular-nums' }}>{number}</span>
        {title}
      </h3>
      {children}
    </section>
  );
}

/**
 * Add, edit or duplicate a rank and its grades (roadmap Phase 4, item 1;
 * Decisions 127, 128, 140, 149, 152, 165, 173, 180; New Portal layout in
 * DESIGN.md → "Belt editor: one grade at a time"). A grade is each step a
 * student can reach on a belt: the plain belt, then each stripe. A row of
 * pills picks the grade being edited; under them, its place ("Grade 2 of 4"),
 * ↑ ↓ and Delete grade. 01 Belt and stripes: the rank name, the colours shared
 * by every grade, where a new rank goes in the ladder, this grade's own name
 * and its stripes (colour groups). 02 What it takes: this grade's
 * requirements. 03 Promotion fee, owner only and only while the School's fee
 * is on. A live preview shows the picked grade, and "Ready to save" lists what
 * is still missing; an empty grade is a warning, not a block. Grades reorder
 * within the belt and keep their students; a grade someone holds can't be
 * deleted.
 */
export function BeltEditorModal({
  title,
  mode = 'edit',
  discipline,
  initial,
  ladder,
  originalIndex,
  skills,
  holders,
  fee,
  submitting,
  onSubmit,
  onClose,
}: {
  title: string;
  /** "add" and "duplicate" ask where the rank goes in the ladder. */
  mode?: 'add' | 'edit' | 'duplicate';
  discipline: DisciplineResponse;
  initial?: RankResponse;
  /** The style's ranks in ladder order, for "Where it goes" and the preview. */
  ladder: RankResponse[];
  /** This rank's place in the ladder when editing, or the duplicated one's. */
  originalIndex?: number;
  skills: SkillResponse[];
  holders: Map<string, Holder[]>;
  /** The School's promotion fee, when it is on and the caller is the owner. */
  fee: { currency: string | null } | null;
  submitting: boolean;
  /** `position`: the ladder index for a new rank (add / duplicate). */
  onSubmit: (values: BeltValues, position: number) => Promise<void>;
  onClose: () => void;
}) {
  const t = useT();
  const copying = mode === 'duplicate';
  const [name, setName] = useState(initial ? (copying ? t('ranks.editor.copyName', { name: initial.name }) : initial.name) : '');
  const [primaryColour, setPrimaryColour] = useState(initial?.primaryColour ?? '#FFFFFF');
  const [secondaryColour, setSecondaryColour] = useState(initial?.secondaryColour ?? '');
  const [tagColour, setTagColour] = useState(initial?.tagColour ?? '');
  const [rungs, setRungs] = useState<RungDraft[]>(() =>
    initial?.stripeTiers.length ? [...initial.stripeTiers].sort((a, b) => a.order - b.order).map((tier) => draftFrom(tier, !copying)) : [blankRung()],
  );
  const [selected, setSelected] = useState(0);
  const [group, setGroup] = useState(0);
  const [position, setPosition] = useState(mode === 'add' ? ladder.length : copying && originalIndex !== undefined ? originalIndex + 1 : originalIndex ?? 0);
  const [confirming, setConfirming] = useState<Holder[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const types = discipline.classTypesOffered;
  const originalOrder = copying ? [] : (initial?.stripeTiers ?? []).slice().sort((a, b) => a.order - b.order).map((tier) => tier.id);
  const current = rungs[Math.min(selected, rungs.length - 1)];
  const index = Math.min(selected, rungs.length - 1);
  const beltLabel = name.trim() || t('ranks.editor.unnamedRank');
  const labelOf = (r: RungDraft) => r.name.trim() || generatedName(beltLabel, total(r.segments));
  const shortLabel = (r: RungDraft) => (total(r.segments) === 0 ? t('ranks.editor.plainBelt') : t('ranks.editor.stripesShort', { count: total(r.segments) }));
  const update = (key: string, patch: Partial<RungDraft>) => setRungs((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const move = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= rungs.length) return;
    setRungs((rs) => moveItem(rs, i, j));
    if (selected === i) setSelected(j);
  };
  const drag = useDragReorder((from, to) => {
    setRungs((rs) => moveItem(rs, from, to));
    setSelected(to);
  });
  const ladderPlace = mode === 'edit' ? (originalIndex ?? 0) : position;
  const ladderSize = mode === 'edit' ? ladder.length : ladder.length + 1;
  // The very first grade of the whole ladder may say nothing (it's where everyone starts).
  const isFirstOfLadder = (i: number) => ladderPlace === 0 && i === 0;
  const empties = rungs.filter((r, i) => !isFirstOfLadder(i) && !saysWhatItTakes(r));

  /** Students on grades whose position in this belt changes (Decision 152). */
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
      if (fee && r.price.trim() !== '' && !(Number(r.price) >= 0)) return t('ranks.editor.priceInvalid', { label: labelOf(r) });
    }
    return null;
  }

  async function save() {
    setError(null);
    try {
      await onSubmit(
        {
          name: name.trim(),
          primaryColour: primaryColour.trim(),
          secondaryColour: secondaryColour.trim() || null,
          tagColour: tagColour.trim() || null,
          stripeTiers: rungs.map((r, i) => toInput(r, i, !!fee)),
        },
        position,
      );
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
            <li key={h.studentId}>{`${h.firstName} ${h.surname}`.trim() || t('ranks.formerStudent')}</li>
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

  const others = ladder;
  const positionOptions = [
    ...others.map((r, i) => ({ value: String(i), label: i === 0 ? t('ranks.editor.positionFirst', { name: r.name }) : t('ranks.editor.positionAfter', { name: others[i - 1].name }) })),
    { value: String(others.length), label: others.length ? t('ranks.editor.positionLast', { name: others[others.length - 1].name }) : t('ranks.editor.positionOnly') },
  ];
  const held = current.id ? holders.get(current.id) ?? [] : [];
  const previewRank = {
    ...(initial ?? ({} as RankResponse)),
    id: initial?.id ?? 'preview',
    name: beltLabel,
    primaryColour: primaryColour || '#FFFFFF',
    secondaryColour: secondaryColour.trim() || null,
    tagColour: tagColour.trim() || null,
  } as RankResponse;
  const previewTier = { ...(toInput(current, index, false) as unknown as RankResponse['stripeTiers'][number]), id: current.id ?? 'preview' };
  const pricedSummary = rungs.filter((r) => r.price.trim() !== '' && Number(r.price) > 0);

  return (
    <Modal title={title} onClose={onClose} wide>
      <form onSubmit={handleSubmit}>
        {error ? <ErrorBanner message={error} /> : null}
        {copying ? <p style={{ color: '#2b4f80', marginTop: 0 }}>{t('ranks.editor.duplicateNote')}</p> : null}
        <div className="ultm8-editor-layout">
          <div style={{ minWidth: 0 }}>
            <h3 style={{ fontSize: 15, margin: '0 0 8px' }}>{t('ranks.editor.gradesOf', { name: beltLabel })}</h3>
            <ol aria-label={t('ranks.editor.gradesOf', { name: beltLabel })} style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {rungs.map((r, i) => {
                const label = labelOf(r);
                const count = r.id ? holders.get(r.id)?.length ?? 0 : 0;
                return (
                  <li key={r.key} aria-label={t('ranks.editor.lineAria', { number: i + 1, label })} {...drag.targetProps(i)} style={{ display: 'flex', alignItems: 'center', ...drag.rowStyle(i) }}>
                    <span {...drag.handleProps(i, label)}>⠿</span>
                    <button
                      type="button"
                      className={`ultm8-grade-pill${i === index ? ' ultm8-grade-pill--on' : ''}`}
                      aria-pressed={i === index}
                      aria-label={t('ranks.editAria', { name: label })}
                      onClick={() => {
                        setSelected(i);
                        setGroup(0);
                      }}
                    >
                      <BeltChip rung={{ id: r.key, rankId: previewRank.id, rank: previewRank, tier: { ...(toInput(r, i, false) as unknown as RankResponse['stripeTiers'][number]) }, index: i, name: label }} />
                      <span>{shortLabel(r)}</span>
                      {count > 0 ? <span className="ultm8-grade-pill__count">{count}</span> : null}
                    </button>
                  </li>
                );
              })}
            </ol>
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
              <span className="ultm8-field__hint" style={{ flex: 1, minWidth: 160 }}>
                {t('ranks.editor.gradeOf', { number: index + 1, total: rungs.length })} · {t('ranks.editor.onStripe', { count: held.length })}
              </span>
              <Button type="button" variant="secondary" onClick={() => move(index, -1)} disabled={index === 0} aria-label={t('ranks.moveUpAria', { name: labelOf(current) })}>
                ↑
              </Button>
              <Button type="button" variant="secondary" onClick={() => move(index, 1)} disabled={index === rungs.length - 1} aria-label={t('ranks.moveDownAria', { name: labelOf(current) })}>
                ↓
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRungs((rs) => rs.filter((x) => x.key !== current.key));
                  setSelected(Math.max(0, index - 1));
                }}
                disabled={held.length > 0 || rungs.length === 1}
                aria-label={held.length > 0 ? t('ranks.editor.cantRemoveAria', { label: labelOf(current), count: held.length }) : t('ranks.editor.removeAria', { label: labelOf(current) })}
                title={held.length > 0 ? t('ranks.editor.heldTitle') : undefined}
              >
                {t('ranks.editor.deleteGrade')}
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => {
                  setRungs((rs) => [...rs, nextGrade(rs[rs.length - 1])]);
                  setSelected(rungs.length);
                  setGroup(0);
                }}
              >
                {t('ranks.editor.addGrade')}
              </Button>
            </div>

            <Chapter number="01" title={t('ranks.editor.chapterBelt')}>
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
              {mode !== 'edit' ? (
                <Field label={t('ranks.editor.whereItGoes')} htmlFor="belt-position">
                  <SelectField value={String(position)} onChange={(e) => setPosition(Number(e.target.value))} options={positionOptions} />
                </Field>
              ) : null}
              <Field
                label={t('ranks.editor.gradeName')}
                htmlFor={`grade-name-${current.key}`}
                hint={t('ranks.editor.stripeNameHint', { name: generatedName(beltLabel, total(current.segments)) })}
              >
                <TextField maxLength={100} value={current.name} placeholder={generatedName(beltLabel, total(current.segments))} onChange={(e) => update(current.key, { name: e.target.value })} />
              </Field>
              <StripeGroups r={current} group={group} setGroup={setGroup} onChange={(patch) => update(current.key, patch)} />
            </Chapter>

            <Chapter number="02" title={t('ranks.editor.chapterWhatItTakes')}>
              <RequirementFields r={current} index={index} types={types} skills={skills} onChange={(patch) => update(current.key, patch)} />
            </Chapter>

            {fee ? (
              <Chapter number="03" title={t('ranks.editor.chapterFee')}>
                <Field label={fee.currency ? `${t('ranks.editor.priceLabel')} (${fee.currency})` : t('ranks.editor.priceLabel')} htmlFor={`grade-price-${current.key}`} hint={t('ranks.editor.priceHint')}>
                  <TextField type="number" min={0} step="0.01" value={current.price} placeholder={t('ranks.editor.free')} onChange={(e) => update(current.key, { price: e.target.value })} />
                </Field>
                <p className="ultm8-field__hint" style={{ margin: 0 }}>
                  {pricedSummary.length === 0
                    ? t('ranks.editor.pricedNone')
                    : t('ranks.editor.pricedGrades', {
                        list: pricedSummary.map((r) => `${labelOf(r)}: ${formatMoney(Math.round(Number(r.price) * 100), fee.currency)}`).join(', '),
                      })}
                </p>
              </Chapter>
            ) : null}
          </div>

          <aside className="ultm8-editor-preview">
            <div className="ultm8-field__hint" style={{ textTransform: 'uppercase', letterSpacing: '0.06em', fontSize: 11 }}>
              {t('ranks.editor.preview')}
            </div>
            <BeltChip large rung={{ id: current.key, rankId: previewRank.id, rank: previewRank, tier: previewTier, index, name: labelOf(current) }} />
            <strong>{labelOf(current)}</strong>
            <span className="ultm8-field__hint">{t('ranks.editor.beltOf', { number: ladderPlace + 1, total: ladderSize })}</span>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: 10, marginTop: 6 }}>
              <strong style={{ fontSize: 14 }}>{t('ranks.editor.readyTitle')}</strong>
              <ul style={{ listStyle: 'none', padding: 0, margin: '6px 0 0', display: 'grid', gap: 4, fontSize: 13 }}>
                <ReadyLine ok={!!name.trim()}>{t('ranks.editor.readyName')}</ReadyLine>
                <ReadyLine ok={!!primaryColour.trim()}>{t('ranks.editor.readyColour')}</ReadyLine>
                <ReadyLine ok={rungs.every((r) => r.segments.every((s) => Number(s.count) >= 1 && !!s.colour.trim()))}>{t('ranks.editor.readyStripes')}</ReadyLine>
                {empties.length === 0 ? (
                  <ReadyLine ok>{t('ranks.editor.readyWhatItTakes')}</ReadyLine>
                ) : (
                  <li style={{ color: 'var(--text-warning)' }}>
                    ⚠ {t('ranks.editor.checkWhatItTakes', { list: empties.map(shortLabel).join(', ') })}
                  </li>
                )}
              </ul>
            </div>
            {current.timeOnly ? <Badge variant="accent">{t('ranks.editor.timeOnlyBadge')}</Badge> : null}
          </aside>
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

function ReadyLine({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li style={{ display: 'flex', gap: 6, color: ok ? undefined : 'var(--text-danger)' }}>
      <span aria-hidden="true" style={{ color: ok ? '#3a7556' : undefined }}>
        {ok ? '✓' : '○'}
      </span>
      <span>{children}</span>
    </li>
  );
}

/** "Stripes on this grade" as colour groups (DESIGN.md → "Stripe colours"):
 * each group is a box with a round selector; one Remove button removes the
 * selected group and names it; a new group is selected as soon as it's added. */
function StripeGroups({ r, group, setGroup, onChange }: { r: RungDraft; group: number; setGroup: (i: number) => void; onChange: (patch: Partial<RungDraft>) => void }) {
  const t = useT();
  const setSegment = (i: number, patch: Partial<Segment>) => onChange({ segments: r.segments.map((s, j) => (j === i ? { ...s, ...patch } : s)) });
  const picked = Math.min(group, r.segments.length - 1);
  return (
    <fieldset style={{ border: 'none', padding: 0, margin: '0 0 12px' }}>
      <legend className="ultm8-field__label">{t('ranks.editor.stripesCount', { count: total(r.segments) })}</legend>
      <div style={{ display: 'grid', gap: 8 }}>
        {r.segments.map((s, i) => (
          <div key={i} className={`ultm8-colour-group${i === picked ? ' ultm8-colour-group--on' : ''}`} onClick={() => setGroup(i)}>
            <input
              type="radio"
              name={`group-${r.key}`}
              checked={i === picked}
              onChange={() => setGroup(i)}
              aria-label={t('ranks.editor.colourGroup', { number: i + 1, count: Number(s.count) || 0 })}
            />
            <span className="ultm8-field__hint" style={{ minWidth: 110 }}>
              {t('ranks.editor.colourGroup', { number: i + 1, count: Number(s.count) || 0 })}
            </span>
            <Field label={t('ranks.editor.number')} htmlFor={`${r.key}-seg-${i}-count`}>
              <TextField type="number" min={1} max={12} value={s.count} onChange={(e) => setSegment(i, { count: e.target.value })} />
            </Field>
            <Field label={t('ranks.editor.colour')} htmlFor={`${r.key}-seg-${i}-colour`}>
              <TextField type="color" value={/^#[0-9a-fA-F]{6}$/.test(s.colour) ? s.colour : '#ffffff'} onChange={(e) => setSegment(i, { colour: e.target.value })} />
            </Field>
          </div>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 8 }}>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            onChange({ segments: [...r.segments, { count: '1', colour: '#ffffff' }] });
            setGroup(r.segments.length);
          }}
        >
          {r.segments.length ? t('ranks.editor.addStripesAnotherColour') : t('ranks.editor.addStripes')}
        </Button>
        {r.segments.length > 0 ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              onChange({ segments: r.segments.filter((_, j) => j !== picked) });
              setGroup(Math.max(0, picked - 1));
            }}
          >
            {r.segments.length > 1 ? t('ranks.editor.removeColour', { number: picked + 1 }) : t('ranks.editor.remove')}
          </Button>
        ) : null}
      </div>
    </fieldset>
  );
}

function RequirementFields({
  r,
  index,
  types,
  skills,
  onChange,
}: {
  r: RungDraft;
  index: number;
  types: string[];
  skills: SkillResponse[];
  onChange: (patch: Partial<RungDraft>) => void;
}) {
  const t = useT();
  const id = (f: string) => `rung-${index}-${f}`;
  return (
    <div>
      <Checkbox label={t('ranks.editor.timeOnlyLabel')} checked={r.timeOnly} onChange={(e) => onChange({ timeOnly: e.target.checked })} />
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
