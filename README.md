# Bradd RDT

A Web-based remote desktop application.

## Structure
- `packages/server`: Node.js + Express + Socket.io Server.
- `packages/web`: React + Vite Frontend.
- `packages/client`: Node.js Client Agent (compiles to EXE).

## Prerequisites
- Node.js (v18+)
- .NET Framework 4.0+ (for InputHelper)

## Setup
1. `npm install` in root.

## Running Development
1. **Server**: `npm run dev --workspace=packages/server` (Port 3000)
2. **Web**: `npm run dev --workspace=packages/web` (Port 5173/5174)
3. **Client**:
   - `cd packages/client`
   - `npx ts-node src/index.ts` (Connects to localhost:3000)

## Building Client EXE
To create the standalone client executable:
1. `cd packages/client`
2. `npm run build`
3. The `.exe` will be in `packages/client/build/`.

## Configuration
- Server URL is currently defaulted to `http://localhost:3000`.
- To change it for the built client, modify `packages/client/src/index.ts` or set `SERVER_URL` env var before building.
