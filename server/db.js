// Prisma Client singleton for the production RivaCare database (tenants,
// clinic_configs, users, user_clinic_access, ...). This is the ONLY place
// the dashboard server talks to Postgres directly - everything else
// (calls, invoices, payment recovery data) still flows through n8n's
// webhooks per the RivaCare architecture, since n8n owns writing that data.
// Direct DB access here is scoped to authentication and clinic membership,
// which have no n8n webhook of their own.
import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();
