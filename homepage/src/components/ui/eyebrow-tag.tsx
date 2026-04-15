interface EyebrowTagProps {
  children: React.ReactNode;
  className?: string;
}

export function EyebrowTag({ children, className = "" }: EyebrowTagProps) {
  return (
    <span
      className={`inline-block rounded-full bg-accent/10 px-3 py-1 text-[11px] font-medium uppercase tracking-[0.15em] text-accent ${className}`}
    >
      {children}
    </span>
  );
}
