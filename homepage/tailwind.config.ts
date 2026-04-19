import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'class',  // admin 영역에 .dark 클래스로 다크 모드 강제
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Pretendard", "system-ui", "sans-serif"],
      },
      colors: {
        airtable: {
          navy: "#181d26",
          blue: "#1b61c9",
          border: "#e0e2e6",
          bg: "#f8fafc",
          surface: "#ffffff",
          textWeak: "rgba(4,14,32,0.69)",
        },
        accent: {
          DEFAULT: "#10b981",
          50: "#ecfdf5",
          100: "#d1fae5",
          200: "#a7f3d0",
          300: "#6ee7b7",
          400: "#34d399",
          500: "#10b981",
          600: "#059669",
          700: "#047857",
          800: "#065f46",
          900: "#064e3b",
          950: "#022c22",
        },
      },
      boxShadow: {
        airtable: "rgba(0, 0, 0, 0.32) 0px 0px 1px, rgba(0, 0, 0, 0.08) 0px 0px 2px, rgba(45, 127, 249, 0.28) 0px 1px 3px, rgba(0, 0, 0, 0.06) 0px 0px 0px 0.5px inset",
        'airtable-subtle': "rgba(15, 48, 106, 0.05) 0px 0px 20px",
      },
      letterSpacing: {
        'airtable-body': '0.18px',
        'airtable-card': '0.12px',
        'airtable-btn': '0.08px',
      },
      transitionTimingFunction: {
        supanova: "cubic-bezier(0.16, 1, 0.3, 1)",
      },
      animation: {
        "fade-in-up": "fadeInUp 0.6s var(--delay, 0s) both",
        float: "float 6s ease-in-out infinite",
        marquee: "marquee 30s linear infinite",
      },
      keyframes: {
        fadeInUp: {
          from: {
            opacity: "0",
            transform: "translateY(2rem)",
            filter: "blur(4px)",
          },
          to: {
            opacity: "1",
            transform: "translateY(0)",
            filter: "blur(0)",
          },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-15px)" },
        },
        marquee: {
          "0%": { transform: "translateX(0)" },
          "100%": { transform: "translateX(-50%)" },
        },
      },
    },
  },
  plugins: [],
};
export default config;
