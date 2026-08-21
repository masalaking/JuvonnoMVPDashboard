#!/usr/bin/env node
// Multi-clinic provisioning CLI (multi-clinic-prompt.md §4). Talks directly
// to Prisma/Postgres - never through n8n or the dashboard API - since this
// is an operator tool for setting up tenants/clinics/users/access, not
// something the frontend or n8n ever calls.
//
// Usage: npm run clinics -- <command> [--flag value ...]
//
//   list-clinics [--tenant <tenantId>]
//   create-clinic --tenant <tenantId> --clinic-id <clinicId> --name <clinicName>
//                 [--client-id <clientId>] [--timezone <tz>] [--status <status>]
//   create-user --tenant <tenantId> --username <username> --password <password>
//   grant --username <username> --tenant <tenantId> --clinic <clinicId> [--role <role>]
//   revoke --username <username> --tenant <tenantId> --clinic <clinicId>
//   list-access --tenant <tenantId> [--username <username>]
import bcrypt from 'bcryptjs';
import { prisma } from '../server/db.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith('--')) {
      out[key] = true;
    } else {
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function requireArg(args, key) {
  const value = args[key];
  if (value === undefined || value === true) {
    throw new Error(`--${key} is required`);
  }
  return String(value);
}

// tenants isn't provisioned by this CLI (no --tenant-name flag) - a clinic
// can't exist without one, so this upserts a minimal row (defaults for
// name/status/timezone) the first time a tenant id is used, rather than
// requiring a separate provisioning step for something this CLI's own
// callers don't otherwise need to configure.
async function ensureTenant(tenantId) {
  await prisma.tenants.upsert({
    where: { id: tenantId },
    update: {},
    create: { id: tenantId, slug: tenantId, name: tenantId },
  });
}

async function findUserByUsername(username) {
  const user = await prisma.users.findUnique({ where: { username } });
  if (!user) throw new Error(`No user found with username "${username}"`);
  return user;
}

async function listClinics(args) {
  const where = args.tenant ? { tenant_id: String(args.tenant) } : {};
  const clinics = await prisma.clinic_configs.findMany({ where, orderBy: { clinic_name: 'asc' } });
  if (clinics.length === 0) { console.log('No clinics found.'); return; }
  for (const c of clinics) {
    console.log(`${c.tenant_id}\t${c.clinic_id}\t${c.clinic_name ?? '(unnamed)'}\t${c.status}\t${c.timezone ?? ''}`);
  }
}

async function createClinic(args) {
  const tenantId = requireArg(args, 'tenant');
  const clinicId = requireArg(args, 'clinic-id');
  const clinicName = requireArg(args, 'name');
  const clientId = args['client-id'] ? String(args['client-id']) : clinicId;
  const timezone = args.timezone ? String(args.timezone) : 'America/Toronto';
  const status = args.status ? String(args.status) : 'active';

  await ensureTenant(tenantId);
  const clinic = await prisma.clinic_configs.upsert({
    where: { tenant_id_clinic_id: { tenant_id: tenantId, clinic_id: clinicId } },
    update: { clinic_name: clinicName, timezone, status },
    create: { tenant_id: tenantId, clinic_id: clinicId, client_id: clientId, clinic_name: clinicName, timezone, status },
  });
  console.log(`Created/updated clinic ${clinic.clinic_id} ("${clinic.clinic_name}") under tenant ${clinic.tenant_id}.`);
}

async function createUser(args) {
  const tenantId = requireArg(args, 'tenant');
  const username = requireArg(args, 'username');
  const password = requireArg(args, 'password');
  await ensureTenant(tenantId);
  const password_hash = await bcrypt.hash(password, 12);
  const user = await prisma.users.create({ data: { tenant_id: tenantId, username, password_hash } });
  console.log(`Created user "${user.username}" (id ${user.id}) under tenant ${tenantId}.`);
  console.log('Grant clinic access next with: npm run clinics -- grant --username ' + username + ' --tenant ' + tenantId + ' --clinic <clinicId> --role <role>');
}

async function grant(args) {
  const tenantId = requireArg(args, 'tenant');
  const clinicId = requireArg(args, 'clinic');
  const username = requireArg(args, 'username');
  const role = args.role ? String(args.role) : 'viewer';
  const user = await findUserByUsername(username);
  if (user.tenant_id !== tenantId) {
    throw new Error(`User "${username}" belongs to tenant ${user.tenant_id}, not ${tenantId} - one login belongs to exactly one tenant.`);
  }
  const clinic = await prisma.clinic_configs.findUnique({
    where: { tenant_id_clinic_id: { tenant_id: tenantId, clinic_id: clinicId } },
  });
  if (!clinic) throw new Error(`No clinic "${clinicId}" found under tenant ${tenantId} - create it first with create-clinic.`);
  await prisma.user_clinic_access.upsert({
    where: { user_id_tenant_id_clinic_id: { user_id: user.id, tenant_id: tenantId, clinic_id: clinicId } },
    update: { role },
    create: { user_id: user.id, tenant_id: tenantId, clinic_id: clinicId, role },
  });
  console.log(`Granted "${username}" ${role} access to clinic ${clinicId} (tenant ${tenantId}).`);
}

async function revoke(args) {
  const tenantId = requireArg(args, 'tenant');
  const clinicId = requireArg(args, 'clinic');
  const username = requireArg(args, 'username');
  const user = await findUserByUsername(username);
  await prisma.user_clinic_access.delete({
    where: { user_id_tenant_id_clinic_id: { user_id: user.id, tenant_id: tenantId, clinic_id: clinicId } },
  }).catch(() => {
    throw new Error(`"${username}" doesn't currently have access to clinic ${clinicId} (tenant ${tenantId}).`);
  });
  console.log(`Revoked "${username}"'s access to clinic ${clinicId} (tenant ${tenantId}).`);
}

async function listAccess(args) {
  const tenantId = requireArg(args, 'tenant');
  const where = { tenant_id: tenantId };
  if (args.username) {
    const user = await findUserByUsername(String(args.username));
    where.user_id = user.id;
  }
  const rows = await prisma.user_clinic_access.findMany({
    where,
    include: { users: true, clinic_configs: true },
    orderBy: [{ users: { username: 'asc' } }, { clinic_id: 'asc' }],
  });
  if (rows.length === 0) { console.log('No access grants found.'); return; }
  for (const r of rows) {
    console.log(`${r.users.username}\t${r.clinic_configs?.clinic_name ?? r.clinic_id}\t${r.role}`);
  }
}

const COMMANDS = {
  'list-clinics': listClinics,
  'create-clinic': createClinic,
  'create-user': createUser,
  grant,
  revoke,
  'list-access': listAccess,
};

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  const handler = COMMANDS[command];
  if (!handler) {
    console.error(`Unknown command "${command ?? ''}". Available: ${Object.keys(COMMANDS).join(', ')}`);
    process.exitCode = 1;
    return;
  }
  const args = parseArgs(rest);
  await handler(args);
}

main()
  .catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
