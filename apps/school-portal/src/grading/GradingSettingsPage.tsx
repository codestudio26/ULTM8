import React, { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Checkbox, EmptyState, ErrorBanner, Spinner, SuccessBanner, Switch, TextField } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useGradingSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import {
  useMyGrading,
  useOpenMatHours,
  usePromotionFeeSettings,
  useSetAnyBoardThresholds,
  useSetGradingRequirements,
  useSetOpenMatHours,
  type GradingRequirements,
  useSetRankDisplay,
  useSetReadyForAdultAge,
  useUpdatePromotionFeeSettings,
} from './gradingQueries';
import { useGradingHeaderTabs } from './GradingTabs';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { NewLookSelect } from '../layout/NewLookSelect';
import { StyleSwitch } from './StyleSwitch';
import '../disciplines/stylesLook.css';
import './gradingSettingsLook.css';

type About = 'display' | 'requirements' | 'promotion' | 'columns' | 'fee' | 'gradeBeforePaid' | 'openMat' | 'who';

const ABOUT: Record<About, { title: TranslationKey; body: TranslationKey }> = {
  display: { title: 'grading.settings.displayTitle', body: 'grading.settings.about.display' },
  requirements: { title: 'grading.settings.requirements.title', body: 'grading.settings.about.requirements' },
  promotion: { title: 'grading.settings.requirements.promotion', body: 'grading.settings.about.promotion' },
  columns: { title: 'grading.settings.columns.title', body: 'grading.settings.about.columns' },
  fee: { title: 'grading.settings.fee.enabled', body: 'grading.settings.about.fee' },
  gradeBeforePaid: { title: 'grading.settings.fee.gradeBeforePaid', body: 'grading.settings.about.gradeBeforePaid' },
  openMat: { title: 'grading.settings.openMat.label', body: 'grading.settings.about.openMatGraded' },
  who: { title: 'grading.settings.who.title', body: 'grading.settings.about.who' },
};

/**
 * Grading → Settings (DESIGN.md → "Grading screens", Settings tab): sections of
 * settings with an "About this setting" panel, and one Discard / Save changes
 * bar. Board columns per style (the owner, or a coach with "Change board %"
 * for that style); the promotion fee for the whole school (owner only,
 * Decisions 297, 300, 307); and "Open mat counts toward hours" (the owner, or
 * a coach with "Change board %" for any style; Decisions 301, 304, 306).
 * A Kids style linked to its Adult style also has "Ready for Adult from age"
 * (backlog 3.20; Decision 285 items 2 and 4), with the same right as its
 * columns. "Ranks shown as" Belts or Levels per style (Decision 290), with
 * the same right too. "What counts toward the next rank" per style
 * (Decision 321): the requirement tick boxes, automatic promotion and
 * "Auto-assign first belt", the owner only.
 *
 * New look (Decision 460 item 17): the new page header with the Grading
 * tabs, white cards with soft rows, the new look's drop-downs (a pick is an
 * edit like any other: the Discard / Save changes bar shows), and the About
 * panel beside the settings (under them on a phone). The same settings,
 * rights, checks, working copy and saving as before.
 *
 * One style at a time (Decision 462 items 10 and 11): the style switch on top
 * picks the style whose cards show (each card's heading names it), and
 * "Ranks shown as" is a Belts · Levels two-button switch. The working copy
 * still holds every style, so an edit made to one style survives switching
 * to another, and Save sends them all.
 */

/** Decision 321 item 1: the six tick boxes, in Gymdesk's order. */
const TICKS: Array<{ field: keyof GradingRequirements; label: TranslationKey }> = [
  { field: 'requireClasses', label: 'grading.settings.requirements.classes' },
  { field: 'requireDaysInRank', label: 'grading.settings.requirements.daysInRank' },
  { field: 'requireSkills', label: 'grading.settings.requirements.skills' },
  { field: 'requireHours', label: 'grading.settings.requirements.hours' },
  { field: 'requireDaysAttended', label: 'grading.settings.requirements.daysAttended' },
  { field: 'requireMinimumAge', label: 'grading.settings.requirements.minimumAge' },
];

function requirementsOf(d: DisciplineResponse): GradingRequirements {
  return {
    requireClasses: d.requireClasses,
    requireDaysInRank: d.requireDaysInRank,
    requireSkills: d.requireSkills,
    requireHours: d.requireHours,
    requireDaysAttended: d.requireDaysAttended,
    requireMinimumAge: d.requireMinimumAge,
    promotionMode: d.promotionMode,
    autoAssignFirstRank: d.autoAssignFirstRank,
  };
}

const sameRequirements = (a: GradingRequirements, b: GradingRequirements) =>
  (Object.keys(a) as Array<keyof GradingRequirements>).every((k) => a[k] === b[k]);
export function GradingSettingsPage() {
  const schoolId = useGradingSchoolId();
  const t = useT();
  const my = useMyGrading(schoolId);
  const disciplines = useDisciplines(schoolId);
  const fee = usePromotionFeeSettings(schoolId);
  const openMat = useOpenMatHours(schoolId);
  const updateFee = useUpdatePromotionFeeSettings(schoolId ?? '');
  const setOpenMat = useSetOpenMatHours(schoolId ?? '');
  const setThresholds = useSetAnyBoardThresholds();
  const setAdultAge = useSetReadyForAdultAge();
  const setRankDisplay = useSetRankDisplay();
  const setRequirements = useSetGradingRequirements();
  const styles = useMemo(() => (disciplines.data?.items ?? []).filter((d) => !d.archivedAt && my.mayGradeStyle(d.id)), [disciplines.data, my]);

  // The page's working copy; Save sends only what changed.
  const [columns, setColumns] = useState<Record<string, { g: string; r: string }>>({});
  const [adultAges, setAdultAges] = useState<Record<string, string>>({});
  const [displays, setDisplays] = useState<Record<string, DisciplineResponse['rankDisplay']>>({});
  const [requirements, setRequirementsDraft] = useState<Record<string, GradingRequirements>>({});
  const [feeOn, setFeeOn] = useState(false);
  const [beforePaid, setBeforePaid] = useState(false);
  // Decision 420 item 3: "Charge a fee when moving a student from Kids to Adult".
  const [kidsToAdult, setKidsToAdult] = useState(false);
  const [openMatOn, setOpenMatOn] = useState(false);
  const [about, setAbout] = useState<About>('columns');
  const [styleId, setStyleId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const headerTabs = useGradingHeaderTabs();

  const reset = () => {
    setColumns(Object.fromEntries(styles.map((d) => [d.id, { g: String(d.boardGettingThere), r: String(d.boardReadyToGrade) }])));
    setAdultAges(Object.fromEntries(styles.map((d) => [d.id, String(d.readyForAdultAge)])));
    setDisplays(Object.fromEntries(styles.map((d) => [d.id, d.rankDisplay])));
    setRequirementsDraft(Object.fromEntries(styles.map((d) => [d.id, requirementsOf(d)])));
    setFeeOn(fee.data?.promotionFeeEnabled ?? false);
    setBeforePaid(fee.data?.gradeBeforeFeePaid ?? false);
    setKidsToAdult(fee.data?.kidsToAdultFeeEnabled ?? false);
    setOpenMatOn(openMat.data?.openMatCountsTowardHours ?? false);
  };
  // Reset when the saved values change, not on every render (the style list is rebuilt each time).
  const savedKey = styles
    .map((d) => `${d.id}:${d.boardGettingThere}:${d.boardReadyToGrade}:${d.readyForAdultAge}:${d.rankDisplay}:${JSON.stringify(requirementsOf(d))}`)
    .join(',');
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(reset, [savedKey, fee.data, openMat.data]);

  if (!schoolId) return null;
  if (my.isLoading || disciplines.isLoading || fee.isLoading || openMat.isLoading) return <Spinner />;
  const loadError = my.error ?? disciplines.error ?? fee.error ?? openMat.error;
  if (loadError) return <ErrorBanner message={loadError instanceof ApiError ? loadError.message : t('grading.settings.loadFailed')} />;

  const canColumns = (d: DisciplineResponse) => my.can(d.id, 'canChangeBoardThresholds');
  const canOpenMat = my.isOwner || styles.some(canColumns);
  const columnProblem = (c: { g: string; r: string }) => {
    const g = Number(c.g);
    const r = Number(c.r);
    return Number.isInteger(g) && Number.isInteger(r) && g >= 1 && r <= 99 && g < r ? null : t('grading.board.thresholds.invalid');
  };
  const changedColumns = styles.filter((d) => {
    const c = columns[d.id];
    return c && canColumns(d) && (c.g !== String(d.boardGettingThere) || c.r !== String(d.boardReadyToGrade));
  });
  const ageProblem = (v: string) => (Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 99 ? null : t('grading.settings.columns.adultAgeInvalid'));
  const changedAges = styles.filter((d) => d.adultDisciplineId && canColumns(d) && adultAges[d.id] !== undefined && adultAges[d.id] !== String(d.readyForAdultAge));
  const changedDisplays = styles.filter((d) => canColumns(d) && displays[d.id] !== undefined && displays[d.id] !== d.rankDisplay);
  // The style whose cards show; the first one until another is picked.
  const shown = styles.find((d) => d.id === styleId) ?? styles[0] ?? null;
  const shownStyles = shown ? [shown] : [];
  const changedRequirements = styles.filter((d) => my.isOwner && requirements[d.id] !== undefined && !sameRequirements(requirements[d.id], requirementsOf(d)));
  const feeChanged =
    my.isOwner &&
    (feeOn !== (fee.data?.promotionFeeEnabled ?? false) ||
      beforePaid !== (fee.data?.gradeBeforeFeePaid ?? false) ||
      kidsToAdult !== (fee.data?.kidsToAdultFeeEnabled ?? false));
  const openMatChanged = canOpenMat && openMatOn !== (openMat.data?.openMatCountsTowardHours ?? false);
  const dirty = changedColumns.length > 0 || changedAges.length > 0 || changedDisplays.length > 0 || changedRequirements.length > 0 || feeChanged || openMatChanged;
  const invalid = changedColumns.some((d) => columnProblem(columns[d.id]) !== null) || changedAges.some((d) => ageProblem(adultAges[d.id]) !== null);

  async function save() {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      for (const d of changedColumns) {
        await setThresholds.mutateAsync({ disciplineId: d.id, gettingThere: Number(columns[d.id].g), readyToGrade: Number(columns[d.id].r) });
      }
      for (const d of changedAges) {
        await setAdultAge.mutateAsync({ disciplineId: d.id, age: Number(adultAges[d.id]) });
      }
      for (const d of changedDisplays) {
        await setRankDisplay.mutateAsync({ disciplineId: d.id, rankDisplay: displays[d.id] });
      }
      for (const d of changedRequirements) {
        await setRequirements.mutateAsync({ disciplineId: d.id, body: requirements[d.id] });
      }
      if (feeChanged) await updateFee.mutateAsync({ promotionFeeEnabled: feeOn, ...(feeOn ? { gradeBeforeFeePaid: beforePaid, kidsToAdultFeeEnabled: kidsToAdult } : {}) });
      if (openMatChanged) await setOpenMat.mutateAsync(openMatOn);
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('common.tryAgain'));
    } finally {
      setSaving(false);
    }
  }

  const aboutButton = (key: About) => (
    <Button variant="secondary" className="ultm8-about-button u8gst-info" onClick={() => setAbout(key)} aria-label={t('grading.settings.aboutAria', { setting: t(ABOUT[key].title) })}>
      ⓘ
    </Button>
  );
  /** A card's heading: the title, an "Owner only" tag, and its ⓘ. */
  const cardHead = (title: TranslationKey, key: About | null, ownerOnly = false, styleName?: string) => (
    <div className="u8gst-head">
      <h2 className="u8b-card__title">
        {t(title)}
        {styleName ? ` · ${styleName}` : ''} {ownerOnly ? <span className="u8gs-tag">{t('grading.settings.ownerOnly')}</span> : null}
      </h2>
      {key ? aboutButton(key) : null}
    </div>
  );

  return (
    <BillingPage>
      <NewLookPageHeader title={t('grading.settings.title')} subtitle={t('grading.settings.subtitle')} {...headerTabs} />
      {error ? <ErrorBanner message={error} /> : null}
      {saved && !dirty ? <SuccessBanner message={t('grading.settings.saved')} /> : null}
      <div className="u8gst-layout">
        <div className="u8gst-main">
          {styles.length ? <StyleSwitch styles={styles} value={shown?.id ?? null} onChange={setStyleId} /> : null}
          {styles.length ? (
            <BillingCard>
              <section aria-label={t('grading.settings.displayTitle')}>
                {cardHead('grading.settings.displayTitle', 'display', false, shown?.name)}
                <div className="u8gst-rows">
                  {shownStyles.map((d) => {
                    const editable = canColumns(d);
                    const value = displays[d.id] ?? d.rankDisplay;
                    const pick = (v: DisciplineResponse['rankDisplay']) => {
                      if (v !== value) setDisplays((x) => ({ ...x, [d.id]: v }));
                      setAbout('display');
                    };
                    return (
                      <div key={d.id} className="u8gst-row u8gst-row--line">
                        <strong className="u8gst-grow">{t('disciplines.form.rankDisplayLabel')}</strong>
                        <div role="group" aria-label={t('grading.settings.displayAria', { style: d.name })} className="u8ss">
                          {(
                            [
                              ['BELTS', 'disciplines.form.rankDisplayBelts'],
                              ['LEVELS', 'disciplines.form.rankDisplayLevels'],
                            ] as const
                          ).map(([v, label]) => (
                            <button key={v} type="button" className="u8ss__btn" aria-pressed={value === v} disabled={!editable} onClick={() => pick(v)}>
                              {t(label)}
                            </button>
                          ))}
                        </div>
                        {editable ? null : <p className="u8gs-note u8gst-full">{t('grading.settings.columns.noRight')}</p>}
                      </div>
                    );
                  })}
                </div>
              </section>
            </BillingCard>
          ) : null}
          {styles.length ? (
            <BillingCard>
              <section aria-label={t('grading.settings.requirements.title')}>
                {cardHead('grading.settings.requirements.title', 'requirements', true, shown?.name)}
                <p className="u8gs-note u8gst-intro">{t('grading.settings.requirements.intro')}</p>
                <div className="u8gst-rows">
                  {shownStyles.map((d) => {
                    const r = requirements[d.id] ?? requirementsOf(d);
                    const set = (patch: Partial<GradingRequirements>) => setRequirementsDraft((x) => ({ ...x, [d.id]: { ...r, ...patch } }));
                    return (
                      <div key={d.id} className="u8gst-row" data-testid={`requirements-${d.id}`}>
                        <div className="u8gst-ticks u8gst-full">
                          {TICKS.map(({ field, label }) => (
                            <Checkbox
                              key={field}
                              label={t(label)}
                              aria-label={t('grading.settings.requirements.tickAria', { style: d.name, requirement: t(label) })}
                              checked={r[field] as boolean}
                              disabled={!my.isOwner}
                              onChange={(e) => {
                                set({ [field]: e.target.checked });
                                setAbout('requirements');
                              }}
                            />
                          ))}
                        </div>
                        <div className="u8n-dd-field u8gst-dd u8gst-full">
                          <NewLookSelect
                            id={`promotion-${d.id}`}
                            label={t('grading.settings.requirements.promotion')}
                            ariaLabel={t('grading.settings.requirements.promotionAria', { style: d.name })}
                            value={r.promotionMode}
                            disabled={!my.isOwner}
                            onChange={(v) => {
                              set({ promotionMode: v as GradingRequirements['promotionMode'] });
                              setAbout('promotion');
                            }}
                            options={[
                              { value: 'MANUAL', label: t('grading.settings.requirements.manual') },
                              { value: 'AUTO_STRIPES', label: t('grading.settings.requirements.autoStripes') },
                              { value: 'AUTO_ALL', label: t('grading.settings.requirements.autoAll') },
                            ]}
                          />
                        </div>
                        <div className="u8gst-full">
                          <Switch
                            id={`first-belt-${d.id}`}
                            label={t('grading.settings.requirements.firstBelt')}
                            description={t('grading.settings.requirements.firstBeltHint')}
                            checked={r.autoAssignFirstRank}
                            disabled={!my.isOwner}
                            onChange={(v) => {
                              set({ autoAssignFirstRank: v });
                              setAbout('promotion');
                            }}
                          />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </BillingCard>
          ) : null}
          <BillingCard>
            <section aria-label={t('grading.settings.columns.title')}>
              {cardHead('grading.settings.columns.title', 'columns', false, shown?.name)}
              <p className="u8gs-note u8gst-intro">{t('grading.settings.columns.intro')}</p>
              {styles.length === 0 ? (
                <EmptyState title={t('grading.noStylesTitle')} description={t('grading.board.noStylesDescription')} />
              ) : (
                <div className="u8gst-rows">
                  {shownStyles.map((d) => {
                    const c = columns[d.id] ?? { g: String(d.boardGettingThere), r: String(d.boardReadyToGrade) };
                    const editable = canColumns(d);
                    const problem = editable ? columnProblem(c) : null;
                    return (
                      <div key={d.id} className="u8gst-row">
                        <label className="u8gst-num">
                          {t('grading.settings.columns.gettingThere')}
                          <TextField
                            type="number"
                            min={1}
                            max={98}
                            value={c.g}
                            disabled={!editable}
                            aria-label={t('grading.settings.columns.gettingThereAria', { style: d.name })}
                            onChange={(e) => setColumns((x) => ({ ...x, [d.id]: { ...c, g: e.target.value } }))}
                          />
                        </label>
                        <label className="u8gst-num">
                          {t('grading.settings.columns.readyToGrade')}
                          <TextField
                            type="number"
                            min={2}
                            max={99}
                            value={c.r}
                            disabled={!editable}
                            aria-label={t('grading.settings.columns.readyToGradeAria', { style: d.name })}
                            onChange={(e) => setColumns((x) => ({ ...x, [d.id]: { ...c, r: e.target.value } }))}
                          />
                        </label>
                        {d.adultDisciplineId ? (
                          <label className="u8gst-num">
                            {t('grading.settings.columns.adultAge')}
                            <TextField
                              type="number"
                              min={1}
                              max={99}
                              value={adultAges[d.id] ?? String(d.readyForAdultAge)}
                              disabled={!editable}
                              aria-label={t('grading.settings.columns.adultAgeAria', { style: d.name })}
                              onChange={(e) => setAdultAges((x) => ({ ...x, [d.id]: e.target.value }))}
                            />
                          </label>
                        ) : null}
                        {d.adultDisciplineId && editable && adultAges[d.id] !== undefined && ageProblem(adultAges[d.id]) ? (
                          <p role="alert" className="ultm8-field__error u8gst-full u8gst-error">
                            {ageProblem(adultAges[d.id])}
                          </p>
                        ) : null}
                        {editable ? null : <p className="u8gs-note u8gst-full">{t('grading.settings.columns.noRight')}</p>}
                        {problem ? (
                          <p role="alert" className="ultm8-field__error u8gst-full u8gst-error">
                            {problem}
                          </p>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </BillingCard>

          <BillingCard>
            <section aria-label={t('grading.settings.fee.title')}>
              {cardHead('grading.settings.fee.title', 'fee', true)}
              {my.isOwner ? null : <p className="u8gs-note u8gst-intro">{t('grading.settings.fee.coachNote')}</p>}
              <div className="u8gst-rows">
                <div className="u8gst-row">
                  <div className="u8gst-full">
                    <Switch
                      id="fee-enabled"
                      label={t('grading.settings.fee.enabled')}
                      description={feeOn ? t('grading.settings.fee.enabledOn') : t('grading.settings.fee.enabledOff')}
                      checked={feeOn}
                      disabled={!my.isOwner}
                      onChange={(v) => {
                        setFeeOn(v);
                        setAbout('fee');
                      }}
                    />
                  </div>
                </div>
                {feeOn ? (
                  <>
                    {/* Decision 420 item 3: works only while the promotion fee is on; off by default. */}
                    <div className="u8gst-row">
                      <div className="u8gst-full">
                        <Switch
                          id="fee-kids-to-adult"
                          label={t('grading.settings.fee.kidsToAdult')}
                          description={kidsToAdult ? t('grading.settings.fee.kidsToAdultOn') : t('grading.settings.fee.kidsToAdultOff')}
                          checked={kidsToAdult}
                          disabled={!my.isOwner}
                          onChange={(v) => {
                            setKidsToAdult(v);
                            setAbout('fee');
                          }}
                        />
                      </div>
                    </div>
                    <div className="u8gst-row u8gst-row--with-info">
                      <div className="u8gst-grow">
                        <Switch
                          id="fee-before-paid"
                          label={t('grading.settings.fee.gradeBeforePaid')}
                          description={beforePaid ? t('grading.settings.fee.gradeBeforePaidOn') : t('grading.settings.fee.gradeBeforePaidOff')}
                          checked={beforePaid}
                          disabled={!my.isOwner}
                          onChange={(v) => {
                            setBeforePaid(v);
                            setAbout('gradeBeforePaid');
                          }}
                        />
                      </div>
                      {aboutButton('gradeBeforePaid')}
                    </div>
                    <div className="u8gst-row u8gst-row--line">
                      <strong className="u8gst-grow">{t('grading.settings.fee.prices')}</strong>
                      <Link to="/disciplines" className="u8gst-link">
                        {t('grading.settings.fee.pricesLink')}
                      </Link>
                    </div>
                    <div className="u8gst-row u8gst-row--line">
                      <strong className="u8gst-grow">{t('grading.settings.fee.accepts')}</strong>
                      <span className="u8gs-tag">{t('grading.settings.fee.alwaysOn')}</span>
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          </BillingCard>

          <BillingCard>
            <section aria-label={t('grading.settings.wholeSchool')}>
              {cardHead('grading.settings.wholeSchool', null)}
              <div className="u8gst-rows">
                <div className="u8gst-row u8gst-row--with-info">
                  <div className="u8gst-grow">
                    <Switch
                      id="open-mat-hours"
                      label={t('grading.settings.openMat.label')}
                      description={t('grading.settings.openMat.hint')}
                      checked={openMatOn}
                      disabled={!canOpenMat}
                      onChange={(v) => {
                        setOpenMatOn(v);
                        setAbout('openMat');
                      }}
                    />
                  </div>
                  {aboutButton('openMat')}
                </div>
                <div className="u8gst-row u8gst-row--line">
                  <span className="u8gst-grow">
                    <strong>{t('grading.settings.who.title')}</strong>
                    <span className="u8gs-note u8gst-sub">{t('grading.settings.who.hint')}</span>
                  </span>
                  {my.isOwner ? (
                    <Link to="/grading/permissions" className="u8gst-link">
                      {t('grading.settings.who.link')}
                    </Link>
                  ) : null}
                </div>
              </div>
            </section>
          </BillingCard>
        </div>

        <aside className="u8gst-about">
          <BillingCard>
            <section aria-label={t('grading.settings.aboutTitle')}>
              <div className="u8gst-about__label">{t('grading.settings.aboutTitle')}</div>
              <h3 className="u8gst-about__title">{t(ABOUT[about].title)}</h3>
              <p className="u8gst-about__text">{t(ABOUT[about].body)}</p>
            </section>
          </BillingCard>
        </aside>
      </div>

      {dirty ? (
        <div className="u8gst-save" role="region" aria-label={t('grading.settings.unsaved')}>
          <span className="u8gst-save__text">
            <span className="u8gst-save__dot" aria-hidden="true" />
            {t('grading.settings.unsaved')}
          </span>
          <div className="u8gst-save__pair">
            <Button variant="secondary" onClick={reset} disabled={saving}>
              {t('grading.settings.discard')}
            </Button>
            <Button onClick={save} loading={saving} disabled={invalid}>
              {t('grading.settings.save')}
            </Button>
          </div>
        </div>
      ) : null}
    </BillingPage>
  );
}
