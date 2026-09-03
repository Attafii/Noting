import type { HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
  {
    variants: {
      variant: {
        neutral: 'border-zinc-700/70 bg-zinc-800/60 text-zinc-300',
        success: 'border-emerald-900/70 bg-emerald-950/60 text-emerald-300',
        warning: 'border-amber-900/70 bg-amber-950/60 text-amber-300',
        error: 'border-red-900/70 bg-red-950/60 text-red-300',
        accent: 'border-accent-600/40 bg-accent-500/10 text-accent-300',
      },
    },
    defaultVariants: { variant: 'neutral' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>, VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
