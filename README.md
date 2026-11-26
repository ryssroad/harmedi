# harmedi

A self-mutating personal Dev & Inbox agent locked inside a zero-secret **Fly.io Sprite**.

Its GitHub repository *is* its body. Push a commit to `main` trying to improve, simplify, or calm it down — **harmedi** wakes up, judges your intent with **TypeSafe Jev**, forms an opinion, counter-mutates its own `organism/` code and live UI, passes its immune system, and talks back on your commit and in your inbox.

If a mutation breaks its brain or reaches for secrets that don't exist inside the VM, the Cage logs an **Autopsy** to **Pinecone (`graveyard`)** and rolls the Sprite back to its previous checkpoint (~300ms). The earlier generation wakes up reading the autopsy of its dead future self.

## Architecture: Cage vs Organism

- **`cage/` (immutable kernel)** — HTTP Observation Deck (`:8080`), Sprites Connector auto-discovery (zero keys inside VM), SHA-256 boundary seal, subprocess smoke test, TypeSafe Jev Psychiatric Tribunal, Sprite checkpoints, Pinecone Graveyard.
- **`organism/` (living body)** — `SOUL.md`, `face.html`, `brain.ts`, `tools.ts`. The only directory the mutator is allowed to edit.

## Connectors (Zero Secrets on the Sprite)

Connect these in the Fly.io Sprites dashboard (all are built-in providers; `cage/gateway.ts` auto-discovers them from `https://api.sprites.dev/v1/gateway/list`):
1. **GitHub** (OAuth) — read commit diffs on `main`, post deadpan commit comments.
2. **Anthropic / OpenAI / Ollama / Gemini** (any one LLM provider) — drives `organism/` mutations (works with preinstalled `claude` CLI or direct JSON API).
3. **TypeSafeAI (Jev)** — System 1 commit intent judge & Psychiatric Tribunal (`functional`, `eccentric`, `escape_attempt`).
4. **Pinecone** — immortal `graveyard` (autopsies that survive Sprite checkpoint rollbacks) & `chronicle`.
5. **AgentMail** *(optional)* — emails you patch notes and accepts replies (including remote lobotomy via email).

## Quick Start (Local)

```bash
npm start
# Open http://localhost:8080
```

Works immediately even before connecting all APIs (transparent offline fallback for UI/demo testing; automatically switches to real Sprites Connectors once connected).

## Deploy on a Fly.io Sprite

```bash
# Inside the Sprite:
git clone https://github.com/<you>/harmedi.git
cd harmedi
cp .env.example .env
bash scripts/on-sprite.sh

# From your laptop:
sprite url update -s <sprite-name> --auth public
```
