"""Admin — AI 계정 풀 + 고객 API 키 + Opus 감성 검증."""
import uuid as _uuid
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.models import Tenant, AIAccount
from app.common.dependencies import CurrentUser
from app.elections.models import Candidate, NewsArticle, CommunityPost

from .common import require_superadmin
from .schemas import AIAccountCreate, AIAccountUpdate, TenantAPIKeyUpdate

router = APIRouter()


# ──── AI 계정 풀 관리 ────

@router.get("/ai-accounts")
async def list_ai_accounts(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 목록 + 배정된 캠프 수."""
    require_superadmin(user)
    accounts = (await db.execute(
        select(AIAccount).order_by(AIAccount.priority, AIAccount.created_at)
    )).scalars().all()

    result = []
    for a in accounts:
        assigned = (await db.execute(
            select(func.count()).where(Tenant.ai_account_id == a.id)
        )).scalar() or 0
        result.append({
            "id": str(a.id), "provider": a.provider, "name": a.name,
            "config_dir": a.config_dir, "status": a.status,
            "priority": a.priority, "notes": a.notes,
            "assigned_tenants": assigned,
            "created_at": a.created_at.isoformat() if a.created_at else None,
        })
    return result


@router.post("/ai-accounts", status_code=201)
async def create_ai_account(req: AIAccountCreate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 추가."""
    require_superadmin(user)
    account = AIAccount(
        id=_uuid.uuid4(), provider=req.provider, name=req.name,
        config_dir=req.config_dir, notes=req.notes,
    )
    db.add(account)
    await db.flush()
    return {"id": str(account.id), "message": f"{req.provider} 계정 추가 완료"}


@router.put("/ai-accounts/{account_id}")
async def update_ai_account(account_id: UUID, req: AIAccountUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 수정."""
    require_superadmin(user)
    account = (await db.execute(select(AIAccount).where(AIAccount.id == account_id))).scalar_one_or_none()
    if not account:
        raise HTTPException(404)
    if req.name is not None: account.name = req.name
    if req.config_dir is not None: account.config_dir = req.config_dir
    if req.status is not None: account.status = req.status
    if req.priority is not None: account.priority = req.priority
    if req.notes is not None: account.notes = req.notes
    return {"message": "수정 완료"}


@router.delete("/ai-accounts/{account_id}", status_code=204)
async def delete_ai_account(account_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """AI CLI 계정 삭제."""
    require_superadmin(user)
    account = (await db.execute(select(AIAccount).where(AIAccount.id == account_id))).scalar_one_or_none()
    if not account:
        raise HTTPException(404)
    await db.execute(text("UPDATE tenants SET ai_account_id = NULL WHERE ai_account_id = :aid"), {"aid": str(account_id)})
    await db.delete(account)


@router.post("/ai-accounts/{account_id}/assign")
async def assign_ai_account(account_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db), tenant_ids: list[str] = []):
    """캠프에 AI 계정 배정."""
    require_superadmin(user)
    for tid in tenant_ids:
        await db.execute(text("UPDATE tenants SET ai_account_id = :aid WHERE id = :tid"), {"aid": str(account_id), "tid": tid})
    return {"message": f"{len(tenant_ids)}개 캠프에 배정 완료"}


# ──── 고객 API 키 ────

@router.put("/tenants/{tenant_id}/api-keys")
async def update_tenant_api_keys(tenant_id: UUID, req: TenantAPIKeyUpdate, user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """고객의 API 키 설정 (관리자 또는 본인)."""
    tenant = (await db.execute(select(Tenant).where(Tenant.id == tenant_id))).scalar_one_or_none()
    if not tenant:
        raise HTTPException(404)
    if not user.get("is_superadmin") and str(tenant_id) != user.get("tenant_id"):
        raise HTTPException(403)
    if req.anthropic_api_key is not None:
        tenant.anthropic_api_key = req.anthropic_api_key or None
    if req.openai_api_key is not None:
        tenant.openai_api_key = req.openai_api_key or None
    return {"message": "API 키 업데이트 완료"}


# ──── Opus 감성 검증 ────

@router.post("/verify-sentiment/{election_id}")
async def verify_sentiment_opus(
    election_id: UUID,
    user: CurrentUser,
    db: AsyncSession = Depends(get_db),
):
    """
    특정 선거의 미검증 데이터를 Opus로 감성 검증 + 4사분면 배정.
    관리자 또는 해당 캠프 사용자가 수동 실행.
    """
    from app.analysis.sentiment import SentimentAnalyzer
    from app.common.election_access import get_election_tenant_ids

    all_tids = await get_election_tenant_ids(db, election_id)
    if not user.get("is_superadmin") and user.get("tenant_id") not in [str(t) for t in all_tids]:
        raise HTTPException(403, "접근 권한 없음")

    candidates = (await db.execute(
        select(Candidate).where(
            Candidate.election_id == election_id,
            Candidate.enabled == True,
        )
    )).scalars().all()
    cand_map = {str(c.id): c for c in candidates}

    unverified_news = (await db.execute(
        select(NewsArticle).where(
            NewsArticle.election_id == election_id,
            NewsArticle.sentiment.in_(["positive", "negative"]),
            NewsArticle.sentiment_verified == False,
        ).order_by(NewsArticle.collected_at.desc()).limit(50)
    )).scalars().all()

    unverified_community = (await db.execute(
        select(CommunityPost).where(
            CommunityPost.election_id == election_id,
            CommunityPost.sentiment.in_(["positive", "negative"]),
            CommunityPost.sentiment_verified == False,
        ).order_by(CommunityPost.collected_at.desc()).limit(30)
    )).scalars().all()

    all_items = []
    for row in unverified_news:
        cand = cand_map.get(str(row.candidate_id))
        all_items.append({
            "id": str(row.id),
            "table": "news_articles",
            "text": f"{row.title or ''} {row.summary or row.content_snippet or ''}",
            "current_sentiment": row.sentiment,
            "candidate_name": cand.name if cand else "불명",
            "is_our_candidate": cand.is_our_candidate if cand else False,
        })
    for row in unverified_community:
        cand = cand_map.get(str(row.candidate_id))
        all_items.append({
            "id": str(row.id),
            "table": "community_posts",
            "text": f"{row.title or ''} {row.content_snippet or ''}",
            "current_sentiment": row.sentiment,
            "candidate_name": cand.name if cand else "불명",
            "is_our_candidate": cand.is_our_candidate if cand else False,
        })

    if not all_items:
        return {"message": "검증할 항목 없음", "total": 0, "verified": 0, "changed": 0}

    analyzer = SentimentAnalyzer()
    results = await analyzer.verify_batch_with_opus(all_items, tenant_id=user.get("tenant_id"), db=db)

    verified = 0
    changed = 0
    changes_detail = []

    for r in results:
        item = next((it for it in all_items if it["id"] == r["id"]), None)
        if not item:
            continue

        tbl = item["table"]
        await db.execute(
            text(
                f"UPDATE {tbl} SET "
                f"sentiment = :s, sentiment_score = :sc, "
                f"sentiment_verified = TRUE, "
                f"strategic_quadrant = :q, strategic_value = :q "
                f"WHERE id = :id"
            ),
            {"s": r["sentiment"], "sc": r["score"], "q": r.get("quadrant"), "id": r["id"]},
        )
        verified += 1
        if r.get("changed"):
            changed += 1
            changes_detail.append({
                "title": item["text"][:60],
                "before": item["current_sentiment"],
                "after": r["sentiment"],
                "quadrant": r.get("quadrant"),
                "reason": r.get("reason", ""),
            })

    await db.commit()

    return {
        "message": f"Opus 검증 완료: {verified}건 검증, {changed}건 교정",
        "total": len(all_items),
        "verified": verified,
        "changed": changed,
        "changes": changes_detail[:20],
    }
