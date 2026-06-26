# SocraticDS — Adaptive Socratic DSA Tutor

An AI-powered Socratic tutoring system for Data Structures & Algorithms, built with **Gemini 2.5 Flash**, **LangGraph**, **FastAPI**, and **React**.

Instead of giving answers, SocraticDS guides students through structured questioning — adapting in real-time to their reasoning level, detecting misconceptions, and building a persistent cognitive profile across sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                                            │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────────┐ │
│  │  Problem   │ │   Code   │ │   Tutor   │ │  Visualizations      │ │
│  │  Panel     │ │  Editor  │ │   Chat    │ │  (Canvas Animations) │ │
│  │           │ │ (Monaco) │ │  (SSE)    │ │  Trie / BFS / DFS... │ │
│  └───────────┘ └──────────┘ └───────────┘ └──────────────────────┘ │
│       │             │             │               │                 │
│  ┌────┴─────────────┴─────────────┴───────────────┴─────────────┐  │
│  │        Zustand Store (sessionStore + authStore)                │  │
│  │        grounding · calibration · signals · messages           │  │
│  └──────────────────────────┬────────────────────────────────────┘  │
│                              │ SSE + REST                           │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
┌──────────────────────────────┼──────────────────────────────────────┐
│  Backend (FastAPI)           │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                       API Routers                              │  │
│  │  /api/tutor/stream  /api/hints  /api/execute  /api/sessions   │  │
│  │  /api/problems/parse          /api/notes                      │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                 LangGraph Pipeline (6 nodes)                   │  │
│  │  build_context → generate_response → parse_tags →             │  │
│  │           check_grounding_drift → persist_data                │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │                      Services Layer                            │  │
│  │  grounding          socratic_prompt     calibration            │  │
│  │  session_manager    tag_parser          problem_ai_parser      │  │
│  │  student_context    profile_aggregator  note_generator         │  │
│  │  problem_fetcher    reflection_evaluator                      │  │
│  └───────────────────────────┬───────────────────────────────────┘  │
│                              │                                      │
│  ┌───────────────────────────▼───────────────────────────────────┐  │
│  │           Supabase (PostgreSQL + Auth + RLS)                   │  │
│  │  sessions  messages  reflections  notes  misconceptions       │  │
│  │  mastery_events  solved_problems  student_profiles            │  │
│  └───────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────────┘
```

## Key Features

### Problem Grounding Engine

The core innovation that prevents tutor hallucinations over long conversations.

```
User submits problem
       │
       ▼
Problem Parser (text / image / URL)
       │
       ▼
Grounding Extractor (Gemini, temperature=0)
       │
       ▼
Structured Grounding JSON
       │
       ├────────► Stored in DB (per-session)
       │
       ▼
Every tutor prompt includes:
   • Grounding JSON (authoritative problem knowledge)
   • Student Grounding (dynamic per-session state)
   • Student Profile (cross-session cognitive model)
   • Current Code + Conversation Summary
```

**What the grounding extracts:**
- `objective` — one-sentence problem goal
- `core_concepts` — DSA patterns (Sliding Window, Trie, etc.)
- `key_invariants` — what must hold at every algorithm step
- `hidden_tricks` — non-obvious insights for efficient solutions
- `common_misconceptions` — predicted student mistakes (specific to this problem)
- `edge_cases` — boundary conditions that break naive solutions
- `optimal_complexity` — target time/space complexity

**Drift detection:** After every tutor response, a separate Gemini call checks for factual contradictions against the grounding. Conflicts are logged for observability.

**Dynamic student state:** Tracks per-session which misconceptions were triggered, which concepts were mastered, and what the student is still confused about — injected into every prompt.

### Socratic Tutoring Engine
- **Never gives answers directly** — guides through structured questioning
- **Real-time calibration** — adapts scaffolding based on reasoning quality, frustration, and confusion signals
- **Loop detection** — automatically breaks question loops after 2 rephrases
- **Frustration protocol** — overrides Socratic mode when student is stuck/frustrated
- **Mathematical claim protocol** — verifies claims with concrete examples before challenging

### Adaptive Learning
- **4-level hint ladder** — Conceptual → Directional → Structural → Code-Level
- **Prerequisite gap detection** — pauses the current problem to teach missing foundations
- **Pattern mastery tracking** — recognition → application → generalisation per DSA pattern
- **Cross-session cognitive profile** — persistent student model with weakness fingerprints

### Interactive Visualizations
Animated canvas-based visualizations triggered automatically by the tutor or from problem grounding:

| Visualization | Trigger |
|--------------|---------|
| Sliding Window | `[TRIGGER_VISUALIZATION: sliding_window]` |
| Two Pointers | `[TRIGGER_VISUALIZATION: two_pointers]` |
| BFS Traversal | `[TRIGGER_VISUALIZATION: bfs]` |
| DFS Traversal | `[TRIGGER_VISUALIZATION: dfs]` |
| Stack Operations | `[TRIGGER_VISUALIZATION: stack]` |
| Recursion Tree | `[TRIGGER_VISUALIZATION: recursion]` |
| Binary Trie | `[TRIGGER_VISUALIZATION: trie]` |

Visualizations are also auto-triggered from the grounding engine's `core_concepts` when a problem is loaded.

### Code Execution
- **Integrated code editor** (Monaco) with syntax highlighting
- **Backend code execution** via `/api/execute` endpoint
- **Input/output panel** for testing with custom inputs

### Post-Session Intelligence
- **AI-generated study notes** — categorised as mistake / technique / insight / pattern
- **Reflection quality evaluation** — rates student reflections as surface / structural / transferable
- **Solved problem logging** — tracks strategy used, key mistakes, mastery level
- **Spaced repetition alerts** — flags patterns not seen in 7+ days

### Voice Mode
- **Speech-to-text input** — students can speak their reasoning
- **Optimised voice prompts** — short bursts, natural pauses, conversational rhythm
- **STT noise handling** — extracts semantic intent from garbled transcriptions

### Technical
- **Streaming SSE** — real-time token-by-token tutor responses
- **Gemini 2.5 Flash** with automatic fallback to gemini-1.5-flash on rate limits
- **JWT auth** — supports both HS256 (legacy) and ES256 (JWKS) Supabase tokens
- **LangGraph state machine** — deterministic 6-node pipeline with typed state

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Zustand, Monaco Editor, CSS Modules |
| Backend | Python 3.11+, FastAPI, LangGraph, LangChain |
| AI | Google Gemini 2.5 Flash (primary), Gemini 1.5 Flash (fallback/drift check) |
| Database | Supabase (PostgreSQL), Row Level Security |
| Auth | Supabase Auth (email/password), JWT verification |

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key
- A [Supabase](https://supabase.com/) project (free tier works)

### 1. Database Setup

Run the schema and migrations in your Supabase SQL Editor:

```sql
-- 1. Run the base schema
-- Copy contents of backend/schema.sql into Supabase SQL Editor and run

-- 2. Run migrations (in order)
-- backend/migrations/add_calibration_state.sql
-- backend/migrations/add_cognitive_profile.sql
-- backend/migrations/002_audit_fixes.sql
-- backend/migrations/003_problem_grounding.sql
```

### 2. Backend

```bash
cd backend

# Create virtual environment
python -m venv venv
venv\Scripts\activate  # Windows
# source venv/bin/activate  # macOS/Linux

# Install dependencies
pip install -r requirements.txt

# Configure environment
cp .env.example .env
# Edit .env with your keys:
#   GEMINI_API_KEY=your-gemini-api-key
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_KEY=your-anon-key

# Start server
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Configure environment
cp .env.example .env  # or create .env with:
#   VITE_API_URL=http://localhost:8000
#   VITE_SUPABASE_URL=https://your-project.supabase.co
#   VITE_SUPABASE_ANON_KEY=your-anon-key

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── config.py                  # Pydantic settings
│   │   ├── main.py                    # FastAPI app factory
│   │   ├── graph/
│   │   │   ├── state.py               # LangGraph typed state (TutorState, HintState)
│   │   │   ├── nodes.py               # Pipeline nodes (6 stages)
│   │   │   ├── tutor_graph.py         # Main tutoring graph
│   │   │   └── hint_graph.py          # Hint generation graph
│   │   ├── middleware/
│   │   │   └── auth.py                # JWT verification (HS256 + ES256/JWKS)
│   │   ├── models/                    # Pydantic request/response models
│   │   ├── routers/
│   │   │   ├── tutor.py               # SSE streaming + grounding extraction
│   │   │   ├── problems.py            # Problem parsing (text/image/URL)
│   │   │   ├── execute.py             # Code execution endpoint
│   │   │   ├── hints.py               # Hint ladder endpoint
│   │   │   ├── sessions.py            # Session management
│   │   │   └── notes.py               # Study notes endpoint
│   │   └── services/
│   │       ├── grounding.py               # Problem Grounding Engine
│   │       ├── socratic_prompt.py         # System prompt + context builder
│   │       ├── calibration.py             # Real-time dialogue calibration
│   │       ├── session_manager.py         # Session CRUD + grounding persistence
│   │       ├── problem_ai_parser.py       # AI problem extraction (text/image)
│   │       ├── problem_fetcher.py         # LeetCode problem fetcher
│   │       ├── note_generator.py          # AI study note generation
│   │       ├── reflection_evaluator.py    # Reflection quality scoring
│   │       ├── profile_aggregator.py      # Cross-session cognitive profile
│   │       ├── student_context.py         # Context injection from profile
│   │       └── tag_parser.py              # Structured tag extraction
│   ├── schema.sql                     # Full database schema
│   └── migrations/                    # Schema migration scripts
│       ├── add_calibration_state.sql
│       ├── add_cognitive_profile.sql
│       ├── 002_audit_fixes.sql
│       └── 003_problem_grounding.sql
│
└── frontend/
    └── src/
        ├── api/                       # Backend API client layer
        │   ├── tutor.js               # SSE stream handler (chunks, tags, grounding)
        │   ├── notes.js               # Study notes API
        │   └── client.js              # Auth-aware fetch wrapper
        ├── components/
        │   ├── TutorChat.jsx          # Chat panel with streaming + grounding
        │   ├── ProblemPanel.jsx       # Problem input (number/text/image)
        │   ├── EditorPanel.jsx        # Monaco code editor + execution
        │   ├── VisualizationPanel.jsx # 7 animated visualizations
        │   ├── VoiceMode.jsx          # Speech-to-text interface
        │   ├── HintLadder.jsx         # 4-level hint system
        │   ├── ReflectionModal.jsx    # Post-session reflection
        │   ├── Header.jsx             # App header + auth
        │   └── BottomBar.jsx          # Status bar
        ├── hooks/
        │   └── useVoiceInput.js       # Web Speech API hook
        ├── lib/
        │   └── supabase.js            # Supabase client
        ├── store/
        │   ├── sessionStore.js        # Session state (grounding, signals, messages)
        │   └── authStore.js           # Auth state (JWT, user profile)
        └── styles/                    # Global CSS + design tokens
```

## Tutoring Pipeline

```
Student sends message
       │
       ▼
┌─────────────────────┐
│   build_context      │  Loads grounding JSON, student profile,
│                      │  calibration state, and conversation history.
│                      │  Injects grounding as AUTHORITATIVE block.
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│  generate_response   │  Calls Gemini with system prompt + grounding
│                      │  context + full conversation. Streams tokens
│                      │  via SSE to frontend.
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│    parse_tags        │  Extracts [MISCONCEPTION], [MASTERY],
│                      │  [CALIBRATION], [TRIGGER_VISUALIZATION],
│                      │  [PROBLEM_SOLVED]. Updates calibration.
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│ check_grounding_     │  Compares tutor response against grounded
│ drift                │  problem facts. Logs any contradictions.
└──────────┬──────────┘
           ▼
┌─────────────────────┐
│   persist_data       │  Saves tutor message, misconceptions,
│                      │  mastery events, calibration, and
│                      │  student grounding state to DB.
└─────────────────────┘
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tutor/stream` | SSE stream of Socratic tutor response (includes grounding) |
| POST | `/api/hints` | Generate next hint in the 4-level ladder |
| POST | `/api/problems/parse` | Parse problem from number/URL/title/image |
| POST | `/api/execute` | Execute student code with custom input |
| POST | `/api/sessions/{id}/reflect` | Save reflection + trigger AI evaluation |
| GET | `/api/sessions/student/me` | List authenticated student's sessions |
| GET | `/api/notes/me` | Get AI-generated study notes |
| GET | `/health` | Health check |

## SSE Event Types

The `/api/tutor/stream` endpoint sends these Server-Sent Events:

| Event Type | Payload | Description |
|------------|---------|-------------|
| `chunk` | `{ content }` | Streamed text token from Gemini |
| `tags` | `{ misconceptions, mastery, vizTriggers, problemSolved }` | Structured tags extracted from response |
| `grounding` | `{ grounding }` | Problem grounding JSON (first message or on load) |
| `error` | `{ message }` | Error message |
| `done` | `{ sessionId }` | Stream complete, includes session ID |

## License

MIT
