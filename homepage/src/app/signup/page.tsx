"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { IconifyIcon } from "@/components/ui/iconify-icon";

const TEMPLATE_OPTIONS = [
  { value: "election", label: "선거 후보", desc: "공약, 프로필, 일정, 사진첩 등", icon: "solar:flag-bold" },
  { value: "namecard", label: "개인 명함", desc: "이력, 포트폴리오, 연락처", icon: "solar:user-id-bold" },
  { value: "store", label: "소상공인", desc: "메뉴, 사진, 위치, 예약", icon: "solar:shop-bold" },
];

export default function SignupPage() {
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    templateType: "election",
    code: "",
    name: "",
    phone: "",
    password: "",
    passwordConfirm: "",
    positionTitle: "",
    partyName: "",
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [codeAvailable, setCodeAvailable] = useState<boolean | null>(null);
  const [codeChecking, setCodeChecking] = useState(false);
  const [codeReason, setCodeReason] = useState<string>("");

  function update(key: string, value: string) {
    setForm((prev) => ({ ...prev, [key]: value }));
    if (key === "code") {
      setCodeAvailable(null);
      setCodeReason("");
    }
  }

  // 300ms 디바운스 자동 체크 — 예약어·형식·중복 한 번에
  useEffect(() => {
    const code = form.code.trim();
    if (!code) { setCodeAvailable(null); setCodeReason(""); return; }

    setCodeChecking(true);
    const timer = setTimeout(async () => {
      try {
        const r = await fetch(`/api/public/slug/check?value=${encodeURIComponent(code)}`);
        const d = await r.json();
        setCodeAvailable(!!d?.data?.available);
        setCodeReason(d?.data?.reason || "");
      } catch {
        setCodeAvailable(null);
        setCodeReason("");
      } finally {
        setCodeChecking(false);
      }
    }, 300);

    return () => { clearTimeout(timer); setCodeChecking(false); };
  }, [form.code]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    if (form.password !== form.passwordConfirm) {
      setError("비밀번호가 일치하지 않습니다");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();

      if (!data.success) {
        setError(data.error);
        setLoading(false);
        return;
      }

      router.push(data.data.redirectUrl);
    } catch {
      setError("서버에 연결할 수 없습니다");
      setLoading(false);
    }
  }

  return (
    <div className="min-h-[100dvh] bg-zinc-950 px-4 py-12">
      <div className="mx-auto max-w-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <Link href="/" className="inline-flex items-center gap-2 text-zinc-400 hover:text-zinc-200 mb-6">
            <IconifyIcon icon="solar:arrow-left-linear" width="16" height="16" />
            <span className="text-sm">메인으로</span>
          </Link>
          <h1 className="text-3xl font-bold text-zinc-100">홍보 사이트 만들기</h1>
          <p className="mt-2 text-zinc-500">3분이면 나만의 홍보 사이트가 완성됩니다</p>
        </div>

        {/* Progress */}
        <div className="mb-8 flex items-center justify-center gap-2">
          {[1, 2, 3].map((s) => (
            <div key={s} className="flex items-center gap-2">
              <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${
                step >= s ? "bg-accent text-zinc-950" : "bg-zinc-800 text-zinc-500"
              }`}>
                {s}
              </div>
              {s < 3 && <div className={`h-0.5 w-8 ${step > s ? "bg-accent" : "bg-zinc-800"}`} />}
            </div>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          {/* Step 1: 템플릿 선택 */}
          {step === 1 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-200">어떤 사이트를 만드시겠어요?</h2>
              <div className="grid gap-3">
                {TEMPLATE_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => { update("templateType", opt.value); setStep(2); }}
                    className={`flex items-center gap-4 rounded-2xl border p-5 text-left transition-all ${
                      form.templateType === opt.value
                        ? "border-accent/50 bg-accent/5"
                        : "border-white/10 bg-zinc-900/50 hover:border-white/20"
                    }`}
                  >
                    <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-accent/10">
                      <IconifyIcon icon={opt.icon} width="24" height="24" />
                    </div>
                    <div>
                      <div className="font-semibold text-zinc-100">{opt.label}</div>
                      <div className="text-sm text-zinc-500">{opt.desc}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Step 2: 기본 정보 */}
          {step === 2 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-200">기본 정보를 입력하세요</h2>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">
                  사이트 주소 *
                </label>
                <div className="flex items-center rounded-xl border border-white/10 bg-zinc-900 px-3">
                  <span className="text-sm text-zinc-600">ai.on1.kr/</span>
                  <input
                    type="text"
                    value={form.code}
                    onChange={(e) => update("code", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
                    className="flex-1 bg-transparent py-3 text-sm text-zinc-100 outline-none"
                    placeholder="jinkyun"
                    maxLength={30}
                    required
                  />
                  {form.code.length >= 1 && (
                    <span className={`ml-2 text-xs ${
                      codeChecking ? "text-zinc-500" :
                      codeAvailable === true ? "text-green-400" :
                      codeAvailable === false ? "text-red-400" : "text-zinc-500"
                    }`}>
                      {codeChecking ? "확인 중…" : codeAvailable === true ? "사용 가능" : codeAvailable === false ? "불가" : ""}
                    </span>
                  )}
                </div>
                <p className="mt-1 text-xs text-zinc-500">
                  영소문자·숫자·하이픈(-), 3~30자. 나중에 관리자 설정에서 변경 가능
                </p>
                {codeAvailable === false && codeReason && (
                  <p className="mt-1 text-xs text-red-400">{codeReason}</p>
                )}
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">
                  {form.templateType === "election" ? "후보자 이름" : form.templateType === "store" ? "상호명" : "이름"} *
                </label>
                <input
                  type="text"
                  value={form.name}
                  onChange={(e) => update("name", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-accent/50"
                  placeholder={form.templateType === "election" ? "김진균" : "홍길동"}
                  required
                />
              </div>

              {form.templateType === "election" && (
                <>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-zinc-400">직함 / 직위</label>
                    <input
                      type="text"
                      value={form.positionTitle}
                      onChange={(e) => update("positionTitle", e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-accent/50"
                      placeholder="서울시 교육감 후보"
                    />
                  </div>
                  <div>
                    <label className="mb-1.5 block text-sm font-medium text-zinc-400">소속 정당</label>
                    <input
                      type="text"
                      value={form.partyName}
                      onChange={(e) => update("partyName", e.target.value)}
                      className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-accent/50"
                      placeholder="무소속, 국민의힘, 더불어민주당 등"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">연락처 (선택)</label>
                <input
                  type="tel"
                  value={form.phone}
                  onChange={(e) => update("phone", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-accent/50"
                  placeholder="010-1234-5678"
                />
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep(1)}
                  className="rounded-xl border border-white/10 bg-zinc-800 px-6 py-3 text-sm text-zinc-300 hover:bg-zinc-700">이전</button>
                <button type="button"
                  onClick={() => {
                    if (!form.name) { setError("이름은 필수입니다"); return; }
                    if (!form.code || codeAvailable !== true) {
                      setError(codeReason || "사용 가능한 사이트 주소를 입력하세요");
                      return;
                    }
                    setError("");
                    setStep(3);
                  }}
                  disabled={codeAvailable !== true || !form.name}
                  className="flex-1 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-zinc-950 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed">다음</button>
              </div>
            </div>
          )}

          {/* Step 3: 비밀번호 설정 */}
          {step === 3 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold text-zinc-200">비밀번호를 설정하세요</h2>
              <p className="text-sm text-zinc-500">관리자 페이지 접속 시 사용됩니다</p>

              <div className="rounded-2xl border border-white/10 bg-zinc-900/50 p-4">
                <div className="mb-3 text-sm text-zinc-400">가입 정보 확인</div>
                <div className="space-y-1 text-sm">
                  <div className="flex justify-between">
                    <span className="text-zinc-500">사이트 주소</span>
                    <span className="font-mono text-zinc-200">ai.on1.kr/{form.code}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">이름</span>
                    <span className="text-zinc-200">{form.name}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-zinc-500">유형</span>
                    <span className="text-zinc-200">{TEMPLATE_OPTIONS.find(t => t.value === form.templateType)?.label}</span>
                  </div>
                  {form.positionTitle && (
                    <div className="flex justify-between">
                      <span className="text-zinc-500">직함</span>
                      <span className="text-zinc-200">{form.positionTitle}</span>
                    </div>
                  )}
                </div>
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">비밀번호 *</label>
                <input
                  type="password"
                  value={form.password}
                  onChange={(e) => update("password", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-accent/50"
                  placeholder="8자 이상"
                  minLength={8}
                  required
                />
              </div>

              <div>
                <label className="mb-1.5 block text-sm font-medium text-zinc-400">비밀번호 확인 *</label>
                <input
                  type="password"
                  value={form.passwordConfirm}
                  onChange={(e) => update("passwordConfirm", e.target.value)}
                  className="w-full rounded-xl border border-white/10 bg-zinc-900 px-4 py-3 text-sm text-zinc-100 outline-none focus:border-accent/50"
                  placeholder="비밀번호 재입력"
                  required
                />
              </div>

              {error && <p className="text-sm text-red-400">{error}</p>}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setStep(2)}
                  className="rounded-xl border border-white/10 bg-zinc-800 px-6 py-3 text-sm text-zinc-300 hover:bg-zinc-700">이전</button>
                <button type="submit" disabled={loading}
                  className="flex-1 rounded-xl bg-accent px-6 py-3 text-sm font-semibold text-zinc-950 hover:scale-[1.01] active:scale-[0.99] disabled:opacity-50">
                  {loading ? "생성 중..." : "사이트 생성하기"}
                </button>
              </div>
            </div>
          )}
        </form>
      </div>
    </div>
  );
}
