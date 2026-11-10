import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { cn } from '@/lib/utils';

/**
 * Detects whether a string contains Markdown formatting syntax.
 */
export const hasMarkdownSyntax = (text?: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const mdRegex = /(?:^|\n)(?:#{1,6}\s+|>\s+|\s*[-*+]\s+|\s*\d+\.\s+|---|___|\*\*\*)|(?:\*\*|__)(?!\s).+?(?!\s)(?:\*\*|__)|(?<!\*)\*(?!\s)[^*\n]+?(?!\s)\*(?!\*)|(?<!_)_(?!\s)[^_\n]+?(?!\s)_(?!_)|`[^`\n]+`|```|!?\[[^\]]*\]\([^)]+\)|~~[^~]+~~|\|[^\n]+\|/m;
  return mdRegex.test(text);
};

export interface MarkdownRendererProps {
  content: string;
  className?: string;
  style?: React.CSSProperties;
  isSans?: boolean;
  compact?: boolean;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({
  content,
  className = '',
  style,
  isSans = false,
  compact = false,
}) => {
  const useSans = isSans || className.includes('font-sans');

  return (
    <div
      style={style}
      className={cn(
        useSans ? 'font-sans font-normal' : 'font-mono',
        'text-foreground/90',
        compact ? 'leading-normal' : 'leading-relaxed',
        className
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className={cn(
                compact ? 'text-[1.1em] mt-1 mb-0.5' : useSans ? 'text-[1.35em] mt-3 mb-1.5 pb-1' : 'text-sm mt-3 mb-1.5 pb-1',
                'font-bold tracking-tight text-foreground border-b border-border/60'
              )}
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className={cn(
                compact ? 'text-[1.05em] mt-1 mb-0.5' : useSans ? 'text-[1.2em] mt-2.5 mb-1.5 pb-0.5' : 'text-xs mt-2.5 mb-1.5 pb-0.5',
                'font-bold tracking-tight text-foreground border-b border-border/40'
              )}
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className={cn(
                compact ? 'text-[1em] mt-0.5 mb-0.5' : useSans ? 'text-[1.1em] mt-2 mb-1' : 'text-xs mt-2 mb-1',
                'font-semibold text-foreground'
              )}
              {...props}
            />
          ),
          h4: ({ node, ...props }) => (
            <h4
              className={cn(
                compact ? 'text-[0.95em] mt-0.5 mb-0.5' : useSans ? 'text-[1.05em] mt-2 mb-1' : 'text-xs mt-2 mb-1',
                'font-medium text-muted-foreground'
              )}
              {...props}
            />
          ),
          p: ({ node, children, ...props }) => {
            const renderWithMentions = (child: React.ReactNode): React.ReactNode => {
              if (typeof child !== 'string') return child;
              const parts = child.split(/(@[a-zA-Z0-9_\-\.]+)/g);
              if (parts.length === 1) return child;
              return parts.map((part, i) => {
                if (part.startsWith('@') && part.length > 1) {
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded bg-muted text-foreground border border-border font-medium text-[0.9em]"
                    >
                      {part}
                    </span>
                  );
                }
                return part;
              });
            };

            const formattedChildren = React.Children.map(children, renderWithMentions);
            return <p className={compact ? 'my-0.5 leading-normal' : 'my-1.5 leading-relaxed'} {...props}>{formattedChildren}</p>;
          },
          ul: ({ node, ...props }) => (
            <ul className={cn('list-disc list-outside pl-4', compact ? 'space-y-0.5 my-0.5' : 'space-y-1 my-1.5')} {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className={cn('list-decimal list-outside pl-4', compact ? 'space-y-0.5 my-0.5' : 'space-y-1 my-1.5')} {...props} />
          ),
          li: ({ node, children, ...props }) => {
            const renderWithMentions = (child: React.ReactNode): React.ReactNode => {
              if (typeof child !== 'string') return child;
              const parts = child.split(/(@[a-zA-Z0-9_\-\.]+)/g);
              if (parts.length === 1) return child;
              return parts.map((part, i) => {
                if (part.startsWith('@') && part.length > 1) {
                  return (
                    <span
                      key={i}
                      className="inline-flex items-center px-1.5 py-0.2 mx-0.5 rounded bg-muted text-foreground border border-border font-medium text-[0.9em]"
                    >
                      {part}
                    </span>
                  );
                }
                return part;
              });
            };
            const formattedChildren = React.Children.map(children, renderWithMentions);
            return <li className={cn(compact ? 'leading-normal' : 'leading-relaxed', 'pl-1')} {...props}>{formattedChildren}</li>;
          },
          strong: ({ node, ...props }) => (
            <strong className="font-semibold text-foreground" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic text-muted-foreground" {...props} />
          ),
          code: ({ node, className: codeClassName, children, ...props }: any) => {
            const hasNewLine = typeof children === 'string' && children.includes('\n');
            const isCodeBlock = Boolean(codeClassName) || hasNewLine;

            if (!isCodeBlock) {
              return (
                <code
                  className="py-0.5 px-1.5 text-[0.875em] font-mono bg-muted text-foreground border border-border/80 rounded-md"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre className="my-2 p-3 bg-muted/60 text-foreground border border-border font-mono text-[0.875em] overflow-x-auto rounded-lg">
                <code {...props}>{children}</code>
              </pre>
            );
          },
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="border-l-2 border-primary pl-3 py-1 my-2 bg-muted/30 text-muted-foreground italic rounded-r-md"
              {...props}
            />
          ),
          a: ({ node, href, children, ...props }) => {
            const isInternal = href?.startsWith('#');
            if (isInternal) {
              return (
                <a
                  href={href}
                  className="inline-flex items-center gap-1 font-mono text-xs px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/25 hover:bg-primary/20 no-underline font-medium transition-colors cursor-pointer"
                  onClick={(e) => {
                    e.preventDefault();
                    const rawTarget = href ? href.replace(/^#/, '') : '';
                    if (rawTarget.startsWith('diagram-')) {
                      const diagramId = rawTarget.replace(/^diagram-/, '');
                      window.dispatchEvent(new CustomEvent('opentask:open-diagram', { detail: { diagramId } }));
                    } else if (rawTarget) {
                      window.dispatchEvent(new CustomEvent('opentask:navigate-task', { detail: { taskId: rawTarget } }));
                    }
                  }}
                  {...props}
                >
                  {children}
                </a>
              );
            }
            return (
              <a
                href={href}
                className="text-primary underline font-medium hover:text-primary/80 transition-colors"
                target="_blank"
                rel="noopener noreferrer"
                {...props}
              >
                {children}
              </a>
            );
          },
          hr: ({ node, ...props }) => (
            <hr className="my-3 border-border" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 border border-border rounded-lg">
              <table className="w-full text-left border-collapse text-xs" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th
              className="border-b border-border p-2 bg-muted/50 font-semibold text-foreground text-xs"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td
              className="border-b border-border/50 p-2 text-foreground/90 text-xs"
              {...props}
            />
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
};
