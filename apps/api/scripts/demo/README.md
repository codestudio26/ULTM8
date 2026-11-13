# ULTM8 demo (populated)

A lived-in demo of ULTM8 for clicking through the School Portal, the coach screens and the member app: one Franchise, **Apex Jiu-Jitsu**, with its main academy and three franchisee Schools, about three months of history, and a login for every role. It uses only features that are built; nothing here is a business rule of its own.

Not part of CI, and never for a production database (see "Safety" below).

## What's in it

| School | Where | Currency, language | Members | Coaches | Front desk | Branches |
|---|---|---|---|---|---|---|
| **Apex Jiu-Jitsu HQ** (main academy) | London | GBP, English | 430 | 10 | 2 | Shoreditch, Clapham |
| Apex Jiu-Jitsu Manchester | Manchester | GBP, English | 245 | 3 | 1 | Northern Quarter |
| Apex Jiu-Jitsu Dublin | Dublin | EUR, English | 215 | 3 | 1 | Dublin City |
| Apex Jiu-Jitsu São Paulo | São Paulo | BRL, Português (Brasil) | 275 | 4 | 1 | Pinheiros |

About 30% of each School's members are children, each with a parent (some parents train too, some have two children). Every School has:

- **Two styles from the IBJJF template**, as two programs (Decision 281): *Brazilian Jiu-Jitsu* (adult belts; the kids belts archived, white-belt stripes counting Adult Fundamentals) and *Kids BJJ* (kids belts; the adult belts archived), linked so a kid can move to the adult program. Coaches' own belts, verified; grading permissions per coach and style (assistants can promote kids only); skills on each style.
- **A weekly timetable** (14–40 classes a week per School, kids classes with an age range, a women-only class at Shoreditch), with the coming four weeks made by the real class generator job and the past 13 weeks of the same classes back-dated.
- **Membership plans**: monthly Subscriptions (adult, kids), a 10-class pack, a drop-in, a free trial week and a Friend Pass. São Paulo takes no cards, as built for Brazil: its monthly fee is a 30-day pass paid each month by Pix or cash.
- **Memberships**: mostly monthly, plus packs, trials (new joiners), lapsed members, a few subscriptions cancelling at the end of the month and a few frozen (approved freezes in progress).
- **Payments**: card (pretend Stripe) first payments and monthly renewals for up to a year, a few failed renewals retried, two refunds per card School, cash and Pix at the desk, and a few cash/Pix orders waiting for the School to confirm.
- **Attendance**: about 25,000 bookings over 13 weeks (checked in by app QR, check-in code, coach scan or by hand), with no-shows and cancellations, hours trained, and bookings for this week. Today's classes that had started when the seed ran have people checked in, so the Dashboard's **Check-ins today** isn't zero (see "Today's check-ins" below).
- **Grading**: a rank for every member, a promotion and stripe history, and progress from their real check-ins: some just starting, some getting there, some ready to grade (dozens of active students at HQ sit in the Grading Board's Ready to Grade column, 66% and over, so the Dashboard's **Ready to grade** shows three of them and "See all N →"). A couple of new members' self-declared belts wait to be verified.
- **Waivers** signed by almost everyone (a parent for each child; some on paper); a few still to sign.
- **Guardians**: each child linked to a parent, with the parent's consent (and camera consent for most).
- **Notifications** (ready to grade, payment to confirm, membership ended, frozen, School messages), **sign-ups** waiting on the front-desk list, **staff permissions** for the front desk, **pay rates** for payroll, a small **curriculum** (lessons without video: video needs Cloudflare Stream, deferred to v1.3, Decision 267), member **tags** and **notes**, emergency contacts.
- **Franchise fees**: the Franchise's own Stripe account and a flat $250 a month from each franchisee School for the last six months.

Names, phone numbers and email addresses are made up. Every email is on `apex-demo.example`, a reserved domain that can never reach a real inbox.

## Logins

Every passcode is **123456** (or `DEMO_PASSCODE` when the seed was run with one). Staff sign in to the **School Portal**; members and parents to the **member app**, after picking their School (type "Apex" and choose it, or use the join code the seed prints).

| Role | School | Email | Where | What it shows |
|---|---|---|---|---|
| Franchise owner | Apex Jiu-Jitsu (all four) | `founder@apex-demo.example` | Portal | Franchises → Apex Jiu-Jitsu: the four member Schools, fee billing and the monthly fee charges |
| School owner (main academy) | HQ | `owner.hq@apex-demo.example` | Portal | Everything, in the new look. Lands on the **Dashboard**: Bookings this week, Upcoming, **Check-ins today** (check-ins to classes that start today, London time), Active students, Attendance, Today's classes, **Ready to grade** (the Grading Board's Ready to Grade column, active students only: the top three and "See all N →"), Birthdays, and Notifications on the right. A "Belts waiting to be verified" pop-up comes first (new members' self-declared belts): tap **Later**. Then Students (Check-in, Sign-ups, Attendance, Growth tabs) and a student's profile, Team, Schedule (Classes, Timetable, Curriculum, Cancellations), Grading Board, Billing (Membership Plans, Transactions, Billing reports, Payroll), Waivers, Organisation, Notifications |
| Head coach | HQ, Shoreditch | `coach.hq@apex-demo.example` | Portal | The new-look **Coach dashboard** (`/coach`): Grading (each style's "ready to grade" and "getting there" counts, Open the Grading Board), My classes (every week, and coming up with **Roll call** and **Show QR**), Notifications, Birthdays, and on the right the next class and the Ready to grade list. Grading Board and Students for their branch, My belts, My coach profile. No "Check-ins today": that card is for the owner and the front desk |
| Front desk (Branch Staff) | HQ, Shoreditch | `desk.hq@apex-demo.example` | Portal | Has **See attendance statistics**, so its new-look Coach dashboard (`/coach`) opens with **Check-ins today** for Shoreditch (Decision 461), then the branch's classes this week with Roll call and Show QR, and Birthdays. Students (Check-in and front-desk mode, Sign-ups, Attendance, Growth), Team, Schedule (book someone in on the Timetable); no money pages, and nothing to grade (no grading permission) |
| Front desk, fewer permissions | HQ, Clapham | `desk.clapham@apex-demo.example` | Portal | The same for Clapham (Check-ins today for Clapham too), without class management or charges |
| School owner | Manchester | `owner.manchester@apex-demo.example` | Portal | A franchisee's own School |
| Coach | Manchester | `coach.manchester@apex-demo.example` | Portal | |
| Front desk | Manchester | `desk.manchester@apex-demo.example` | Portal | |
| School owner | Dublin (EUR) | `owner.dublin@apex-demo.example` | Portal | |
| Coach | Dublin | `coach.dublin@apex-demo.example` | Portal | |
| Front desk | Dublin | `desk.dublin@apex-demo.example` | Portal | |
| School owner | São Paulo (BRL, pt-BR) | `owner.saopaulo@apex-demo.example` | Portal | The portal in Portuguese, Pix and cash payments |
| Coach | São Paulo | `coach.saopaulo@apex-demo.example` | Portal | |
| Front desk | São Paulo | `recepcao.saopaulo@apex-demo.example` | Portal | |
| Adult member | HQ | `member@apex-demo.example` | Member app | James Carter, blue belt, ready to grade: My grading, bookings (book a class from Browse academies → the School), monthly membership (freeze, cancel), check-in QR and code, waiver signed, payment history, notifications, lessons |
| Parent | HQ | `parent@apex-demo.example` | Member app | Emma Clarke, with her children (My minors): each child's grading, booking, waivers, plans and membership card. She doesn't train, so the app offers "Join"; tap **Not now** |
| New member, first sign-in | HQ | `new.member@apex-demo.example` | Member app or portal | Noah Bailey, joined two days ago on a free trial: shows the first-sign-in **"I agree"** step (Terms and Privacy), and has a waiver still to sign |
| Adult member | São Paulo | `aluno@apex-demo.example` | Member app | Lucas Ferreira: the app in Portuguese, monthly 30-day passes paid by Pix or cash |

Every other member is `firstname.surname@apex-demo.example` (a number is added when a name repeats), all with the same passcode. Children have no login of their own (as built: the parent acts for them). Once "I agree" is ticked for `new.member@`, it stays ticked until the demo is seeded again.

**Coaches** and the **front desk** sign in to the School Portal with the same login page as owners (email and passcode) and land on the **Coach dashboard** (`/coach`). A coach sees the styles they may grade with how many students are ready, their weekly classes, and the coming classes with **Roll call** and **Show QR** links, with the next class and the Ready to grade list in the right-hand panel; Grading and Students show only their own branch. The front desk sees its Branch's classes instead, and **Check-ins today** for its Branch, because every demo front desk has "See attendance statistics".

### Today's check-ins

The Dashboard's **Check-ins today** (and the front desk's card on `/coach`) counts check-ins to the classes that start today on the School's clock. The seed checks people in only to classes that had started when it ran, as the API would (nobody checks in to a class that hasn't opened yet), and it runs once. So:

- seeded before the day's first class, the card shows 0 that day. HQ's first class is at 06:30 on Monday, Wednesday and Friday, 07:00 on Tuesday and Thursday (Clapham; Shoreditch's is 12:15), 09:30 on Saturday and 10:00 on Sunday (the women's class at Shoreditch; Clapham has no Sunday classes, so `desk.clapham@`'s card stays at 0 on Sundays);
- the next day it starts again from 0, and only real check-ins made in the demo add to it.

**Re-run the seed to refresh today's check-ins** (after the day's first class has started). At the end the seed reads both new tiles back through the API, as the HQ owner and each HQ front desk, and prints them, for example: `Apex Jiu-Jitsu HQ: "Ready to grade" 74 students; "Check-ins today" (…, Europe/London) 101 for the owner, 70 for desk.hq@apex-demo.example (Shoreditch), 31 for desk.clapham@apex-demo.example (Clapham)`. It says so when today's count is still 0.

## Run it on one machine

```sh
apps/api/scripts/demo/start-demo.sh --seed     # first time: start everything, build what's missing, seed
apps/api/scripts/demo/start-demo.sh            # after a restart: start everything again (the data is kept)
apps/api/scripts/demo/start-demo.sh --build    # rebuild the API and both web apps, then start
apps/api/scripts/demo/start-demo.sh --stop     # stop it all
```

It needs Node 20+, the repo's `node_modules` (`npm ci`), Postgres 16 binaries (`PG_BIN`, default `/usr/lib/postgresql/16/bin`) and `redis-server`. Everything runs in the background and keeps running after the script ends; logs and pid files go to `/var/tmp/demo-logs`. The defaults (each can be changed with the variable in brackets):

| Process | Port |
|---|---|
| Postgres, data in `/var/tmp/pg-demo` (`DEMO_PGDATA`), socket in `/var/tmp` | 55540 (`DEMO_PG_PORT`) |
| Redis, in its own folder `/var/tmp/demo-redis` (`DEMO_REDIS_DIR`; never the repo), emptied of saved data before it starts | 56540 (`DEMO_REDIS_PORT`) |
| Pretend Stripe (`demo-stripe.mjs` in front of the rehearsal's `fake-stripe.mjs`, one port below) | 12540 (`DEMO_FAKE_STRIPE_PORT`) |
| API, with the rehearsal's fakes (`../rehearsal/use-fakes.cjs`) | 3540 (`DEMO_API_PORT`) |
| Fake file storage (the rehearsal's fake R2) | 12541 (`DEMO_R2_PORT`) |
| **Front server**: the one port to open | **8080** (`DEMO_FRONT_PORT`) |

Open **`http://<host>:8080/`** for the School Portal and **`http://<host>:8080/app/`** for the member app. The front server (`front-server.mjs`) serves both builds and passes `/v1/...` to the API, so everything is on one origin; both apps are built with a relative API address (`VITE_API_BASE_URL=` for the portal; for the member app, `start-demo.sh` sets `extra.apiBaseUrl` to `""` and `experiments.baseUrl` to `/app` in `apps/student/app.json` for the export only, then puts the file back).

No live key is used: the env in `start-demo.sh` is the CI's dummy test values. Outside services are the rehearsal's fakes: Stripe (`fake-stripe.mjs`; paying on the hosted Checkout page is `POST /__checkout/:id/pay` on the fake's port), SMS (the code **123456** is always approved, nothing is sent) and file storage (kept in memory, so a file uploaded during the demo is gone after a restart). `demo-stripe.mjs` answers for the Stripe ids the seed wrote (members' card subscriptions, connected accounts, past payments), which the in-memory fake never made, so cancelling, freezing or refunding a seeded membership works.

## Seed a real server (staging)

On the shared staging server, use the GitHub Actions workflow **Seed staging demo** (`.github/workflows/seed-staging-demo.yml`); the owner's click-by-click steps are in `docs/deploy/STAGING-DEMO.md`. By hand, from `apps/api`, with the API running against the same database:

```sh
DATABASE_URL=postgresql://<owner>@<host>/<db> DEMO_PASSCODE=<6 digits> \
ULTM8_ALLOW_DEV_SEED_HOST=<host> API=https://<api-host>/v1 node scripts/demo/seed-demo.mjs
```

- `DATABASE_URL`: the database owner (bulk history is written straight into the tables, as the app would have written it). Not the app's RLS role.
- `API`: the styles, plans, waivers and timetable go through the real API, signed in as each School's owner with the seeded passcode (as the apps do; no API secret is needed). Making each weekly class makes its coming four weeks of Classes. It waits up to five minutes for a sleeping API to wake.
- `DEMO_PASSCODE`: the 6-digit passcode for every demo login. Required, and not `123456`, on any database that isn't local.
- `REDIS_URL` (optional): the API's Redis; when set, the seed also runs the class generator job there.
- `DEMO_KEEP_EXISTING=1` (optional): if the demo is already there, leave it as it is.
- It takes a minute or two locally, longer against a remote database.

Re-running it is safe: it first deletes its own tenants (the Franchise `de300000-0000-4000-8000-000000000001`, its Schools, every account on `@apex-demo.example`, and the children only those accounts look after), with everything that depends on them, then seeds them again. Nothing else in the database is touched. The data is dated from the day it runs ("today" always has classes), so re-seed to bring a demo back up to date, and to refresh today's check-ins.

On a server with real Stripe, SMS or email, remember the demo Schools are fake: a payment needs a test-mode Stripe account, and the made-up phone numbers and `.example` emails never receive anything.

## Safety

- Refuses a non-local `DATABASE_URL` unless `ULTM8_ALLOW_DEV_SEED_HOST` names that exact host, and always refuses `NODE_ENV=production` (`prisma/dev-seed-guard.js`, shared with the other dev seeds). It also refuses a `sk_live_` Stripe key.
- Every login has the same known passcode; never point this at a database real people use.

## Files

- `seed-demo.mjs`: the seed.
- `start-demo.sh`: (re)starts Postgres, Redis, the pretend Stripe, the API and the front server; `--seed`, `--build`, `--stop`.
- `front-server.mjs`: the one-port front server.
- `demo-stripe.mjs`: answers for the seeded Stripe ids in front of the rehearsal's fake.
