import React from 'react';
import { Link } from 'react-router-dom';
import { SelectField } from '@ultm8/ui';
import { useAuth } from '../auth/AuthContext';
import { useCurrentUser, useUpdateCurrentUser } from '../auth/currentUserQueries';
import { useNotificationCounts } from '../notifications/notificationQueries';
import { useLanguages } from '../settings/settingsQueries';
import { useI18n, useT } from '../i18n/I18nProvider';

/** Who reads "What's new" (Decision 318 item 3): owners and staff, not students. */
const STAFF_ROLES: string[] = ['SCHOOL_OWNER_MANAGER', 'BRANCH_STAFF', 'INSTRUCTOR', 'FRANCHISE_OWNER'];

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
 * The header tools of the app shell (NewLookShell.tsx): What's new, the
 * notifications bell and the language picker. Notifications are wired to real
 * data (GET /notifications/me/counts); language is a real, working preference
 * backed by the confirmed GET /settings/languages list — picking one saves it
 * to the profile and switches the portal's text (I18nProvider, Decision 273).
 */

/** Decision 318 item 3: news from ULTM8 HQ, for owners and staff. */
export function WhatsNewLink() {
  const { claims } = useAuth();
  const t = useT();
  const isStaff = (claims?.grants ?? []).some((g) => STAFF_ROLES.includes(g.role));
  if (!isStaff) return null;
  return (
    <Link
      to="/whats-new"
      data-testid="whats-new-link"
      aria-label={t('whatsNew.title')}
      title={t('whatsNew.title')}
      style={{ display: 'inline-flex', color: 'var(--text-secondary)' }}
    >
      {/* An icon, like the bell beside it, so the header keeps to one
          line on a tablet (a text pill wrapped it, and the open account
          menu then covered the page heading). */}
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3.5 8v4h2.5l6 3.5v-11L6 8H3.5Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" />
        <path d="M14.5 7.5a3.5 3.5 0 0 1 0 5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      </svg>
    </Link>
  );
}

/** The bell, with a dot while anything is unread. The counts endpoint covers
 * every page and leaves snoozed notifications out, the same Unread number the
 * Notifications page shows. */
export function NotificationsBell() {
  const { data: counts } = useNotificationCounts();
  const t = useT();
  const hasUnread = (counts?.unread ?? 0) > 0;
  return (
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
  );
}

/** The language picker: saves the choice to the profile and switches the
 * portal's text (I18nProvider, Decision 273). */
export function LanguagePicker() {
  const { data: me } = useCurrentUser();
  const { data: languages } = useLanguages();
  const updateCurrentUser = useUpdateCurrentUser();
  const { t, locale, rememberLocale } = useI18n();
  if (!languages?.length) return null;
  return (
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
  );
}
