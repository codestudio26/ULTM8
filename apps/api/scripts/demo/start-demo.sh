#!/usr/bin/env bash
# (Re)starts the whole ULTM8 demo on one machine, every process in the
# background (it keeps running after this script exits):
#   Postgres  -> DEMO_PG_PORT     (data DEMO_PGDATA, socket /var/tmp)
#   Redis     -> DEMO_REDIS_PORT
#   pretend Stripe: demo-stripe.mjs (DEMO_FAKE_STRIPE_PORT) in front of the
#     rehearsal's fake (scripts/stress/billing/fake-stripe.mjs, one port below)
#   API with the rehearsal fakes (Stripe, SMS code 123456, R2 files) -> DEMO_API_PORT
#   front server (portal at /, member app at /app/, API at /v1) -> DEMO_FRONT_PORT
#
#   apps/api/scripts/demo/start-demo.sh            restart everything (builds what's missing)
#   apps/api/scripts/demo/start-demo.sh --build    rebuild the API and both web apps first
#   apps/api/scripts/demo/start-demo.sh --seed     also (re)seed the demo data
#   apps/api/scripts/demo/start-demo.sh --stop     stop everything this script started
#
# No live key is used anywhere: the env below is the CI's dummy test values.
# Logs and pid files: DEMO_LOGS (/var/tmp/demo-logs).
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
API_DIR="$(cd "$HERE/../.." && pwd)"
REPO="$(cd "$API_DIR/../.." && pwd)"

PG_BIN="${PG_BIN:-/usr/lib/postgresql/16/bin}"
PGDATA_DIR="${DEMO_PGDATA:-/var/tmp/pg-demo}"
PG_PORT="${DEMO_PG_PORT:-55540}"
REDIS_PORT="${DEMO_REDIS_PORT:-56540}"
REDIS_DIR="${DEMO_REDIS_DIR:-/var/tmp/demo-redis}"
FAKE_STRIPE_PORT="${DEMO_FAKE_STRIPE_PORT:-12540}"
R2_PORT="${DEMO_R2_PORT:-12541}"
API_PORT="${DEMO_API_PORT:-3540}"
FRONT_PORT="${DEMO_FRONT_PORT:-8080}"
LOGS="${DEMO_LOGS:-/var/tmp/demo-logs}"
WEB="${DEMO_WEB:-/var/tmp/demo-web}"

BUILD=0; SEED=0; STOP=0
for a in "$@"; do
  case "$a" in
    --build) BUILD=1 ;;
    --seed) SEED=1 ;;
    --stop) STOP=1 ;;
    *) echo "unknown option $a" >&2; exit 2 ;;
  esac
done

mkdir -p "$LOGS" "$WEB" "$REDIS_DIR"

# --- environment (CI dummy values, never a live key) ---------------------------
export DATABASE_URL="postgresql://postgres:postgres@localhost:${PG_PORT}/ultm8?schema=public"
export DATABASE_URL_APP="postgresql://ultm8_app:changeme@localhost:${PG_PORT}/ultm8?schema=public"
export DATABASE_URL_JOBS="postgresql://ultm8_jobs:changeme@localhost:${PG_PORT}/ultm8?schema=public"
export DATABASE_URL_DISCOVERY="postgresql://ultm8_discovery:changeme@localhost:${PG_PORT}/ultm8?schema=public"
export DATABASE_URL_GRADING_ERASURE="postgresql://ultm8_grading_erasure:changeme@localhost:${PG_PORT}/ultm8?schema=public"
export DATABASE_URL_PLATFORM_ADMIN="postgresql://ultm8_platform_admin:changeme@localhost:${PG_PORT}/ultm8?schema=public"
export REDIS_URL="redis://localhost:${REDIS_PORT}"
export JWT_ACCESS_SECRET=ci-test-secret-not-for-production-use-only-32-chars-min
export STRIPE_WEBHOOK_SECRET=ci-test-webhook-secret-not-a-real-stripe-secret
export STRIPE_SECRET_KEY=sk_test_ci_dummy_not_a_real_stripe_key
export PLATFORM_ADMIN_JWT_SECRET=ci-test-platform-admin-secret-not-for-production-use-32-chars-min
export R2_ACCOUNT_ID=ci-test-r2-account
export R2_ACCESS_KEY_ID=ci-test-r2-access-key
export R2_SECRET_ACCESS_KEY=ci-test-r2-secret-key-not-a-real-credential
export R2_BUCKET_NAME=ci-test-waiver-signatures
export R2_PUBLIC_BUCKET_NAME=ci-test-public-photos
export R2_PUBLIC_BASE_URL=https://ci-test-public-photos.example.test
export QR_CLASS_TOKEN_SECRET=ci-test-qr-class-token-secret-not-for-production-use-32-chars
export QR_STUDENT_TOKEN_SECRET=ci-test-qr-student-token-secret-not-for-production-32-chars
export QR_ATTENDANCE_TOKEN_TTL_SECONDS=20
case "$STRIPE_SECRET_KEY" in sk_live_*) echo "refusing: a live Stripe key is set" >&2; exit 1 ;; esac

stop_pid() { # name
  local f="$LOGS/$1.pid"
  if [[ -f "$f" ]]; then
    local pid; pid="$(cat "$f")"
    if kill -0 "$pid" 2>/dev/null; then kill "$pid" 2>/dev/null || true; for _ in 1 2 3 4 5 6 7 8 9 10; do kill -0 "$pid" 2>/dev/null || break; sleep 0.5; done; kill -9 "$pid" 2>/dev/null || true; fi
    rm -f "$f"
  fi
}
start_bg() { # name logfile cmd...
  local name="$1" log="$2"; shift 2
  setsid nohup "$@" >"$log" 2>&1 </dev/null &
  echo $! >"$LOGS/$name.pid"
}
wait_http() { # url seconds
  for _ in $(seq 1 "$2"); do curl -fsS -o /dev/null "$1" 2>/dev/null && return 0; sleep 1; done
  echo "timed out waiting for $1" >&2; return 1
}

stop_pid front; stop_pid api; stop_pid demo-stripe; stop_pid fake-stripe
if [[ $STOP == 1 ]]; then
  redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
  [[ -f "$PGDATA_DIR/postmaster.pid" ]] && su postgres -c "$PG_BIN/pg_ctl -D $PGDATA_DIR -m fast stop" || true
  echo "demo stopped"; exit 0
fi

# --- Postgres -------------------------------------------------------------------
pg() { if [[ "$(id -u)" == 0 ]]; then su postgres -c "$*"; else bash -c "$*"; fi; }
if [[ ! -f "$PGDATA_DIR/PG_VERSION" ]]; then
  mkdir -p "$PGDATA_DIR"; [[ "$(id -u)" == 0 ]] && chown postgres "$PGDATA_DIR"
  pg "$PG_BIN/initdb -D $PGDATA_DIR -U postgres --auth=trust -E UTF8 >/dev/null"
fi
if ! pg "$PG_BIN/pg_ctl -D $PGDATA_DIR status" >/dev/null 2>&1; then
  [[ "$(id -u)" == 0 ]] && chown postgres "$LOGS"
  pg "$PG_BIN/pg_ctl -D $PGDATA_DIR -o '-p $PG_PORT -k /var/tmp' -l $LOGS/postgres.log -w start" >/dev/null
fi
psql -h /var/tmp -p "$PG_PORT" -U postgres -tAc "ALTER USER postgres PASSWORD 'postgres'" >/dev/null
psql -h /var/tmp -p "$PG_PORT" -U postgres -tAc "SELECT 1 FROM pg_database WHERE datname='ultm8'" | grep -q 1 \
  || psql -h /var/tmp -p "$PG_PORT" -U postgres -c "CREATE DATABASE ultm8" >/dev/null
(cd "$API_DIR" && npx prisma migrate deploy >"$LOGS/migrate.log" 2>&1) || { echo "migrate failed, see $LOGS/migrate.log" >&2; exit 1; }

# --- Redis (its own dir, so it never loads another project's dump.rdb) ---------
if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
  (cd "$REDIS_DIR" && setsid nohup redis-server --port "$REDIS_PORT" --dir "$REDIS_DIR" --save '' --appendonly no >"$LOGS/redis.log" 2>&1 </dev/null &)
  for _ in $(seq 1 20); do redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1 && break; sleep 0.5; done
fi

# --- builds ---------------------------------------------------------------------
if [[ $BUILD == 1 || ! -f "$API_DIR/dist/main.js" ]]; then
  echo "building the API..."; (cd "$API_DIR" && npx prisma generate >/dev/null && npm run build >"$LOGS/api-build.log" 2>&1)
fi
if [[ $BUILD == 1 || ! -f "$WEB/portal/index.html" ]]; then
  echo "building the School Portal..."
  (cd "$REPO/apps/school-portal" && VITE_API_BASE_URL= npx vite build --outDir "$WEB/portal" --emptyOutDir >"$LOGS/portal-build.log" 2>&1)
fi
if [[ $BUILD == 1 || ! -f "$WEB/member/index.html" ]]; then
  echo "building the member app (web)..."
  # The export needs a relative API address and the /app base path; app.json is
  # edited for the export only and always put back.
  APPJSON="$REPO/apps/student/app.json"; cp "$APPJSON" "$LOGS/app.json.orig"
  trap 'cp "$LOGS/app.json.orig" "$APPJSON"' EXIT
  node -e '
    const f = process.argv[1]; const j = JSON.parse(require("fs").readFileSync(f, "utf8"));
    j.expo.extra = { ...(j.expo.extra || {}), apiBaseUrl: "" };
    j.expo.experiments = { ...(j.expo.experiments || {}), baseUrl: "/app" };
    require("fs").writeFileSync(f, JSON.stringify(j, null, 2) + "\n");' "$APPJSON"
  (cd "$REPO/apps/student" && CI=1 npx expo export -p web --output-dir "$WEB/member" >"$LOGS/member-build.log" 2>&1) || { echo "member app export failed, see $LOGS/member-build.log" >&2; exit 1; }
  cp "$LOGS/app.json.orig" "$APPJSON"; trap - EXIT
fi

# --- fake Stripe + API ----------------------------------------------------------
cd "$API_DIR"
export REHEARSAL_R2_PORT="$R2_PORT"
FAKE_STRIPE_PORT=$((FAKE_STRIPE_PORT - 1)) start_bg fake-stripe "$LOGS/fake-stripe.log" node scripts/stress/billing/fake-stripe.mjs
DEMO_STRIPE_PORT="$FAKE_STRIPE_PORT" UPSTREAM_STRIPE_PORT=$((FAKE_STRIPE_PORT - 1)) start_bg demo-stripe "$LOGS/demo-stripe.log" node "$HERE/demo-stripe.mjs"
export FAKE_STRIPE_PORT
(
  export TWILIO_ACCOUNT_SID=ACfake TWILIO_AUTH_TOKEN=fake TWILIO_VERIFY_SERVICE_SID=VAfake
  export STRIPE_CONNECT_RETURN_URL="http://localhost:${FRONT_PORT}/" STRIPE_CONNECT_REFRESH_URL="http://localhost:${FRONT_PORT}/"
  export PORTAL_BASE_URL="http://localhost:${FRONT_PORT}" CORS_ALLOWED_ORIGINS="http://localhost:${FRONT_PORT}"
  export PORT="$API_PORT" THROTTLE_IP_LIMIT_PER_MINUTE=10000000
  # The API would send its Stripe calls through a proxy; the fake is on localhost.
  unset HTTPS_PROXY HTTP_PROXY https_proxy http_proxy
  start_bg api "$LOGS/api.log" node --require ./scripts/rehearsal/use-fakes.cjs dist/main.js
)
wait_http "http://127.0.0.1:${API_PORT}/v1/health" 90

# --- seed (optional) ------------------------------------------------------------
if [[ $SEED == 1 ]]; then
  API="http://127.0.0.1:${API_PORT}/v1" node "$HERE/seed-demo.mjs" 2>&1 | tee "$LOGS/seed.log"
fi

# --- front server ---------------------------------------------------------------
FRONT_PORT="$FRONT_PORT" API_URL="http://127.0.0.1:${API_PORT}" PORTAL_DIR="$WEB/portal" MEMBER_DIR="$WEB/member" \
  start_bg front "$LOGS/front.log" node "$HERE/front-server.mjs"
wait_http "http://127.0.0.1:${FRONT_PORT}/v1/health" 20
echo "demo up: http://localhost:${FRONT_PORT}/ (School Portal), http://localhost:${FRONT_PORT}/app/ (member app); logs in $LOGS"
