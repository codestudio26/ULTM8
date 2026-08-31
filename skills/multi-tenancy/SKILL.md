---
name: multi-tenancy
description: Governance skill for tenant isolation on the ULTM8 project — enforcing, propagating, and testing tenant boundaries. Generic principles only; ULTM8's actual tenancy relationships come from Spec 55 and the domain rules.
---

# Multi-Tenancy

## Purpose

This skill governs how tenant isolation is designed, enforced, and verified across the platform.

## When to Use

Load before writing any query, endpoint, or background job that touches tenant-scoped data, or reviewing a change for cross-tenant risk.

## Core Principles

- Tenant isolation is enforced at the data layer, not only in application code.
- Every tenant-scoped query carries an explicit tenant filter.
- Tenant context is propagated deliberately through the request/job lifecycle, never assumed.
- Authorization at a tenant boundary is a first-class check, not a side effect.
- Tenant isolation is tested, not just implemented.

## Rules

- Never write a tenant-scoped query without its tenant filter.
- Propagate tenant context explicitly through async/background work — don't let it get lost.
- Treat a missing tenant filter as a bug severe enough to block a merge.
- Test that one tenant's token/session cannot read or write another tenant's data.

## ULTM8 Constraints

ULTM8's actual tenancy relationships (which entities are Franchise-, School-, or Branch-scoped) and isolation mechanism must come from Spec 55, `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific tenancy behaviour.

## Must NOT

- Must not assume a query is safe because "it worked in testing."
- Must not invent ULTM8's actual tenancy relationships — those come from Spec 55 and the domain rules.
- Must not build a cross-tenant capability (e.g. an admin bypass) without following the project's already-approved isolation model.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
