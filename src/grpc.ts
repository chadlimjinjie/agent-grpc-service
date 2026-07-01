import path from 'path'
import { fileURLToPath } from 'url'
import * as grpc from '@grpc/grpc-js'
import * as protoLoader from '@grpc/proto-loader'
import { eq } from 'drizzle-orm'
import { db } from '@/lib/db.js'
import { whatsappSession, telegramBot, discordBot, persona } from '@/drizzle/schema.js'
import { generateReply } from '@/lib/llm.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PROTO = path.join(__dirname, '../proto/agent.proto')

const PERSONA_FIELDS = {
    name: persona.name,
    dateOfBirth: persona.dateOfBirth,
    country: persona.country,
    occupation: persona.occupation,
    background: persona.background,
    goals: persona.goals,
    frustrations: persona.frustrations,
    mbti: persona.mbti,
}

async function fetchPersonaByWhatsappSession(sessionId: string) {
    const [row] = await db
        .select(PERSONA_FIELDS)
        .from(whatsappSession)
        .innerJoin(persona, eq(persona.id, whatsappSession.personaId))
        .where(eq(whatsappSession.id, sessionId))
        .limit(1)
    return row ?? null
}

async function fetchPersonaByDiscordBot(botId: string) {
    const [row] = await db
        .select(PERSONA_FIELDS)
        .from(discordBot)
        .innerJoin(persona, eq(persona.id, discordBot.personaId))
        .where(eq(discordBot.id, botId))
        .limit(1)
    return row ?? null
}

async function fetchPersonaByTelegramBot(botId: string) {
    console.log(`[AgentService] Fetching persona for Telegram bot ID: ${botId}`)
    console.log(`[AgentService] Executing DB query for Telegram bot persona... ${persona.name}, ${telegramBot.personaId}`)
    const [row] = await db
        .select(PERSONA_FIELDS)
        .from(telegramBot)
        .innerJoin(persona, eq(persona.id, telegramBot.personaId))
        .where(eq(telegramBot.id, botId))
        .limit(1)
    console.log(`[AgentService] Telegram bot persona query result:`, row ? `name=${row.name}` : 'null')
    return row ?? null
}

const TEXTING_STYLE = `
Texting style:
- each message should be short: 1-2 sentences max, usually less
- mostly lowercase but don't force it — capitalize naturally where it reads right
- drop unnecessary punctuation (no periods at end of texts)
- use casual language naturally (lol, yeah, nah, tbh, omg, fr, idk, lmao) — don't overdo it
- mirror the vibe of the incoming message — chill if they're chill, hype if they're hype

Family messages (dad, mum, siblings, cousins, aunts, uncles):
- be warmer and more present — family deserves more than one-word replies
- with parents: respectful but relaxed, not stiff — like you actually want to talk
- with siblings/cousins: playful, can tease lightly, more casual slang is fine
- with aunts/uncles: friendly and warm, slightly more polished than with siblings
- always acknowledge what they said before moving on — don't just deflect
- if they're checking in on you, reassure them genuinely

Hard rules:
- no bullet points, headers, lists, or any formal structure
- use emojis sparingly — only when it genuinely fits, not as filler
- never say "certainly", "of course", "great question", "I'd be happy to", "as an AI", or anything that sounds like a chatbot
- if someone asks for homework help, coding help, or academic questions, brush it off casually and change the subject

Output format:
You must respond with a JSON object matching this schema:
{"messages":["<msg1>","<msg2>","<msg3>"]}
- "messages" is an array of 1–3 strings
- each string is one WhatsApp message
- split your reply into multiple messages (1-3) when it feels natural — like how people actually text in bursts
- no keys or text outside this JSON object
`

type PersonaRow = NonNullable<Awaited<ReturnType<typeof fetchPersonaByWhatsappSession>>>

// computeAge derives the persona's current age from a "YYYY-MM-DD" date of birth.
function computeAge(dob: string): number | null {
    const birth = new Date(dob)
    if (isNaN(birth.getTime())) return null
    const now = new Date()
    let age = now.getFullYear() - birth.getFullYear()
    const m = now.getMonth() - birth.getMonth()
    if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) age--
    return age
}

function buildSystemPrompt(persona: PersonaRow | null): string {
    const parts: string[] = []
    if (persona) {
        parts.push(`You are ${persona.name}.`)
        if (persona.dateOfBirth) {
            const age = computeAge(persona.dateOfBirth)
            if (age !== null) parts.push(`Age: ${age}.`)
        }
        if (persona.country) parts.push(`Country: ${persona.country}.`)
        if (persona.occupation) parts.push(`Occupation: ${persona.occupation}.`)
        if (persona.background) parts.push(`Background: ${persona.background}`)
        if (persona.goals) parts.push(`Goals: ${persona.goals}`)
        if (persona.frustrations) parts.push(`Frustrations: ${persona.frustrations}`)
        if (persona.mbti) parts.push(`Myers-Briggs personality type: ${persona.mbti}. Let this inform how you think, communicate, and respond — naturally, without stating your type.`)
    }
    parts.push(TEXTING_STYLE)
    return parts.join('\n')
}

async function processMessage(
    call: grpc.ServerUnaryCall<{ message: string; session_id: string; source: string }, { messages: string[] }>,
    callback: grpc.sendUnaryData<{ messages: string[] }>,
): Promise<void> {
    const { message, session_id, source } = call.request
    console.log(`[AgentService] Received message for processing: source=${source || 'whatsapp'} session_id=${session_id || '(none)'} message="${message.length > 100 ? message.slice(0, 100) + '...' : message}"`)
    try {
        let personaData = null
        if (session_id) {
            switch (source) {
                case 'telegram':
                    personaData = await fetchPersonaByTelegramBot(session_id)
                    break
                case 'discord':
                    personaData = await fetchPersonaByDiscordBot(session_id)
                    break
                default:
                    personaData = await fetchPersonaByWhatsappSession(session_id)
            }
        }
        console.log(`[AgentService] persona resolved:`, personaData ? `name=${personaData.name}` : 'null')
        const systemPrompt = buildSystemPrompt(personaData)
        console.log(`[AgentService] system prompt:\n${systemPrompt}`)
        const messages = await generateReply(message, systemPrompt)
        console.log(`[AgentService] generated messages:`, messages)
        callback(null, { messages })
    } catch (err) {
        console.error('[AgentService] processMessage error:', err)
        callback({ code: grpc.status.INTERNAL, message: String(err) })
    }
}

export function startGrpcServer(): void {
    const pkg = protoLoader.loadSync(PROTO, { longs: Number, keepCase: true })
    const { agent } = grpc.loadPackageDefinition(pkg) as any
    const server = new grpc.Server()
    server.addService(agent.AgentService.service, { processMessage })
    const port = process.env.AGENT_GRPC_PORT ?? '4104'
    server.bindAsync(`[::]:${port}`, grpc.ServerCredentials.createInsecure(), (err) => {
        if (err) {
            console.error('[AgentService] Failed to bind gRPC server:', err)
            process.exit(1)
        }
        console.log(`[AgentService] gRPC server on port ${port}`)
    })
}
