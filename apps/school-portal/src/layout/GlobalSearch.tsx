import React, { useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { unwrap } from '@ultm8/api-client';
import { apiClient } from '../api';
import { useCoachSchoolId, useOwnedSchoolId } from '../auth/AuthContext';
import { useT, type TranslationKey } from '../i18n/I18nProvider';

/** Start searching only from this many characters, and wait this long after the
 * last keystroke — keeps one word from firing five requests per letter. */
const MIN_CHARS = 2;
const DEBOUNCE_MS = 250;
/** Results shown per type; the paginated endpoints are asked for just this many. */
const PER_TYPE = 5;

type ResultType = 'students' | 'instructors' | 'classes' | 'branches' | 'franchises';
interface SearchResult {
  type: ResultType;
  id: string;
  label: string;
  href: string;
}

/** Group order and headings — the headings are the sidebar's own labels. */
const GROUPS: Array<{ type: ResultType; heading: TranslationKey }> = [
  { type: 'students', heading: 'layout.nav.students' },
  { type: 'instructors', heading: 'layout.nav.instructors' },
  { type: 'classes', heading: 'layout.nav.classes' },
  { type: 'branches', heading: 'layout.nav.branches' },
  { type: 'franchises', heading: 'layout.nav.franchises' },
];

function fullName(firstName: string | null | undefined, surname: string | null | undefined): string {
  return `${firstName ?? ''} ${surname ?? ''}`.trim();
}

/**
 * The header's Global Search (Decision 278): one box that finds Students,
 * Instructors, Classes, Branches and Franchises by name, grouped by type, each
 * result opening that record's own page.
 *
 * No search endpoint of its own — it calls each type's existing list endpoint
 * with its `search` param, in parallel, so every result has already passed that
 * endpoint's own tenant scoping and role checks. It only offers the types the
 * sidebar does (Shell.tsx): a coach or Branch Staff member who doesn't own the
 * School has none of these pages in their sidebar, so the box isn't shown to
 * them at all. The School-scoped types follow the School picked in the header's
 * SchoolSwitcher (`useOwnedSchoolId`), like every page; Franchises are the
 * caller's own, as on the Franchises page.
 *
 * An ARIA 1.2 combobox: arrow keys move through the results, Enter opens one,
 * Escape (or a click outside) closes the list.
 */
export function GlobalSearch() {
  const coachSchoolId = useCoachSchoolId();
  const ownedSchoolId = useOwnedSchoolId();
  // Same test Shell.tsx uses to pick COACH_NAV over OWNER_NAV.
  const isCoachOnly = !ownedSchoolId && !!coachSchoolId;
  if (isCoachOnly) return null;
  return <GlobalSearchBox schoolId={ownedSchoolId} />;
}

function GlobalSearchBox({ schoolId }: { schoolId: string | null }) {
  const t = useT();
  const navigate = useNavigate();
  const baseId = useId();
  const listboxId = `${baseId}-results`;
  const optionId = (i: number) => `${baseId}-option-${i}`;

  const [input, setInput] = useState('');
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const next = input.trim();
    const timer = window.setTimeout(() => setTerm(next), DEBOUNCE_MS);
    return () => window.clearTimeout(timer);
  }, [input]);

  useEffect(() => {
    if (!open) return;
    function onDocPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocPointerDown);
    return () => document.removeEventListener('mousedown', onDocPointerDown);
  }, [open]);

  const enabled = term.length >= MIN_CHARS;
  const schoolEnabled = enabled && !!schoolId;

  const queries = useQueries({
    queries: [
      {
        queryKey: ['globalSearch', 'students', schoolId, term],
        enabled: schoolEnabled,
        queryFn: async (): Promise<SearchResult[]> => {
          const res = await unwrap(
            apiClient.GET('/v1/schools/{id}/students', { params: { path: { id: schoolId! }, query: { search: term } } }),
          );
          // This roster isn't paginated, so it's cut to size here.
          return res.items.slice(0, PER_TYPE).map((s) => ({
            type: 'students' as const,
            id: s.id,
            label: fullName(s.firstName, s.surname),
            href: `/students/${s.id}`,
          }));
        },
      },
      {
        queryKey: ['globalSearch', 'instructors', schoolId, term],
        enabled: schoolEnabled,
        queryFn: async (): Promise<SearchResult[]> => {
          const res = await unwrap(
            apiClient.GET('/v1/schools/{schoolId}/instructors', {
              params: { path: { schoolId: schoolId! }, query: { search: term, limit: PER_TYPE } },
            }),
          );
          return res.items.map((i) => ({
            type: 'instructors' as const,
            id: i.id,
            label: fullName(i.firstName, i.surname),
            href: `/instructors/${i.id}`,
          }));
        },
      },
      {
        queryKey: ['globalSearch', 'classes', schoolId, term],
        enabled: schoolEnabled,
        queryFn: async (): Promise<SearchResult[]> => {
          const res = await unwrap(
            apiClient.GET('/v1/schools/{schoolId}/classes', {
              params: { path: { schoolId: schoolId! }, query: { search: term, limit: PER_TYPE } },
            }),
          );
          return res.items.map((c) => ({ type: 'classes' as const, id: c.id, label: c.title, href: `/classes/${c.id}` }));
        },
      },
      {
        queryKey: ['globalSearch', 'branches', schoolId, term],
        enabled: schoolEnabled,
        queryFn: async (): Promise<SearchResult[]> => {
          const res = await unwrap(
            apiClient.GET('/v1/schools/{schoolId}/branches', {
              params: { path: { schoolId: schoolId! }, query: { search: term, limit: PER_TYPE } },
            }),
          );
          return res.items.map((b) => ({ type: 'branches' as const, id: b.id, label: b.name, href: `/branches/${b.id}` }));
        },
      },
      {
        queryKey: ['globalSearch', 'franchises', term],
        enabled,
        queryFn: async (): Promise<SearchResult[]> => {
          const res = await unwrap(apiClient.GET('/v1/franchises', { params: { query: { search: term, limit: PER_TYPE } } }));
          // GET /franchises also returns closed (archived) Franchises; search leaves them out.
          return res.items.filter((f) => !f.archivedAt).map((f) => ({ type: 'franchises' as const, id: f.id, label: f.name, href: `/franchises/${f.id}` }));
        },
      },
    ],
  });

  const loading = enabled && (input.trim() !== term || queries.some((q) => q.isPending && q.fetchStatus !== 'idle'));
  const failed = enabled && queries.some((q) => q.isError);
  // Results in display order; each option's index in this list is its keyboard position.
  const groups = enabled
    ? GROUPS.map((g, i) => ({ ...g, items: queries[i].data ?? [] })).filter((g) => g.items.length > 0)
    : [];
  const flat = groups.flatMap((g) => g.items);

  useEffect(() => setActiveIndex(-1), [term]);

  const showPopup = open && input.trim().length >= MIN_CHARS;
  const expanded = showPopup && flat.length > 0;

  function choose(result: SearchResult) {
    setOpen(false);
    setInput('');
    setTerm('');
    navigate(result.href);
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setOpen(true);
      if (flat.length) setActiveIndex((i) => (i + 1) % flat.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setOpen(true);
      if (flat.length) setActiveIndex((i) => (i <= 0 ? flat.length - 1 : i - 1));
    } else if (e.key === 'Enter') {
      if (showPopup && activeIndex >= 0 && flat[activeIndex]) {
        e.preventDefault();
        choose(flat[activeIndex]);
      }
    } else if (e.key === 'Escape') {
      if (open) {
        e.preventDefault();
        setOpen(false);
        setActiveIndex(-1);
      } else if (input) {
        e.preventDefault();
        setInput('');
      }
    } else if (e.key === 'Tab') {
      setOpen(false);
    }
  }

  let index = -1;
  return (
    <div ref={rootRef} style={{ position: 'relative' }}>
      <input
        type="search"
        role="combobox"
        className="ultm8-input"
        placeholder={t('layout.search.placeholder')}
        aria-label={t('layout.search.label')}
        aria-autocomplete="list"
        aria-expanded={expanded}
        aria-controls={listboxId}
        aria-activedescendant={expanded && activeIndex >= 0 ? optionId(activeIndex) : undefined}
        autoComplete="off"
        value={input}
        onChange={(e) => {
          setInput(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        style={{ width: 200, minHeight: 40 }}
      />
      <div
        className="ultm8-row-actions__menu"
        hidden={!showPopup}
        // Lines up with the box's start edge, in either text direction (the box
        // starts the header's second row on a tablet); physical sides cleared
        // first so the logical one wins.
        style={{ left: 'auto', right: 'auto', insetInlineStart: 0, width: 'min(320px, calc(100vw - 32px))', maxHeight: '70vh', overflowY: 'auto' }}
      >
        <div
          id={listboxId}
          role="listbox"
          aria-label={t('layout.search.resultsLabel')}
        >
          {groups.map((g) => (
            <div key={g.type} role="group" aria-labelledby={`${baseId}-${g.type}`}>
              <div
                id={`${baseId}-${g.type}`}
                role="presentation"
                style={{
                  padding: '8px 12px 4px',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: 0.4,
                }}
              >
                {t(g.heading)}
              </div>
              {g.items.map((r) => {
                index += 1;
                const i = index;
                const active = i === activeIndex;
                return (
                  <div
                    key={`${r.type}-${r.id}`}
                    id={optionId(i)}
                    role="option"
                    aria-selected={active}
                    className="ultm8-row-actions__item"
                    // mousedown, not click: keeps focus in the input until the choice is made.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      choose(r);
                    }}
                    onMouseEnter={() => setActiveIndex(i)}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      textAlign: 'start',
                      boxSizing: 'border-box',
                      background: active ? 'var(--color-accent-100)' : undefined,
                    }}
                  >
                    {r.label}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
        <div role="status" style={{ padding: flat.length && !loading && !failed ? 0 : '8px 12px', fontSize: 13, color: 'var(--text-secondary)' }}>
          {loading
            ? t('layout.search.loading')
            : failed
              ? t('layout.search.loadFailed')
              : showPopup && flat.length === 0
                ? t('layout.search.noResults', { query: input.trim() })
                : null}
        </div>
      </div>
    </div>
  );
}
