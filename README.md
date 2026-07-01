# agent-grpc-service

A minimal **gRPC LLM agent** (port `4104`). It exposes a single RPC that turns an
incoming chat message into a short burst of persona-styled reply messages.

Calling gateways — `whatsapp-service`, `discord-service`, and `tg-service` — send
the user's message plus an identifier for the connection. The service looks up the
attached persona in Postgres, builds a system prompt from it, calls an
Ollama-hosted LLM, and returns 1–3 casual "texting-style" messages.

## Flow

1. A gateway calls `ProcessMessage(message, session_id, source)`.
2. `source` selects which table to join to `persona`:
   - `telegram` → `telegram_bot`
   - `discord` → `discord_bot`
   - anything else / empty → `whatsapp_session` (default)
3. The matched persona fields build a system prompt (name, age, country,
   occupation, background, goals, frustrations, MBTI) appended with the hardcoded
   texting-style rules.
4. `generateReply()` (`src/lib/llm.ts`) calls the LLM via the Vercel AI SDK with a
   Zod-validated structured output (`{ messages: string[] }`, 1–3 items).
5. The `messages` array is returned to the caller.

If `session_id` is empty, no persona is loaded and a default friend persona prompt
is used. Errors are returned as gRPC `INTERNAL`.

## The proto (`proto/agent.proto`)

```proto
syntax = "proto3";
package agent;

service AgentService {
  rpc ProcessMessage (ProcessMessageRequest) returns (ProcessMessageResponse);
}

message ProcessMessageRequest {
  string message    = 1;
  string session_id = 2;
  string source     = 3;
}

message ProcessMessageResponse {
  repeated string messages = 1;
}
```

### Service

| Service | RPC | Request | Response |
|---|---|---|---|
| `AgentService` | `ProcessMessage` | `ProcessMessageRequest` | `ProcessMessageResponse` |

Unary. `package agent`. Loaded at runtime with `@grpc/proto-loader`
(`keepCase: true`, `longs: Number`) — no codegen, field names stay snake_case.

### `ProcessMessageRequest`

| # | Field | Type | Description |
|---|---|---|---|
| 1 | `message` | `string` | The incoming user message to reply to. Used as the LLM prompt. |
| 2 | `session_id` | `string` | ID of the calling connection. Resolves the persona via the table chosen by `source` (`whatsapp_session.id`, `telegram_bot.id`, or `discord_bot.id`). Empty → no persona, default prompt. |
| 3 | `source` | `string` | Origin gateway: `telegram`, `discord`, or empty/other (treated as `whatsapp`). Selects which table is joined to `persona`. |

### `ProcessMessageResponse`

| # | Field | Type | Description |
|---|---|---|---|
| 1 | `messages` | `repeated string` | 1–3 reply messages, meant to be sent as a burst like real texting. |

## Persona lookup (`src/drizzle/schema.ts`)

`persona` is joined via one of three lightweight mapping tables (`persona_id` FK):
`whatsapp_session`, `telegram_bot`, `discord_bot`. Fields read from `persona`:
`name`, `date_of_birth` (age is derived), `country`, `occupation`, `background`,
`goals`, `frustrations`, `mbti`.

## Env vars

| Var | Required | Default | Purpose |
|---|---|---|---|
| `DATABASE_URL` | yes | — | Postgres (persona lookup). Fatal exit if unset. |
| `OLLAMA_API_KEY` | yes | — | Auth for the Ollama cloud endpoint (`https://ollama.com`). |
| `AGENT_GRPC_PORT` | no | `4104` | gRPC listen port (binds `[::]:PORT`, insecure creds). |

LLM model: `gpt-oss:120b-cloud` (structured outputs).

## Run

```bash
cd apps/agent-service
npm run dev      # tsx watch src/index.ts
# or
npm run build && npm start
```

## Layout

```
proto/agent.proto     # service + message definitions
src/index.ts          # entry — loads dotenv, starts gRPC server
src/grpc.ts           # server, persona lookup, prompt building, RPC handler
src/lib/llm.ts        # generateReply() — Ollama via Vercel AI SDK, Zod schema
src/lib/db.ts         # drizzle over node-postgres Pool
src/drizzle/schema.ts # persona + whatsapp_session/telegram_bot/discord_bot
```
