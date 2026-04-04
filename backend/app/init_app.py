"""
ElectionPulse - Application Initialization
초기 슈퍼관리자 생성, DB 초기화
"""
import asyncio
from sqlalchemy import select
from app.database import async_session_factory, engine, Base
from app.auth.models import User, Tenant, RefreshToken, AuditLog  # noqa
from app.elections.models import (  # noqa — 모든 모델 import 필수
    Election, Candidate, Keyword,
    NewsArticle, CommunityPost, YouTubeVideo,
    SearchTrend, SentimentDaily,
    Survey, SurveyCrosstab, PastElection,
    ScheduleConfig, ScheduleRun,
    Report, TelegramConfig, TelegramRecipient, Payment,
)
from app.elections.history_models import (  # noqa
    VoterTurnout, ElectionResult, RegionalDemographic,
    PoliticalContext, EarlyVoting, ElectionEvent,
    AIRecommendation, YouTubeComment, SNSPost,
    RegionalIssue, AnalysisCache, ImportLog,
)
from app.common.security import hash_password
from app.config import get_settings

settings = get_settings()


async def create_tables():
    """모든 테이블 생성."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("[OK] 테이블 생성 완료")


async def create_superadmin():
    """초기 슈퍼관리자 계정 생성."""
    async with async_session_factory() as session:
        result = await session.execute(
            select(User).where(User.is_superadmin == True)
        )
        existing = result.scalar_one_or_none()

        if existing:
            print(f"[SKIP] 슈퍼관리자 이미 존재: {existing.email}")
            return

        admin = User(
            email=settings.ADMIN_EMAIL,
            password_hash=hash_password(settings.ADMIN_INITIAL_PASSWORD),
            name="Admin",
            role="super_admin",
            is_superadmin=True,
            is_active=True,
            email_verified=True,
        )
        session.add(admin)
        await session.commit()
        print(f"[OK] 슈퍼관리자 생성: {settings.ADMIN_EMAIL}")


async def init_all():
    """전체 초기화."""
    await create_tables()
    await create_superadmin()
    print("\n[완료] ElectionPulse 초기화 성공!")


if __name__ == "__main__":
    asyncio.run(init_all())
