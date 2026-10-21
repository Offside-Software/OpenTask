import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

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
      className={`${useSans ? 'font-sans font-medium' : 'font-mono'} text-neutral-300 dark:text-neutral-300 light:text-neutral-900 ${compact ? 'leading-normal' : 'leading-relaxed'} ${className}`}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className={`${compact ? 'text-[1.1em] mt-1 mb-0.5' : useSans ? 'text-[1.35em] mt-3 mb-1.5 pb-1' : 'text-[13px] mt-3 mb-1.5 pb-1'} font-black uppercase tracking-wide text-[#FFE600] dark:text-[#FFE600] light:text-neutral-950 border-b-2 border-neutral-800 dark:border-neutral-800 light:border-black`}
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className={`${compact ? 'text-[1.05em] mt-1 mb-0.5' : useSans ? 'text-[1.2em] mt-2.5 mb-1.5 pb-0.5' : 'text-[12px] mt-2.5 mb-1.5 pb-0.5'} font-black uppercase tracking-wide text-white dark:text-white light:text-neutral-950 border-b border-neutral-800 dark:border-neutral-800 light:border-neutral-300`}
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className={`${compact ? 'text-[1em] mt-0.5 mb-0.5' : useSans ? 'text-[1.1em] mt-2 mb-1' : 'text-[11px] mt-2 mb-1'} font-black uppercase tracking-wider text-[#FFE600] dark:text-[#FFE600] light:text-amber-800`}
              {...props}
            />
          ),
          h4: ({ node, ...props }) => (
            <h4
              className={`${compact ? 'text-[0.95em] mt-0.5 mb-0.5' : useSans ? 'text-[1.05em] mt-2 mb-1' : 'text-[11px] mt-2 mb-1'} font-bold uppercase tracking-wider text-neutral-200 dark:text-neutral-200 light:text-neutral-800`}
              {...props}
            />
          ),
          p: ({ node, ...props }) => (
            <p className={`${compact ? 'my-0.5 leading-normal' : 'my-1.5 leading-relaxed'}`} {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className={`list-disc list-outside pl-4 ${compact ? 'space-y-0.5 my-0.5' : 'space-y-1 my-1.5'}`} {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className={`list-decimal list-outside pl-4 ${compact ? 'space-y-0.5 my-0.5' : 'space-y-1 my-1.5'}`} {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className={`${compact ? 'leading-normal' : 'leading-relaxed'} pl-1`} {...props} />
          ),
          strong: ({ node, ...props }) => (
            <strong className="font-bold text-white dark:text-white light:text-black" {...props} />
          ),
          em: ({ node, ...props }) => (
            <em className="italic text-neutral-300 dark:text-neutral-300 light:text-neutral-700" {...props} />
          ),
          code: ({ node, className: codeClassName, children, ...props }: any) => {
            const hasNewLine = typeof children === 'string' && children.includes('\n');
            const isCodeBlock = Boolean(codeClassName) || hasNewLine;

            if (!isCodeBlock) {
              return (
                <code
                  className="py-1 px-1.5 text-[0.9em] font-mono bg-black/80 text-[#00FF66] dark:text-[#FFE600] light:text-amber-900 border border-neutral-700 dark:border-neutral-700 light:border-neutral-400 rounded-none shadow-[1px_1px_0px_0px_#000000]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre className="my-2.5 p-2.5 bg-black dark:bg-black light:bg-neutral-100 text-[#00FF66] dark:text-[#00FF66] light:text-emerald-800 border-2 border-black dark:border-neutral-700 light:border-black font-mono text-[0.9em] overflow-x-auto shadow-[2px_2px_0px_0px_#000000] rounded-none">
                <code {...props}>{children}</code>
              </pre>
            );
          },
          blockquote: ({ node, ...props }) => (
            <blockquote
              className="border-l-2 border-[#FFE600] pl-3 py-1 my-2 bg-neutral-900/50 dark:bg-neutral-900/50 light:bg-neutral-100 text-neutral-300 dark:text-neutral-300 light:text-neutral-700 italic"
              {...props}
            />
          ),
          a: ({ node, ...props }) => (
            <a
              className="text-[#FFE600] dark:text-[#FFE600] light:text-blue-600 underline font-bold hover:text-yellow-300 transition-colors"
              target="_blank"
              rel="noopener noreferrer"
              {...props}
            />
          ),
          hr: ({ node, ...props }) => (
            <hr className="my-3 border-neutral-800 dark:border-neutral-800 light:border-neutral-300" {...props} />
          ),
          table: ({ node, ...props }) => (
            <div className="overflow-x-auto my-2 border border-neutral-800 dark:border-neutral-800 light:border-neutral-300 shadow-[2px_2px_0px_0px_#000000]">
              <table className="w-full text-left border-collapse text-[11px]" {...props} />
            </div>
          ),
          th: ({ node, ...props }) => (
            <th
              className="border border-neutral-700 dark:border-neutral-700 light:border-neutral-400 p-1.5 bg-black/70 dark:bg-black/70 light:bg-neutral-200 font-black uppercase text-[#FFE600] dark:text-[#FFE600] light:text-black"
              {...props}
            />
          ),
          td: ({ node, ...props }) => (
            <td
              className="border border-neutral-800 dark:border-neutral-800 light:border-neutral-300 p-1.5 text-neutral-300 dark:text-neutral-300 light:text-neutral-800"
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
