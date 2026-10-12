# Pre-launch upgrade checklist

Durable, in-repo list of things the product owner has deliberately deferred past the
current build — not forgotten, not blocking today's work, but needed before the
product actually launches. Each entry names what's deferred, why, and what "done"
looks like, so a later session can pick it up without re-deriving context.

Add an entry here whenever the product owner says "keep X for now, but flag it for
before launch" — don't let a deferred decision just evaporate from the conversation.

---

## Address field — real geocoding/address-lookup provider

**Status:** Deferred, 12 Oct 2026. Currently a plain free-text input, no lookup/autocomplete.

**Why deferred:** No address-lookup provider was ever evaluated anywhere in Spec 55 or
the decision log — this is a genuinely new vendor pick, not a gap in an existing
decision. The product owner wants to switch to a real provider before launch, not now.

**Candidates already scoped** (from `docs/v1.2-backend-backlog.md`'s own research):
Google Places (best coverage/accuracy, highest cost, needs Google Cloud billing),
Loqate (strong international coverage, enterprise pricing), getAddress.io (cheaper,
UK-focused — weaker fit for this multi-country platform).

**Done looks like:** a real autocomplete/lookup wired into every Address field this
app has (Branch, Franchise, School, User profile), replacing the plain text input —
same places `docs/v1.2-backend-backlog.md`'s "Site-wide field widgets" section already
lists field-by-field.

---

## Mobile number picker — real IP-geolocation provider for the default country

**Status:** Deferred, 12 Oct 2026. Currently falls back to a fixed per-locale default
(derived from browser/device locale) rather than the device's actual network location.

**Why deferred:** Same reasoning as Address above — no IP-geo provider is evaluated
anywhere in Spec 55 or the decision log.

**Candidates already scoped:** Cloudflare's own geo headers (likely free/simplest if
production traffic actually routes through Cloudflare in front of `apps/api` — confirm
the real hosting setup first), ipapi or MaxMind (dedicated IP-geo APIs, work regardless
of hosting setup, new paid dependency either way).

**Done looks like:** `PhoneField`'s (`packages/ui`, `apps/student/src/components/ui.tsx`)
"Based on your location" row uses a real IP-geo lookup instead of the locale-derived
guess it falls back to today.

---

## White-label branding (Track B Phase 9)

**Status:** Deferred, 12 Oct 2026 — scope to be picked up in its own dedicated session.

**Why deferred:** This needs the entire `packages/build-pipeline`, currently an unbuilt
placeholder — a multi-week-scale infrastructure project (per-School build-and-brand
pipeline), not a page-level feature like everything else in this checklist. The product
owner explicitly asked for this to be scoped in a separate session rather than folded
into tonight's batch.

**Done looks like:** `packages/build-pipeline` actually builds a branded client per
School/Franchise entitled to white-label (see `docs/TRACK-B-ROADMAP.md`'s Phase 9 for
the fuller prior context) — scoping this is the first step, not the build itself.

---

## How to use this list

Before declaring the product "launch ready," walk this file top to bottom with the
product owner and confirm each entry is either done or explicitly re-deferred with a
reason. Remove an entry once it's built — point to the PR/Decision instead of leaving
a stale "deferred" note sitting next to shipped code.
