import React, { useEffect, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, EmptyState, ErrorBanner, Spinner, SuccessBanner } from '@ultm8/ui';
import { useGradingHeaderTabs } from './GradingTabs';
import { ApiError, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useAuth, useOwnedSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useIsMainOwner } from '../roleGrants/roleGrantQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';
import { BillingCard, BillingPage } from '../billing/BillingLook';
import { NewLookPageHeader } from '../layout/NewLookPage';
import { TeamAvatar } from '../team/TeamParts';
import '../disciplines/stylesLook.css';
import './gradingSettingsLook.css';

type Permission = components['schemas']['GradingPermissionResponseDto'];
type Staff = components['schemas']['GradingStaffDto'];
type StyleInput = components['schemas']['StylePermissionInputDto'];
type Toggle = Exclude<keyof StyleInput, 'disciplineId'>;

/** The seven toggles, in the order Gus approved (Decision 181). Labels and
 * hints are translation keys, resolved at render time. */
export const TOGGLES: Array<{ key: Toggle; label: TranslationKey; hint: TranslationKey }> = [
  { key: 'canPromote', label: 'grading.permissions.toggles.canPromote.label', hint: 'grading.permissions.toggles.canPromote.hint' },
  { key: 'canDowngrade', label: 'grading.permissions.toggles.canDowngrade.label', hint: 'grading.permissions.toggles.canDowngrade.hint' },
  { key: 'canSignOffSkills', label: 'grading.permissions.toggles.canSignOffSkills.label', hint: 'grading.permissions.toggles.canSignOffSkills.hint' },
  { key: 'canAdjustProgress', label: 'grading.permissions.toggles.canAdjustProgress.label', hint: 'grading.permissions.toggles.canAdjustProgress.hint' },
  { key: 'canVerifyRanks', label: 'grading.permissions.toggles.canVerifyRanks.label', hint: 'grading.permissions.toggles.canVerifyRanks.hint' },
  { key: 'canVoidHistory', label: 'grading.permissions.toggles.canVoidHistory.label', hint: 'grading.permissions.toggles.canVoidHistory.hint' },
  {
    key: 'canChangeBoardThresholds',
    label: 'grading.permissions.toggles.canChangeBoardThresholds.label',
    hint: 'grading.permissions.toggles.canChangeBoardThresholds.hint',
  },
];

const ALL_ON = Object.fromEntries(TOGGLES.map((t) => [t.key, true])) as Record<Toggle, boolean>;

function useGradingPermissions(schoolId: string | null) {
  return useQuery({
    queryKey: ['grading-permissions', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{schoolId}/grading-permissions', { params: { path: { schoolId: schoolId! } } })),
    enabled: !!schoolId,
  });
}

function useSetGradingPermissions(schoolId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ userId, styles }: { userId: string; styles: StyleInput[] }) =>
      unwrap(apiClient.PUT('/v1/schools/{schoolId}/grading-permissions/{userId}', { params: { path: { schoolId, userId } }, body: { styles } })),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['grading-permissions', schoolId] }),
  });
}

/**
 * Grading permissions (Decisions 138, 168, 181): the owner always may do
 * everything. For each Instructor or Branch Staff member, the owner picks the
 * styles they may grade in and, per style, seven toggles. A coach still only
 * grades the students of their own branches (Decision 168).
 *
 * New look (Decision 460 item 17; DESIGN.md → "Grading screens", "Phone"):
 * the new page header with the Grading tabs, a white card per coach, and per
 * style a "May grade" switch over the seven toggles as switches (one list on
 * a phone) instead of a table of tick boxes. The same toggles, rule ("May
 * grade" turns every toggle on), Undo / Save per coach, lock and saving.
 */
export function GradingPermissionsPage() {
  const schoolId = useOwnedSchoolId();
  const knownUser = !!useAuth().claims;
  const permissions = useGradingPermissions(schoolId);
  const disciplines = useDisciplines(schoolId);
  // Decision 448 item 6: only the main owner sets grading permissions; a
  // co-owner sees them, locked.
  const isMainOwner = useIsMainOwner(schoolId);
  const t = useT();
  const headerTabs = useGradingHeaderTabs();

  // Coaches review CP5: owner-only — anyone else goes back to their own home
  // page. Not while the session can't be read yet (a token being refreshed):
  // then nobody is known to own anything, and the page waits instead.
  if (!schoolId) return knownUser ? <Navigate to="/" replace /> : null;
  if (permissions.isLoading || disciplines.isLoading) return <Spinner />;
  const error = permissions.error ?? disciplines.error;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('grading.permissions.loadFailed')} />;

  const staff = permissions.data?.staff ?? [];
  const styles = disciplines.data?.items ?? [];

  return (
    <BillingPage>
      <NewLookPageHeader title={t('grading.permissions.title')} subtitle={t('grading.permissions.subtitle')} {...headerTabs} />
      {isMainOwner === false ? <p className="u8gs-note u8gp-locked">{t('roleGrants.staff.switchesMainOwnerOnly')}</p> : null}
      {staff.length === 0 ? (
        <BillingCard>
          <EmptyState title={t('grading.permissions.noCoachesTitle')} description={t('grading.permissions.noCoachesDescription')} />
        </BillingCard>
      ) : styles.length === 0 ? (
        <BillingCard>
          <EmptyState title={t('grading.noStylesTitle')} description={t('grading.permissions.noStylesDescription')} />
        </BillingCard>
      ) : (
        staff.map((member) => (
          <StaffPermissions
            key={member.userId}
            schoolId={schoolId}
            member={member}
            styles={styles}
            locked={isMainOwner !== true}
            saved={(permissions.data?.items ?? []).filter((p) => p.userId === member.userId)}
          />
        ))
      )}
    </BillingPage>
  );
}

/** An on/off permission: the new look's switch (`role="switch"`), named by
 * `ariaLabel`, with its visible label beside it. */
function PermissionSwitch({ id, label, ariaLabel, title, checked, disabled, onChange }: {
  id: string;
  label: string;
  ariaLabel: string;
  title?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
}) {
  return (
    <>
      <label htmlFor={id} className="u8gp-switch__label" title={title}>
        {label}
      </label>
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={ariaLabel}
        title={title}
        disabled={disabled}
        className={`ultm8-switch${checked ? ' ultm8-switch--on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="ultm8-switch__knob" aria-hidden="true" />
      </button>
    </>
  );
}

type Draft = Record<string, Record<Toggle, boolean> | null>; // per style: toggles, or null = no permission

function draftFrom(saved: Permission[], styles: DisciplineResponse[]): Draft {
  return Object.fromEntries(
    styles.map((s) => {
      const p = saved.find((x) => x.disciplineId === s.id);
      return [s.id, p ? (Object.fromEntries(TOGGLES.map((t) => [t.key, p[t.key]])) as Record<Toggle, boolean>) : null];
    }),
  );
}

function StaffPermissions({ schoolId, member, styles, saved, locked }: { schoolId: string; member: Staff; styles: DisciplineResponse[]; saved: Permission[]; locked: boolean }) {
  const set = useSetGradingPermissions(schoolId);
  const t = useT();
  const [draft, setDraft] = useState<Draft>(() => draftFrom(saved, styles));
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const savedKey = JSON.stringify(draftFrom(saved, styles));
  useEffect(() => setDraft(JSON.parse(savedKey) as Draft), [savedKey]);
  const dirty = JSON.stringify(draft) !== savedKey;
  const name = `${member.firstName} ${member.surname}`.trim();

  async function save() {
    setError(null);
    setDone(false);
    const body: StyleInput[] = Object.entries(draft)
      .filter((e): e is [string, Record<Toggle, boolean>] => e[1] !== null)
      .map(([disciplineId, toggles]) => ({ disciplineId, ...toggles }));
    try {
      await set.mutateAsync({ userId: member.userId, styles: body });
      setDone(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('grading.permissions.saveFailed'));
    }
  }

  return (
    <section aria-label={name} className="u8b-card u8gp-card">
      <div className="u8gs-card-head">
        <div className="u8gp-who">
          <TeamAvatar firstName={member.firstName} surname={member.surname} />
          <div className="u8gp-who__text">
            <h2 className="u8b-card__title">{name}</h2>
            <span className="u8gs-name">
              {member.roles.map((r) => (
                <span key={r} className="u8gs-tag u8gs-tag--info">
                  {r === 'INSTRUCTOR' ? t('grading.permissions.roleInstructor') : t('grading.permissions.roleBranchStaff')}
                </span>
              ))}
            </span>
          </div>
        </div>
        {locked ? null : (
          <div className="u8gs-actions">
            {dirty ? (
              <Button variant="secondary" onClick={() => setDraft(JSON.parse(savedKey) as Draft)}>
                {t('grading.permissions.undo')}
              </Button>
            ) : null}
            <Button onClick={save} disabled={!dirty} loading={set.isPending} aria-label={t('grading.permissions.saveAria', { name })}>
              {t('common.save')}
            </Button>
          </div>
        )}
      </div>
      {error ? <ErrorBanner message={error} /> : null}
      {done && !dirty ? <SuccessBanner message={t('grading.permissions.saved')} /> : null}
      <div className="u8gp-styles">
        {styles.map((style) => {
          const row = draft[style.id];
          const base = `gp-${member.userId}-${style.id}`;
          return (
            <div key={style.id} className="u8gp-style">
              <div className="u8gp-style__head">
                <strong className="u8gp-style__name">{style.name}</strong>
                <div className="u8gp-switch u8gp-switch--may">
                  <PermissionSwitch
                    id={`${base}-may`}
                    label={t('grading.permissions.columnMayGrade')}
                    ariaLabel={t('grading.permissions.mayGradeAria', { name, style: style.name })}
                    checked={row !== null}
                    disabled={locked}
                    onChange={(on) => setDraft((d) => ({ ...d, [style.id]: on ? { ...ALL_ON } : null }))}
                  />
                </div>
              </div>
              <ul className="u8gp-toggles" aria-label={style.name}>
                {TOGGLES.map((toggle) => (
                  <li key={toggle.key} className={`u8gp-switch${row === null ? ' u8gp-switch--off' : ''}`}>
                    <PermissionSwitch
                      id={`${base}-${toggle.key}`}
                      label={t(toggle.label)}
                      ariaLabel={t('grading.permissions.toggleAria', { name, style: style.name, toggle: t(toggle.label) })}
                      title={t(toggle.hint)}
                      checked={row?.[toggle.key] ?? false}
                      disabled={locked || row === null}
                      onChange={(on) => setDraft((d) => ({ ...d, [style.id]: { ...(d[style.id] as Record<Toggle, boolean>), [toggle.key]: on } }))}
                    />
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      <p className="u8gs-note u8gp-foot">{t('grading.permissions.footnote')}</p>
    </section>
  );
}
