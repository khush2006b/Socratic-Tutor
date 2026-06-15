# SocraticDS — Adaptive Socratic DSA Tutor

An AI-powered Socratic tutoring system for Data Structures & Algorithms, built with **Gemini 2.5 Flash**, **LangGraph**, **FastAPI**, and **React**.

Instead of giving answers, SocraticDS guides students through structured questioning — adapting in real-time to their reasoning level, detecting misconceptions, and building a persistent cognitive profile across sessions.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│  Frontend (React + Vite)                                        │
│  ┌──────────┐ ┌──────────┐ ┌───────────┐ ┌──────────────────┐  │
│  │ Problem  │ │  Code    │ │  Tutor    │ │   Reflection     │  │
│  │ Panel    │ │  Editor  │ │  Chat     │ │   Modal          │  │
│  │          │ │ (Monaco) │ │  (SSE)    │ │   (Quality AI)   │  │
│  └──────────┘ └──────────┘ └───────────┘ └──────────────────┘  │
│       │            │             │               │              │
│  ┌────┴────────────┴─────────────┴───────────────┴──────────┐  │
│  │              Zustand Store (sessionStore + authStore)      │  │
│  └────────────────────────────────┬──────────────────────────┘  │
│                                   │ SSE + REST                  │
└───────────────────────────────────┼─────────────────────────────┘
                                    │
┌───────────────────────────────────┼─────────────────────────────┐
│  Backend (FastAPI)                │                              │
│  ┌────────────────────────────────▼──────────────────────────┐  │
│  │                     API Routers                            │  │
│  │  /api/tutor/stream  /api/hints  /api/sessions  /api/notes │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────▼──────────────────────────────┐  │
│  │              LangGraph Pipeline                            │  │
│  │  build_context → generate_response → parse_tags →         │  │
│  │                                       persist_data         │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────▼──────────────────────────────┐  │
│  │                    Services Layer                          │  │
│  │  socratic_prompt    calibration    note_generator          │  │
│  │  session_manager    tag_parser     profile_aggregator      │  │
│  │  student_context    reflection_evaluator                   │  │
│  └────────────────────────────┬──────────────────────────────┘  │
│                               │                                 │
│  ┌────────────────────────────▼──────────────────────────────┐  │
│  │         Supabase (PostgreSQL + Auth + RLS)                 │  │
│  │  sessions  messages  reflections  notes  misconceptions   │  │
│  │  mastery_events  solved_problems  student_profiles        │  │
│  └───────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

## Key Features

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

### Post-Session Intelligence
- **AI-generated study notes** — categorised as mistake / technique / insight / pattern
- **Reflection quality evaluation** — rates student reflections as surface / structural / transferable
- **Solved problem logging** — tracks strategy used, key mistakes, mastery level
- **Spaced repetition alerts** — flags patterns not seen in 7+ days

### Technical
- **Streaming SSE** — real-time token-by-token tutor responses
- **Gemini 2.5 Flash** with automatic fallback to gemini-1.5-flash on rate limits
- **JWT auth** — supports both HS256 (legacy) and ES256 (JWKS) Supabase tokens
- **LangGraph state machine** — deterministic pipeline with typed state

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19, Vite 8, Zustand, Monaco Editor, CSS Modules |
| Backend | Python 3.11+, FastAPI, LangGraph, LangChain |
| AI | Google Gemini 2.5 Flash (primary), Gemini 1.5 Flash (fallback) |
| Database | Supabase (PostgreSQL), Row Level Security |
| Auth | Supabase Auth (email/password), JWT verification |

## Quick Start

### Prerequisites
- Python 3.11+
- Node.js 18+
- A [Google AI Studio](https://aistudio.google.com/) API key
- A [Supabase](https://supabase.com/) project (free tier works)

### 1. Database Setup

Run the schema in your Supabase SQL Editor:

```sql
-- Copy contents of backend/schema.sql into Supabase SQL Editor and run
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
│   │   ├── config.py              # Pydantic settings
│   │   ├── main.py                # FastAPI app factory
│   │   ├── graph/
│   │   │   ├── state.py           # LangGraph typed state
│   │   │   ├── nodes.py           # Pipeline nodes (build_context, generate, parse, persist)
│   │   │   ├── tutor_graph.py     # Main tutoring graph
│   │   │   └── hint_graph.py      # Hint generation graph
│   │   ├── middleware/
│   │   │   └── auth.py            # JWT verification (HS256 + ES256/JWKS)
│   │   ├── models/                # Pydantic request/response models
│   │   ├── routers/               # API endpoints
│   │   └── services/
│   │       ├── socratic_prompt.py      # System prompt + context builder
│   │       ├── calibration.py          # Real-time dialogue calibration
│   │       ├── session_manager.py      # Session CRUD + tag persistence
│   │       ├── note_generator.py       # AI study note generation
│   │       ├── reflection_evaluator.py # Reflection quality scoring
│   │       ├── profile_aggregator.py   # Cross-session cognitive profile
│   │       ├── student_context.py      # Context injection from profile
│   │       └── tag_parser.py           # Structured tag extraction
│   ├── schema.sql                 # Full database schema
│   └── migrations/                # Schema migration scripts
│
└── frontend/
    └── src/
        ├── api/                   # Backend API client layer
        ├── components/            # UI components
        ├── hooks/                 # Custom React hooks
        ├── lib/                   # Supabase client
        ├── store/                 # Zustand state management
        └── styles/                # Global CSS
```

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/tutor/stream` | SSE stream of Socratic tutor response |
| POST | `/api/hints` | Generate next hint in the 4-level ladder |
| POST | `/api/problems/parse` | Parse problem from number/URL/title |
| POST | `/api/sessions/{id}/reflect` | Save reflection + trigger AI evaluation |
| GET | `/api/sessions/student/me` | List authenticated student's sessions |
| GET | `/api/notes/me` | Get AI-generated study notes |
| GET | `/health` | Health check |

## How the Tutoring Pipeline Works

```
Student sends message
       │
       ▼
┌─────────────────┐
│  build_context   │  Loads student profile, problem statement,
│                  │  calibration state, and conversation history
└────────┬────────┘
         ▼
┌─────────────────┐
│ generate_response│  Calls Gemini with SystemMessage (prompt +
│                  │  context) + full conversation as messages.
│                  │  Streams tokens via SSE to frontend.
└────────┬────────┘
         ▼
┌─────────────────┐
│   parse_tags     │  Extracts [MISCONCEPTION], [MASTERY],
│                  │  [CALIBRATION], [PROBLEM_SOLVED], etc.
│                  │  Updates calibration state.
└────────┬────────┘
         ▼
┌─────────────────┐
│  persist_data    │  Saves tutor message, misconceptions,
│                  │  mastery events, and calibration to DB
└─────────────────┘
```

## License

MIT
