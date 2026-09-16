import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-9 w-full rounded-xl border border-zinc-800 bg-zinc-900/80 px-3 text-[13px] text-zinc-100 transition-colors duration-200 placeholder:text-zinc-500 hover:border-zinc-700 focus:border-accent-500/60 focus:ring-2 focus:ring-accent-500/20 focus:outline-none',
          className,
        )}
        {...props}
      />
    );
  },
);
