"use client";

import { useScrollReveal } from "@/hooks/use-scroll-reveal";

interface SectionWrapperProps {
  children: React.ReactNode;
  id?: string;
  className?: string;
}

export function SectionWrapper({
  children,
  id,
  className = "",
}: SectionWrapperProps) {
  const { ref, isVisible } = useScrollReveal();

  return (
    <section
      id={id}
      ref={ref}
      className={`py-24 md:py-32 lg:py-40 ${isVisible ? "reveal-visible" : "reveal-hidden"} ${className}`}
    >
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">{children}</div>
    </section>
  );
}
