import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

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
 */
export function GradingPermissionsPage() {
  const schoolId = useOwnedSchoolId();
  const permissions = useGradingPermissions(schoolId);
  const disciplines = useDisciplines(schoolId);
  const t = useT();

  if (!schoolId) return null;
  if (permissions.isLoading || disciplines.isLoading) return <Spinner />;
  const error = permissions.error ?? disciplines.error;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : t('grading.permissions.loadFailed')} />;

  const staff = permissions.data?.staff ?? [];
  const styles = disciplines.data?.items ?? [];

  return (
    <>
      <PageHeader
        title={t('grading.permissions.title')}
        subtitle={t('grading.permissions.subtitle')}
      />
      {staff.length === 0 ? (
        <Card>
          <EmptyState title={t('grading.permissions.noCoachesTitle')} description={t('grading.permissions.noCoachesDescription')} />
        </Card>
      ) : styles.length === 0 ? (
        <Card>
          <EmptyState title={t('grading.noStylesTitle')} description={t('grading.permissions.noStylesDescription')} />
        </Card>
      ) : (
        staff.map((member) => (
          <StaffPermissions
            key={member.userId}
            schoolId={schoolId}
            member={member}
            styles={styles}
            saved={(permissions.data?.items ?? []).filter((p) => p.userId === member.userId)}
          />
        ))
      )}
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

function StaffPermissions({ schoolId, member, styles, saved }: { schoolId: string; member: Staff; styles: DisciplineResponse[]; saved: Permission[] }) {
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
    <section aria-label={name} style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
            {name}{' '}
            {member.roles.map((r) => (
              <Badge key={r}>{r === 'INSTRUCTOR' ? t('grading.permissions.roleInstructor') : t('grading.permissions.roleBranchStaff')}</Badge>
            ))}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {dirty ? (
              <Button variant="secondary" onClick={() => setDraft(JSON.parse(savedKey) as Draft)}>
                {t('grading.permissions.undo')}
              </Button>
            ) : null}
            <Button onClick={save} disabled={!dirty} loading={set.isPending} aria-label={t('grading.permissions.saveAria', { name })}>
              {t('common.save')}
            </Button>
          </div>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        {done && !dirty ? <SuccessBanner message={t('grading.permissions.saved')} /> : null}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12 }}>{t('grading.permissions.columnStyle')}</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12 }}>{t('grading.permissions.columnMayGrade')}</th>
                {TOGGLES.map((toggle) => (
                  <th key={toggle.key} title={t(toggle.hint)} style={{ textAlign: 'center', padding: '6px 8px', fontSize: 12 }}>
                    {t(toggle.label)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {styles.map((style) => {
                const row = draft[style.id];
                return (
                  <tr key={style.id} style={{ borderTop: '1px solid var(--border)' }}>
                    <td style={{ padding: '6px 8px' }}>{style.name}</td>
                    <td style={{ padding: '6px 8px' }}>
                      <input
                        type="checkbox"
                        checked={row !== null}
                        aria-label={t('grading.permissions.mayGradeAria', { name, style: style.name })}
                        onChange={(e) => setDraft((d) => ({ ...d, [style.id]: e.target.checked ? { ...ALL_ON } : null }))}
                      />
                    </td>
                    {TOGGLES.map((toggle) => (
                      <td key={toggle.key} style={{ textAlign: 'center', padding: '6px 8px' }}>
                        <input
                          type="checkbox"
                          disabled={row === null}
                          checked={row?.[toggle.key] ?? false}
                          title={t(toggle.hint)}
                          aria-label={t('grading.permissions.toggleAria', { name, style: style.name, toggle: t(toggle.label) })}
                          onChange={(e) => setDraft((d) => ({ ...d, [style.id]: { ...(d[style.id] as Record<Toggle, boolean>), [toggle.key]: e.target.checked } }))}
                        />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="ultm8-field__hint" style={{ marginBottom: 0 }}>
          {t('grading.permissions.footnote')}
        </p>
      </Card>
    </section>
  );
}
