import {
  Bold,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link2,
  List,
  ListChecks,
  Quote,
  Strikethrough,
  Table2,
} from 'lucide-react';
import { cn } from '../../lib/utils';

export type ToolbarAction =
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bold'
  | 'italic'
  | 'strike'
  | 'checklist'
  | 'bullet'
  | 'code'
  | 'table'
  | 'quote'
  | 'link';

const GROUPS: { actions: { key: ToolbarAction; title: string; icon: React.ReactNode }[] }[] = [
  {
    actions: [
      { key: 'h1', title: 'Heading 1', icon: <Heading1 className="size-3.5" /> },
      { key: 'h2', title: 'Heading 2', icon: <Heading2 className="size-3.5" /> },
      { key: 'h3', title: 'Heading 3', icon: <Heading3 className="size-3.5" /> },
    ],
  },
  {
    actions: [
      { key: 'bold', title: 'Bold', icon: <Bold className="size-3.5" /> },
      { key: 'italic', title: 'Italic', icon: <Italic className="size-3.5" /> },
      { key: 'strike', title: 'Strikethrough', icon: <Strikethrough className="size-3.5" /> },
      { key: 'code', title: 'Code block', icon: <Code2 className="size-3.5" /> },
    ],
  },
  {
    actions: [
      { key: 'checklist', title: 'Checklist', icon: <ListChecks className="size-3.5" /> },
      { key: 'bullet', title: 'Bullet list', icon: <List className="size-3.5" /> },
      { key: 'quote', title: 'Quote', icon: <Quote className="size-3.5" /> },
      { key: 'table', title: 'Insert table', icon: <Table2 className="size-3.5" /> },
      { key: 'link', title: 'Insert link', icon: <Link2 className="size-3.5" /> },
    ],
  },
];

export function EditorToolbar({
  onAction,
  disabled,
}: {
  onAction: (action: ToolbarAction) => void;
  disabled?: boolean;
}) {
  return (
    <div
      role="toolbar"
      aria-label="Markdown formatting"
      className="flex flex-wrap items-center gap-0.5 border-b border-zinc-800/70 px-3 py-1.5"
    >
      {GROUPS.map((group, gi) => (
        <div key={gi} className="flex items-center gap-0.5">
          {gi > 0 && <span aria-hidden className="mx-1 h-4 w-px bg-zinc-800" />}
          {group.actions.map((a) => (
            <button
              key={a.key}
              type="button"
              title={a.title}
              aria-label={a.title}
              disabled={disabled}
              onClick={() => onAction(a.key)}
              className={cn(
                'flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-zinc-400 transition-colors',
                'hover:bg-zinc-800 hover:text-zinc-100 active:translate-y-px',
                'disabled:cursor-not-allowed disabled:opacity-40',
              )}
            >
              {a.icon}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
