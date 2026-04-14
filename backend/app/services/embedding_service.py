"""
ElectionPulse - 벡터 임베딩 서비스 (Ollama bge-m3)
수집/생성 시 자동 임베딩 + 유사도 검색 (RAG)
"""
import httpx
import structlog
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = structlog.get_logger()

OLLAMA_URL = "http://172.18.0.1:11434/api/embeddings"
EMBEDDING_MODEL = "bge-m3"
EMBEDDING_DIM = 1024


async def create_embedding(content: str) -> list[float] | None:
    """텍스트 → 1024차원 벡터. Ollama bge-m3 사용."""
    if not content or len(content.strip()) < 10:
        return None
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                OLLAMA_URL,
                json={"model": EMBEDDING_MODEL, "prompt": content[:2000]},
                timeout=15,
            )
            if resp.status_code == 200:
                emb = resp.json().get("embedding")
                if emb and len(emb) == EMBEDDING_DIM:
                    return emb
    except Exception as e:
        logger.warning("embedding_error", error=str(e)[:100])
    return None


async def store_embedding(
    db: AsyncSession,
    tenant_id: str,
    election_id: str | None,
    source_type: str,
    source_id: str,
    title: str,
    content: str,
) -> bool:
    """텍스트를 임베딩하여 DB에 저장. 기존 있으면 업데이트."""
    emb = await create_embedding(f"{title}\n{content}" if title else content)
    if not emb:
        return False

    vec_str = "[" + ",".join(str(v) for v in emb) + "]"
    preview = (content or "")[:300]

    try:
        await db.execute(text(
            "DELETE FROM embeddings WHERE source_type = :stype AND source_id = cast(:sid as uuid) AND tenant_id = cast(:tid as uuid)"
        ), {"stype": source_type, "sid": source_id, "tid": tenant_id})
        await db.execute(text(
            "INSERT INTO embeddings (tenant_id, election_id, source_type, source_id, title, content_preview, embedding)"
            " VALUES (cast(:tid as uuid), cast(:eid as uuid), :stype, cast(:sid as uuid), :title, :preview, cast(:emb as vector))"
        ), {
            "tid": tenant_id, "eid": election_id,
            "stype": source_type, "sid": source_id,
            "title": title, "preview": preview, "emb": vec_str,
        })
        return True
    except Exception as e:
        logger.error("embedding_store_error", error=str(e)[:200])
        try:
            await db.rollback()
        except Exception:
            pass
        return False


async def search_similar(
    db: AsyncSession,
    tenant_id: str,
    query: str,
    limit: int = 10,
    source_types: list[str] | None = None,
) -> list[dict]:
    """질문과 유사한 문서 검색. 코사인 유사도 기준."""
    emb = await create_embedding(query)
    if not emb:
        return []

    vec_str = "[" + ",".join(str(v) for v in emb) + "]"

    type_filter = ""
    if source_types:
        types_sql = ",".join(f"'{t}'" for t in source_types)
        type_filter = f"AND source_type IN ({types_sql})"

    try:
        rows = (await db.execute(text(f"""
            SELECT source_type, source_id, title, content_preview,
                   1 - (embedding <=> cast(:qvec as vector)) as similarity
            FROM embeddings
            WHERE tenant_id = cast(:tid as uuid) {type_filter}
            ORDER BY embedding <=> cast(:qvec as vector)
            LIMIT :lim
        """), {"tid": tenant_id, "qvec": vec_str, "lim": limit})).fetchall()

        return [
            {
                "source_type": r.source_type,
                "source_id": str(r.source_id) if r.source_id else None,
                "title": r.title,
                "content": r.content_preview,
                "similarity": round(float(r.similarity), 3),
            }
            for r in rows
            if r.similarity > 0.3  # 최소 유사도 필터
        ]
    except Exception as e:
        logger.error("embedding_search_error", error=str(e)[:200])
        return []


async def embed_batch_items(
    db: AsyncSession,
    tenant_id: str,
    election_id: str,
    items: list[dict],
    source_type: str,
) -> int:
    """배치 임베딩 — 수집 직후 호출용.
    items: [{"id": "...", "title": "...", "content": "..."}, ...]
    """
    stored = 0
    for item in items:
        ok = await store_embedding(
            db, tenant_id, election_id,
            source_type=source_type,
            source_id=item["id"],
            title=item.get("title", ""),
            content=item.get("content", ""),
        )
        if ok:
            stored += 1
            try:
                await db.commit()
            except Exception:
                pass
    return stored


async def embed_existing_data(db: AsyncSession, tenant_id: str, election_id: str) -> dict:
    """기존 데이터 일괄 임베딩 (최초 구축용)."""
    result = {}

    # 보고서 + 브리핑
    reports = (await db.execute(text("""
        SELECT id, report_type, title, content_text FROM reports
        WHERE tenant_id = :tid AND election_id = :eid AND content_text IS NOT NULL
        ORDER BY report_date DESC LIMIT 30
    """), {"tid": tenant_id, "eid": election_id})).fetchall()

    count = 0
    for r in reports:
        stype = "report" if r.report_type in ("daily", "weekly", "ai_daily") else "briefing"
        ok = await store_embedding(db, tenant_id, election_id, stype, str(r.id), r.title or r.report_type, r.content_text)
        if ok:
            count += 1
            try:
                await db.commit()
            except Exception:
                pass
    result["reports"] = count

    # 뉴스 (election-shared)
    news = (await db.execute(text("""
        SELECT id, title, ai_summary, ai_reason FROM news_articles
        WHERE election_id = :eid AND is_relevant = true AND ai_summary IS NOT NULL
        ORDER BY collected_at DESC LIMIT 200
    """), {"eid": election_id})).fetchall()

    count = 0
    for n in news:
        content = f"{n.ai_summary or ''}\n{n.ai_reason or ''}"
        ok = await store_embedding(db, tenant_id, election_id, "news", str(n.id), n.title, content)
        if ok:
            count += 1
            try:
                await db.commit()
            except Exception:
                pass
    result["news"] = count

    # 커뮤니티 (election-shared)
    comm = (await db.execute(text("""
        SELECT id, title, ai_summary FROM community_posts
        WHERE election_id = :eid AND is_relevant = true AND ai_summary IS NOT NULL
        ORDER BY collected_at DESC LIMIT 200
    """), {"eid": election_id})).fetchall()

    count = 0
    for c in comm:
        ok = await store_embedding(db, tenant_id, election_id, "community", str(c.id), c.title, c.ai_summary or "")
        if ok:
            count += 1
            try:
                await db.commit()
            except Exception:
                pass
    result["community"] = count

    # 유튜브 (election-shared)
    yt = (await db.execute(text("""
        SELECT id, title, ai_summary FROM youtube_videos
        WHERE election_id = :eid AND is_relevant = true AND ai_summary IS NOT NULL
        ORDER BY collected_at DESC LIMIT 100
    """), {"eid": election_id})).fetchall()

    count = 0
    for y in yt:
        ok = await store_embedding(db, tenant_id, election_id, "youtube", str(y.id), y.title, y.ai_summary or "")
        if ok:
            count += 1
            try:
                await db.commit()
            except Exception:
                pass
    result["youtube"] = count
    logger.info("embed_existing_done", tenant=tenant_id, result=result)
    return result
