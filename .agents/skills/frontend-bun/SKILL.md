---
name: frontend-bun
description: >-
  Use this skill when developing, testing, building, or modifying frontend code in opentask-app.
  Enforces Bun commands, design system component reuse, and Dark/Light theme color validation.
---

# OpenTask Frontend Development Skill (Bun)

This skill provides step-by-step procedures for safely developing, building, and styling components in `opentask-app`.

---

## 1. Toolchain Execution Procedures

Always use **Bun** for all frontend actions:

### Install Dependencies
```bash
cd opentask-app
bun install
```

### Run Typecheck & Build
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

> [!WARNING]
> Never use `npm`, `npx`, `yarn`, or `pnpm`. If a command or script fails, fix the underlying TypeScript or environment issue; do not switch package managers.

---

## 2. Reusable Component Checklist

Before writing any custom button, card, modal, or badge, check `opentask-app/src/design-system/`:

1. **Buttons**: Import `{ Button }` from `../design-system/Button`. Use variants `primary`, `success`, `outline`, `danger`, `ghost`, or `white`.
2. **Close Action**: Import `{ CloseButton }` from `../design-system/CloseButton`. Use on top-right corners of modals, slide-overs, and popups.
3. **Cards & Containers**: Import `{ SurfaceCard }` from `../design-system/SurfaceCard`. Supply `title`, `subtitle`, `icon`, or `rightElement`.
4. **Badges / Status Chips**: Import `{ Badge }` from `../design-system/Badge`. Supply `variant="accent" | "success" | "warning" | "danger" | "neutral"`.
5. **Delete Actions**: Import `{ TrashButton }` from `../design-system/TrashButton`.
6. **Alerts & Messages**: Import `{ Toast }` from `../design-system/Toast`.
7. **Loading States**: Import `{ Skeleton }` from `../design-system/Skeleton`.
8. **Progress Bars**: Import `{ ProgressBar }` from `../design-system/ProgressBar`.

---

## 3. Dark / Light Theme Color Validation

OpenTask provides dual-theme support (`ThemeContext`). Follow this procedure to prevent unreadable text or low-contrast UI bugs:

### Color Verification Procedure
1. **Inspect Background vs Text Hierarchy**:
   - Check default dark values: dark surface `#141619` with text `#E5E7EB` or `#FFFFFF`.
   - Check light mode transformation: surface becomes `#FFFFFF` or `#EAEAE4` with text `#111111` or `#000000`.
2. **Audit Static Text Color Classes**:
   - **Avoid**: Bare `text-white` on components unless the background is guaranteed to remain dark in light mode (e.g. signal red `bg-[#FF3333]`, solid black buttons `bg-black`, or accented labels).
   - **Use**: Contextual theme variables (`--cmd-text-body`, `--cmd-text-meta`) or paired utilities (`text-neutral-900 dark:text-white`).
3. **Audit Border Visibility**:
   - Ensure borders are sharp and visible in light mode (`border-black` or `border-neutral-700`).
4. **Neo-Brutalist Consistency**:
   - Maintain `rounded-none`, 2px solid borders, and unblurred drop shadows (`shadow-[3px_3px_0px_0px_#000000]`).

---

## 4. Verification Workflow

Before completing any frontend task:
1. Run `bun run build` from `opentask-app`.
2. Verify exit code is `0` with no TypeScript errors.
3. Verify that all entity IDs are treated as `string` for safe comparison.
