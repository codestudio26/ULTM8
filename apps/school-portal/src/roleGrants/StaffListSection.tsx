import { useDeferredValue, useState } from 'react';
import { Badge, Card, EmptyState, ErrorBanner, Field, RowActionsMenu, SelectField, Spinner, Table, TextField } from '@ultm8/ui';
import type { BranchResponse } from '../branches/branchQueries';
import { Avatar } from '../lib/Avatar';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { ROLE_LABELS } from '../lib/enumLabels';
import { formatLocale } from '../i18n/format';
import { useT } from '../i18n/I18nProvider';
import { useRemoveFromSchool, useStaffList, type StaffListFilters, type StaffMember, type StaffRoleEntry } from './roleGrantQueries';

/** Table rows need an `id`. */
type StaffRow = StaffMember & { id: string };

/**
 * The Staff page's list (Decision 361): everyone who holds, or held, an owner,
 * coach or Branch Staff role at this School, one row per person. Replaces
 * looking people up by User ID. Removed staff stay findable under the
 * "Removed" status, hidden by default.
 *
 * Each person's menu removes one role (the existing Revoke, confirmed by the
 * page's own dialog) or, with "Remove from School", every coach and Branch
 * Staff role they hold here at once. Owner roles have no actions here: who
 * may remove an owner is its own rule (main owner and co-owners).
 */
export function StaffListSection({
  schoolId,
  branches,
  onRevokeRole,
}: {
  schoolId: string;
  branches: BranchResponse[];
  onRevokeRole: (person: StaffMember, role: StaffRoleEntry) => void;
}) {
  const t = useT();
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const [branchId, setBranchId] = useState('');
  const [status, setStatus] = useState<StaffListFilters['status']>('active');
  const q = useDeferredValue(search.trim());
  const filters: StaffListFilters = {
    status,
    role: (role || undefined) as StaffListFilters['role'],
    branchId: branchId || undefined,
    q: q || undefined,
  };
  const { data, isLoading, error } = useStaffList(schoolId, filters);
  const removeFromSchool = useRemoveFromSchool(schoolId);
  const [confirmingRemove, setConfirmingRemove] = useState<StaffMember | null>(null);

  const filtering = !!(q || role || branchId || status !== 'active');
  const people: StaffRow[] = (data?.items ?? []).map((p) => ({ ...p, id: p.userId }));
  const roleLabel = (r: string) => (ROLE_LABELS[r] ? t(ROLE_LABELS[r]!) : r);
  const roleText = (r: StaffRoleEntry) => (r.branchName ? `${roleLabel(r.role)} · ${r.branchName}` : roleLabel(r.role));
  const date = (iso: string) => new Date(iso).toLocaleDateString(formatLocale(), { day: 'numeric', month: 'short', year: 'numeric' });
  // Owner roles are never removed from this list.
  const removable = (p: StaffMember) => p.roles.filter((r) => !r.revokedAt && r.role !== 'SCHOOL_OWNER_MANAGER');

  return (
    <Card className="ultm8-field">
      <h2 className="ultm8-page-header__title" style={{ fontSize: 18 }}>
        {t('roleGrants.list.heading')}
      </h2>
      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 12 }}>
        <div style={{ minWidth: 220 }}>
          <Field label={t('roleGrants.list.search')} htmlFor="staff-search">
            <TextField id="staff-search" type="search" placeholder={t('roleGrants.list.searchPlaceholder')} value={search} onChange={(e) => setSearch(e.target.value)} />
          </Field>
        </div>
        <div style={{ minWidth: 160 }}>
          <Field label={t('roleGrants.list.role')} htmlFor="staff-role-filter">
            <SelectField
              id="staff-role-filter"
              value={role}
              onChange={(e) => setRole(e.target.value)}
              options={[
                { value: '', label: t('roleGrants.list.any') },
                { value: 'SCHOOL_OWNER_MANAGER', label: roleLabel('SCHOOL_OWNER_MANAGER') },
                { value: 'INSTRUCTOR', label: roleLabel('INSTRUCTOR') },
                { value: 'BRANCH_STAFF', label: roleLabel('BRANCH_STAFF') },
              ]}
            />
          </Field>
        </div>
        {branches.length > 0 ? (
          <div style={{ minWidth: 160 }}>
            <Field label={t('roleGrants.list.branch')} htmlFor="staff-branch-filter">
              <SelectField
                id="staff-branch-filter"
                value={branchId}
                onChange={(e) => setBranchId(e.target.value)}
                options={[{ value: '', label: t('roleGrants.list.any') }, ...branches.map((b) => ({ value: b.id, label: b.name }))]}
              />
            </Field>
          </div>
        ) : null}
        <div style={{ minWidth: 140 }}>
          <Field label={t('roleGrants.list.status')} htmlFor="staff-status-filter">
            <SelectField
              id="staff-status-filter"
              value={status}
              onChange={(e) => setStatus(e.target.value as StaffListFilters['status'])}
              options={[
                { value: 'active', label: t('roleGrants.list.statusActive') },
                { value: 'removed', label: t('roleGrants.list.statusRemoved') },
                { value: 'all', label: t('roleGrants.list.statusAll') },
              ]}
            />
          </Field>
        </div>
      </div>

      {error ? <ErrorBanner message={t('roleGrants.list.loadFailed')} /> : null}
      {isLoading ? (
        <Spinner />
      ) : people.length === 0 ? (
        filtering ? (
          <EmptyState title={t('roleGrants.list.noMatchTitle')} description={t('roleGrants.list.noMatchDescription')} />
        ) : (
          <EmptyState title={t('roleGrants.list.emptyTitle')} description={t('roleGrants.list.emptyDescription')} />
        )
      ) : (
        <Table<StaffRow>
          rows={people}
          columns={[
            {
              key: 'person',
              header: t('roleGrants.list.columnPerson'),
              render: (p) => (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Avatar firstName={p.firstName} surname={p.surname} photoUrl={p.profilePhotoUrl ?? null} />
                  <div>
                    <div>{`${p.firstName} ${p.surname}`.trim()}</div>
                    <div style={{ fontSize: 13, opacity: 0.75 }}>{p.email}</div>
                  </div>
                </div>
              ),
            },
            { key: 'phone', header: t('roleGrants.list.columnPhone'), render: (p) => p.phone ?? '—' },
            {
              key: 'roles',
              header: t('roleGrants.list.columnRoles'),
              render: (p) => {
                const shown = p.active ? p.roles.filter((r) => !r.revokedAt) : p.roles;
                return (
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                    {shown.map((r) => (
                      <Badge key={r.grantId} variant={r.revokedAt ? undefined : 'accent'}>
                        {roleText(r)}
                      </Badge>
                    ))}
                    {p.canInviteCoaches && p.active ? <Badge>{t('roleGrants.list.canInviteCoaches')}</Badge> : null}
                  </div>
                );
              },
            },
            { key: 'added', header: t('roleGrants.list.columnAdded'), render: (p) => date(p.addedAt) },
            {
              key: 'status',
              header: t('roleGrants.list.columnStatus'),
              render: (p) =>
                p.active ? (
                  <Badge variant="success">{t('roleGrants.list.statusActive')}</Badge>
                ) : (
                  <Badge>{t('roleGrants.list.removedOn', { date: date(p.removedAt!) })}</Badge>
                ),
            },
            {
              key: 'actions',
              header: '',
              render: (p) => {
                const roles = removable(p);
                if (roles.length === 0) return null;
                return (
                  <RowActionsMenu
                    label={t('roleGrants.list.actionsAria', { name: `${p.firstName} ${p.surname}`.trim() })}
                    actions={[
                      ...roles.map((r) => ({ label: t('roleGrants.list.removeRole', { role: roleText(r) }), onClick: () => onRevokeRole(p, r) })),
                      { label: t('roleGrants.list.removeFromSchool'), onClick: () => setConfirmingRemove(p) },
                    ]}
                  />
                );
              },
            },
          ]}
        />
      )}

      {confirmingRemove ? (
        <ConfirmDeleteModal
          title={t('roleGrants.list.removeTitle', { name: `${confirmingRemove.firstName} ${confirmingRemove.surname}`.trim() })}
          description={t('roleGrants.list.removeDescription', { roles: removable(confirmingRemove).map(roleText).join(', ') })}
          confirmLabel={t('roleGrants.list.removeFromSchool')}
          genericErrorMessage={t('roleGrants.list.removeFailed')}
          onConfirm={async () => {
            await removeFromSchool.mutateAsync(confirmingRemove.userId);
          }}
          onClose={() => setConfirmingRemove(null)}
        />
      ) : null}
    </Card>
  );
}
