import React from 'react';
import { Text, View } from 'react-native';
import { theme, spacing, fontSize } from '../theme/tokens';

/**
 * Standard B2B SaaS footer (Decision 256) — copyright line + Terms of
 * Service / Privacy Policy / Support, shown once below "Log out" on
 * `HomeScreen.tsx` (this app has no AppShell/persistent-footer concept, just
 * a plain navigation stack, so Home is the closest equivalent to "once per
 * app shell"). Mirrors `packages/ui`'s own `LegalFooter`/`LEGAL_FOOTER_LINKS`
 * for the web apps — kept in sync by hand, since there's no shared non-UI
 * package both already depend on that would justify a third copy.
 *
 * `LEGAL_FOOTER_LINKS` is the ONE place to edit once real pages exist for any
 * of these: flip that entry's `enabled` to `true`. Links stay plain disabled
 * text rather than clickable (no in-app browser/webview wired up here yet)
 * until that happens — reads as "not live yet," not broken, same convention
 * every other not-yet-built feature in this app already uses.
 */
export const LEGAL_FOOTER_LINKS: { label: string; enabled: boolean }[] = [
  { label: 'Terms of Service', enabled: false },
  { label: 'Privacy Policy', enabled: false },
  { label: 'Support', enabled: false },
];

export function LegalFooter() {
  const year = new Date().getFullYear();
  return (
    <View style={{ marginTop: spacing[6], paddingTop: spacing[4], borderTopWidth: 1, borderTopColor: theme.border }}>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption }}>{`© ${year} ULTM8`}</Text>
      <Text style={{ color: theme.textSecondary, fontSize: fontSize.caption, marginTop: spacing[1] }}>
        {LEGAL_FOOTER_LINKS.map((link) => `${link.label} (coming soon)`).join('  ·  ')}
      </Text>
    </View>
  );
}
