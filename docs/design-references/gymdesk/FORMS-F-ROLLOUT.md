# Form pattern "F": site-wide rollout plan

The product owner chose this on 20 Oct 2026: "apply F to the other forms and any form across the site". The live app must not change until the new look goes live.

Pattern F is specified in DESIGN.md → Patterns → Form pattern "F". The reference build is the vision's **4 · Add student**.

## What already applies everywhere (behind the new-look switch)

`packages/ui/src/redesign-fixes.css` §4 gives **every** existing form field F's soft look:
- grey fill, 52px tall, 14px corners
- a slate ring on focus
- 14px regular labels

This covers Input, Textarea, Select, and the time zone / currency / phone pickers. So all 44 forms below get it automatically when `data-look="redesign"` is set.

One difference from Add student: the fields keep a faint 1px outline. Many existing forms sit on the grey page background, and without the outline a grey field would disappear into it.

**Live app check:** a check comparing `master` with the redesign branch, switch off, finds 0 differences across all 113 component classes, in light and dark mode.

## What needs each form rebuilt: chapters + live preview

Full F suits **long create/edit forms**, where staff build a record and benefit from seeing it take shape.

Short forms (sign-in, single-purpose modals, search/lookup bars) keep their current layout and only take the field look. Splitting a 2-field modal into numbered chapters would add length, not clarity.

Rebuilding a page changes that page's code. Each rebuild therefore happens **behind the new-look switch**, so the live page is unchanged, and only with the product owner's go-ahead.

### Full F: chapters + live preview (22)

| Form | File | Live preview shows |
|---|---|---|
| Add student | (vision done) | student card + check-in code |
| Update student | `school-portal/src/students/StudentUpdatePage.tsx` | student card |
| Invite student | `school-portal/src/students/InviteStudentPage.tsx` | the invite as the student will receive it |
| Instructor (create/edit) | `school-portal/src/instructors/InstructorFormModal.tsx` | instructor card |
| Add instructor manually | `school-portal/src/instructors/AddInstructorManuallyModal.tsx` | instructor card |
| Complete instructor profile | `school-portal/src/instructors/CompleteInstructorProfilePage.tsx` | instructor card |
| Add staff manually | `school-portal/src/roleGrants/AddStaffManuallyModal.tsx` | staff card + role |
| Class | `school-portal/src/classes/ClassFormModal.tsx` | class card (time, coach, branch) |
| Timetable slot | `school-portal/src/timetable/TimetableSlotFormModal.tsx` | slot as it appears on the timetable |
| Membership plan | `school-portal/src/membershipPlans/MembershipPlanFormPage.tsx` | plan card as students see it |
| Waiver | `school-portal/src/waivers/WaiverFormModal.tsx` | the waiver document |
| Lesson (curriculum) | `school-portal/src/curriculum/LessonFormModal.tsx` | lesson card |
| Discipline | `school-portal/src/disciplines/DisciplineFormModal.tsx` | discipline card |
| Belt / rank | `school-portal/src/ranks/BeltEditorModal.tsx` | the belt itself |
| Skill | `school-portal/src/skills/SkillFormModal.tsx` | skill card |
| Branch (create) | `school-portal/src/branches/BranchFormModal.tsx` | branch card |
| Branch settings | `school-portal/src/branches/BranchSettingsPage.tsx` | branch card |
| Franchise | `school-portal/src/franchises/FranchiseFormModal.tsx` | franchise card |
| School page | `school-portal/src/schools/SchoolPage.tsx` | the School's public header/footer |
| Create school | `school-portal/src/schools/CreateSchoolPage.tsx` | the new School's card |
| Broadcast notification | `school-portal/src/notifications/BroadcastNotificationModal.tsx` | the notification as recipients see it |
| Subscription plan (Platform Admin) | `platform-admin/src/subscriptionPlans/SubscriptionPlansPage.tsx` | plan card |

### Field look only: keep the current layout (23)

These are sign-in and account screens, short modals, inline sections, and search/lookup bars:
- **Sign-in and account (school-portal):**
  - `auth/LoginPage.tsx`
  - `auth/RegisterPage.tsx`
  - `auth/ForgotPasscodePage.tsx`
  - `auth/ResetPasscodePage.tsx`
  - `auth/VerifyOtpPage.tsx`
  - `auth/FirstLoginPasscodeChangePage.tsx`
- **Short modals and inline sections (school-portal):**
  - `notifications/SnoozeNotificationModal.tsx`
  - `instructors/InviteToInstructorRoleModal.tsx`
  - `instructors/InstructorBeltsSection.tsx`
  - `roleGrants/CoachInvitesSection.tsx`
  - `roleGrants/StaffPage.tsx`
  - `grading/GradingModals.tsx`
  - `grading/GradingBoardPage.tsx`
  - `disciplines/StyleTemplateModals.tsx`
  - `coach/MyBeltsPage.tsx`
  - `curriculum/CurriculumPage.tsx`
  - `franchises/FranchiseDetailPage.tsx`
- **Platform Admin:**
  - `adminUsers/AdminUsersPage.tsx`
  - `franchises/FranchiseLookupPage.tsx`
  - `schools/SchoolLookupPage.tsx`
  - `impersonation/ImpersonationPage.tsx`
  - `translations/TranslationsPage.tsx`
  - `tenantLifecycle/TenantLifecycleControls.tsx`

## Rules carried over to every rebuild

- **Choices:**
  - 5 or fewer short options → pills
  - more than 5, or a list a School can grow → drop-down
  - choices needing a line of explanation → option cards
- **Gender:** Female and Male only.
- **Visual only:** a redesign changes no business rules, fields, validation, API calls or permissions. Each form keeps exactly the fields it has today.
- **Live preview:** it only shows what the staff member has typed, plus values the system already has. It never invents data.
