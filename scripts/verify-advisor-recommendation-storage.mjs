/*
 * Read-only deployment verifier for the Advisor recommendation store.
 * Run with a dedicated migration/read-only verification credential, never a
 * browser session. `--require-ready` returns a non-zero exit code when the
 * migration has not produced the required schema.
 */
import 'dotenv/config';
import { prisma } from '../server/db.js';

const requiredColumns = new Map([
  ['id', { type: 'uuid', nullable: false }],
  ['tenant_id', { type: 'text', nullable: false }],
  ['clinic_id', { type: 'text', nullable: false }],
  ['category', { type: 'text', nullable: false }],
  ['title', { type: 'text', nullable: false }],
  ['problem_identified', { type: 'text', nullable: false }],
  ['evidence', { type: 'jsonb', nullable: false }],
  ['baseline_metric', { type: 'jsonb', nullable: true }],
  ['baseline_start_date', { type: 'date', nullable: true }],
  ['baseline_end_date', { type: 'date', nullable: true }],
  ['recommended_action', { type: 'text', nullable: false }],
  ['target_metric', { type: 'jsonb', nullable: true }],
  ['implementation_status', { type: 'text', nullable: false }],
  ['current_metric', { type: 'jsonb', nullable: true }],
  ['percentage_change', { type: 'numeric', nullable: true }],
  ['estimated_financial_impact', { type: 'jsonb', nullable: true }],
  ['sources', { type: 'jsonb', nullable: false }],
  ['created_at', { type: 'timestamp with time zone', nullable: false }],
  ['updated_at', { type: 'timestamp with time zone', nullable: false }],
]);

const requiredIndexes = new Set([
  'advisor_recommendations_clinic_status_idx',
  'advisor_recommendations_review_idx',
]);

async function main() {
  const [tableRows, columns, constraints, indexes, storageRows] = await Promise.all([
    prisma.$queryRawUnsafe("SELECT to_regclass('public.advisor_recommendations')::text AS table_name"),
    prisma.$queryRawUnsafe("SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_schema='public' AND table_name='advisor_recommendations' ORDER BY ordinal_position"),
    prisma.$queryRawUnsafe("SELECT conname, pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid='public.advisor_recommendations'::regclass ORDER BY conname").catch(() => []),
    prisma.$queryRawUnsafe("SELECT indexname, indexdef FROM pg_indexes WHERE schemaname='public' AND tablename='advisor_recommendations' ORDER BY indexname"),
    prisma.$queryRawUnsafe("SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename IN ('advisor_conversations','advisor_messages','advisor_memories','advisor_memory_clinics','advisor_memory_jobs','advisor_audit_events') ORDER BY tablename"),
  ]);

  const tableExists = Boolean(tableRows[0]?.table_name);
  const columnsByName = new Map(columns.map(column => [column.column_name, column]));
  const missingColumns = [];
  const incompatibleColumns = [];
  for (const [name, expected] of requiredColumns) {
    const actual = columnsByName.get(name);
    if (!actual) missingColumns.push(name);
    else if (actual.data_type !== expected.type || (actual.is_nullable === 'YES') !== expected.nullable) {
      incompatibleColumns.push({ column: name, expected, actual: { data_type: actual.data_type, is_nullable: actual.is_nullable } });
    }
  }
  const indexNames = new Set(indexes.map(index => index.indexname));
  const missingIndexes = [...requiredIndexes].filter(name => !indexNames.has(name));
  const definitions = constraints.map(constraint => String(constraint.definition));
  const checks = {
    uuid_primary_key: definitions.some(definition => /PRIMARY KEY \(id\)/i.test(definition)),
    tenant_clinic_foreign_key: definitions.some(definition => /FOREIGN KEY \(tenant_id, clinic_id\).*REFERENCES clinic_configs\(tenant_id, clinic_id\).*ON DELETE CASCADE/i.test(definition)),
    tenant_foreign_key: definitions.some(definition => /FOREIGN KEY \(tenant_id\).*REFERENCES tenants\(id\).*ON DELETE CASCADE/i.test(definition)),
    status_default: String(columnsByName.get('implementation_status')?.column_default ?? '').includes('suggested'),
    baseline_date_check: definitions.some(definition => /baseline_start_date.*baseline_end_date/i.test(definition)),
  };
  const ready = tableExists && !missingColumns.length && !incompatibleColumns.length && !missingIndexes.length && Object.values(checks).every(Boolean) && storageRows.length === 6;
  const result = {
    ready,
    recommendation_table: tableRows[0]?.table_name ?? null,
    existing_advisor_storage_tables: storageRows.map(row => row.tablename),
    missing_columns: missingColumns,
    incompatible_columns: incompatibleColumns,
    missing_indexes: missingIndexes,
    checks,
  };
  console.log(JSON.stringify(result, null, 2));
  if (process.argv.includes('--require-ready') && !ready) process.exitCode = 2;
}

try {
  await main();
} finally {
  await prisma.$disconnect();
}
