"""
ElectionPulse - AI Service
Claude CLI subprocess 호출 통합 모듈.
모든 AI 호출은 이 모듈을 통해야 함.

모델 Tier:
  fast     = Haiku    (감성분석, 이슈분류, 브리핑 등 대량·단순)
  standard = Sonnet   (콘텐츠 생성, 멀티톤, AI 챗 기본)
  premium  = Opus     (보고서, 토론대본, 심층전략, AI 챗 최고품질)
"""
import asyncio
import json
import shutil
import structlog

logger = structlog.get_logger()

# ── CLI 시스템 프롬프트 (--permission-mode plan 기본 코딩 어시스턴트를 선거 AI로 전환) ──
CLI_SYSTEM_PROMPT = (
    "당신은 한국 선거 캠프 분석 SaaS 플랫폼(ElectionPulse)의 AI 엔진입니다. "
    "캠프 관계자의 요청에 따라 선거 데이터 분석, 콘텐츠 생성, 브리핑, 전략 제안을 수행합니다. "
    "반드시 한국어로만 응답하세요. JSON 출력 요청 시 순수 JSON만 반환하세요."
)

# ── 모델 매핑 ──
MODEL_TIER = {
    "fast": "claude-haiku-4-5-20251001",
    "standard": "claude-sonnet-4-6",
    "premium": "claude-opus-4-6",
}

# 용도별 기본 tier (context명 → tier)
DEFAULT_TIER = {
    # fast (Haiku) — 단순 분류만
    "issue_classify": "fast",
    # standard (Sonnet) — 감성 분석 (Haiku로는 한국어 선거 뉴스 오분류 26-40%)
    "sentiment": "standard",
    "batch_sentiment": "standard",
    "media_analyze_batch": "standard",
    "media_analyze_single": "standard",
    "competitor_gap_summary": "standard",
    "survey_ai_strategy": "premium",
    "telegram_briefing": "fast",
    "alert_check": "fast",
    "keyword_extract": "fast",
    # premium (Opus) — 콘텐츠 생성 (성능 우선)
    "content_generate": "premium",
    "content_generation": "premium",
    "multi_tone": "premium",
    "chat": "standard",
    "chat_standard": "standard",
    "swing_voter": "standard",
    "swing_voter_cta": "standard",
    "briefing": "standard",
    "ai_briefing": "standard",
    # premium (Opus) — 보고서·전략·토론·감성검증
    "sentiment_verify": "premium",
    "daily_report": "premium",
    "weekly_report": "premium",
    "debate_script": "premium",
    "ai_strategy": "premium",
    "deep_analysis": "premium",
    "report_generate": "premium",
    "ai_report_generation": "premium",
    # 챗 모델 선택
    "chat_fast": "fast",
    "chat_premium": "premium",
}


def get_model_for_context(context: str, override_tier: str | None = None) -> str:
    """context 또는 명시적 tier로 모델 ID 반환."""
    if override_tier and override_tier in MODEL_TIER:
        return MODEL_TIER[override_tier]
    tier = DEFAULT_TIER.get(context, "standard")
    return MODEL_TIER[tier]


def get_tier_for_context(context: str) -> str:
    """context의 기본 tier 반환. 정확 매칭 → prefix 매칭 → standard."""
    if context in DEFAULT_TIER:
        return DEFAULT_TIER[context]
    # prefix 매칭 (multi_tone_instagram_friendly → multi_tone)
    for key in DEFAULT_TIER:
        if context.startswith(key):
            return DEFAULT_TIER[key]
    return "standard"


async def _get_tenant_ai_config(db, tenant_id: str | None) -> dict:
    """tenant별 AI 설정 조회 — API 키, 배정된 CLI 계정."""
    if not db or not tenant_id:
        return {}
    try:
        from sqlalchemy import text as sql_text
        r = await db.execute(sql_text(
            "SELECT anthropic_api_key, openai_api_key, ai_account_id FROM tenants WHERE id = :tid"
        ), {"tid": tenant_id})
        row = r.fetchone()
        if not row:
            return {}
        config = {
            "anthropic_key": row[0],
            "openai_key": row[1],
            "ai_account_id": str(row[2]) if row[2] else None,
        }
        # 배정된 CLI 계정의 config_dir 조회
        if config["ai_account_id"]:
            r2 = await db.execute(sql_text(
                "SELECT config_dir, status FROM ai_accounts WHERE id = :aid AND status = 'active'"
            ), {"aid": config["ai_account_id"]})
            acc = r2.fetchone()
            if acc:
                config["config_dir"] = acc[0]
        return config
    except Exception:
        return {}


async def _call_api_anthropic(prompt: str, model: str, api_key: str, timeout: int) -> dict | None:
    """Anthropic API 직접 호출 (고객 API 키 사용)."""
    try:
        import httpx
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "x-api-key": api_key,
                    "anthropic-version": "2023-06-01",
                    "content-type": "application/json",
                },
                json={
                    "model": model,
                    "max_tokens": 4096,
                    "messages": [{"role": "user", "content": prompt}],
                },
                timeout=timeout,
            )
            if resp.status_code == 200:
                data = resp.json()
                text = data.get("content", [{}])[0].get("text", "")
                if text:
                    return _extract_json(text)
            logger.warning("anthropic_api_error", status=resp.status_code)
    except Exception as e:
        logger.error("anthropic_api_call_failed", error=str(e)[:200])
    return None


async def call_claude(
    prompt: str,
    timeout: int = 60,
    context: str = "unknown",
    tenant_id: str | None = None,
    db=None,
    model_tier: str | None = None,
    web_search: bool = False,
) -> dict | None:
    """
    AI 호출 — 자동 전환:
    1순위: 고객 Anthropic API 키 (있으면)
    2순위: 배정된 CLI 계정 (config_dir)
    3순위: 시스템 기본 CLI

    web_search=True 시 CLI에 WebSearch/WebFetch 도구 허용 (사실 검증용).
    """
    model = get_model_for_context(context, model_tier)
    tier_label = model_tier or get_tier_for_context(context)

    # tenant별 설정 조회
    ai_config = await _get_tenant_ai_config(db, tenant_id)

    # 1순위: 고객 API 키
    if ai_config.get("anthropic_key"):
        result = await _call_api_anthropic(prompt, model, ai_config["anthropic_key"], timeout)
        if result:
            logger.info("ai_via_tenant_api", context=context, model=model, tier=tier_label)
            return result

    # 2순위/3순위: CLI (배정 계정 또는 시스템 기본)
    claude_path = shutil.which("claude")
    if not claude_path:
        logger.info("claude_cli_not_found", context=context)
        return None

    env = None
    config_dir = ai_config.get("config_dir")
    if config_dir:
        import os
        env = {**os.environ, "CLAUDE_CONFIG_DIR": config_dir}

    # 웹서치 사용 시 플래그 구성
    extra_args = []
    if web_search:
        extra_args = ["--permission-mode", "default", "--allowedTools", "WebSearch,WebFetch"]
    else:
        extra_args = ["--permission-mode", "plan"]

    for attempt in range(2):
        try:
            proc = await asyncio.create_subprocess_exec(
                claude_path, "-p", prompt,
                "--model", model,
                *extra_args,
                "--no-session-persistence",
                "--system-prompt", CLI_SYSTEM_PROMPT,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

            if proc.returncode == 0 and stdout:
                text = stdout.decode("utf-8").strip()
                if len(text) > 10:
                    src = "assigned_cli" if config_dir else "system_cli"
                    logger.info("claude_json_ok", context=context, model=model, tier=tier_label, source=src, length=len(text), web_search=web_search)
                    return _extract_json(text)

            stderr_text = stderr.decode("utf-8", errors="ignore") if stderr else ""

            # rate limit 감지
            if "rate limit" in stderr_text.lower() or "rate_limit" in stderr_text.lower():
                logger.error("claude_rate_limited", context=context, config_dir=config_dir or "default")
                if config_dir and db and ai_config.get("ai_account_id"):
                    try:
                        from sqlalchemy import text as sql_text
                        await db.execute(sql_text(
                            "UPDATE ai_accounts SET status = 'blocked', updated_at = NOW() WHERE id = :aid"
                        ), {"aid": ai_config["ai_account_id"]})
                        logger.warning("ai_account_auto_blocked", account_id=ai_config["ai_account_id"])
                    except Exception:
                        pass
                return None

            # stderr 로깅 (원인 파악용)
            logger.warning("claude_cli_empty_result", context=context, model=model,
                           returncode=proc.returncode,
                           stderr=stderr_text[:500] if stderr_text else "none",
                           attempt=attempt + 1)

            # 첫 시도 실패 시 5초 후 재시도 (토큰 갱신 시간 확보)
            if attempt == 0 and proc.returncode != 0:
                await asyncio.sleep(5)
                continue

            return None

        except asyncio.TimeoutError:
            logger.error("claude_cli_timeout", context=context, model=model, timeout=timeout)
            if attempt == 0:
                continue
            await _alert(TimeoutError(f"Claude CLI {timeout}s timeout ({model})"), context, tenant_id, db)
            return None
        except Exception as e:
            logger.error("claude_cli_error", context=context, model=model, error=str(e)[:300])
            await _alert(e, context, tenant_id, db)
            return None
    return None


async def call_claude_text(
    prompt: str,
    timeout: int = 90,
    context: str = "unknown",
    tenant_id: str | None = None,
    db=None,
    model_tier: str | None = None,
    web_search: bool = False,
) -> str | None:
    """
    AI → 텍스트 반환. 자동 전환 (API 키 → 배정 CLI → 시스템 CLI).

    web_search=True 시 CLI WebSearch/WebFetch 허용 (실시간 사실 검증).
    """
    model = get_model_for_context(context, model_tier)
    tier_label = model_tier or get_tier_for_context(context)

    # tenant별 설정 조회
    ai_config = await _get_tenant_ai_config(db, tenant_id)

    # 1순위: 고객 API 키
    if ai_config.get("anthropic_key"):
        try:
            import httpx
            async with httpx.AsyncClient() as client:
                resp = await client.post(
                    "https://api.anthropic.com/v1/messages",
                    headers={
                        "x-api-key": ai_config["anthropic_key"],
                        "anthropic-version": "2023-06-01",
                        "content-type": "application/json",
                    },
                    json={"model": model, "max_tokens": 8192, "messages": [{"role": "user", "content": prompt}]},
                    timeout=timeout,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    text = data.get("content", [{}])[0].get("text", "")
                    if text and len(text) > 50:
                        logger.info("ai_text_via_tenant_api", context=context, model=model, length=len(text))
                        return text
        except Exception as e:
            logger.warning("tenant_api_text_failed", error=str(e)[:200])

    # 2순위/3순위: CLI
    claude_path = shutil.which("claude")
    if not claude_path:
        logger.info("claude_cli_not_found", context=context)
        return None

    env = None
    config_dir = ai_config.get("config_dir")
    if config_dir:
        import os
        env = {**os.environ, "CLAUDE_CONFIG_DIR": config_dir}

    extra_args = []
    if web_search:
        extra_args = ["--permission-mode", "default", "--allowedTools", "WebSearch,WebFetch"]
    else:
        extra_args = ["--permission-mode", "plan"]

    for attempt in range(2):
        try:
            proc = await asyncio.create_subprocess_exec(
                claude_path, "-p", prompt,
                "--model", model,
                *extra_args,
                "--no-session-persistence",
                "--system-prompt", CLI_SYSTEM_PROMPT,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env=env,
            )
            stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

            if proc.returncode == 0 and stdout:
                result = stdout.decode("utf-8").strip()
                if len(result) > 50:
                    src = "assigned_cli" if config_dir else "system_cli"
                    logger.info("claude_text_ok", context=context, model=model, tier=tier_label, source=src, length=len(result), web_search=web_search)
                    return result

            stderr_text = stderr.decode("utf-8", errors="ignore") if stderr else ""
            logger.warning("claude_cli_empty_result", context=context, model=model,
                           returncode=proc.returncode,
                           stderr=stderr_text[:500] if stderr_text else "none",
                           attempt=attempt + 1)

            if attempt == 0 and proc.returncode != 0:
                await asyncio.sleep(5)
                continue

            return None

        except asyncio.TimeoutError:
            logger.error("claude_cli_timeout", context=context, model=model, timeout=timeout)
            if attempt == 0:
                continue
            await _alert(TimeoutError(f"Claude CLI {timeout}s timeout ({model})"), context, tenant_id, db)
            return None
        except Exception as e:
            logger.error("claude_cli_error", context=context, model=model, error=str(e)[:300])
            await _alert(e, context, tenant_id, db)
            return None
    return None


def _extract_json(text: str) -> dict | None:
    """텍스트에서 JSON 객체를 추출."""
    start = text.find("{")
    end = text.rfind("}") + 1
    if start >= 0 and end > start:
        try:
            return json.loads(text[start:end])
        except json.JSONDecodeError:
            pass

    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        try:
            return {"items": json.loads(text[start:end])}
        except json.JSONDecodeError:
            pass

    return None


async def _alert(error: Exception, context: str, tenant_id: str | None, db):
    """AI 실패 Telegram 알림 (fire-and-forget)."""
    if not tenant_id or not db:
        return
    try:
        from app.telegram_service.reporter import send_alert
        await send_alert(
            db, tenant_id,
            f"⚠️ AI 엔진 오류 ({context})\n오류: {str(error)[:200]}\n→ 규칙 기반 fallback으로 대체됨",
        )
    except Exception as alert_err:
        logger.warning("ai_alert_send_failed", original_context=context, alert_error=str(alert_err)[:200])
