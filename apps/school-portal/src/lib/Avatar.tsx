import React from 'react';
import { firstGrapheme } from '@ultm8/i18n';

/**
 * Shared "no photo yet" placeholder — a colored initials monogram derived from
 * the person's own real name, not a generic silhouette or an assumed likeness.
 * Renders the real photo once one is set. One neutral treatment for everyone,
 * regardless of who they are — nothing here varies by any assumed attribute.
 */
export function Avatar({
  firstName,
  surname,
  photoUrl,
  size = 40,
  color = 'var(--fill-accent)',
}: {
  firstName: string;
  surname: string;
  photoUrl?: string | null;
  size?: number;
  color?: string;
}) {
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', flex: 'none' }}
      />
    );
  }
  // Whole letters, never half a character (Decision 433, TXT-7).
  const initials = `${firstGrapheme(firstName)}${firstGrapheme(surname)}` || '?';
  return (
    <span
      aria-hidden="true"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: size,
        height: size,
        borderRadius: '50%',
        background: color,
        color: '#ffffff',
        fontSize: Math.round(size * 0.4),
        fontWeight: 500,
        flex: 'none',
      }}
    >
      {initials}
    </span>
  );
}
