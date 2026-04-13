"""
캠프별 맞춤 AI 컨텍스트 — 모든 AI 호출에서 재사용.

챗/콘텐츠 생성/토론/보고서 등 모든 AI 기능에서
해당 캠프의 이전 생성물(보고서, 콘텐츠, 대화)을 참조할 수 있게 함.
"""
from datetime import date, timedelta
from sqlalchemy import select, desc
from sqlalchemy.ext.asyncio import AsyncSession

import structlog

logger = structlog.get_logger()


async def build_camp_memory(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    max_reports: int = 3,
    max_content: int = 5,
    max_chat: int = 0,
) -> str:
    """캠프의 이전 생성물을 AI 컨텍스트용 텍스트로 구성.

    Returns: "[캠프 메모리]\n..." 형태의 컨텍스트 문자열
    """
    sections = []

    # 1. 최근 보고서 요약
    try:
        from app.elections.models import Report
        reports = (await db.execute(
            select(Report).where(
                Report.tenant_id == tenant_id,
                Report.election_id == election_id,
                Report.report_type.in_(["daily", "weekly", "morning_brief", "ai_daily", "ai_morning_brief"]),
            ).order_by(Report.report_date.desc()).limit(max_reports)
        )).scalars().all()

        if reports:
            lines = ["=== 최근 보고서 ==="]
            for r in reports:
                d = r.report_date.isoformat() if r.report_date else ""
                t = r.report_type or ""
                content = (r.content_text or "")[:500].replace("\n", " ")
                lines.append(f"[{d} {t}] {content}...")
            sections.append("\n".join(lines))
    except Exception as e:
        logger.warning("camp_memory_report_error", error=str(e)[:100])

    # 2. 최근 생성 콘텐츠
    try:
        from app.elections.models import Report
        contents = (await db.execute(
            select(Report).where(
                Report.tenant_id == tenant_id,
                Report.election_id == election_id,
                Report.report_type.in_(["blog", "sns", "youtube", "card", "press", "defense", "debate_script"]),
            ).order_by(Report.created_at.desc()).limit(max_content)
        )).scalars().all()

        if contents:
            lines = ["=== 이전 생성 콘텐츠 ==="]
            for c in contents:
                ct = c.report_type or ""
                title = c.title or ""
                preview = (c.content_text or "")[:300].replace("\n", " ")
                lines.append(f"[{ct}] {title}: {preview}...")
            sections.append("\n".join(lines))
    except Exception as e:
        logger.warning("camp_memory_content_error", error=str(e)[:100])

    # 3. 최근 대화 이력 (선택적)
    if max_chat > 0:
        try:
            from app.chat.models import ChatMessage
            messages = (await db.execute(
                select(ChatMessage).where(
                    ChatMessage.tenant_id == tenant_id,
                    ChatMessage.election_id == election_id,
                ).order_by(ChatMessage.created_at.desc()).limit(max_chat)
            )).scalars().all()

            if messages:
                lines = ["=== 최근 대화 ==="]
                for m in reversed(messages):
                    role = "사용자" if m.role == "user" else "AI"
                    lines.append(f"{role}: {m.content[:200]}")
                sections.append("\n".join(lines))
        except Exception as e:
            logger.warning("camp_memory_chat_error", error=str(e)[:100])

    if not sections:
        return ""

    return "\n\n[캠프 메모리 — 이전 생성물 참조]\n" + "\n\n".join(sections) + "\n"
