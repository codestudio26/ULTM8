# Prisma — status notes (Phase 1)

**No Postgres instance was reachable in the environment this was built in** (checked
locally: no `psql`, no `docker`). That has two consequences worth knowing before this
schema is trusted:

1. **`migrations/20260902000000_init/migration.sql` was hand-authored**, not generated
   by `prisma migrate dev`. It's written to match `schema.prisma` field-for-field, but
   it has not been verified by Prisma's own diffing engine. Before relying on it:
   ```bash
   # against a throwaway/empty Postgres database
   npx prisma migrate dev --name init
   # then diff the generated migration.sql against this one and reconcile
   ```
2. **The RLS test suite** (`test/tenant-isolation.rls.spec.ts`) requires a real Postgres
   instance with both `DATABASE_URL` (migration/superuser role) and `DATABASE_URL_APP`
   (the `ultm8_app` role the migration creates) set. It was written and reviewed for
   correctness but has not been executed end-to-end here for the same reason.

## Local setup

```bash
# 1. Start Postgres (docker example — adjust to your setup)
docker run -d --name ultm8-pg -e POSTGRES_PASSWORD=postgres -p 5432:5432 postgres:16

# 2. Create the database
docker exec -it ultm8-pg psql -U postgres -c "CREATE DATABASE ultm8;"

# 3. Copy .env.example -> .env, point DATABASE_URL at the postgres superuser
#    (migrations need to create the ultm8_app role and grant it access)

# 4. Run the migration
npx prisma migrate deploy   # applies migration.sql as-is
# or, to have Prisma regenerate it fresh instead of trusting the hand-authored file:
npx prisma migrate dev --name init

# 5. Generate the Prisma Client
npx prisma generate

# 6. Point DATABASE_URL_APP at the ultm8_app role the migration created
#    (password "changeme" — change it before anything but local dev)
```
