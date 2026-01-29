# Purira

AI-powered desktop chat application with screenshot capabilities, built with Tauri, SvelteKit, and a Rust backend server.

## Architecture

Purira uses a client-server architecture:
- **Client**: Tauri desktop app with SvelteKit UI (handles screenshots and user interface)
- **Server**: Rust/Axum HTTP server (handles AI integration, history, and storage)

See [ARCHITECTURE.md](ARCHITECTURE.md) for detailed documentation.

## Quick Start

### Prerequisites
- Rust 1.70+ (for both client and server)
- Node.js 18+
- OpenAI API key

### 1. Start the Server

```bash
cd server
cp .env.example .env
# Edit .env and set your OPENAI_API_KEY
cargo run
```

Server will start on `http://localhost:3000`

### 2. Configure the Client

```bash
cp static/config.example.json static/config.json
# Edit static/config.json and set serverUrl and apiKey
```

Example `static/config.json`:
```json
{
  "serverUrl": "http://localhost:3000",
  "apiKey": "dev-key"
}
```

### 3. Run the Client

```bash
npm install
npm run tauri dev
```

## Development

### Server Development
```bash
cd server
cargo run          # Run in development mode
cargo build --release  # Build for production
```

### Client Development
```bash
npm run dev        # Run Vite dev server only
npm run tauri dev  # Run full Tauri app
npm run build      # Build frontend for production
npm run tauri build  # Build complete Tauri app
```

## Docker Deployment

```bash
cd server
docker-compose up --build
```

This starts the server in a container with persistent storage volumes.

## Features

- **AI Chat**: Natural language conversations with GPT-4
- **Screenshot Integration**: Capture and describe screenshots with GPT-4 Vision
- **Chat History**: Persistent conversation history stored server-side
- **Multi-Monitor Support**: Captures all connected displays
- **RESTful API**: Clean HTTP API for extensibility
- **Bearer Token Auth**: Secure API authentication

## Project Structure

```
purira/
├── src/                    # SvelteKit frontend
│   ├── routes/
│   │   └── +page.svelte   # Main chat UI
│   └── lib/
│       └── api.ts         # HTTP API client
├── src-tauri/             # Tauri desktop app
│   └── src/
│       ├── lib.rs         # Screenshot command
│       └── io.rs          # Screenshot capture
├── server/                # Rust backend server
│   └── src/
│       ├── main.rs        # Server entry point
│       ├── api/           # HTTP endpoints
│       ├── services/      # Business logic
│       └── middleware/    # Auth middleware
└── static/
    └── config.json        # Client configuration (gitignored)
```

## API Endpoints

- `GET /health` - Health check
- `POST /api/chat` - Send text messages
- `POST /api/screenshot` - Upload screenshots for description
- `GET /api/history` - Retrieve chat history

All endpoints except `/health` require Bearer token authentication.

## Environment Variables

### Server (.env)
- `OPENAI_API_KEY` - Your OpenAI API key (required)
- `SERVER_API_KEY` - Bearer token for API authentication (default: "dev-key")
- `DATA_DIR` - Directory for history storage (default: "./data")
- `UPLOADS_DIR` - Directory for screenshot storage (default: "./uploads")

### Client (static/config.json)
- `serverUrl` - Backend server URL (default: "http://localhost:3000")
- `apiKey` - Bearer token matching server's SERVER_API_KEY

## Recommended IDE Setup

[VS Code](https://code.visualstudio.com/) + [Svelte](https://marketplace.visualstudio.com/items?itemName=svelte.svelte-vscode) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## License

MIT
