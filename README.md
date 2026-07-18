# SocraticDS — Adaptive Socratic DSA Tutor

An AI-powered Socratic tutoring system for Data Structures & Algorithms, built with **Gemini 2.5 Flash**, **LangGraph**, **FastAPI**, and **React**.

Instead of giving answers, SocraticDS guides students through structured questioning — adapting in real-time to their reasoning level, detecting misconceptions, and building a persistent cognitive profile across sessions.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Frontend (React 19 + Vite 8)                                           │
│  ┌───────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────────────┐ │
│  │  Problem   │ │   Code   │ │   Tutor   │ │  Algorithm Visualizations │ │
│  │  Panel     │ │  Editor  │ │   Chat    │ │  (7 Canvas Animations)    │ │
│  │           │ │ (Monaco) │ │  (SSE)    │ │  Trie / BFS / DFS / ...  │ │
│  └───────────┘ └──────────┘ └───────────┘ └──────────────────────────┘ │
│                                                                         │
│  ┌────────────────┐  ┌──────────────────┐  ┌──────────────────────────┐ │
│  │  Voice Mode     │  │  Dashboard       │  │  Study Notes             │ │
│  │  (STT + TTS)    │  │  (Heatmap/Stats) │  │  (AI-Generated)         │ │
│  └────────────────┘  └──────────────────┘  └──────────────────────────┘ │
│       │             │             │               │                      │
│  ┌────┴─────────────┴─────────────┴───────────────┴──────────────────┐  │
│  │        Zustand Store (sessionStore + authStore)                     │  │
│  │        grounding · calibration · signals · messages · viz          │  │
│  └──────────────────────────┬─────────────────────────────────────────┘  │
│                              │ SSE + REST                                │
└──────────────────────────────┼───────────────────────────────────────────┘
                               │
┌──────────────────────────────┼───────────────────────────────────────────┐
│  Backend (FastAPI)           │                                            │
│  ┌───────────────────────────▼────────────────────────────────────────┐  │
│  │                        API Routers (7)                              │  │
│  │  /api/tutor/stream   /api/hints   /api/execute   /api/sessions    │  │
│  │  /api/problems/parse   /api/notes   /api/dashboard                │  │
│  └───────────────────────────┬────────────────────────────────────────┘  │
│                              │                                            │
│  ┌───────────────────────────▼────────────────────────────────────────┐  │
│  │              LangGraph Pipeline (5 nodes)                           │  │
│  │  build_context → generate_response → parse_tags →                  │  │
│  │            check_grounding_drift → persist_data                    │  │
│  └───────────────────────────┬────────────────────────────────────────┘  │
│                              │                                            │
│  ┌───────────────────────────▼────────────────────────────────────────┐  │
│  │                       Services Layer (14)                           │  │
│  │  gemini (key rotation)   grounding            socratic_prompt      │  │
│  │  calibration             session_manager      tag_parser           │  │
│  │  student_context         profile_aggregator   note_generator       │  │
│  │  problem_fetcher         problem_ai_parser    reflection_evaluator │  │
│  │  database                                                          │  │
│  └───────────────────────────┬────────────────────────────────────────┘  │
│                              │                                            │
│  ┌───────────────────────────▼────────────────────────────────────────┐  │
│  │            Supabase (PostgreSQL + Auth + RLS)                       │  │
│  │  sessions  messages  reflections  notes  misconceptions            │  │
│  │  mastery_events  solved_problems  student_profiles                 │  │
│  │  daily_recommendations                                             │  │
│  └────────────────────────────────────────────────────────────────────┘  │
└──────────────────────────────────────────────────────────────────────────┘
```

---

## Key Features

### 🧠 Problem Grounding Engine

The core innovation that prevents tutor hallucinations over long conversations.

```
User submits problem
       │
       ▼
Problem Parser (text / image / URL / LeetCode number)
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

### 💬 Socratic Tutoring Engine

The system prompt (634 lines) enforces **Three Laws**:

1. **Zero Validation Fluff** — Never says "Great job!" or "You're correct". Forbidden phrases are explicitly listed.
2. **Proactive, Not Reactive** — Predicts gaps before errors happen. Probes invariants, edge cases, "Why this data structure?"
3. **Always End With Pattern Generalisation** — After mastery: Abstraction → Signal Recognition → Transfer ("Name 3 other problems where this pattern applies")

**Pedagogical modes:** Exploring · Code Review · Stuck · Collaborative

Additional behaviours:
- **Real-time calibration** — adapts scaffolding based on reasoning quality, frustration, and confusion signals
- **Loop detection** — automatically breaks question loops after 2 rephrases
- **Frustration protocol** — overrides Socratic mode when student is stuck/frustrated
- **Mathematical claim protocol** — verifies claims with concrete examples before challenging

### 📊 Adaptive Learning & Dashboard

- **4-level hint ladder** — Conceptual → Directional → Structural → Code-Level
- **Prerequisite gap detection** — pauses the current problem to teach missing foundations
- **Pattern mastery tracking** — `recognition → application → generalisation` per DSA pattern
- **Cross-session cognitive profile** — persistent student model with weakness fingerprints, strength fingerprints, learning velocity
- **AI daily question recommendation** — Gemini picks a personalized LeetCode problem based on your weak patterns. Persists until solved or skipped.
- **Activity heatmap & streaks** — GitHub-style contribution heatmap + current/max streak tracking
- **Spaced repetition alerts** — flags patterns not seen in 7+ days

### 🎨 Interactive Visualizations

Animated canvas-based visualizations (845 lines) triggered automatically by the tutor or from problem grounding:

| Visualization | Description |
|--------------|-------------|
| Sliding Window | Two-pointer window moving across an array |
| Two Pointers | Left/right pointers converging |
| BFS Traversal | Level-order graph traversal animation |
| DFS Traversal | Depth-first with backtracking animation |
| Stack Operations | Push/pop stack with visual state |
| Recursion Tree | Branching recursion tree construction |
| Binary Trie | Bit-by-bit trie insertion |

Triggered by `[TRIGGER_VISUALIZATION: type]` tags in Gemini responses or auto-triggered from grounding `core_concepts`.

### 💻 Code Execution

- **Monaco code editor** with syntax highlighting and auto-detection
- **Local sandboxed execution** for Python, JavaScript, C++, and Java
- **Custom input/output panel** for testing with any input
- **Compile-then-run flow** for compiled languages (C++, Java)

### 🎤 Voice Mode

Full hands-free tutoring with a floating "phone call" interface:

```
1. Panel opens → mic starts automatically
2. Student speaks → interim transcript shown real-time
3. Student pauses → recognition ends → transcript sent to AI
4. AI streams response → orb animates → TTS speaks each sentence
5. TTS finishes → mic restarts → loop continues
```

- **Natural TTS pacing** — sentences queued and spoken with deliberate pauses (`[PAUSE:N]`)
- **Interruption support** — tap the orb mid-sentence to take over
- **Voice tags** — `[WAIT]` stops TTS and listens, `[PAUSE:N]` creates N seconds of silence
- **Markdown-aware TTS** — strips formatting syntax but keeps variable names and code terms
- **Text chat stays in sync** — everything spoken appears in the chat transcript

### 📝 Post-Session Intelligence

- **AI-generated study notes** — categorised as `mistake` / `technique` / `insight` / `pattern` / `process`
- **Reflection quality evaluation** — rates student reflections as `surface` / `structural` / `transferable`
- **Solved problem logging** — tracks strategy used, key mistakes, mastery level
- **Profile aggregation** — background job rebuilds cognitive profile after every session

### 🔑 API Key Rotation

Supports up to **3 Gemini API keys** that rotate automatically on rate-limit (HTTP 429 / quota exhaustion):

```
Key 1 hits limit → ⚠️ auto-rotates → Key 2 → Key 3 → Key 1...
```

Thread-safe rotation across all services (tutor streaming, grounding, hints, daily questions, note generation).

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Zustand, Monaco Editor, CSS Modules |
| Backend | Python 3.11+, FastAPI, LangGraph, LangChain |
| AI | Google Gemini 2.5 Flash (primary), Gemini 1.5 Flash (fallback/drift check) |
| Database | Supabase (PostgreSQL), Row Level Security (prepared) |
| Auth | Supabase Auth (email/password), JWT verification (HS256 + ES256/JWKS) |
| Speech | Web Speech API (STT), SpeechSynthesis API (TTS) |
| Execution | Local subprocess sandboxing (Python, JS, C++, Java) |

---

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key (up to 3 for rotation)
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
-- backend/migrations/003_daily_recommendations.sql
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
#   GEMINI_API_KEY_1=your-first-gemini-key
#   GEMINI_API_KEY_2=your-second-gemini-key     (optional)
#   GEMINI_API_KEY_3=your-third-gemini-key      (optional)
#   SUPABASE_URL=https://your-project.supabase.co
#   SUPABASE_KEY=your-service-role-key
#   SUPABASE_JWT_SECRET=your-jwt-secret

# Start server
uvicorn app.main:app --reload --port 8000
```

### 3. Frontend

```bash
cd frontend

# Install dependencies
npm install

# Start dev server
npm run dev
```

Open [http://localhost:5173](http://localhost:5173) in your browser.

---

## Project Structure

```
├── backend/
│   ├── app/
│   │   ├── config.py                      # Pydantic settings (multi-key, Supabase)
│   │   ├── main.py                        # FastAPI app factory + router registration
│   │   ├── graph/
│   │   │   ├── state.py                   # TutorState + HintState (typed dicts)
│   │   │   ├── nodes.py                   # Pipeline nodes (5 stages)
│   │   │   ├── tutor_graph.py             # Main tutoring graph definition
│   │   │   └── hint_graph.py              # Hint generation graph
│   │   ├── middleware/
│   │   │   └── auth.py                    # JWT verification (HS256 + ES256/JWKS)
│   │   ├── models/
│   │   │   ├── problem.py                 # Problem model
│   │   │   ├── session.py                 # Session model
│   │   │   ├── tutor.py                   # Tutor request/response models
│   │   │   └── note.py                    # Note model
│   │   ├── routers/
│   │   │   ├── tutor.py                   # SSE streaming + grounding extraction
│   │   │   ├── problems.py                # Problem parsing (text/image/URL/number)
│   │   │   ├── execute.py                 # Code execution (Python/JS/C++/Java)
│   │   │   ├── hints.py                   # Hint ladder endpoint
│   │   │   ├── sessions.py                # Session management + reflections
│   │   │   ├── notes.py                   # Study notes endpoint
│   │   │   └── dashboard.py               # Dashboard API + AI daily questions
│   │   └── services/
│   │       ├── gemini.py                  # Gemini client + API key rotation
│   │       ├── database.py                # Supabase client singleton
│   │       ├── grounding.py               # Problem Grounding Engine + drift check
│   │       ├── socratic_prompt.py         # System prompt (634 lines) + context builder
│   │       ├── calibration.py             # Real-time dialogue calibration
│   │       ├── session_manager.py         # Session CRUD + grounding persistence
│   │       ├── problem_ai_parser.py       # AI problem extraction (text/image)
│   │       ├── problem_fetcher.py         # LeetCode problem fetcher
│   │       ├── note_generator.py          # AI study note generation
│   │       ├── reflection_evaluator.py    # Reflection quality scoring
│   │       ├── profile_aggregator.py      # Cross-session cognitive profile
│   │       ├── student_context.py         # Context injection from profile
│   │       └── tag_parser.py              # Structured tag extraction
│   ├── schema.sql                         # Full database schema (9 tables)
│   ├── migrations/                        # Schema migrations
│   │   ├── add_calibration_state.sql
│   │   ├── add_cognitive_profile.sql
│   │   ├── 002_audit_fixes.sql
│   │   ├── 003_problem_grounding.sql
│   │   └── 003_daily_recommendations.sql
│   └── requirements.txt                   # Python dependencies
│
└── frontend/
    ├── package.json
    └── src/
        ├── App.jsx                        # Main app (routing + layout)
        ├── main.jsx                       # Entry point
        ├── api/                           # Backend API client layer
        │   ├── client.js                  # Auth-aware fetch wrapper
        │   ├── tutor.js                   # SSE stream handler
        │   ├── dashboard.js               # Dashboard + daily question API
        │   └── notes.js                   # Study notes API
        ├── components/
        │   ├── TutorChat.jsx              # Chat panel with streaming + grounding
        │   ├── ProblemPanel.jsx           # Problem input (number/text/image/URL)
        │   ├── EditorPanel.jsx            # Monaco code editor + execution
        │   ├── VisualizationPanel.jsx     # 7 animated canvas visualizations
        │   ├── VoiceMode.jsx              # Voice tutoring interface
        │   ├── HintLadder.jsx             # 4-level hint system
        │   ├── ReflectionModal.jsx        # Post-session reflection
        │   ├── Header.jsx                 # App header + auth
        │   ├── BottomBar.jsx              # Status bar
        │   └── TypingIndicator.jsx        # Typing/thinking animation
        ├── pages/
        │   ├── AuthPage.jsx               # Login / signup
        │   ├── DashboardPage.jsx          # Stats, heatmap, AI daily question
        │   └── NotesPage.jsx              # AI-generated study notes
        ├── hooks/
        │   ├── useVoiceInput.js           # Web Speech API (STT)
        │   ├── useSpeechOutput.js         # SpeechSynthesis API (TTS)
        │   ├── useConversationState.js    # Voice state machine
        │   └── useVoiceTutor.js           # Full voice tutoring orchestrator
        ├── store/
        │   ├── sessionStore.js            # Session state (Zustand)
        │   └── authStore.js               # Auth state (Zustand)
        ├── lib/
        │   └── supabase.js                # Supabase client
        └── styles/
            ├── globals.css                # Design tokens + global styles
            └── animations.css             # Shared animations
```

---

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
│                      │  via SSE to frontend. Auto-retries with
│                      │  rotated API key on rate-limit.
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

---

## Database Schema

9 tables in Supabase (PostgreSQL):

| Table | Purpose |
|-------|---------|
| `sessions` | One row per problem attempt. Tracks phase, hints used, elapsed time, calibration state |
| `messages` | Conversation turns (role: tutor/student) per session |
| `reflections` | Post-session reflections with quality evaluation (surface/structural/transferable) |
| `misconceptions` | Detected from `[MISCONCEPTION]` tags. Pattern + description + resolved status |
| `mastery_events` | Append-only log from `[MASTERY]` tags. Pattern + level (recognition/application/generalisation) |
| `solved_problems` | Cross-session log. Strategy used, key mistake, mastery level, difficulty |
| `student_profiles` | Denormalized per-student profile. Weakness/strength fingerprints, learning velocity, per-pattern mastery |
| `notes` | AI-generated study notes. Category: mistake/technique/insight/pattern/process |
| `daily_recommendations` | AI daily question picks. Status: active/solved/skipped. Auto-rotates on solve/skip |

---

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tutor/stream` | SSE stream of Socratic tutor response (includes grounding) |
| POST | `/api/hints` | Generate next hint in the 4-level ladder |
| POST | `/api/problems/parse` | Parse problem from number/URL/title/text/image |
| POST | `/api/execute` | Execute student code (Python/JS/C++/Java) |
| POST | `/api/sessions/{id}/reflect` | Save reflection + trigger AI evaluation |
| GET | `/api/sessions/student/me` | List authenticated student's sessions |
| GET | `/api/notes/me` | Get AI-generated study notes |
| GET | `/api/dashboard/me` | Full dashboard payload (profile, heatmap, streak, daily question) |
| POST | `/api/dashboard/question/refresh` | Skip current daily question, generate new AI pick |
| GET | `/health` | Health check |

## SSE Event Types

The `/api/tutor/stream` endpoint sends these Server-Sent Events:

| Event Type | Payload | Description |
|------------|---------|-------------|
| `chunk` | `{ content }` | Streamed text token from Gemini |
| `tags` | `{ misconceptions, mastery, vizTriggers, waitSeconds, problemSolved }` | Structured tags extracted from response |
| `grounding` | `{ grounding }` | Problem grounding JSON (first message or on load) |
| `error` | `{ message }` | Error message |
| `done` | `{ sessionId }` | Stream complete, includes session ID |

---

## Environment Variables

### Backend (`backend/.env`)

| Variable | Required | Description |
|----------|----------|-------------|
| `GEMINI_API_KEY_1` | ✅ | Primary Gemini API key |
| `GEMINI_API_KEY_2` | ❌ | Second key for rotation |
| `GEMINI_API_KEY_3` | ❌ | Third key for rotation |
| `GEMINI_MODEL` | ❌ | Model name (default: `gemini-2.5-flash`) |
| `SUPABASE_URL` | ❌ | Supabase project URL |
| `SUPABASE_KEY` | ❌ | Supabase service role key |
| `SUPABASE_JWT_SECRET` | ❌ | JWT secret for token verification |
| `ALLOWED_ORIGINS` | ❌ | CORS origins (default: `localhost:5173,5174`) |
| `APP_ENV` | ❌ | Environment (default: `development`) |
| `LOG_LEVEL` | ❌ | Logging level (default: `INFO`) |

> **Note:** The app works without Supabase — it falls back to in-memory storage (data is lost on restart).

---

## License

MIT
