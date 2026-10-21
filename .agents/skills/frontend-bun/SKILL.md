---
name: frontend-bun
description: >-
  Use this skill when developing, testing, building, or modifying frontend code in opentask-app.
  Enforces Bun commands, design system component reuse, Markdown rendering standards, and Dark/Light theme validation.
---

# OpenTask Frontend Development Skill (Bun & React 19)

This skill provides mandatory guidelines, architectural standards, and procedures for building and styling components in `opentask-app`.

---

## 1. Toolchain Execution Procedures

Always use **Bun** for all frontend actions. The frontend is built with **React 19**, **TypeScript**, **Vite**, and **Tailwind CSS**.

> [!WARNING]
> Never execute `npm`, `npx`, `yarn`, or `pnpm` inside `opentask-app/`. Bun is the single mandated package manager and runtime.

### Install Dependencies
```bash
cd opentask-app
bun install
```

### Run Typecheck & Production Build
```bash
cd opentask-app
bun run build
```

### Start Development Server
```bash
cd opentask-app
bun run dev
```

### Run Unit Tests
```bash
cd opentask-app
bun test
```

---

## 2. Reusable Design System Checklist

Do **NOT** reinvent bespoke buttons, cards, badges, dismiss buttons, or markdown parsers. Always import from `opentask-app/src/design-system/`:

1. **Buttons**: `{ Button }` from `../design-system/Button`. Use variants `primary`, `success`, `outline`, `danger`, `ghost`, or `white`, with sizes `sm`, `md`, `lg`.
2. **Close Action**: `{ CloseButton }` from `../design-system/CloseButton`. Use on top-right corners of modals, slide-overs, and drawers.
3. **Cards & Containers**: `{ SurfaceCard }` from `../design-system/SurfaceCard`. Supply `title`, `subtitle`, `icon`, or `rightElement`.
4. **Badges / Status Chips**: `{ Badge }` from `../design-system/Badge`. Supply `variant="accent" | "success" | "warning" | "danger" | "neutral"`.
5. **Delete Actions**: `{ TrashButton }` from `../design-system/TrashButton`.
6. **Alerts & Messages**: `{ Toast }` from `../design-system/Toast`.
7. **Loading States**: `{ Skeleton }` from `../design-system/Skeleton`.
8. **Progress Bars**: `{ ProgressBar }` from `../design-system/ProgressBar`.
9. **Markdown Rendering**: `{ MarkdownRenderer, hasMarkdownSyntax }` from `../design-system/MarkdownRenderer`. Supports `isSans`, `compact`, custom `style`, and relative heading sizing.

---

## 3. Typography, Readability & Markdown Standards

### 3.1 Strict Non-Monospace Body Requirement
- For task descriptions, card previews, modal details, and user editable textareas: **Always use clean, medium non-monospace font (`font-sans font-medium` or standard sans stack)**.
- **Rule**: Never use `font-mono` on rich body descriptions. Monospace is reserved exclusively for IDs, commit hashes, code blocks, or metadata tags.

### 3.2 Dynamic Markdown Detection & Dual-View Modes
- **Auto-Detection on Cards**: Use `hasMarkdownSyntax(text)` to detect markdown formatting. On Kanban cards, render `MarkdownRenderer` in `compact` mode with `isSans={true}` if detected, otherwise render sanitized plain text.
- **Task Detail Modal View Toggle**: Provide a switcher between **MARKDOWN** (rich rendered view) and **RAW** (original text source).
- **Font Size Stepper**: Task details must include a zoom stepper (`+` and `-` buttons) allowing users to scale description text size up or down (12px to 22px) for maximum readability.

---

## 4. Kanban & Focus Workspace Architecture

### 4.1 Fullscreen Focus Workspace
- OpenTask supports an expanded workspace overlay (`fixed inset-0 z-[45]`) on project boards to provide an uncluttered, large-scale view of buckets and tasks.
- Maintain top navigation toolbar containing:
  - Board overview summary (bucket and task counts).
  - Density toggle: **Standard** (`w-[320px]`) vs **Wide** (`w-[420px]`).
  - Bucket Focus dropdown selector.
  - Collapse / Close button.

### 4.2 Bucket Focus Dropdown Filter
- Follow the Assignee filter dropdown pattern:
  - Custom dropdown button displaying active focus (`All Buckets` or specific bucket name with task count badge).
  - Popover menu with checkmark indicators and clear selection support.
  - When a bucket is selected, filter the board to isolate that bucket while retaining the quick-switcher.

---

## 5. Snowflake SafeId Precision Rules

All primary keys (projects, buckets, tasks, alerts, meetings, users) are 64-bit Snowflake BigInts.

- **JavaScript Precision Hazard**: Numbers exceeding `Number.MAX_SAFE_INTEGER` ($2^{53}-1$) will be truncated or rounded if handled as numbers in JavaScript.
- **Frontend Rules**:
  1. Treat all IDs as `string`.
  2. Never use `parseInt()`, `Number()`, or `+id` on entity IDs.
  3. Use `String(id)` when comparing or indexing IDs in maps and sets.

---

## 6. Dark / Light Theme Color & Neo-Brutalist Validation

OpenTask provides dual-theme support controlled via `ThemeContext` (`data-theme="light"` / `data-theme="dark"`).

### 6.1 Contrast Audit Rules
1. **Never Hardcode `text-white`**:
   - In light mode, surfaces become light (`#FFFFFF` or `#EAEAE4`), making static `text-white` completely unreadable.
   - Use theme CSS variables (`--cmd-app-bg`, `--cmd-surface`, `--cmd-text-body`, `--cmd-text-meta`, `--cmd-border`) or paired utilities (`text-neutral-900 dark:text-white`).
   - Static `text-white` is permitted only on permanent dark elements (e.g. signal red tags `bg-[#FF3333]`, solid black buttons `bg-black`, or dark badges).
2. **Neo-Brutalist Aesthetic Guidelines**:
   - **Sharp Geometry**: 0px border radius (`rounded-none`).
   - **Hard Borders**: Solid, high-contrast borders (`border-2 border-black` or `border-neutral-700`).
   - **Hard Shadows**: Unblurred drop shadows (`shadow-[3px_3px_0px_0px_#000000]` or `shadow-[4px_4px_0px_0px_#000000]`).
   - **Signature Palette**: Primary Industrial Yellow (`#FFE600`), Success Neon Mint (`#00FF66`), Danger Signal Red (`#FF3333`), Warning Caution Amber (`#FF9900`).

---

## 7. Verification Workflow

Before completing any frontend task:
1. Run `bun run build` inside `opentask-app`.
2. Confirm the build finishes with exit code `0` and 0 TypeScript compilation errors.
3. Validate layout and readability in both Dark and Light modes.
