interface DoubleBezelCardProps {
  children: React.ReactNode;
  className?: string;
  innerClassName?: string;
}

export function DoubleBezelCard({
  children,
  className = "",
  innerClassName = "",
}: DoubleBezelCardProps) {
  return (
    <div
      className={`rounded-[2rem] bg-white/5 p-1.5 ring-1 ring-white/10 ${className}`}
    >
      <div
        className={`rounded-[calc(2rem-0.375rem)] bg-zinc-900/80 p-6 shadow-[inset_0_1px_1px_rgba(255,255,255,0.15)] ${innerClassName}`}
      >
        {children}
      </div>
    </div>
  );
}
