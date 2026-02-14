# 🏛️ OpenLares

A visual interactive platform for AI agent personas, built on [OpenClaw](https://github.com/openclaw/openclaw).

Give your AI agents a face, a personality, and a home.

> **Status:** Early development — not ready for use yet.

## Why "Lares"?

In ancient Rome, [Lares](https://en.wikipedia.org/wiki/Lares) were guardian spirits of the household — protectors that watched over the home and family. OpenLares brings that idea into the digital age: personal AI companions that watch over your digital life.

## What is OpenLares?

OpenLares connects to an [OpenClaw](https://openclaw.ai) Gateway and provides a visual interface for your AI agents. Watch them work in real-time, customize their personalities, and interact with them through an animated workspace.

- 🎭 **Animated avatars** — your agents get a visual presence
- ⚡ **Real-time activity feed** — see what your agents are doing as it happens
- 🎨 **Personality editor** — customize how your agents think and behave
- 🔌 **WebSocket-powered** — connects to any OpenClaw Gateway instance

## Tech Stack

- **Framework:** Next.js 15 + React 19
- **Language:** TypeScript
- **Visual Engine:** PixiJS 8 (2D WebGL)
- **Styling:** Tailwind CSS 4
- **State:** Zustand
- **Monorepo:** Turborepo + pnpm

## Project Structure

```
packages/
├── core/          # Shared types, interfaces, event bus
├── api-client/    # OpenClaw Gateway communication (WebSocket + REST)
├── ui/            # React UI components
├── game-engine/   # PixiJS rendering layer (avatars, animations)
└── app/           # Next.js app (ties everything together)
```

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) 22+
- [pnpm](https://pnpm.io/) 10+

### Development

```bash
# Clone the repo
git clone https://github.com/openlares/openlares.git
cd openlares

# Install dependencies
pnpm install

# Start dev server
pnpm dev
```

The app will be available at `http://localhost:3000`.

### Commands

| Command          | Description               |
| ---------------- | ------------------------- |
| `pnpm dev`       | Start development server  |
| `pnpm build`     | Production build          |
| `pnpm lint`      | Run ESLint                |
| `pnpm test`      | Run tests                 |
| `pnpm typecheck` | TypeScript type checking  |
| `pnpm format`    | Format code with Prettier |

## Contributing

OpenLares is in early development. Contribution guidelines will be added once the project stabilizes.

## License

[BSL 1.1](LICENSE) — free for personal, educational, and non-commercial use. Converts to Apache 2.0 after 4 years per version.
