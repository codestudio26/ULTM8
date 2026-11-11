import React, { useEffect, useRef } from 'react';
import { Spinner } from '@ultm8/ui';

/**
 * New-look pieces for the Waivers page (DESIGN.md → "One accent: mint",
 * "Button pairs", "Never the same colour twice"). Styles: waivers.css.
 *
 * Kept inside the Waivers files on purpose: the Team PR (redesign/team) is
 * restyling the shared buttons and checkbox. When both are on master, these
 * can be joined with the shared ones (same look: white pills with a grey
 * outline, the main action mint).
 */

/** A pill button. `primary` is the mint main action; `loading` disables it
 * and shows the spinner, as the old Button did. */
export function Pill({
  primary,
  small,
  loading,
  disabled,
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { primary?: boolean; small?: boolean; loading?: boolean }) {
  const classes = ['u8w-pill', primary ? 'u8w-pill--primary' : '', small ? 'u8w-pill--small' : '', className ?? ''].join(' ').trim();
  return (
    <button type="button" className={classes} disabled={disabled || loading} {...rest}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/** A short note in place of the old banners: the same roles (an error is an
 * alert, a success a status), and like them it scrolls itself into view
 * when its message appears or changes and it is off screen. */
export function Note({ kind, message }: { kind: 'error' | 'success'; message: string }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el?.scrollIntoView) return;
    const rect = el.getBoundingClientRect();
    if (rect.top >= 0 && rect.bottom <= window.innerHeight) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [message]);
  return (
    <div ref={ref} className={`u8w-note u8w-note--${kind}`} role={kind === 'error' ? 'alert' : 'status'}>
      {message}
    </div>
  );
}

export type TagKind = 'ok' | 'bad' | 'warn' | 'plain';

export function Tag({ kind = 'plain', children }: { kind?: TagKind; children: React.ReactNode }) {
  return <span className={`u8w-tag u8w-tag--${kind}`}>{children}</span>;
}
