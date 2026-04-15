import { IconifyIcon } from "@/components/ui/iconify-icon";

const FOOTER_LINKS = [
  { label: "서비스 소개", href: "#features" },
  { label: "요금제", href: "#pricing" },
  { label: "이용약관", href: "#" },
  { label: "개인정보처리방침", href: "#" },
];

const SOCIAL_LINKS = [
  { icon: "solar:letter-bold", href: "mailto:hello@myhome.kr", label: "이메일" },
  { icon: "solar:phone-bold", href: "tel:02-1234-5678", label: "전화" },
];

export function Footer() {
  return (
    <footer className="border-t border-white/5 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="flex flex-col items-center gap-8 md:flex-row md:justify-between">
          {/* Logo + Description */}
          <div className="text-center md:text-left">
            <div className="flex items-center justify-center gap-2 md:justify-start">
              <IconifyIcon icon="solar:home-2-bold" width="20" height="20" />
              <span className="text-lg font-bold text-zinc-100">MyHome</span>
            </div>
            <p className="mt-2 max-w-[35ch] text-sm text-zinc-500">
              나만의 홍보 사이트를 가장 쉽고 빠르게 만드는 플랫폼
            </p>
          </div>

          {/* Links */}
          <nav className="flex flex-wrap justify-center gap-6">
            {FOOTER_LINKS.map((link) => (
              <a
                key={link.label}
                href={link.href}
                className="text-sm text-zinc-500 transition-colors duration-300 hover:text-zinc-300"
              >
                {link.label}
              </a>
            ))}
          </nav>

          {/* Social */}
          <div className="flex gap-3">
            {SOCIAL_LINKS.map((s) => (
              <a
                key={s.label}
                href={s.href}
                aria-label={s.label}
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white/5 text-zinc-400 ring-1 ring-white/10 transition-all duration-300 hover:bg-white/10 hover:text-zinc-100"
              >
                <IconifyIcon icon={s.icon} width="18" height="18" />
              </a>
            ))}
          </div>
        </div>

        <div className="mt-8 text-center text-xs text-zinc-600">
          &copy; 2026 MyHome. All rights reserved.
        </div>
      </div>
    </footer>
  );
}
