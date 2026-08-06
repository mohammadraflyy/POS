import path from 'node:path'
import bcrypt from 'bcryptjs'
import { createDb } from './migrate'
import { users } from './schema'

const dbPath = path.resolve(process.cwd(), 'dev.sqlite')
const migrationsFolder = path.resolve(process.cwd(), 'drizzle')
const db = createDb(dbPath, migrationsFolder)

const passwordHash = bcrypt.hashSync('password', 10)
const now = new Date()

db.insert(users)
  .values({
    username: 'admin',
    passwordHash,
    name: 'Admin',
    createdAt: now,
    updatedAt: now,
  })
  .run()

console.log('Seeded user "admin" with password "password" into dev.sqlite')
