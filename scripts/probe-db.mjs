import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

try {
  await prisma.$queryRawUnsafe('SELECT 1 AS database_connection_ok');
  console.log(JSON.stringify({ database_connection_ok: true }));
} catch (error) {
  console.log(JSON.stringify({
    database_connection_ok: false,
    code: error?.code ?? null,
    message: String(error?.message ?? error).split('\n')[0],
  }));
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
