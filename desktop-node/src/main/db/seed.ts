import bcrypt from 'bcryptjs'
import { eq } from 'drizzle-orm'
import { users } from './schema'

export function seedDefaultAdmin(db: any) {
  const existingAdmin = db
    .select()
    .from(users)
    .where(eq(users.username, 'admin'))
    .get()

  if (existingAdmin) {
    return
  }

  const passwordHash = bcrypt.hashSync('admin', 10)
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

  console.log('Default admin account created')
}