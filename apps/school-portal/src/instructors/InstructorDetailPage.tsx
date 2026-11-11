import React, { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { EmptyState, ErrorBanner, Spinner, SuccessBanner } from '@ultm8/ui';
import { ApiError } from '@ultm8/api-client';
import { useOwnedSchoolId } from '../auth/AuthContext';
import { ConfirmDeleteModal } from '../lib/ConfirmDeleteModal';
import { useIsMainOwner, useRevokeRoleGrant, useUserRoleGrants } from '../roleGrants/roleGrantQueries';
import { useBranches } from '../branches/branchQueries';
import { WEEKDAY_ORDER, weekdayName } from '../timetable/timetableOccurrences';
import {
  fetchInstructorCertificationUrl,
  useAllTimetableSlots,
  useInstructor,
  useInstructorClasses,
  type InstructorClassResponse,
} from './instructorQueries';
import { GiveRoleBackModal, HandOverClassesModal, ResendPasscodeModal, RevokeBlockedModal } from './InstructorDetailActions';
import { useT } from '../i18n/I18nProvider';
import { formatLocale } from '../i18n/format';
import { localizeAddressCountry } from '@ultm8/i18n';
import { ROLE_LABELS } from '../lib/enumLabels';
import { NewLookPage, NewLookPageHeader } from '../layout/NewLookPage';
import { useDisciplines } from '../disciplines/disciplineQueries';
import { useSchoolInstructorBelts, useVerifyInstructorBelt } from './instructorBeltQueries';
import { EditInstructorModal } from './InstructorsPage';
import { BeltPicture, BeltStatus, FrontDeskSwitches, TeamCard, TeamPanelWho } from '../team/TeamParts';

const PAST_SHOWN = 10;

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(formatLocale(), { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Instructor Detail — v1.2 backend backlog. Real data only (no mockup
 * template to match): profile fields InstructorResponseDto already carries,
 * the real "Instructor Class" grid (GET /instructors/{id}/classes, with a
 * server-computed enrolledCount — see InstructorsService.findClassesForInstructor's
 * own header comment), and a Revoke Enrollment action for the underlying
 * INSTRUCTOR RoleGrant, using this app's existing ConfirmDeleteModal
 * confirmation pattern (not a browser confirm()).
 *
 * Decision 312 adds what the instructor filled in themselves (address,
 * activities, certification), their branch and weekly timetable slots, and
 * the two follow-ups to a revoke: handing their classes to someone else, and
 * giving the role back.
 *
 * Decision 331: the owner can resend the temporary passcode to someone who
 * hasn't signed in yet; revoking is refused while they still teach upcoming
 * classes or weekly slots (hand them over first); and address and
 * certification come back from the API only for the owner or the instructor.
 *
 * The new look (Decision 453; DESIGN.md → "Team member full page"): "‹ Team"
 * and the name, Profile and Classes tabs, white cards, and the Team member
 * panel on the right (who they are and how to reach them, with Edit). The
 * Profile tab has About, their Belts (with Verify), Front desk and money,
 * Roles, the next two classes and "Remove from the team"; the Classes tab has
 * the upcoming classes, weekly timetable and past classes.
 */
export function InstructorDetailPage() {
  const t = useT();
  const { id } = useParams<{ id: string }>();
  const instructorId = id ?? null;
  const schoolId = useOwnedSchoolId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: instructor, isLoading, error } = useInstructor(instructorId);
  const { data: classesData, isLoading: classesLoading, error: classesError } = useInstructorClasses(instructorId);
  const roleGrants = useUserRoleGrants(instructor?.userId ?? null);
  const revokeGrant = useRevokeRoleGrant();
  // Decision 423 item 10: only the main owner removes or gives back the coach role.
  const isMainOwner = useIsMainOwner(schoolId ?? null);
  const { data: branchData } = useBranches(schoolId);
  const { data: slots } = useAllTimetableSlots(schoolId);
  const [confirmingRevoke, setConfirmingRevoke] = useState(false);
  const [showAllPast, setShowAllPast] = useState(false);
  const [handingOver, setHandingOver] = useState(false);
  const [givingRoleBack, setGivingRoleBack] = useState(false);
  const [resending, setResending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [certError, setCertError] = useState<string | null>(null);
  const [searchParams] = useSearchParams();
  const [editing, setEditing] = useState(false);
  // Archived styles too: the form shows one a record already has (Decision 310).
  const { data: disciplineData } = useDisciplines(schoolId, { includeArchived: true });
  // Their belts, verified here as on the Instructors page (Decisions 108, 188).
  const belts = useSchoolInstructorBelts(schoolId);
  const verify = useVerifyInstructorBelt(schoolId ?? '');
  const [beltError, setBeltError] = useState<string | null>(null);

  if (!instructorId) return null;
  if (isLoading) return <Spinner />;
  if (error) {
    return <ErrorBanner message={error instanceof ApiError ? error.message : t('instructors.detail.loadFailed')} />;
  }
  if (!instructor) return null;

  // Upcoming soonest first, past most recent first (Decision 311, I14).
  const now = Date.now();
  const allClasses = classesData?.items ?? [];
  const upcoming = allClasses.filter((c) => new Date(c.endDate).getTime() >= now).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const past = allClasses.filter((c) => new Date(c.endDate).getTime() < now).sort((a, b) => b.startDate.localeCompare(a.startDate));
  const activeGrants = (roleGrants.data?.items ?? []).filter(
    (g) => g.schoolId === schoolId && g.role === 'INSTRUCTOR' && !g.revokedAt,
  );
  const activeGrant = activeGrants[0];
  // The ones that keep making classes for them, Monday first.
  const mySlots = (slots ?? [])
    .filter((s) => s.instructorId === instructor.userId && s.status === 'ON' && !s.archivedAt)
    .sort((a, b) => WEEKDAY_ORDER.indexOf(a.weekday) - WEEKDAY_ORDER.indexOf(b.weekday) || a.startTime.localeCompare(b.startTime));
  const branchName = instructor.branchId
    ? branchData?.items.find((b) => b.id === instructor.branchId)?.name ?? instructor.branchId
    : t('instructors.allBranches');
  const name = `${instructor.firstName} ${instructor.surname}`.trim();
  // Their only Instructor role here and work still on their plate: the API
  // would refuse the revoke, so offer "Hand over classes" instead. With more
  // than one role, the API decides branch by branch.
  const revokeBlocked = activeGrants.length === 1 && (upcoming.length > 0 || mySlots.length > 0);

  async function verifyBelt(disciplineId: string) {
    setBeltError(null);
    try {
      await verify.mutateAsync({ userId: instructor!.userId, disciplineId });
    } catch (err) {
      setBeltError(err instanceof ApiError ? err.message : t('instructors.belts.verifyFailed'));
    }
  }

  async function openCertification() {
    setCertError(null);
    // Opened before the request so the browser doesn't treat it as a pop-up.
    const tab = window.open('', '_blank');
    try {
      const { url } = await fetchInstructorCertificationUrl(instructor!.id);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      tab?.close();
      setCertError(err instanceof ApiError ? err.message : t('instructors.detail.certificationFailed'));
    }
  }

  const myBelts = (belts.data?.items ?? []).filter((b) => b.userId === instructor.userId);
  const beltsWaiting = (belts.data?.instructors ?? []).some((i) => i.userId === instructor.userId);
  // Their staff roles here: each with its branch; a revoked profile with
  // none left shows as a revoked Instructor.
  const branchOf = (branchId: string | null | undefined) =>
    branchId ? branchData?.items.find((b) => b.id === branchId)?.name ?? branchId : t('roleGrants.coachInvites.wholeSchool');
  const myRoles = (roleGrants.data?.items ?? []).filter(
    (g) => g.schoolId === schoolId && !g.revokedAt && (g.role === 'INSTRUCTOR' || g.role === 'BRANCH_STAFF' || g.role === 'SCHOOL_OWNER_MANAGER'),
  );
  const tab = searchParams.get('tab') === 'classes' ? 'classes' : 'profile';
  const here = `/instructors/${instructor.id}`;
  const statusTags = (
    <>
      {instructor.awaitingFirstLogin ? <span className="u8t-tag u8t-tag--warn">{t('instructors.awaitingFirstLogin')}</span> : null}
      {instructor.archivedAt ? <span className="u8t-tag">{t('instructors.archived')}</span> : null}
    </>
  );
  const label = (key: Parameters<typeof t>[0]) => t(key);

  // DESIGN.md → "Team member full page": the right panel says who the person
  // is and how to reach them; everything else is on the page only.
  const inspector = (
    <>
      <TeamPanelWho firstName={instructor.firstName} surname={instructor.surname} photoUrl={instructor.photoUrl} name={name} />
      {schoolId ? (
        <div className="u8t-tiles">
          <button type="button" className="u8t-tile" onClick={() => setEditing(true)}>
            <span className="u8t-tile__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M4 20h4L18.5 9.5a2.8 2.8 0 0 0-4-4L4 16v4" />
              </svg>
            </span>
            {t('instructors.edit')}
          </button>
        </div>
      ) : null}
      <p className="u8t-sec">{t('instructors.team.contact')}</p>
      <div className="u8t-line">
        <span>{t('instructors.inviteModal.email')}</span>
        <span>{instructor.email}</span>
      </div>
      {instructor.phone ? (
        <div className="u8t-line">
          <span>{t('instructors.inviteModal.phone')}</span>
          <span>{instructor.phone}</span>
        </div>
      ) : null}
    </>
  );

  return (
    <>
      <NewLookPageHeader
        parent={{ to: '/instructors', label: t('layout.newLook.groups.team') }}
        title={name}
        subtitle={instructor.bio ?? undefined}
        tabs={[
          { to: here, label: t('instructors.team.profileTab'), current: tab === 'profile' },
          { to: `${here}?tab=classes`, label: t('instructors.detail.classesHeading'), current: tab === 'classes' },
        ]}
        tabsLabel={t('instructors.team.sectionsAria')}
      />
      {notice ? <SuccessBanner message={notice} /> : null}
      {certError ? <ErrorBanner message={certError} /> : null}

      <NewLookPage inspector={inspector} inspectorLabel={t('instructors.team.panelLabel')}>
        <div className="u8t-stack u8t-profile">
          {tab === 'profile' ? (
            <>
              <TeamCard title={t('instructors.team.about')}>
                <div className="u8t-rows">
                  {/* Their profile's branch, when Roles doesn't already show it. */}
                  {myRoles.length > 0 && !myRoles.some((g) => branchOf(g.branchId) === branchName) ? (
                    <div className="u8t-line">
                      <span>{label('instructors.form.branch')}</span>
                      <span>{branchName}</span>
                    </div>
                  ) : null}
                  {instructor.yearsOfExperience != null ? (
                    <div className="u8t-line">
                      <span>{label('instructors.form.yearsOfExperience')}</span>
                      <span>{instructor.yearsOfExperience}</span>
                    </div>
                  ) : null}
                  {instructor.specializations.length > 0 ? (
                    <div className="u8t-line">
                      <span>{label('instructors.form.specializations')}</span>
                      <span className="u8t-tags" style={{ justifyContent: 'flex-end' }}>
                        {instructor.specializations.map((sp, i) => (
                          <span key={`${sp}-${i}`} className="u8t-tag u8t-tag--info">
                            {sp}
                          </span>
                        ))}
                      </span>
                    </div>
                  ) : null}
                  {/* Filled in by the instructor on their Complete Profile page. */}
                  {instructor.activities.length > 0 ? (
                    <div className="u8t-line">
                      <span>{label('instructors.completeProfile.activities')}</span>
                      <span className="u8t-tags" style={{ justifyContent: 'flex-end' }}>
                        {instructor.activities.map((a, i) => (
                          <span key={`${a}-${i}`} className="u8t-tag">
                            {a}
                          </span>
                        ))}
                      </span>
                    </div>
                  ) : null}
                  {instructor.address ? (
                    <div className="u8t-line">
                      <span>{label('instructors.completeProfile.address')}</span>
                      <span>{localizeAddressCountry(instructor.address, formatLocale(), instructor.addressCountry)}</span>
                    </div>
                  ) : null}
                  {instructor.certificationKey ? (
                    <div className="u8t-line">
                      <span>{label('instructors.completeProfile.certification')}</span>
                      <span>
                        {instructor.certificationConsentedAt
                          ? t('instructors.detail.certificationConsented', { date: formatDate(instructor.certificationConsentedAt) })
                          : t('instructors.detail.certificationOnFile')}
                        <br />
                        <button type="button" className="u8t-pill u8t-pill--sm" style={{ marginTop: 8 }} onClick={openCertification}>
                          {t('instructors.detail.viewCertification')}
                        </button>
                      </span>
                    </div>
                  ) : null}
                </div>
                {/* Decision 456: these sit under their details. */}
                {schoolId && (upcoming.length > 0 || mySlots.length > 0 || (instructor.awaitingFirstLogin && instructor.status === 'ACTIVE')) ? (
                  <div className="u8t-state u8t-actions" style={{ justifyContent: 'flex-start', flexWrap: 'wrap', paddingTop: 4 }}>
                    {upcoming.length > 0 || mySlots.length > 0 ? (
                      <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => setHandingOver(true)}>
                        {t('instructors.detail.handOver')}
                      </button>
                    ) : null}
                    {instructor.awaitingFirstLogin && instructor.status === 'ACTIVE' ? (
                      <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => setResending(true)}>
                        {t('instructors.detail.resendPasscode')}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </TeamCard>

              {schoolId && (myBelts.length > 0 || beltsWaiting) ? (
                <TeamCard title={t('instructors.team.belts')}>
                  {beltError ? (
                    <div className="u8t-banners">
                      <ErrorBanner message={beltError} />
                    </div>
                  ) : null}
                  {myBelts.length === 0 ? <p className="u8t-note">{t('instructors.belts.emptyTitle')}</p> : null}
                  {myBelts.map((b) => (
                    <div key={b.id} className="u8t-li">
                      <span className="u8t-li__main">
                        <span className="u8t-sub" style={{ display: 'block' }}>
                          {b.disciplineName}
                        </span>
                        <span className="u8t-belt" style={{ marginTop: 6 }}>
                          <BeltPicture disciplineId={b.disciplineId} stripeTierId={b.stripeTierId} />
                          <span>{b.beltName}</span>
                        </span>
                      </span>
                      <BeltStatus verified={b.verificationStatus === 'VERIFIED'} />
                      {b.verificationStatus === 'UNVERIFIED' ? (
                        <button
                          type="button"
                          className="u8t-pill u8t-pill--go u8t-pill--sm"
                          onClick={() => void verifyBelt(b.disciplineId)}
                          aria-label={t('instructors.belts.verifyAria', { name, style: b.disciplineName })}
                        >
                          {t('instructors.belts.verify')}
                        </button>
                      ) : null}
                    </div>
                  ))}
                </TeamCard>
              ) : null}

              {schoolId ? <FrontDeskSwitches schoolId={schoolId} userId={instructor.userId} variant="card" /> : null}

              <TeamCard title={t('instructors.team.roles')}>
                {myRoles.length > 0 ? (
                  myRoles.map((g) => (
                    <div key={g.id} className="u8t-li">
                      <span className="u8t-li__main">
                        <span className="u8t-li__title">{ROLE_LABELS[g.role] ? t(ROLE_LABELS[g.role]!) : g.role}</span>
                        <span className="u8t-sub" style={{ display: 'block' }}>
                          {branchOf(g.branchId)}
                        </span>
                      </span>
                      <span className="u8t-tags">
                        <span className="u8t-tag u8t-tag--ok">{t('lib.instructorStatus.active')}</span>
                        {g.role === 'INSTRUCTOR' ? statusTags : null}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="u8t-li">
                    <span className="u8t-li__main">
                      <span className="u8t-li__title">{t('lib.roles.instructor')}</span>
                      <span className="u8t-sub" style={{ display: 'block' }}>
                        {branchName}
                      </span>
                    </span>
                    <span className="u8t-tags">
                      <span className={'u8t-tag' + (instructor.status === 'ACTIVE' ? ' u8t-tag--ok' : '')}>
                        {instructor.status === 'ACTIVE' ? t('lib.instructorStatus.active') : t('lib.instructorStatus.revoked')}
                      </span>
                      {statusTags}
                    </span>
                  </div>
                )}
              </TeamCard>

              {upcoming.length > 0 ? (
                <TeamCard
                  title={t('instructors.team.nextClasses')}
                  action={
                    <Link className="u8t-pill u8t-pill--sm" to={`${here}?tab=classes`}>
                      {t('instructors.team.allClasses')}
                      <span aria-hidden="true"> ›</span>
                    </Link>
                  }
                >
                  <ClassList classes={upcoming.slice(0, 2)} showBooked branchOf={branchOf} />
                </TeamCard>
              ) : null}

              {isMainOwner && (activeGrant || (schoolId && instructor.status === 'REVOKED')) ? (
                <TeamCard title={t('instructors.team.removeHeading')} danger>
                  <div className="u8t-danger-body">
                    {activeGrant ? (
                      <>
                        <p>{t('instructors.detail.revokeDescription')}</p>
                        <button type="button" className="u8t-pill u8t-pill--red u8t-pill--sm" onClick={() => setConfirmingRevoke(true)}>
                          {t('instructors.detail.revokeEnrollment')}
                        </button>
                      </>
                    ) : (
                      <>
                        <p>{t('instructors.detail.giveRoleBackDescription')}</p>
                        <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => setGivingRoleBack(true)}>
                          {t('instructors.detail.giveRoleBack')}
                        </button>
                      </>
                    )}
                  </div>
                </TeamCard>
              ) : isMainOwner === false ? (
                <p className="u8t-hint">{t('roleGrants.staff.mainOwnerOnly')}</p>
              ) : null}
            </>
          ) : (
            <>
              <TeamCard title={t('instructors.detail.upcomingHeading')}>
                {classesLoading ? (
                  <div className="u8t-state">
                    <Spinner />
                  </div>
                ) : classesError ? (
                  <div className="u8t-state">
                    <ErrorBanner message={classesError instanceof ApiError ? classesError.message : t('instructors.detail.classesLoadFailed')} />
                  </div>
                ) : upcoming.length === 0 && past.length === 0 ? (
                  <div className="u8t-state">
                    <EmptyState title={t('instructors.detail.classesEmptyTitle')} description={t('instructors.detail.classesEmptyDescription')} />
                  </div>
                ) : upcoming.length === 0 ? (
                  <div className="u8t-state">
                    <EmptyState title={t('instructors.detail.upcomingEmptyTitle')} description={t('instructors.detail.upcomingEmptyDescription')} />
                  </div>
                ) : (
                  <ClassList classes={upcoming} showBooked branchOf={branchOf} />
                )}
              </TeamCard>

              {mySlots.length > 0 ? (
                <TeamCard title={t('instructors.detail.timetableHeading')}>
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                    {mySlots.map((sl) => (
                      <li key={sl.id} className="u8t-li">
                        <span className="u8t-li__main">
                          <span className="u8t-li__title">{sl.title}</span>
                          <span className="u8t-sub" style={{ display: 'block' }}>
                            {weekdayName(sl.weekday, formatLocale() ?? 'en', 'long')} {sl.startTime}–{sl.endTime}
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                </TeamCard>
              ) : null}

              {past.length > 0 ? (
                <TeamCard title={t('instructors.detail.pastHeading')}>
                  <ClassList classes={showAllPast ? past : past.slice(0, PAST_SHOWN)} showBooked={false} branchOf={branchOf} />
                  {past.length > PAST_SHOWN ? (
                    <div className="u8t-state">
                      <button type="button" className="u8t-pill u8t-pill--sm" onClick={() => setShowAllPast((v) => !v)}>
                        {showAllPast ? t('instructors.detail.showFewerPast') : t('instructors.detail.showAllPast', { count: past.length })}
                      </button>
                    </div>
                  ) : null}
                </TeamCard>
              ) : null}
            </>
          )}
        </div>
      </NewLookPage>

      {editing && schoolId ? (
        <EditInstructorModal schoolId={schoolId} branches={branchData?.items ?? []} disciplines={disciplineData?.items ?? []} instructor={instructor} onClose={() => setEditing(false)} />
      ) : null}

      {confirmingRevoke && activeGrant && revokeBlocked ? (
        <RevokeBlockedModal
          instructor={instructor}
          onHandOver={() => {
            setConfirmingRevoke(false);
            setHandingOver(true);
          }}
          onClose={() => setConfirmingRevoke(false)}
        />
      ) : null}

      {confirmingRevoke && activeGrant && !revokeBlocked ? (
        <ConfirmDeleteModal
          title={t('instructors.detail.revokeTitle', { name: `${instructor.firstName} ${instructor.surname}` })}
          description={t('instructors.detail.revokeDescription')}
          confirmLabel={t('instructors.detail.revokeConfirm')}
          genericErrorMessage={t('instructors.detail.revokeFailed')}
          onConfirm={async () => {
            await revokeGrant.mutateAsync({ targetUserId: activeGrant.userId, roleGrantId: activeGrant.id });
            // The roster's Status column and belts box change with it.
            await queryClient.invalidateQueries({ queryKey: ['instructors'] });
            await queryClient.invalidateQueries({ queryKey: ['instructor-belts'] });
            navigate('/instructors');
          }}
          onClose={() => setConfirmingRevoke(false)}
        />
      ) : null}

      {handingOver && schoolId ? (
        <HandOverClassesModal
          schoolId={schoolId}
          instructor={instructor}
          onDone={(message) => {
            setHandingOver(false);
            setNotice(message);
          }}
          onClose={() => setHandingOver(false)}
        />
      ) : null}

      {resending ? (
        <ResendPasscodeModal
          instructor={instructor}
          onDone={(message) => {
            setResending(false);
            setNotice(message);
          }}
          onClose={() => setResending(false)}
        />
      ) : null}

      {givingRoleBack && schoolId ? (
        <GiveRoleBackModal
          schoolId={schoolId}
          instructor={instructor}
          onDone={async (invited) => {
            setGivingRoleBack(false);
            await queryClient.invalidateQueries({ queryKey: ['instructors'] });
            await queryClient.invalidateQueries({ queryKey: ['instructor-belts'] });
            setNotice(t(invited ? 'instructors.detail.giveRoleBackInvited' : 'instructors.detail.giveRoleBackDone', { name }));
          }}
          onClose={() => setGivingRoleBack(false)}
        />
      ) : null}
    </>
  );
}

/** Each class: its title, then the date and its branch, and for upcoming
 * ones how many are booked. */
function ClassList({ classes, showBooked, branchOf }: { classes: InstructorClassResponse[]; showBooked: boolean; branchOf: (id: string) => string }) {
  const t = useT();
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {classes.map((c) => (
        <li key={c.id} className="u8t-li">
          <span className="u8t-li__main">
            <span className="u8t-li__title">{c.title}</span>
            <span className="u8t-sub" style={{ display: 'block' }}>
              {c.branchId ? `${formatDate(c.startDate)} · ${branchOf(c.branchId)}` : formatDate(c.startDate)}
            </span>
          </span>
          {/* The count is of upcoming bookings, so it means nothing once a class is over. */}
          {showBooked ? (
            <span className="u8t-tag u8t-tag--info">
              {c.capacity != null
                ? t('instructors.detail.booked', { enrolled: c.enrolledCount, capacity: c.capacity })
                : t('instructors.detail.bookedNoCapacity', { enrolled: c.enrolledCount })}
            </span>
          ) : null}
        </li>
      ))}
    </ul>
  );
}
