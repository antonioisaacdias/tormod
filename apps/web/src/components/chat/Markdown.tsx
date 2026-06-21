import { memo } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { cn } from '@/lib/cn'

const components: Components = {
  p: ({ ...props }) => <p className="mb-2 last:mb-0" {...props} />,
  h1: ({ ...props }) => <h1 className="mb-1.5 mt-3 text-base font-bold first:mt-0" {...props} />,
  h2: ({ ...props }) => <h2 className="mb-1.5 mt-3 text-[15px] font-bold first:mt-0" {...props} />,
  h3: ({ ...props }) => <h3 className="mb-1 mt-2.5 text-sm font-bold first:mt-0" {...props} />,
  ul: ({ ...props }) => <ul className="mb-2 list-disc space-y-0.5 pl-5 last:mb-0" {...props} />,
  ol: ({ ...props }) => <ol className="mb-2 list-decimal space-y-0.5 pl-5 last:mb-0" {...props} />,
  li: ({ ...props }) => <li className="leading-relaxed" {...props} />,
  strong: ({ ...props }) => <strong className="font-semibold text-frost" {...props} />,
  em: ({ ...props }) => <em className="italic" {...props} />,
  a: ({ ...props }) => (
    <a target="_blank" rel="noreferrer" className="text-arc underline underline-offset-2" {...props} />
  ),
  blockquote: ({ ...props }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 text-mist last:mb-0" {...props} />
  ),
  hr: () => <hr className="my-3 border-border" />,
  pre: ({ ...props }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-ink/70 p-2.5 text-[12.5px] leading-relaxed last:mb-0" {...props} />
  ),
  code: ({ className, children, ...props }) => {
    const isBlock = (className?.includes('language-') ?? false) || String(children).includes('\n')
    if (isBlock) {
      return (
        <code className={cn('font-mono', className)} {...props}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-ink/60 px-1 py-0.5 font-mono text-[12.5px] text-frost" {...props}>
        {children}
      </code>
    )
  },
  table: ({ ...props }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-[13px]" {...props} />
    </div>
  ),
  th: ({ ...props }) => <th className="border border-border px-2 py-1 font-semibold" {...props} />,
  td: ({ ...props }) => <td className="border border-border px-2 py-1" {...props} />,
}

interface MarkdownProps {
  children: string
}

export const Markdown = memo(function Markdown({ children }: MarkdownProps) {
  return (
    <div className="break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {children}
      </ReactMarkdown>
    </div>
  )
})
