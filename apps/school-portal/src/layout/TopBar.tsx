import React from 'react';
import { Link } from 'react-router-dom';
import { SelectField } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';
import { useCurrentUser, useUpdateCurrentUser } from '../auth/currentUserQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { useLanguages } from '../settings/settingsQueries';
import { Avatar } from '../lib/Avatar';
import type { RoleGrantClaim } from '../auth/types';

function roleLabel(grants: RoleGrantClaim[] | undefined): string {
  if (!grants?.length) return '';
  if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return 'School Owner';
  if (grants.some((g) => g.role === 'BRANCH_STAFF')) return 'Branch Staff';
  return grants[0].role;
}

/**
 * App-shell header — rendered once by AppShell, above every page's own
 * content, not just Instructors'. Notifications and the profile are wired to
 * real data (GET /notifications/me, GET/PATCH /users/me); language is a real,
 * working preference backed by the confirmed GET /settings/languages list —
 * this app has no translation runtime yet, so picking one saves the
 * preference without changing any UI text. Search has no backing feature
 * anywhere in this codebase (no search endpoint exists anywhere) — shown
 * disabled rather than omitted or faked, so it reads as "not built yet," not
 * broken.
 */
export function TopBar() {
  const { claims } = useAuth();
  const { data: notifications } = useNotifications();
  const { data: me } = useCurrentUser();
  const { data: languages } = useLanguages();
  const updateCurrentUser = useUpdateCurrentUser();

  const hasUnread = (notifications?.items ?? []).some((n) => !n.read);

  return (
    <>
      <span
        aria-hidden="true"
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: 48,
          height: 48,
          borderRadius: 'var(--radius-md)',
          background: 'var(--fill-accent)',
          color: 'var(--on-accent)',
          fontSize: 16,
          fontWeight: 500,
          flex: 'none',
        }}
      >
        U8
      </span>

      <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
        <input
          disabled
          className="ultm8-input"
          placeholder="Search (coming soon)"
          aria-label="Search — not available yet"
          style={{ width: 200, minHeight: 40 }}
        />

        <Link
          to="/notifications"
          aria-label="Notifications"
          style={{ position: 'relative', display: 'inline-flex', color: 'var(--text-secondary)' }}
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
            <path
              d="M5 8a5 5 0 0 1 10 0c0 3.3 1 4.6 1.5 5.2.4.4.1 1.1-.5 1.1H4c-.6 0-.9-.7-.5-1.1C4 12.6 5 11.3 5 8Z"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M8 16.5a2 2 0 0 0 4 0" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {hasUnread ? (
            <span
              aria-hidden="true"
              style={{
                position: 'absolute',
                top: -1,
                right: -1,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: 'var(--text-danger)',
                border: '1.5px solid var(--surface-0)',
              }}
            />
          ) : null}
        </Link>

        {me ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar firstName={me.firstName} surname={me.surname} photoUrl={me.profilePhotoUrl} size={34} />
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 14 }}>
                {me.firstName} {me.surname}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{roleLabel(claims?.grants)}</div>
            </div>
          </div>
        ) : null}

        {languages?.length ? (
          <SelectField
            aria-label="Language"
            value={me?.language ?? ''}
            onChange={(e) => {
              const value = e.target.value;
              if (value) updateCurrentUser.mutate({ language: value });
            }}
            options={[{ value: '', label: '—' }, ...languages.map((l) => ({ value: l.code, label: l.name }))]}
            style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
          />
        ) : null}
      </div>
    </>
  );
}
