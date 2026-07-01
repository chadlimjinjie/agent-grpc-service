import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import * as schema from '../drizzle/schema.js'

if (!process.env.DATABASE_URL) {
    console.error('[AgentService] FATAL: DATABASE_URL is not set')
    process.exit(1)
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
export const db = drizzle(pool, { schema })
