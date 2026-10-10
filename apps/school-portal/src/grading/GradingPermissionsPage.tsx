import React, { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Badge, Button, Card, EmptyState, ErrorBanner, PageHeader, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError, unwrap } from '@ultm8/api-client';
import type { components } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { useDisciplines, type DisciplineResponse } from '../disciplines/disciplineQueries';

type Permission = components['schemas']['GradingPermissionResponseDto'];
type Staff = components['schemas']['GradingStaffDto'];
type StyleInput = components['schemas']['StylePermissionInputDto'];
type Toggle = Exclude<keyof StyleInput, 'disciplineId'>;

/** The seven toggles, in the order Gus approved (Decision 181). */
export const TOGGLES: Array<{ key: Toggle; label: string; hint: string }> = [
  { key: 'canPromote', label: 'Promote', hint: 'Grade up, stripe award, bulk promote, give a first rank' },
  { key: 'canDowngrade', label: 'Move down', hint: 'Downgrade, with a reason' },
  { key: 'canSignOffSkills', label: 'Sign off skills', hint: 'Skills for the next rank' },
  { key: 'canAdjustProgress', label: 'Adjust progress', hint: 'Move on the board (e.g. to Ready to Grade), log a class, correct the rank date, Active switch' },
  { key: 'canVerifyRanks', label: 'Verify ranks', hint: 'Verify or correct self-declared ranks' },
  { key: 'canVoidHistory', label: 'Void history', hint: 'Void a history entry, with a reason' },
  { key: 'canChangeBoardThresholds', label: 'Change board %', hint: "This style's Grading Board split (33% / 66% by default)" },
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

  if (!schoolId) return null;
  if (permissions.isLoading || disciplines.isLoading) return <Spinner />;
  const error = permissions.error ?? disciplines.error;
  if (error) return <ErrorBanner message={error instanceof ApiError ? error.message : 'Could not load grading permissions.'} />;

  const staff = permissions.data?.staff ?? [];
  const styles = disciplines.data?.items ?? [];

  return (
    <>
      <PageHeader
        title="Grading permissions"
        subtitle="You (the owner) can always do everything. Choose, for each coach and each style, what they may do. Coaches only grade the students of their own branches."
      />
      {staff.length === 0 ? (
        <Card>
          <EmptyState title="No coaches yet" description="Invite Instructors or Branch Staff on the Staff page, then give them grading permission here." />
        </Card>
      ) : styles.length === 0 ? (
        <Card>
          <EmptyState title="No styles yet" description="Add a style on the Disciplines page first." />
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
      setError(err instanceof ApiError ? err.message : 'Could not save — please try again.');
    }
  }

  return (
    <section aria-label={name} style={{ marginBottom: 24 }}>
      <Card>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap', marginBottom: 8 }}>
          <h2 className="ultm8-page-header__title" style={{ fontSize: 16, margin: 0 }}>
            {name}{' '}
            {member.roles.map((r) => (
              <Badge key={r}>{r === 'INSTRUCTOR' ? 'Instructor' : 'Branch Staff'}</Badge>
            ))}
          </h2>
          <div style={{ display: 'flex', gap: 8 }}>
            {dirty ? (
              <Button variant="secondary" onClick={() => setDraft(JSON.parse(savedKey) as Draft)}>
                Undo
              </Button>
            ) : null}
            <Button onClick={save} disabled={!dirty} loading={set.isPending} aria-label={`Save permissions for ${name}`}>
              Save
            </Button>
          </div>
        </div>
        {error ? <ErrorBanner message={error} /> : null}
        {done && !dirty ? <SuccessBanner message="Saved." /> : null}
        <div style={{ overflowX: 'auto' }}>
          <table style={{ borderCollapse: 'collapse', width: '100%', minWidth: 760 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12 }}>Style</th>
                <th style={{ textAlign: 'left', padding: '6px 8px', fontSize: 12 }}>May grade</th>
                {TOGGLES.map((t) => (
                  <th key={t.key} title={t.hint} style={{ textAlign: 'center', padding: '6px 8px', fontSize: 12 }}>
                    {t.label}
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
                        aria-label={`${name} may grade in ${style.name}`}
                        onChange={(e) => setDraft((d) => ({ ...d, [style.id]: e.target.checked ? { ...ALL_ON } : null }))}
                      />
                    </td>
                    {TOGGLES.map((t) => (
                      <td key={t.key} style={{ textAlign: 'center', padding: '6px 8px' }}>
                        <input
                          type="checkbox"
                          disabled={row === null}
                          checked={row?.[t.key] ?? false}
                          title={t.hint}
                          aria-label={`${name}, ${style.name}: ${t.label}`}
                          onChange={(e) => setDraft((d) => ({ ...d, [style.id]: { ...(d[style.id] as Record<Toggle, boolean>), [t.key]: e.target.checked } }))}
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
          Ticking "May grade" turns every toggle on; untick what they shouldn't do. "Ready to grade" notifications go to coaches who may promote.
        </p>
      </Card>
    </section>
  );
}
