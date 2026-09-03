import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '../../lib/utils';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, ...props }, ref) {
    return (
      <input
        ref={ref}
        className={cn(
          'h-8 w-full rounded-lg border border-zinc-800 bg-zinc-900/70 px-3 text-[13px] text-zinc-200 transition-colors duration-200 placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-600 focus:outline-none',
          className,
        )}
        {...props}
      />
    );
  },
);
