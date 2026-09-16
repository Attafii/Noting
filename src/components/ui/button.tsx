import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '../../lib/utils';

const buttonVariants = cva(
  'inline-flex shrink-0 cursor-pointer items-center justify-center gap-1.5 rounded-xl font-semibold whitespace-nowrap transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-3.5 [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        accent:
          'bg-accent-500 text-zinc-950 shadow-[0_0_0_1px_rgb(231196124/0.25),0_4px_16px_-4px_rgb(20115463/0.45)] hover:bg-accent-400 active:scale-[0.98]',
        secondary:
          'border border-zinc-700/70 bg-zinc-800/70 text-zinc-200 hover:border-zinc-600 hover:bg-zinc-700/70 active:scale-[0.98]',
        ghost: 'text-zinc-400 hover:bg-zinc-800/70 hover:text-zinc-100 active:scale-[0.98]',
        danger:
          'border border-red-900/60 bg-red-950/50 text-red-300 hover:border-red-800 hover:bg-red-900/40 active:scale-[0.98]',
      },
      size: {
        sm: 'h-7 px-2.5 text-xs',
        md: 'h-8 px-3.5 text-[13px]',
        icon: 'h-8 w-8',
        'icon-sm': 'h-7 w-7',
      },
    },
    defaultVariants: { variant: 'secondary', size: 'md' },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, type = 'button', ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
});
