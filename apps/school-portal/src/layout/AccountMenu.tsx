import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth, useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import type { CurrentUserResponse } from '../auth/currentUserQueries';
import { Avatar } from '../lib/Avatar';
import { useT } from '../i18n/I18nProvider';

/**
 * The header's avatar block (photo + name + role) as a menu button: the
 * signed-in user's name, email and role, then My profile, School settings and
 * Log out. Same popover ingredients `@ultm8/ui`'s `RowActionsMenu` uses
 * (outside-`mousedown` dismissal, `Escape` returns focus to the trigger) and its
 * menu styling, plus arrow-key movement between items.
 *
 * "School settings" follows the sidebar exactly (Shell.tsx): it shows wherever
 * the sidebar's own "School" link does — everyone except a coach/Branch Staff
 * member who doesn't own the School. "Log out" calls the same `logout()` the
 * sidebar's button does; the menu's items only exist while it is open, so the
 * sidebar button stays the only "Log out" button on the page.
 */
export function AccountMenu({ me, roleLabel }: { me: CurrentUserResponse; roleLabel: string }) {
  const t = useT();
  const { logout } = useAuth();
  const coachSchoolId = useCoachSchoolId();
  const isCoachOnly = !useOwnedSchoolId() && !!coachSchoolId;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const fullName = `${me.firstName} ${me.surname}`.trim();

  function items(): HTMLElement[] {
    return Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []);
  }

  useEffect(() => {
    if (!open) return;
    items()[0]?.focus();
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  function close(returnFocus: boolean) {
    setOpen(false);
    if (returnFocus) triggerRef.current?.focus();
  }

  function onMenuKeyDown(e: React.KeyboardEvent) {
    const list = items();
    const index = list.indexOf(document.activeElement as HTMLElement);
    let next: number | null = null;
    if (e.key === 'ArrowDown') next = (index + 1) % list.length;
    else if (e.key === 'ArrowUp') next = (index - 1 + list.length) % list.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = list.length - 1;
    else if (e.key === 'Tab') close(false);
    if (next !== null) {
      e.preventDefault();
      list[next]?.focus();
    }
  }

  const itemStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', textDecoration: 'none', textAlign: 'start', boxSizing: 'border-box' };

  return (
    <div
      ref={rootRef}
      style={{ position: 'relative' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && open) {
          e.preventDefault();
          close(true);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '4px 6px',
          border: '1px solid transparent',
          borderRadius: 'var(--radius-md)',
          background: open ? 'var(--bg-accent)' : 'transparent',
          color: 'inherit',
          font: 'inherit',
          textAlign: 'start',
          cursor: 'pointer',
        }}
      >
        <Avatar firstName={me.firstName} surname={me.surname} photoUrl={me.profilePhotoUrl} size={34} />
        <div style={{ lineHeight: 1.25 }}>
          <div style={{ fontSize: 14 }}>{fullName}</div>
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{roleLabel}</div>
        </div>
      </button>
      {open ? (
        <div
          ref={menuRef}
          id="account-menu"
          role="menu"
          aria-label={t('layout.accountMenu.label')}
          className="ultm8-row-actions__menu"
          style={{ insetInlineEnd: 0, right: 'auto', minWidth: 240 }}
          onKeyDown={onMenuKeyDown}
        >
          <div role="presentation" style={{ padding: '8px 12px 10px', borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <div style={{ fontSize: 14, fontWeight: 500 }}>{fullName}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', overflowWrap: 'anywhere' }}>{me.email}</div>
            {roleLabel ? <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{roleLabel}</div> : null}
          </div>
          <Link to="/profile" role="menuitem" tabIndex={-1} className="ultm8-row-actions__item" style={itemStyle} onClick={() => close(false)}>
            {t('layout.accountMenu.myProfile')}
          </Link>
          {!isCoachOnly ? (
            <Link to="/school" role="menuitem" tabIndex={-1} className="ultm8-row-actions__item" style={itemStyle} onClick={() => close(false)}>
              {t('layout.accountMenu.schoolSettings')}
            </Link>
          ) : null}
          <button
            type="button"
            role="menuitem"
            tabIndex={-1}
            className="ultm8-row-actions__item"
            style={itemStyle}
            onClick={() => {
              close(false);
              void logout();
            }}
          >
            {t('layout.logOut')}
          </button>
        </div>
      ) : null}
    </div>
  );
}
