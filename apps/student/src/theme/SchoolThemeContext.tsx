import React, { createContext, useContext, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useEnrolledSchoolIds } from '../auth/AuthContext';

interface SchoolThemeValue {
  accentColor: string | null;
  logoUrl: string | null;
}

const DEFAULT_VALUE: SchoolThemeValue = { accentColor: null, logoUrl: null };

const SchoolThemeContext = createContext<SchoolThemeValue>(DEFAULT_VALUE);

/**
 * Decision 266 — the School-side half of "light theming post-login": a
 * single accent color (and logo) pulled into the UI once a session is
 * scoped to a School. Mounted only inside AppNavigator (RootNavigator), so
 * by construction this never runs for a signed-out session.
 *
 * Deliberately scoped to a Student enrolled at EXACTLY ONE School.
 * useEnrolledSchoolIds()'s own header comment already explains why Students
 * have no single "active School" concept the way coaches have
 * activeCoachSchoolId — this item's approved scope didn't ask for one
 * either, so rather than invent one just for theming, a multi-School
 * Student simply sees the app's plain default theme (consumers below fall
 * back to `theme.fillAccent`/no logo, same as before this feature existed).
 * Revisit if a real per-Student "active School" concept is ever added.
 *
 * Reads the full `GET /schools/{id}` (not `/academies/{id}` — that's the
 * curated discovery shape AcademySummaryDto deliberately excludes
 * accentColor from, see academies.service.ts's own comment) — RLS already
 * allows any RoleGrant holder at a School to read it (confirmed directly
 * against SchoolsService.findOne's own implementation), a STUDENT grant
 * included, so no new backend access was needed for this.
 */
export function SchoolThemeProvider({ children }: { children: React.ReactNode }) {
  const schoolIds = useEnrolledSchoolIds();
  const schoolId = schoolIds.length === 1 ? schoolIds[0] : null;

  const { data } = useQuery({
    queryKey: ['school-theme', schoolId],
    queryFn: () => unwrap(apiClient.GET('/v1/schools/{id}', { params: { path: { id: schoolId! } } })),
    enabled: !!schoolId,
    staleTime: 5 * 60 * 1000,
  });

  const value = useMemo<SchoolThemeValue>(
    () => ({ accentColor: data?.accentColor ?? null, logoUrl: data?.logoUrl ?? null }),
    [data],
  );

  return <SchoolThemeContext.Provider value={value}>{children}</SchoolThemeContext.Provider>;
}

export function useSchoolTheme(): SchoolThemeValue {
  return useContext(SchoolThemeContext);
}
