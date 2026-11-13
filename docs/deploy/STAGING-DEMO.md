# The populated demo on staging

This puts the populated demo (the **Apex Jiu-Jitsu** Franchise: four Schools,
about 1,200 members, three months of history, a login for every role) into the
**staging** database, so you can open it in Chrome on the staging School Portal
and the member app.

The seeding runs from GitHub Actions, started by you with a button. It is the
same seed as the local demo (`apps/api/scripts/demo/`, see its `README.md` for
everything that's in it). It wipes and rebuilds only its own demo tenants;
nothing else in the staging database is touched. **Never do this on
production.**

> **Never paste a password, connection string or passcode into a chat**
> (including with Claude). Type them only into Supabase, GitHub, Render or
> Vercel's own pages.

| | Address |
|---|---|
| School Portal (staff) | https://ultm8-school-portal.vercel.app |
| Member app (members and parents, on the web) | https://ultm8-student-web.vercel.app |
| API | https://ultm8-staging-api.onrender.com |

## 1. Render: bring the staging API up to date

1. Open https://dashboard.render.com and click **ultm8-staging-api**.
2. Check the status at the top says **Live** (green). If it says *Suspended* or
   *Failed*, open **Events** and **Logs** to see why before going on.
3. Click **Manual Deploy** (top right) → **Deploy latest commit**. Make sure the
   branch shown under the service name is `master`. Wait until the new deploy
   says **Live** (about 5 to 10 minutes). Its build also updates the database
   tables (migrations), which the seed needs.
4. Let the member app talk to the API: click **Environment** (left menu), find
   `CORS_ALLOWED_ORIGINS`, click its value to edit it, and add the member app's
   address to the end, after a comma, with no space and no trailing slash. It
   then looks like:

   ```
   https://ultm8-school-portal.vercel.app,https://<the admin portal>.vercel.app,https://ultm8-student-web.vercel.app
   ```

   Keep whatever was already there. Click **Save, rebuild, and deploy** (or
   **Save changes**, then **Manual Deploy** → **Deploy latest commit**) and wait
   for **Live** again.
5. Check it: open https://ultm8-staging-api.onrender.com/v1/health in Chrome.
   It should show `{"status":"ok","db":"ok","redis":"ok"}`. (The free plan
   sleeps when nobody uses it; the first visit can take about a minute.)

## 2. Supabase: copy the database connection string

1. Open https://supabase.com/dashboard and click the **staging** project (the
   one Render's `DATABASE_URL` points at).
2. Click **Connect** at the top of the page. In the window that opens, choose
   **Connection string**, then under **Method** choose **Session pooler**
   (port 5432). Older Supabase screens have this under **Project Settings →
   Database → Connection string → Session pooler**.
3. Copy the string. It looks like
   `postgresql://postgres.<ref>:[YOUR-PASSWORD]@aws-0-<region>.pooler.supabase.com:5432/postgres`.
   Replace `[YOUR-PASSWORD]` (brackets too) with the project's database password.
   If the password has any of `@ : / ? #` in it, write them as `%40 %3A %2F %3F %23`.
   Don't use the `db.<ref>.supabase.co` ("Direct connection") string: GitHub's
   machines can't reach it.
4. Also note the **host** on its own: the part between `@` and `:5432`, for
   example `aws-0-us-west-1.pooler.supabase.com`.

It is the same value as `DATABASE_URL` on Render, so you can also copy it from
Render → ultm8-staging-api → Environment → `DATABASE_URL` (click the eye icon).

## 3. GitHub: save the two secrets and one variable

On https://github.com/codestudio26/ULTM8:

1. Click **Settings** (top menu of the repository) → in the left menu
   **Secrets and variables** → **Actions**.
2. On the **Secrets** tab, click **New repository secret** and add:
   - Name `STAGING_DATABASE_URL`, value: the full string from step 2.3.
     Click **Add secret**.
   - Name `DEMO_PASSCODE`, value: **6 digits you choose** (not `123456`). Every
     demo login will use it. Click **Add secret**.
3. Click the **Variables** tab, then **New repository variable**:
   - Name `STAGING_DB_HOST`, value: the host from step 2.4 (only the host, for
     example `aws-0-us-west-1.pooler.supabase.com`). Click **Add variable**.

   The seed refuses any database whose host isn't exactly this one, so the
   secret can never send it somewhere else by mistake.

GitHub never shows a secret again after you save it, and hides it in the run's
log. To change one, click it and choose **Update**.

## 4. GitHub: run the seed

1. Click **Actions** (top menu of the repository).
2. In the left list click **Seed staging demo**.
3. Click **Run workflow** (on the right). Leave the branch as `master`.
   - **Type SEED STAGING to confirm**: type `SEED STAGING`.
   - **If the demo is already there, wipe it and build it again**: leave it
     ticked. (Untick it to leave an existing demo as it is.)
   - **The staging API address**: leave it as it is.
4. Click the green **Run workflow** button. Refresh the page after a few seconds
   and click the new run to watch it. It takes about 5 to 15 minutes.

When it's green, the run's **Summary** lists the logins. If it's red, click the
failed step; the message says what to fix. The usual ones:

| Message | What to do |
|---|---|
| `... is not set` | Step 3: a secret or the variable is missing or misspelled. |
| `... host is not STAGING_DB_HOST` | The variable and the connection string disagree: check both against step 2. |
| `Staging's database is not in step with this branch's migrations` | Step 1.3: redeploy the API on Render, wait for **Live**, then run again. |
| `did not answer /health` | The API is down: step 1.2. |
| `signing in as owner.hq@... failed` | The API and the secret point at different databases: check `STAGING_DATABASE_URL` is the same database as Render's `DATABASE_URL`. |

Run it again whenever you like: the demo's dates start from the day it runs
("today" always has classes), so re-seed before showing it to someone. "Check-ins today" only counts classes that had started when the seed ran, so re-run it after the day's first class to refresh today's check-ins (`apps/api/scripts/demo/README.md`, "Today's check-ins").

## 5. Open it

Use the passcode you saved as `DEMO_PASSCODE` for every login.

**School Portal**: https://ultm8-school-portal.vercel.app (email and passcode).

| Who | Email | What to look at |
|---|---|---|
| School owner, main academy (London) | `owner.hq@apex-demo.example` | Everything, in the new look: the Dashboard with **Check-ins today** and **Ready to grade**, Students (Check-in, Sign-ups, Attendance), Team, Schedule, Grading, Billing (Plans, Transactions, Billing reports, Payroll), Waivers, Organisation, Notifications |
| Head coach (London, Shoreditch) | `coach.hq@apex-demo.example` | The new-look Coach dashboard (ready to grade, my classes with roll call and class QR), Grading Board |
| Front desk (Shoreditch) | `desk.hq@apex-demo.example` | Coach dashboard with **Check-ins today** for Shoreditch (it may see attendance statistics), Students, Check-in, Timetable, Sign-ups; no money pages |
| Front desk, fewer permissions (Clapham) | `desk.clapham@apex-demo.example` | The same without class management or charges |
| Franchise owner | `founder@apex-demo.example` | Franchises → Apex Jiu-Jitsu: the member Schools and franchise fees |
| School owner, Manchester | `owner.manchester@apex-demo.example` | A franchisee's own School |
| School owner, Dublin (euros) | `owner.dublin@apex-demo.example` | |
| School owner, São Paulo (reais, Portuguese) | `owner.saopaulo@apex-demo.example` | The portal in Portuguese, Pix and cash |

Coaches and front desk for the other Schools: `coach.manchester@`, `desk.manchester@`,
`coach.dublin@`, `desk.dublin@`, `coach.saopaulo@`, `recepcao.saopaulo@` (all
`@apex-demo.example`).

**Member app**: https://ultm8-student-web.vercel.app. First pick the School:
type `Apex` and choose it, then sign in.

| Who | School to pick | Email | What to look at |
|---|---|---|---|
| Adult member | Apex Jiu-Jitsu HQ | `member@apex-demo.example` | James Carter: My grading (ready to grade), bookings, membership, check-in code, waiver, payment history, notifications |
| Parent | Apex Jiu-Jitsu HQ | `parent@apex-demo.example` | Emma Clarke: My minors (her child's grading, bookings, plans). She doesn't train, so the app offers "Join": tap **Not now** |
| New member, first sign-in | Apex Jiu-Jitsu HQ | `new.member@apex-demo.example` | The first-sign-in "I agree" step, and a waiver still to sign |
| Member in São Paulo | Apex Jiu-Jitsu São Paulo | `aluno@apex-demo.example` | The app in Portuguese, monthly passes paid by Pix or cash |

Every other member is `firstname.surname@apex-demo.example`, same passcode.

## What doesn't work on staging

Staging has no Stripe, SMS or email keys, so anything that needs them live
fails. Nothing else is affected, and no page breaks: the part that needs Stripe
shows an error message on its own.

- **Card payments.** The card payment history (renewals, refunds) shows as
  recorded data, but buying a plan by card, "View receipt", adding a card,
  refunding, cancelling or freezing a card subscription, and the **Stripe
  account** box on the School page and the Franchise page show an error
  ("Internal server error"). The School page's franchise-fee card box does too.
  Cash and Pix payments, and confirming them, work.
- **Background billing jobs.** The API's log shows a repeated
  "StripeClientService is not configured" error from the membership sweep for
  the frozen card memberships. It retries and does no harm.
- **SMS and email.** Nothing is sent (the demo's emails are on a reserved
  domain that never reaches an inbox anyway). Signing up a new account needs
  the SMS code, so use the demo logins above.
- **Push notifications, video lessons and file uploads** need their own keys
  (FCM, Cloudflare Stream, R2), deferred to v1.3 (Decision 267).
- **The free Render plan sleeps** after about 15 minutes idle: the first page
  after a pause can take a minute, and the nightly jobs only run while it's
  awake.

## The member app on Vercel

The Vercel project **ultm8-student-web** (team code-studio4) already exists:
root directory `apps/student`, Node 22, environment variable
`EXPO_PUBLIC_API_BASE_URL` = `https://ultm8-staging-api.onrender.com`. It builds
from `master` once `apps/student/vercel.json` is there (it exports the app for
the web with `expo export -p web`). If the address above doesn't open after
that, open the project in Vercel → **Deployments**, and if there is none,
**Settings → Git** to check it's connected to `codestudio26/ULTM8` (connect it
if not), then push or **Redeploy**. The API address is baked in when it builds,
so **redeploy** after changing it.

To make it from scratch instead: Vercel → **Add New…**
→ **Project** → import `codestudio26/ULTM8` → **Project Name**
`ultm8-student-web` → **Root Directory** `apps/student` (click **Edit**) →
**Framework Preset** "Other" → open **Environment Variables** and add
`EXPO_PUBLIC_API_BASE_URL` = `https://ultm8-staging-api.onrender.com` → **Deploy**.
The build settings come from `apps/student/vercel.json` (it exports the app
for the web with `expo export -p web`). The address is baked in when it builds,
so **redeploy** after changing it. Then do step 1.4 with the project's address.
