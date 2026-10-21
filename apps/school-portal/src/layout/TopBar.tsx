import React from 'react';
import { Link } from 'react-router-dom';
import { SelectField } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';
import { useCurrentUser, useUpdateCurrentUser } from '../auth/currentUserQueries';
import { useNotifications } from '../notifications/notificationQueries';
import { useLanguages } from '../settings/settingsQueries';
import { Avatar } from '../lib/Avatar';
import { SchoolSwitcher } from '../coach/SchoolSwitcher';
import type { RoleGrantClaim } from '../auth/types';
import { useI18n, type TranslateFn } from '../i18n/I18nProvider';

function roleLabel(grants: RoleGrantClaim[] | undefined, t: TranslateFn): string {
  if (!grants?.length) return '';
  if (grants.some((g) => g.role === 'SCHOOL_OWNER_MANAGER')) return t('layout.roles.owner');
  if (grants.some((g) => g.role === 'BRANCH_STAFF')) return t('layout.roles.branchStaff');
  if (grants.some((g) => g.role === 'INSTRUCTOR')) return t('layout.roles.coach');
  if (grants.some((g) => g.role === 'STUDENT')) return t('layout.roles.student');
  return grants[0].role;
}

/** Each language listed in its own script ("Deutsch", "العربية"), so a
 * reader can find theirs whatever the page is showing now. */
function nativeName(code: string, fallback: string): string {
  try {
    const name = new Intl.DisplayNames([code], { type: 'language' }).of(code);
    return name ? name.charAt(0).toLocaleUpperCase(code) + name.slice(1) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * App-shell header — rendered once by AppShell, above every page's own
 * content, not just Instructors'. Notifications and the profile are wired to
 * real data (GET /notifications/me, GET/PATCH /users/me); language is a real,
 * working preference backed by the confirmed GET /settings/languages list —
 * picking one saves it to the profile and switches the portal's text
 * (I18nProvider, Decision 273). Search has no backing feature
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
  const { t, locale, rememberLocale } = useI18n();

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
          placeholder={t('layout.searchPlaceholder')}
          aria-label={t('layout.searchAria')}
          style={{ width: 200, minHeight: 40 }}
        />

        <Link
          to="/notifications"
          aria-label={t('layout.notificationsAria')}
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

        <SchoolSwitcher />

        {me ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Avatar firstName={me.firstName} surname={me.surname} photoUrl={me.profilePhotoUrl} size={34} />
            <div style={{ lineHeight: 1.25 }}>
              <div style={{ fontSize: 14 }}>
                {me.firstName} {me.surname}
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{roleLabel(claims?.grants, t)}</div>
            </div>
          </div>
        ) : null}

        {languages?.length ? (
          <SelectField
            aria-label={t('layout.languageAria')}
            value={me?.language ?? locale}
            onChange={(e) => {
              const value = e.target.value;
              if (!value) return;
              rememberLocale(value);
              updateCurrentUser.mutate({ language: value });
            }}
            options={[{ value: '', label: t('common.none') }, ...languages.map((l) => ({ value: l.code, label: nativeName(l.code, l.name) }))]}
            style={{ width: 'auto', minHeight: 36, padding: '4px 8px' }}
          />
        ) : null}
      </div>
    </>
  );
}
