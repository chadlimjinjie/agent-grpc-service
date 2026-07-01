import { pgTable, text, date } from 'drizzle-orm/pg-core'

export const persona = pgTable('persona', {
    id: text().primaryKey().notNull(),
    name: text().notNull(),
    dateOfBirth: date('date_of_birth'),
    country: text(),
    occupation: text(),
    background: text(),
    goals: text(),
    frustrations: text(),
    mbti: text(),
})

export const whatsappSession = pgTable('whatsapp_session', {
    id: text().primaryKey().notNull(),
    personaId: text('persona_id').references(() => persona.id),
})

export const telegramBot = pgTable('telegram_bot', {
    id: text().primaryKey().notNull(),
    personaId: text('persona_id').references(() => persona.id),
})

export const discordBot = pgTable('discord_bot', {
    id: text().primaryKey().notNull(),
    personaId: text('persona_id').references(() => persona.id),
})
