import { PrismaClient } from '@prisma/client'

// Singleton Prisma client. Import `db` wherever you need database access.
export const db = new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
})
