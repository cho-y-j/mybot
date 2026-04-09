"""
ElectionPulse - AI Service
Claude CLI subprocess 호출 통합 모듈.
모든 AI 호출은 이 모듈을 통해야 함.
"""
import asyncio
import json
import shutil
import structlog

logger = structlog.get_logger()


async def call_claude(
    prompt: str,
    timeout: int = 60,
    context: str = "unknown",
    tenant_id: str | None = None,
    db=None,
) -> dict | None:
    """
    Claude CLI subprocess 호출 → JSON 파싱.
    실패 시 로깅 + Telegram 알림 후 None 반환.
    """
    claude_path = shutil.which("claude")
    if not claude_path:
        logger.info("claude_cli_not_found", context=context)
        return None

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        if proc.returncode == 0 and stdout:
            text = stdout.decode("utf-8").strip()
            if len(text) > 10:
                return _extract_json(text)

        logger.warning("claude_cli_empty_result", context=context, returncode=proc.returncode)
        return None

    except asyncio.TimeoutError:
        logger.error("claude_cli_timeout", context=context, timeout=timeout)
        await _alert(TimeoutError(f"Claude CLI {timeout}s timeout"), context, tenant_id, db)
        return None
    except Exception as e:
        logger.error("claude_cli_error", context=context, error=str(e)[:300])
        await _alert(e, context, tenant_id, db)
        return None


async def call_claude_text(
    prompt: str,
    timeout: int = 90,
    context: str = "unknown",
    tenant_id: str | None = None,
    db=None,
) -> str | None:
    """
    Claude CLI → 텍스트 반환 (JSON 파싱 안함).
    보고서 등 장문 텍스트 생성용.
    """
    claude_path = shutil.which("claude")
    if not claude_path:
        logger.info("claude_cli_not_found", context=context)
        return None

    try:
        proc = await asyncio.create_subprocess_exec(
            claude_path, "-p", prompt,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=timeout)

        if proc.returncode == 0 and stdout:
            result = stdout.decode("utf-8").strip()
            if len(result) > 50:
                logger.info("claude_text_generated", context=context, length=len(result))
                return result

        logger.warning("claude_cli_empty_result", context=context)
        return None

    except asyncio.TimeoutError:
        logger.error("claude_cli_timeout", context=context, timeout=timeout)
        await _alert(TimeoutError(f"Claude CLI {timeout}s timeout"), context, tenant_id, db)
        return None
    except Exception as e:
        logger.error("claude_cli_error", context=context, error=str(e)[:300])
        await _alert(e, context, tenant_id, db)
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

    # 배열 형태도 시도
    start = text.find("[")
    end = text.rfind("]") + 1
    if start >= 0 and end > start:
        try:
            return {"items": json.loads(text[start:end])}
        except json.JSONDecodeError:
            pass

    return None


async def _alert(error: Exception, context: str, tenant_id: str | None, db):
    """AI 실패 Telegram 알림 (fire-and-forget). 알림 실패가 본 기능을 차단하지 않음."""
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
