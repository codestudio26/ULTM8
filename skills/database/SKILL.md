---
name: database
description: Governance skill for database schema design and data-access practices on the ULTM8 project — integrity, migrations, indexing, and tenant-aware access. Generic principles only; ULTM8's actual data model comes from Spec 55.
---

# Database

## Purpose

This skill governs schema design, data access, and data-integrity practices for ULTM8's data layer.

## When to Use

Load before designing or altering a schema, writing a migration, or reviewing data-access code.

## Core Principles

- Data integrity first.
- Explicit relationships and constraints, not just application-level assumptions.
- Migrations are the only path to schema change.
- Indexing follows real query patterns, not speculative ones.
- Efficient queries over convenient ones.
- Transactional consistency for multi-step writes.
- Tenant-aware data access is a default assumption, not an add-on.

## Rules

- Every schema change goes through a migration, never a manual edit.
- Foreign keys and constraints should be explicit at the database layer, not enforced only in application code.
- A multi-step write that must succeed or fail together belongs in a transaction.
- Add an index for a query pattern that actually exists, not a hypothetical one.
- Review a query's actual behavior before assuming it's efficient at scale.

## ULTM8 Constraints

ULTM8's actual tables, entities, relationships, and tenant-scoping rules must come from Spec 55 (§6, Data Model), `skills/ultm8-domain-rules/SKILL.md`, approved architectural decisions, or other explicitly approved project documentation. This skill must not invent ULTM8-specific schema.

## Must NOT

- Must not perform a destructive schema change (drop/rename that loses data) without explicit approval.
- Must not assume whether a table is tenant-scoped — verify against Spec 55.
- Must not invent ULTM8-specific tables, columns, or relationships in this skill.
- Must not substitute a manual database edit for a migration.

## Current Status

This is an initial engineering governance skill and will be refined as the ULTM8 architecture and implementation standards are formally established.
