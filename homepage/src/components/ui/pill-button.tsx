import { IconifyIcon } from "./iconify-icon";

interface PillButtonProps {
  children: React.ReactNode;
  variant?: "primary" | "secondary";
  href?: string;
  className?: string;
  onClick?: () => void;
}

export function PillButton({
  children,
  variant = "primary",
  href,
  className = "",
  onClick,
}: PillButtonProps) {
  const base =
    "group inline-flex items-center gap-3 rounded-full px-8 py-4 text-lg font-semibold transition-all duration-500 ease-supanova focus:outline-none focus:ring-2 focus:ring-accent/50 focus:ring-offset-2 focus:ring-offset-zinc-950";

  const variants = {
    primary:
      "bg-accent text-zinc-950 hover:scale-[1.02] active:scale-[0.98] hover:shadow-[0_0_30px_rgba(16,185,129,0.2)]",
    secondary:
      "bg-white/5 text-zinc-100 ring-1 ring-white/10 hover:bg-white/10 hover:scale-[1.02] active:scale-[0.98]",
  };

  const inner = (
    <>
      <span>{children}</span>
      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-black/10 transition-transform duration-500 ease-supanova group-hover:translate-x-1">
        <IconifyIcon icon="solar:arrow-right-linear" width="16" height="16" />
      </span>
    </>
  );

  if (href) {
    return (
      <a href={href} className={`${base} ${variants[variant]} ${className}`}>
        {inner}
      </a>
    );
  }

  return (
    <button
      onClick={onClick}
      className={`${base} ${variants[variant]} ${className}`}
    >
      {inner}
    </button>
  );
}
