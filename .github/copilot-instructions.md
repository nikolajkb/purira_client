# Purira AI Companion - AI Coding Guidelines

## Architecture Overview
Purira is a client-server desktop AI chat app:
- **Client** (`purira_client/`): Tauri + SvelteKit frontend for UI and screenshot capture
- **Server** (`purira/`): Axum HTTP server for OpenAI integration and history storage

## Key Patterns & Conventions

### Message Handling
- Assistant responses are **split into 1-4 messages** with varying counts (never repeat previous count)
- Use `Message::assistant_multiple()` for responses, `Message::user()` for input
- **Rollback on error**: Remove failed messages from history using `remove_last_n_messages()`

### AI Integration (`purira/src/services/gpt.rs`)
- Use OpenAI Responses API (not Chat Completions) with GPT-5.1
- Structured JSON responses with mood and message array
- Enrich system prompt with temporal context and variance reminders
- Schema: `{"mood": "excited|normal|...", "messages": ["msg1", "msg2"]}`

### Screenshot Flow
- Tauri captures multi-monitor screenshots (`invoke('take_screenshot')`)
- Send base64 images to `/api/screenshot` endpoint
- AI describes images then reacts conversationally

### Authentication
- Bearer token auth on all API endpoints except `/health`
- Client loads config from `static/config.json` (serverUrl, apiKey)
- Server uses `SERVER_API_KEY` env var

### Data Storage
- History: JSON in `data/history.json` (auto-created)
- Uploads: `data/uploads/` directory
- Docker: Mount `./data` volume for persistence

### Avatar System
- Mood-based avatars: `/avatar/{mood}.png` or `/{mood}_a.mp4`
- Check animated version availability with HEAD request
- Update mood from assistant message metadata

## Development Workflows

### Server Development
```bash
cd purira
cp .env.example .env  # Set OPENAI_API_KEY, SERVER_API_KEY
cargo run            # Runs on :3000
```

### Client Development  
```bash
cd purira_client
cp static/config.example.json static/config.json  # Set serverUrl, apiKey
npm install
npm run tauri dev   # Full desktop app
```

### Building
```bash
# Server
cd purira && cargo build --release

# Client
cd purira_client && npm run tauri build
```

### Docker Deployment
```bash
cd purira && docker-compose up --build
```

## Common Tasks

### Adding New API Endpoint
1. Add handler in `purira/src/api/`
2. Register route in `main.rs` with auth middleware
3. Update `purira_client/src/lib/api.ts` client method

### Modifying AI Behavior
- Edit system prompt in `purira/system.txt`
- Adjust response schema in `gpt.rs::response_schema()`
- Update mood enums in frontend and backend

### Adding New Mood
1. Add to mood enum in `gpt.rs::response_schema()`
2. Add avatar files: `purira_client/static/avatar/{mood}.png`
3. Optional: `/{mood}_a.mp4` for animation

## File References
- **Main Server**: `purira/src/main.rs`
- **API Client**: `purira_client/src/lib/api.ts`  
- **Chat UI**: `purira_client/src/routes/+page.svelte`
- **AI Service**: `purira/src/services/gpt.rs`
- **Message Model**: `purira/src/models/message.rs`