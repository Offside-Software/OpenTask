# OpenTask Frontend AI Coding Rules (`opentask-app/AGENTS.md`)

This document outlines the strict guidelines and conventions for frontend development within the `opentask-app` workspace.

---

## 1. Toolchain: Bun Exclusively

- **Mandatory Package Manager**: **Bun** is the sole package manager and script runner for this frontend.
- **Rules**:
  - Run `bun install` when adding or modifying dependencies.
  - Run `bun run build` to verify TypeScript types and build output.
  - Run `bun run dev` to start the Vite development server.
  - Run `bun test` for unit tests.
  - **Do NOT execute `npm`, `npx`, `yarn`, or `pnpm` under any circumstances.**

---

## 2. Component Reuse: Design System First

Never craft ad-hoc buttons, custom close icons, custom card frames, or raw alert popups. Always check and use `src/design-system/`.

### 2.1 Component Catalog

| Component | Location | Props & Usage | Notes |
| :--- | :--- | :--- | :--- |
| **`Button`** | `src/design-system/Button.tsx` | `variant`: `'primary' \| 'success' \| 'outline' \| 'danger' \| 'ghost' \| 'white'`<br>`size`: `'sm' \| 'md' \| 'lg'`<br>`children`, `className`, standard HTML button props | Brutalist action button with active translate effect and hard shadow. Use `primary` (`#FFE600`) for primary actions. |
| **`CloseButton`** | `src/design-system/CloseButton.tsx` | `size`: `'sm' \| 'md' \| 'lg'`<br>standard HTML button props | Standard `X` close button for modals, slide-overs, and popups. Hover turns red (`#FF0000`) with black icon. |
| **`SurfaceCard`** | `src/design-system/SurfaceCard.tsx` | `title?: string`, `subtitle?: string`, `icon?: LucideIcon`, `rightElement?: ReactNode`, `children` | Standard neo-brutalist container with high-contrast border, top header bar, and hard drop-shadow. |
| **`Badge`** | `src/design-system/Badge.tsx` | `variant`: `'accent' \| 'success' \| 'warning' \| 'danger' \| 'neutral'`<br>`size`: `'sm' \| 'md'`<br>`children` | Tag/chip for statuses, counts, and category labels. |
| **`TrashButton`** | `src/design-system/TrashButton.tsx` | `size`: `'sm' \| 'md' \| 'lg'`<br>`onClick`, standard HTML button props | Dedicated destructive delete button with trash icon and hover styling. |
| **`Toast`** | `src/design-system/Toast.tsx` | `message: string`, `type`: `'success' \| 'error' \| 'info'` | Ephemeral floating alert notification. |
| **`Skeleton`** | `src/design-system/Skeleton.tsx` | `className?: string` | Monochromatic loading placeholder block with brutalist pulse animation. |
| **`ProgressBar`** | `src/design-system/ProgressBar.tsx` | `value: number`, `max?: number` | Linear task progress bar with solid accent fill. |

### 2.2 Component Usage Example
```tsx
import { Button } from "../design-system/Button";
import { CloseButton } from "../design-system/CloseButton";
import { SurfaceCard } from "../design-system/SurfaceCard";
import { Badge } from "../design-system/Badge";
import { CheckCircle2 } from "lucide-react";

export const ExampleModal = ({ onClose }: { onClose: () => void }) => (
  <SurfaceCard
    title="DEPLOYMENT STATUS"
    subtitle="LIVE PRODUCTION CLUSTER"
    icon={CheckCircle2}
    rightElement={<CloseButton onClick={onClose} size="sm" />}
  >
    <div className="space-y-4">
      <Badge variant="success">ONLINE</Badge>
      <div className="flex gap-2">
        <Button variant="primary" size="md">CONFIRM ACTION</Button>
        <Button variant="outline" size="md" onClick={onClose}>CANCEL</Button>
      </div>
    </div>
  </SurfaceCard>
);
```

---

## 3. Dark / Light Theme Color Validation

OpenTask features a dual theme system managed by `ThemeContext` (`src/context/themeContext.tsx`):
- **Dark Mode (Default)**: Background `--cmd-app-bg: #0C0D0E`, surface `--cmd-surface: #141619`, text `--cmd-text-body: #E5E7EB`.
- **Light Mode**: Background `--cmd-app-bg: #F4F4F0`, surface `--cmd-surface: #FFFFFF`, text `--cmd-text-body: #111111`, borders `#000000`.

### 3.1 Strict Contrast Rules (Avoiding Color Errors)
1. **Never use static `text-white` on surfaces without light mode support**:
   - In light mode, surfaces (`.bg-[#141619]`, `.bg-neutral-900`) automatically invert to `#FFFFFF`.
   - If an element has hardcoded `text-white` and is not explicitly exempted in `index.css`, it becomes invisible white-on-white text in light mode!
   - Prefer semantic text classes such as `text-neutral-900 dark:text-white` or rely on `src/index.css` global theme overrides.
2. **Never hardcode dark borders in light mode**:
   - Light mode expects bold, dark borders (`border-black` or `border-neutral-700`). Low contrast gray borders like `border-neutral-800` on light backgrounds look washed out.
3. **Use CSS Variables for Theme Agility**:
   - Backgrounds: `var(--cmd-app-bg)`, `var(--cmd-surface)`, `var(--cmd-component)`
   - Text: `var(--cmd-text-body)`, `var(--cmd-text-meta)`, `var(--cmd-text-h1)`
   - Accents: `var(--cmd-primary)` (`#FFE600`), `var(--cmd-success)` (`#00FF66`), `var(--cmd-danger)` (`#FF3333`)
4. **Mandatory Dual-Theme Verification**:
   - When building or editing any component, mentally or visually verify contrast under:
     - `data-theme="dark"`
     - `data-theme="light"`

---

## 4. Neo-Brutalist Aesthetic Specifications

- **Border Radius**: Always `rounded-none` (`border-radius: 0px`). Do not use `rounded`, `rounded-md`, `rounded-full` (except for pure circular status indicator dots).
- **Borders**: Sharp, prominent 2px solid borders (`border-2 border-black` or `border-2 border-neutral-700`).
- **Shadows**: Hard, non-blurry drop shadows:
  - Small: `shadow-[2px_2px_0px_0px_#000000]`
  - Standard: `shadow-[3px_3px_0px_0px_#000000]` or `shadow-[4px_4px_0px_0px_#000000]`
- **Typography**:
  - Monospaced labels and tags: JetBrains Mono (`font-mono`, uppercase, tracking-wider).
  - Headings: Bold, uppercase, often prefixed with industrial markers (e.g. `// TASK DETAILS`).

---

## 5. Snowflake SafeId Handling

- In TypeScript, always type entity IDs (`taskId`, `projectId`, `bucketId`, `alertId`) as `string` (or `string | number`).
- When comparing IDs:
  ```ts
  // ALWAYS DO THIS:
  String(task.id) === String(selectedTaskId)

  // NEVER DO THIS (causes truncation on >53-bit integers):
  Number(task.id) === Number(selectedTaskId)
  parseInt(task.id) === parseInt(selectedTaskId)
  ```

---

## 6. Pre-Commit Checklist
Before completing any frontend task, verify:
- [ ] Ran `bun run build` and zero TypeScript or Vite compilation errors occurred.
- [ ] Reusable components from `src/design-system/` were used instead of custom duplicates.
- [ ] Tested or audited all modified screens in both **Dark Mode** and **Light Mode**.
- [ ] No BigInt/Snowflake IDs are converted to JavaScript `Number`.
