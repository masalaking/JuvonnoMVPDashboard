// Prisma Client singleton for the production RivaCare database (tenants,
// clinic_configs, users, user_clinic_access, ...). This is the ONLY place
// the dashboard server talks to Postgres directly - everything else
// (calls, invoices, payment recovery data) still flows through n8n's
// webhooks per the RivaCare architecture, since n8n owns writing that data.
// Direct DB access here is scoped to authentication, clinic membership, and
// narrowly defined read-only dashboard billing summaries. Mutating business
// operations continue to flow through n8n, which owns those integrations.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
