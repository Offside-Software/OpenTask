import React, { useState, useRef, useEffect } from "react";
import { Code2, Sparkles, CheckCircle2, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface MermaidTemplate {
  name: string;
  category: string;
  code: string;
}

export const MERMAID_TEMPLATES: MermaidTemplate[] = [
  {
    name: "Architecture Flowchart",
    category: "Flowcharts",
    code: `flowchart TD
    Client["Web Client (React)"] -->|REST / WS| Gateway["API Gateway"]
    Gateway --> Auth["Auth Service"]
    Gateway --> TaskSvc["Task Engine"]
    TaskSvc --> DB[("PostgreSQL DB")]
    TaskSvc --> Cache[("Redis Cache")]
    TaskSvc -.-> Queue["Event Queue"]`,
  },
  {
    name: "Sequence Diagram",
    category: "Sequences",
    code: `sequenceDiagram
    autonumber
    actor User
    participant App as Web App
    participant API as OpenTask API
    participant DB as PostgreSQL

    User->>App: Click 'Move Task'
    App->>API: PUT /tasks/{id} { bucket_id }
    API->>DB: UPDATE opentask.tasks
    DB-->>API: 200 OK
    API-->>App: Task Updated
    API-)App: WS Broadcast (task.moved)`,
  },
  {
    name: "Task Lifecycle State",
    category: "State",
    code: `stateDiagram-v2
    [*] --> DRAFT
    DRAFT --> PENDING: Submit for Review
    PENDING --> TODO: Approved
    TODO --> ONGOING: Start Working
    ONGOING --> ON_REVIEW: Open Pull Request
    ON_REVIEW --> COMPLETED: PR Merged
    COMPLETED --> [*]`,
  },
  {
    name: "Entity Relationship",
    category: "Database",
    code: `erDiagram
    PROJECT ||--o{ BUCKET : contains
    BUCKET ||--o{ TASK : categorizes
    PROJECT ||--o{ PROJECT_DIAGRAM : owns
    TASK ||--o{ TASK_ATTACHMENT : has
    PROJECT ||--o{ PROJECT_MEMBER : includes`,
  },
  {
    name: "Mindmap",
    category: "Brainstorming",
    code: `mindmap
  root((OpenTask))
    Board
      Kanban
      Focus Mode
      Filter & Search
    Intelligence
      Meeting Transcription
      AI PR Review
      Stagnation Radar
    Diagrams
      Mermaid Editor
      Export PNG JPG PDF
      Attach to Tasks`,
  },
  {
    name: "Git Branching Model",
    category: "Git",
    code: `gitGraph
    commit id: "Initial"
    branch dev
    checkout dev
    commit id: "feat: setup"
    branch feat/diagrams
    checkout feat/diagrams
    commit id: "feat: viewer"
    commit id: "feat: export"
    checkout dev
    merge feat/diagrams
    checkout master
    merge dev tag: "v1.2.0"`,
  },
  {
    name: "Class Diagram",
    category: "Architecture",
    code: `classDiagram
    class Project {
      +String id
      +String name
      +createTask()
    }
    class Task {
      +String id
      +String title
      +String status
      +assign()
    }
    Project "1" *-- "many" Task : contains`,
  },
];

interface MermaidEditorProps {
  code: string;
  onChange: (value: string) => void;
  className?: string;
  error?: string | null;
}

export const MermaidEditor: React.FC<MermaidEditorProps> = ({
  code,
  onChange,
  className,
  error,
}) => {
  const [isTemplatesOpen, setIsTemplatesOpen] = useState(false);
  const templateMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        templateMenuRef.current &&
        !templateMenuRef.current.contains(e.target as Node)
      ) {
        setIsTemplatesOpen(false);
      }
    };
    if (isTemplatesOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isTemplatesOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enable Tab indentation (2 spaces)
    if (e.key === "Tab") {
      e.preventDefault();
      const textarea = e.currentTarget;
      const start = textarea.selectionStart;
      const end = textarea.selectionEnd;

      const next = code.substring(0, start) + "  " + code.substring(end);
      onChange(next);

      // Restore cursor position
      setTimeout(() => {
        textarea.selectionStart = textarea.selectionEnd = start + 2;
      }, 0);
    }
  };

  return (
    <div className={cn("flex flex-col h-full bg-card border border-border rounded-xl shadow-xs overflow-hidden", className)}>
      {/* Editor Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-muted/30 border-b border-border flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <Code2 size={14} className="text-primary shrink-0" />
          <span className="text-xs font-semibold uppercase tracking-wider text-foreground">
            Mermaid Source
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Syntax Status */}
          {error ? (
            <div className="flex items-center gap-1 text-[11px] font-medium text-destructive">
              <AlertCircle size={13} />
              <span>Syntax error</span>
            </div>
          ) : (
            <div className="flex items-center gap-1 text-[11px] font-medium text-emerald-500">
              <CheckCircle2 size={13} />
              <span>Valid syntax</span>
            </div>
          )}

          {/* Template Presets Dropdown */}
          <div className="relative" ref={templateMenuRef}>
            <button
              type="button"
              onClick={() => setIsTemplatesOpen((prev) => !prev)}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-muted/60 hover:bg-muted text-foreground text-xs font-medium border border-border transition-colors cursor-pointer"
            >
              <Sparkles size={12} className="text-primary" />
              <span>Templates</span>
            </button>

            {isTemplatesOpen && (
              <div className="absolute right-0 top-full mt-1.5 w-60 rounded-xl border border-border bg-popover text-popover-foreground shadow-[3px_3px_0px_0px_#000000] z-50 p-1.5 animate-in fade-in zoom-in-95 duration-100">
                <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border mb-1">
                  Load Preset Diagram
                </div>
                {MERMAID_TEMPLATES.map((tmpl) => (
                  <button
                    key={tmpl.name}
                    type="button"
                    onClick={() => {
                      onChange(tmpl.code);
                      setIsTemplatesOpen(false);
                    }}
                    className="w-full text-left px-2 py-1.5 rounded-lg hover:bg-muted text-xs transition-colors flex items-center justify-between cursor-pointer group"
                  >
                    <span className="font-medium truncate group-hover:text-primary">
                      {tmpl.name}
                    </span>
                    <span className="text-[10px] text-muted-foreground ml-2 shrink-0 font-mono">
                      {tmpl.category}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Code Textarea */}
      <div className="flex-1 min-h-0 relative">
        <textarea
          value={code}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="flowchart TD&#10;    A[Client] --> B[Server]&#10;    B --> C[Database]"
          spellCheck={false}
          className="w-full h-full p-4 font-mono text-xs sm:text-[13px] leading-relaxed bg-transparent text-foreground placeholder:text-muted-foreground/50 resize-none focus:outline-none no-scrollbar selection:bg-primary/20"
        />
      </div>

      {/* Editor Footer */}
      <div className="px-3 py-1.5 bg-muted/20 border-t border-border flex items-center justify-between text-[10px] text-muted-foreground font-mono">
        <span>Press Tab to indent</span>
        <span>{code.split("\n").length} lines • {code.length} chars</span>
      </div>
    </div>
  );
};
