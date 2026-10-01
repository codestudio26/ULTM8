/**
 * One-off diagnostic — NOT part of the app's real code, not run in CI.
 *
 * WaiverSignature.signedById turned out to be a column that exists on the live DB
 * but isn't backed by ANY migration this branch (or master, per
 * check-migration-drift.js's _prisma_migrations read) has ever run — i.e. someone
 * added it by hand, directly. Before deciding signedById was an isolated incident,
 * this checks EVERY table for the same pattern: a real live column with no
 * corresponding field in schema.prisma. Crude by design (string-matches each live
 * column name against the Prisma model's own text block for that table — good
 * enough to catch "a column exists that the model doesn't know about," not meant
 * as a full schema differ) but enough to answer "is there a second landmine like
 * signedById waiting in some other table."
 *
 * Usage (from apps/api): DATABASE_URL='...' node scripts/check-schema-drift-all-tables.js
 */

const fs = require('fs');
const path = require('path');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const schemaText = fs.readFileSync(path.join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');

  const tables = await prisma.$queryRawUnsafe(`
    SELECT c.table_name, c.column_name, c.is_nullable, c.column_default
    FROM information_schema.columns c
    JOIN information_schema.tables t
      ON t.table_name = c.table_name AND t.table_schema = 'public' AND t.table_type = 'BASE TABLE'
    WHERE c.table_schema = 'public'
    ORDER BY c.table_name, c.ordinal_position
  `);

  const byTable = new Map();
  for (const row of tables) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, []);
    byTable.get(row.table_name).push(row);
  }

  // Internal/Prisma-managed tables that have no model block of their own.
  const SKIP_TABLES = new Set(['_prisma_migrations']);

  let foundAny = false;
  for (const [tableName, columns] of byTable) {
    if (SKIP_TABLES.has(tableName)) continue;

    const modelMatch = schemaText.match(new RegExp(`model ${tableName} \\{([\\s\\S]*?)\\n\\}`));
    if (!modelMatch) {
      console.log(`\n⚠️  Table "${tableName}" exists in the DB but has NO "model ${tableName} {...}" block in schema.prisma at all.`);
      foundAny = true;
      continue;
    }
    const modelBody = modelMatch[1];

    for (const col of columns) {
      // crude but sufficient: does this exact column name appear anywhere in the model's text?
      const re = new RegExp(`\\b${col.column_name}\\b`);
      if (!re.test(modelBody)) {
        foundAny = true;
        const danger = col.is_nullable === 'NO' && col.column_default === null ? ' <-- NOT NULL, no default (will break any insert Prisma doesn\'t know to fill)' : '';
        console.log(`\n⚠️  "${tableName}"."${col.column_name}" exists in the DB but not in schema.prisma's model.${danger}`);
      }
    }
  }

  if (!foundAny) {
    console.log('\nNo drift found — every live column matches something in schema.prisma\'s model text.');
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
