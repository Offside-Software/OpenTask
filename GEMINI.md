# OpenTask Agent Guidelines & Coding Standards (GEMINI.md)

This file provides root-level guidelines for Google Gemini and Antigravity agents operating in the OpenTask codebase. For the full reference, see [AGENTS.md](./AGENTS.md).

---

## 1. Quick Toolchain Checklist

- **Frontend (`opentask-app/`)**:
  - **Toolchain**: **Bun** exclusively.
  - Commands: `bun install`, `bun run build`, `bun test`, `bun run dev`.
  - **Never** invoke `npm`, `yarn`, or `pnpm`.
- **Backend (`api/`)**:
  - **Toolchain**: **UV** exclusively.
  - Commands: `uv sync`, `uv run uvicorn src.main:app`, `uv pip install <pkg>`.
  - **Never** invoke unmanaged Python or global `pip`.

---

## 2. Key Code Requirements

1. **Reusable Design System Components**:
   - Always reuse components from `src/design-system/`:
     - `Button`, `CloseButton`, `SurfaceCard`, `Badge`, `TrashButton`, `Toast`, `Skeleton`, `ProgressBar`.
   - Keep the signature Neo-Brutalist UI: 0px border radius, heavy dark borders, unblurred offset shadows (`shadow-[3px_3px_0px_0px_#000000]`), and primary `#FFE600` industrial yellow.

2. **Dark & Light Mode Compatibility**:
   - Both Dark (`data-theme="dark"`, default) and Light (`data-theme="light"`) modes are active in OpenTask.
   - Do **NOT** use hardcoded unreadable text (e.g. static `text-white` on elements that turn light in light mode).
   - Test and audit contrast in both themes.

3. **Snowflake SafeId Convention**:
   - All IDs are 64-bit BigInts.
   - Prevent JavaScript float64 precision loss by treating all IDs as `string` in TypeScript and serializing as strings / `SafeId` in FastAPI.

4. **Database Connection Pool Management**:
   - Always acquire with `_get_conn()` and release in a `finally` block with `_put_conn(conn)`.
