import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, className = '' }) => {
  return (
    <div className={`font-mono text-[11px] leading-relaxed text-neutral-300 dark:text-neutral-300 light:text-neutral-900 ${className}`}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ node, ...props }) => (
            <h1
              className="text-[13px] font-black uppercase tracking-wide text-[#FFE600] dark:text-[#FFE600] light:text-neutral-950 mt-3 mb-1.5 pb-1 border-b-2 border-neutral-800 dark:border-neutral-800 light:border-black"
              {...props}
            />
          ),
          h2: ({ node, ...props }) => (
            <h2
              className="text-[12px] font-black uppercase tracking-wide text-white dark:text-white light:text-neutral-950 mt-2.5 mb-1.5 pb-0.5 border-b border-neutral-800 dark:border-neutral-800 light:border-neutral-300"
              {...props}
            />
          ),
          h3: ({ node, ...props }) => (
            <h3
              className="text-[11px] font-black uppercase tracking-wider text-[#FFE600] dark:text-[#FFE600] light:text-amber-800 mt-2 mb-1"
              {...props}
            />
          ),
          h4: ({ node, ...props }) => (
            <h4
              className="text-[11px] font-bold uppercase tracking-wider text-neutral-200 dark:text-neutral-200 light:text-neutral-800 mt-2 mb-1"
              {...props}
            />
          ),
          p: ({ node, ...props }) => (
            <p className="my-1.5 leading-relaxed" {...props} />
          ),
          ul: ({ node, ...props }) => (
            <ul className="list-disc list-outside pl-4 space-y-1 my-1.5" {...props} />
          ),
          ol: ({ node, ...props }) => (
            <ol className="list-decimal list-outside pl-4 space-y-1 my-1.5" {...props} />
          ),
          li: ({ node, ...props }) => (
            <li className="leading-relaxed pl-1" {...props} />
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
                  className="px-1 py-0.5 text-[10.5px] font-mono bg-black/60 dark:bg-black/60 light:bg-neutral-200 text-[#FFE600] dark:text-[#FFE600] light:text-amber-900 border border-neutral-700 dark:border-neutral-700 light:border-neutral-400 rounded-none shadow-[1px_1px_0px_0px_#000000]"
                  {...props}
                >
                  {children}
                </code>
              );
            }

            return (
              <pre className="my-2.5 p-2.5 bg-black dark:bg-black light:bg-neutral-100 text-[#00FF66] dark:text-[#00FF66] light:text-emerald-800 border-2 border-black dark:border-neutral-700 light:border-black font-mono text-[11px] overflow-x-auto shadow-[2px_2px_0px_0px_#000000] rounded-none">
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
