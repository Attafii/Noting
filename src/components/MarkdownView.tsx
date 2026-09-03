import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/** Isolated so the whole markdown toolchain ships in a lazy chunk. */
export function MarkdownView({ text }: { text: string }) {
  return <Markdown remarkPlugins={[remarkGfm]}>{text}</Markdown>;
}
