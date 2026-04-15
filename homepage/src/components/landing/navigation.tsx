"use client";

import { useState, useEffect } from "react";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const NAV_ITEMS = [
  { label: "서비스 소개", href: "#features" },
  { label: "활용 사례", href: "#use-cases" },
  { label: "고객 후기", href: "#testimonials" },
  { label: "요금제", href: "#pricing" },
];

export function Navigation() {
  const [isOpen, setIsOpen] = useState(false);
  const [isScrolled, setIsScrolled] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => setIsScrolled(!entry.isIntersecting),
      { threshold: 0 }
    );
    const sentinel = document.getElementById("nav-sentinel");
    if (sentinel) observer.observe(sentinel);
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div id="nav-sentinel" className="absolute top-0 h-1 w-full" />
      <nav
        className={`fixed left-1/2 top-4 z-40 -translate-x-1/2 rounded-full border border-white/10 px-2 py-2 transition-all duration-500 ease-supanova ${
          isScrolled
            ? "bg-zinc-950/80 backdrop-blur-xl shadow-lg"
            : "bg-white/5 backdrop-blur-md"
        }`}
      >
        <div className="flex items-center gap-1">
          <a
            href="#"
            className="flex items-center gap-2 rounded-full px-4 py-2 text-sm font-bold text-zinc-100"
          >
            <IconifyIcon icon="solar:home-2-bold" width="20" height="20" />
            <span>MyHome</span>
          </a>

          <div className="hidden items-center gap-1 md:flex">
            {NAV_ITEMS.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-full px-4 py-2 text-sm text-zinc-400 transition-colors duration-300 hover:bg-white/5 hover:text-zinc-100"
              >
                {item.label}
              </a>
            ))}
          </div>

          <a
            href="#cta"
            className="ml-2 hidden rounded-full bg-accent px-5 py-2 text-sm font-semibold text-zinc-950 transition-all duration-500 ease-supanova hover:scale-[1.02] active:scale-[0.98] md:block"
          >
            시작하기
          </a>

          <button
            onClick={() => setIsOpen(!isOpen)}
            className="flex h-10 w-10 items-center justify-center rounded-full text-zinc-400 transition-colors hover:bg-white/5 hover:text-zinc-100 md:hidden"
            aria-label="메뉴 열기"
          >
            <IconifyIcon
              icon={isOpen ? "solar:close-circle-linear" : "solar:hamburger-menu-linear"}
              width="22"
              height="22"
            />
          </button>
        </div>
      </nav>

      {isOpen && (
        <div className="fixed inset-0 z-30 flex flex-col items-center justify-center gap-6 bg-zinc-950/95 backdrop-blur-3xl md:hidden">
          {NAV_ITEMS.map((item, i) => (
            <a
              key={item.href}
              href={item.href}
              onClick={() => setIsOpen(false)}
              className="text-2xl font-semibold text-zinc-100 transition-all duration-500 ease-supanova animate-fade-in-up"
              style={{ "--delay": `${i * 80}ms` } as React.CSSProperties}
            >
              {item.label}
            </a>
          ))}
          <a
            href="#cta"
            onClick={() => setIsOpen(false)}
            className="mt-4 rounded-full bg-accent px-8 py-4 text-lg font-semibold text-zinc-950 animate-fade-in-up"
            style={{ "--delay": "320ms" } as React.CSSProperties}
          >
            시작하기
          </a>
        </div>
      )}
    </>
  );
}
