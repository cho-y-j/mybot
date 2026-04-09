"""
ElectionPulse - AI 호출 실패 알림 유틸리티
Claude CLI 호출 실패 시 structlog 로깅 + Telegram 관리자 알림
"""
import asyncio
import structlog

logger = structlog.get_logger()


async def log_and_alert_ai_failure(
    error: Exception,
    context: str,
    tenant_id: str | None = None,
    db=None,
):
    """
    AI 호출 실패 시 로깅 + Telegram 알림 (fire-and-forget).
    본 기능(fallback)을 절대 차단하지 않도록 이중 try/except.
    """
    logger.error(
        "ai_call_failed",
        context=context,
        error=str(error)[:300],
        tenant_id=tenant_id,
    )

    if tenant_id and db:
        try:
            from app.telegram_service.reporter import send_alert
            await send_alert(
                db, tenant_id,
                f"⚠️ AI 엔진 오류 ({context})\n오류: {str(error)[:200]}\n→ 규칙 기반 fallback으로 대체됨",
            )
        except Exception as alert_err:
            logger.warning(
                "ai_alert_send_failed",
                original_context=context,
                alert_error=str(alert_err)[:200],
            )


def fire_and_forget_alert(
    error: Exception,
    context: str,
    tenant_id: str | None = None,
    db=None,
):
    """비동기 컨텍스트 밖에서도 사용 가능한 fire-and-forget 버전."""
    try:
        loop = asyncio.get_running_loop()
        loop.create_task(log_and_alert_ai_failure(error, context, tenant_id, db))
    except RuntimeError:
        # 이벤트 루프 없는 경우 로깅만
        logger.error(
            "ai_call_failed",
            context=context,
            error=str(error)[:300],
            tenant_id=tenant_id,
        )
