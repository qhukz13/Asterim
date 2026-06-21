# Relay & WebSockets

> 43 nodes · cohesion 0.07

## Key Concepts

- **events.ts** (21 connections) — `packages/shared/src/events.ts`
- **RelayClient.ts** (15 connections) — `apps/server/src/services/RelayClient.ts`
- **useSocket.ts** (12 connections) — `apps/web/src/hooks/useSocket.ts`
- **crypto.ts** (10 connections) — `packages/shared/src/crypto.ts`
- **index.ts** (4 connections) — `apps/relay/src/index.ts`
- **index.ts** (4 connections) — `packages/shared/src/index.ts`
- **RelayClient** (4 connections) — `apps/server/src/services/RelayClient.ts`
- **.init()** (4 connections) — `apps/server/src/services/RelayClient.ts`
- **decryptPayload()** (4 connections) — `packages/shared/src/crypto.ts`
- **encryptPayload()** (4 connections) — `packages/shared/src/crypto.ts`
- **generateECDHKeyPair()** (4 connections) — `packages/shared/src/crypto.ts`
- **state.ts** (4 connections) — `packages/shared/src/state.ts`
- **deriveSharedSecret()** (3 connections) — `packages/shared/src/crypto.ts`
- **exportPublicKey()** (3 connections) — `packages/shared/src/crypto.ts`
- **importPublicKey()** (3 connections) — `packages/shared/src/crypto.ts`
- **ApprovalRequestPayload** (3 connections) — `packages/shared/src/events.ts`
- **FileChangedPayload** (3 connections) — `packages/shared/src/events.ts`
- **.constructor()** (2 connections) — `apps/server/src/services/RelayClient.ts`
- **arrayBufferToBase64()** (2 connections) — `packages/shared/src/crypto.ts`
- **base64ToArrayBuffer()** (2 connections) — `packages/shared/src/crypto.ts`
- **AgentStatusPayload** (2 connections) — `packages/shared/src/events.ts`
- **ClientCommandPayload** (2 connections) — `packages/shared/src/events.ts`
- **io** (2 connections) — `apps/relay/src/index.ts`
- **fastify** (1 connections) — `apps/relay/src/index.ts`
- **start()** (1 connections) — `apps/relay/src/index.ts`
- *... and 18 more nodes in this community*

## Relationships

- [[Server Core & Services]] (15 shared connections)
- [[Web Frontend Core]] (2 shared connections)
- [[Authentication & Projects API]] (2 shared connections)

## Source Files

- `apps/relay/src/index.ts`
- `apps/server/src/services/RelayClient.ts`
- `apps/web/src/hooks/useSocket.ts`
- `packages/shared/src/crypto.ts`
- `packages/shared/src/events.ts`
- `packages/shared/src/index.ts`
- `packages/shared/src/state.ts`

## Audit Trail

- EXTRACTED: 137 (100%)
- INFERRED: 0 (0%)
- AMBIGUOUS: 0 (0%)

---

*Part of the graphify knowledge wiki. See [[index]] to navigate.*