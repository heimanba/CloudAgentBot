import { isValidElement, type ReactNode } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "../../lib/utils";
import { CopyAction } from "../../ui/design-system";

function CodeBlock({ children }: { children?: ReactNode }) {
  const code = isValidElement<{ children?: ReactNode }>(children) ? children : null;
  const value = String(code?.props.children ?? "").replace(/\n$/, "");
  return (
    <div className="relative my-3 max-w-full">
      <pre className="m-0 max-w-full overflow-auto rounded-lg border border-border bg-foreground/[0.035] p-3 pr-11">
        {children}
      </pre>
      <CopyAction value={value} label="复制代码" className="absolute top-1.5 right-1.5" />
    </div>
  );
}

export function ChatContent({ content, className }: { content: string; className?: string }) {
  return (
    <div
      className={cn(
        "min-w-0 type-body break-words [&>*:first-child]:mt-0 [&>*:last-child]:mb-0",
        "[&_p]:my-2 [&_h1]:mb-2 [&_h1]:mt-5 [&_h1]:text-[20px] [&_h1]:leading-[28px] [&_h1]:font-semibold",
        "[&_h2]:mb-2 [&_h2]:mt-5 [&_h2]:text-[18px] [&_h2]:leading-[26px] [&_h2]:font-semibold",
        "[&_h3]:mb-1.5 [&_h3]:mt-4 [&_h3]:text-[16px] [&_h3]:leading-[24px] [&_h3]:font-semibold",
        "[&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1 [&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_a]:underline [&_a]:underline-offset-2",
        "[&_code]:rounded-md [&_code]:bg-foreground/[0.06] [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[0.9em]",
        "[&_pre]:max-w-full [&_pre]:overflow-auto",
        "[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_table]:my-3 [&_table]:block [&_table]:max-w-full [&_table]:overflow-auto",
        "[&_th]:border [&_th]:border-border [&_th]:bg-surface-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1 [&_hr]:my-4 [&_hr]:border-border",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: CodeBlock,
          a: ({ children, ...props }) => (
            <a {...props} target="_blank" rel="noreferrer">
              {children}
            </a>
          ),
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
