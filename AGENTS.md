# OpenTask AI Agent Guidelines & Coding Standards

Welcome to the **OpenTask** codebase. This document outlines the project architecture, operational standards, and coding conventions that all AI agents and developers must strictly follow when working in this repository.

---

## 1. Project Architecture Overview

OpenTask is a neo-brutalist project management and task tracking platform featuring real-time AI code reviews, GitHub App integration, and notifications.

### Repository Layout
- **`opentask-app/`**: Frontend single-page application built with React 19, TypeScript, Vite, and Tailwind CSS.
- **`api/`**: Backend API service built with Python 3.11+, FastAPI, Uvicorn, and PostgreSQL (Supabase / Docker). Deployed serverlessly via Vercel Functions and locally via Docker Compose.
- **`docker-compose.yml`**: Local infrastructure orchestration (PostgreSQL database, Redis, and local services).
- **`vercel.json`**: Deployment routing between frontend static build and Python serverless API functions.

---

## 2. Mandatory Toolchains

### Frontend Tooling: **Bun Only**
- **Strict Rule**: Always use **Bun** for all frontend package management, building, testing, and script execution.
- **Forbidden**: Never execute `npm`, `yarn`, or `pnpm` inside `opentask-app/` or for frontend workflows.
- Common commands:
  ```bash
  cd opentask-app
  bun install              # Install dependencies
  bun run build            # Compile TypeScript & production bundle
  bun run dev              # Launch Vite dev server
  bun test                 # Run frontend tests
  ```

### Backend Tooling: **UV Only**
- **Strict Rule**: Always use **UV** (`uv`) for Python environment management, package installation, running tests, and starting servers.
- **Forbidden**: Never run global `pip install` or activate virtual environments manually without `uv`.
- Common commands:
  ```bash
  cd api
  uv sync                  # Sync virtual environment with pyproject.toml / uv.lock
  uv pip install <pkg>     # Install a new Python package
  uv run uvicorn src.main:app --port 8000 --reload  # Run backend dev server
  uv run pytest            # Execute tests
  ```

---

## 3. Core Architectural Rules

### 3.1 Snowflake SafeId (BigInt Handling)
- All primary keys (projects, buckets, tasks, alerts, meetings, github installations, reviews) are generated using Twitter-style Snowflake IDs (64-bit BigInts) via `_generator.generate()`.
- **CRITICAL JavaScript Precision Hazard**: JavaScript numbers are double-precision floats (`Number.MAX_SAFE_INTEGER` is \(2^{53}-1 \approx 9.007 \times 10^{15}\)). Snowflake IDs exceed this limit and will suffer truncation/rounding in JavaScript if sent as numeric JSON values.
- **Backend Rule**: Always serialize Snowflake IDs as strings or use the `SafeId` Pydantic type when returning JSON to clients.
- **Frontend Rule**: Treat task IDs, project IDs, and bucket IDs as `string`. Never parse them with `parseInt()`, `Number()`, or `+id`. Use `String(id)` for comparisons or store them as strings.

### 3.2 Database Connection Pool Pattern
- All database operations in `api/` must lease a connection from the pool and ensure it is returned in a `finally` block:
  ```python
  from services.database.database import _get_conn, _put_conn

  conn = _get_conn()
  cur = None
  try:
      cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
      cur.execute("SELECT ... WHERE id = %s;", (item_id,))
      row = cur.fetchone()
      conn.commit()
      return row
  except Exception as e:
      conn.rollback()
      raise HTTPException(status_code=500, detail=str(e))
  finally:
      if cur is not None:
          cur.close()
      _put_conn(conn)
  ```

---

## 4. Frontend Standards (`opentask-app`)

### 4.1 Strict Reusable Component Requirement
- Do **NOT** reinvent bespoke buttons, cards, badges, or dialog close handlers. Always import from `src/design-system/`:
  - `Button` (`src/design-system/Button.tsx`): Variants (`primary`, `success`, `outline`, `danger`, `ghost`, `white`), sizes (`sm`, `md`, `lg`).
  - `CloseButton` (`src/design-system/CloseButton.tsx`): Consistent top-right modal and drawer dismiss button with hover transitions.
  - `SurfaceCard` (`src/design-system/SurfaceCard.tsx`): Neo-brutalist container with title, icon, subtitle, and rightElement support.
  - `Badge` (`src/design-system/Badge.tsx`): Status and metadata tags (`accent`, `success`, `warning`, `danger`, `neutral`).
  - `TrashButton` (`src/design-system/TrashButton.tsx`): Neo-brutalist delete action button.
  - `Toast` (`src/design-system/Toast.tsx`): Alert banners and status notifications.
  - `Skeleton` (`src/design-system/Skeleton.tsx`): Asynchronous loading placeholders.
  - `ProgressBar` (`src/design-system/ProgressBar.tsx`): Task progress bar.

### 4.2 Dual Theme Integrity (Dark & Light Mode)
- OpenTask supports both Dark mode (default) and Light mode controlled by `ThemeContext` via `document.documentElement[data-theme="light"]` / `html.light`.
- **Mandatory Contrast Audit**:
  - Never hardcode unreadable text classes like `text-white` on components without ensuring proper contrast in light mode. In light mode, default background is light (`#F4F4F0` / `#FFFFFF`), so text must adapt.
  - Rely on CSS variables defined in `src/index.css` (`--cmd-app-bg`, `--cmd-surface`, `--cmd-text-body`, `--cmd-text-meta`, `--cmd-border`) or use explicit dark/light utility classes.
  - Always verify that UI changes look crisp, readable, and aesthetic in both dark and light modes.

### 4.3 Neo-Brutalist Aesthetic Guidelines
- **Sharp Geometry**: 0px border radius (`rounded-none`).
- **Hard Borders**: High-contrast, solid borders (`border-2 border-black` or `border-neutral-700`).
- **Hard Shadows**: Unblurred brutalist offset shadows (`shadow-[3px_3px_0px_0px_#000000]` or `shadow-[4px_4px_0px_0px_#000000]`).
- **Signature Palette**:
  - Primary Accent: Industrial Yellow (`#FFE600`)
  - Success Accent: Neon Mint (`#00FF66`)
  - Danger Accent: Signal Red (`#FF3333`)
  - Warning Accent: Caution Amber (`#FF9900`)
  - Monospace accents: JetBrains Mono / Space Grotesk font stacks.

---

## 5. Git & Contribution Conventions

- **Branching**:
  - Specific features requested on separate branches must be branched off `master` with descriptive kebab-case names (e.g., `task-pagination`).
  - Core features and fixes default to `master` unless instructed otherwise.
- **Build Verification**:
  - Always run `bun run build` inside `opentask-app` before declaring frontend work complete.
  - Always verify Python compilation and imports with `uv run` inside `api/`.
