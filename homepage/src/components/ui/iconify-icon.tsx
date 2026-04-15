"use client";

import { useEffect, useRef } from "react";

interface IconifyIconProps {
  icon: string;
  className?: string;
  width?: string | number;
  height?: string | number;
}

export function IconifyIcon({
  icon,
  className,
  width = "1em",
  height = "1em",
}: IconifyIconProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.setAttribute("icon", icon);
      ref.current.setAttribute("width", String(width));
      ref.current.setAttribute("height", String(height));
    }
  }, [icon, width, height]);

  return (
    <iconify-icon
      ref={ref}
      icon={icon}
      width={String(width)}
      height={String(height)}
      className={className}
      style={{ display: "inline-block", verticalAlign: "middle" }}
    />
  );
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace JSX {
    interface IntrinsicElements {
      "iconify-icon": React.DetailedHTMLProps<
        React.HTMLAttributes<HTMLElement> & {
          icon?: string;
          width?: string;
          height?: string;
          inline?: string;
        },
        HTMLElement
      >;
    }
  }
}
