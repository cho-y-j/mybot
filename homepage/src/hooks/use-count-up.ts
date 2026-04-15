"use client";

import { useEffect, useRef, useState } from "react";

interface UseCountUpOptions {
  end: number;
  duration?: number;
  decimals?: number;
  suffix?: string;
  prefix?: string;
}

export function useCountUp({
  end,
  duration = 2000,
  decimals = 0,
  suffix = "",
  prefix = "",
}: UseCountUpOptions) {
  const [display, setDisplay] = useState(`${prefix}0${suffix}`);
  const ref = useRef<HTMLElement>(null);
  const hasAnimated = useRef(false);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated.current) {
          hasAnimated.current = true;
          observer.unobserve(node);

          const start = performance.now();
          const step = (now: number) => {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            const current = eased * end;

            const formatted = current.toLocaleString("ko-KR", {
              minimumFractionDigits: decimals,
              maximumFractionDigits: decimals,
            });
            setDisplay(`${prefix}${formatted}${suffix}`);

            if (progress < 1) {
              requestAnimationFrame(step);
            }
          };

          requestAnimationFrame(step);
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [end, duration, decimals, suffix, prefix]);

  return { ref, display };
}
