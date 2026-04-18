# Design System Inspired by Airtable

## 1. Visual Theme & Atmosphere

Airtable's website is a clean, enterprise-friendly platform that communicates "sophisticated simplicity" through a white canvas with deep navy text (`#181d26`) and Airtable Blue (`#1b61c9`) as the primary interactive accent. The Haas font family (display + text variants) creates a Swiss-precision typography system with positive letter-spacing throughout.

**Key Characteristics:**
- White canvas with deep navy text (`#181d26`)
- Airtable Blue (`#1b61c9`) as primary CTA and link color
- Haas + Haas Groot Disp dual font system
- Positive letter-spacing on body text (0.08px–0.28px)
- 12px radius buttons, 16px–32px for cards
- Multi-layer blue-tinted shadow: `rgba(45,127,249,0.28) 0px 1px 3px`
- Semantic theme tokens: `--theme_*` CSS variable naming

## 2. Color Palette & Roles

### Primary
- **Deep Navy** (`#181d26`): Primary text
- **Airtable Blue** (`#1b61c9`): CTA buttons, links
- **White** (`#ffffff`): Primary surface
- **Spotlight** (`rgba(249,252,255,0.97)`): `--theme_button-text-spotlight`

### Semantic
- **Success Green** (`#006400`): `--theme_success-text`
- **Weak Text** (`rgba(4,14,32,0.69)`): `--theme_text-weak`
- **Secondary Active** (`rgba(7,12,20,0.82)`): `--theme_button-text-secondary-active`

### Neutral
- **Dark Gray** (`#333333`): Secondary text
- **Mid Blue** (`#254fad`): Link/accent blue variant
- **Border** (`#e0e2e6`): Card borders
- **Light Surface** (`#f8fafc`): Subtle surface

### Shadows
- **Blue-tinted** (`rgba(0,0,0,0.32) 0px 0px 1px, rgba(0,0,0,0.08) 0px 0px 2px, rgba(45,127,249,0.28) 0px 1px 3px, rgba(0,0,0,0.06) 0px 0px 0px 0.5px inset`)
- **Soft** (`rgba(15,48,106,0.05) 0px 0px 20px`)

## 3. Typography Rules

### Font Families
- **Primary**: `Haas`, fallbacks: `-apple-system, system-ui, Segoe UI, Roboto`
- **Display**: `Haas Groot Disp`, fallback: `Haas`

### Hierarchy

| Role | Font | Size | Weight | Line Height | Letter Spacing |
|------|------|------|--------|-------------|----------------|
| Display Hero | Haas | 48px | 400 | 1.15 | normal |
| Display Bold | Haas Groot Disp | 48px | 900 | 1.50 | normal |
| Section Heading | Haas | 40px | 400 | 1.25 | normal |
| Sub-heading | Haas | 32px | 400–500 | 1.15–1.25 | normal |
| Card Title | Haas | 24px | 400 | 1.20–1.30 | 0.12px |
| Feature | Haas | 20px | 400 | 1.25–1.50 | 0.1px |
| Body | Haas | 18px | 400 | 1.35 | 0.18px |
| Body Medium | Haas | 16px | 500 | 1.30 | 0.08–0.16px |
| Button | Haas | 16px | 500 | 1.25–1.30 | 0.08px |
| Caption | Haas | 14px | 400–500 | 1.25–1.35 | 0.07–0.28px |

## 4. Component Stylings

### Buttons
- **Primary Blue**: `#1b61c9`, white text, 16px 24px padding, 12px radius
- **White**: white bg, `#181d26` text, 12px radius, 1px border white
- **Cookie Consent**: `#1b61c9` bg, 2px radius (sharp)

### Cards: `1px solid #e0e2e6`, 16px–24px radius
### Inputs: Standard Haas styling

## 5. Layout
- Spacing: 1–48px (8px base)
- Radius: 2px (small), 12px (buttons), 16px (cards), 24px (sections), 32px (large), 50% (circles)

## 6. Depth
- Blue-tinted multi-layer shadow system
- Soft ambient: `rgba(15,48,106,0.05) 0px 0px 20px`

## 7. Do's and Don'ts
### Do: Use Airtable Blue for CTAs, Haas with positive tracking, 12px radius buttons
### Don't: Skip positive letter-spacing, use heavy shadows

## 7-DARK. Dark Mode Variant (mybot 내부 dashboard/easy)

랜딩(라이트, Airtable 톤)과 별개로, 내부 분석 도구는 다크 모드 사용. 같은 디자인 원칙(절제·12px·positive tracking·아이콘 단색)을 다크 토큰으로 매핑.

### Color Mapping
| Light (랜딩) | Dark (내부) | 역할 |
|---|---|---|
| `#ffffff` 흰 캔버스 | `#0b0e1a` 깊은 네이비 | Primary background |
| `#181d26` deep navy text | `#e2e8f0` near-white text | Primary foreground |
| `#1b61c9` Airtable Blue | `#4d8df9` Bright Blue (채도 ↑) | Primary CTA / link |
| `#e0e2e6` border | `rgba(255,255,255,0.06)` border | Card / divider |
| `#f8fafc` subtle surface | `#1a1d2e` raised surface | Card bg |
| `#181d26/82` weak text | `#94a3b8` muted text | Secondary text |

### Tokens (CSS vars on .dark)
```
.dark {
  --background: #0b0e1a;
  --foreground: #e2e8f0;
  --card-bg: #1a1d2e;
  --card-border: rgba(255,255,255,0.06);
  --muted: #94a3b8;
  --muted-bg: #1e2235;
  --primary: #4d8df9;
}
```

### Icon Rules (양 모드 공통 — AI 티 제거의 핵심)
- **컬러 아이콘 금지**: 시선 분산 + 일러스트 풍 = AI 가 만든 인상
- 사이드바 아이콘: `currentColor` 사용 → 텍스트와 같은 색 (라이트 `#181d26/70` / 다크 `#94a3b8`)
- Active 시 더 진한 단색 + 좌측 인디케이터로 강조 (색만으로 구분 X)
- 큰 장식 아이콘(카드 위 거대 SVG·이모지) 모두 제거
- 차트·affordance(화살표/토글/✕)는 유지하되 단색만
- 이모지(🏠📊💬 등) 모두 제거 — "AI 가 만든" 가장 강한 신호

## 8. Responsive Behavior
Breakpoints: 425–1664px (23 breakpoints)

## 9. Agent Prompt Guide
- Text: Deep Navy (`#181d26`)
- CTA: Airtable Blue (`#1b61c9`)
- Background: White (`#ffffff`)
- Border: `#e0e2e6`
