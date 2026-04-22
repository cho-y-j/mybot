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


SHARED_SOURCE_TYPES = {"news", "community", "youtube"}


async def store_embedding(
    db: AsyncSession,
    tenant_id: str,
    election_id: str | None,
    source_type: str,
    source_id: str,
    title: str,
    content: str,
) -> bool:
    """텍스트를 임베딩하여 DB에 저장.
    - shared 타입(news/community/youtube): tenant_id=NULL, election_id 기준 1건만 저장 (선거 단위 공유)
    - private 타입(report/briefing/content): tenant_id별 저장
    기존 있으면 업데이트.
    """
    emb = await create_embedding(f"{title}\n{content}" if title else content)
    if not emb:
        return False

    vec_str = "[" + ",".join(str(v) for v in emb) + "]"
    preview = (content or "")[:300]
    is_shared = source_type in SHARED_SOURCE_TYPES

    try:
        if is_shared:
            await db.execute(text(
                "DELETE FROM embeddings WHERE source_type = :stype AND source_id = cast(:sid as uuid)"
                " AND tenant_id IS NULL AND election_id = cast(:eid as uuid)"
            ), {"stype": source_type, "sid": source_id, "eid": election_id})
            await db.execute(text(
                "INSERT INTO embeddings (tenant_id, election_id, source_type, source_id, title, content_preview, embedding)"
                " VALUES (NULL, cast(:eid as uuid), :stype, cast(:sid as uuid), :title, :preview, cast(:emb as vector))"
            ), {
                "eid": election_id,
                "stype": source_type, "sid": source_id,
                "title": title, "preview": preview, "emb": vec_str,
            })
        else:
            await db.execute(text(
                "DELETE FROM embeddings WHERE source_type = :stype AND source_id = cast(:sid as uuid)"
                " AND tenant_id = cast(:tid as uuid)"
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
    election_id: str | None = None,
) -> list[dict]:
    """질문과 유사한 문서 검색. 코사인 유사도 기준.
    - tenant_id 소유 private 임베딩 + election_id 공유 임베딩(news/community/youtube) 모두 검색.
    """
    emb = await create_embedding(query)
    if not emb:
        return []

    vec_str = "[" + ",".join(str(v) for v in emb) + "]"

    type_filter = ""
    if source_types:
        types_sql = ",".join(f"'{t}'" for t in source_types)
        type_filter = f"AND source_type IN ({types_sql})"

    # private(내 캠프) + shared(같은 선거 공유) 둘 다 검색
    where_scope = "(tenant_id = cast(:tid as uuid)"
    params = {"tid": tenant_id, "qvec": vec_str, "lim": limit}
    if election_id:
        where_scope += " OR (tenant_id IS NULL AND election_id = cast(:eid as uuid))"
        params["eid"] = election_id
    where_scope += ")"

    try:
        rows = (await db.execute(text(f"""
            SELECT source_type, source_id, title, content_preview,
                   1 - (embedding <=> cast(:qvec as vector)) as similarity
            FROM embeddings
            WHERE {where_scope} {type_filter}
            ORDER BY embedding <=> cast(:qvec as vector)
            LIMIT :lim
        """), params)).fetchall()

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
    """기존 데이터 일괄 임베딩.

    - 미임베딩 항목만 뽑아오도록 SQL 단계에서 NOT EXISTS 필터 (LIMIT 밖에 숨어 영영 누락되던 버그 수정)
    - 배치당 최대 1000건 처리. 백로그가 더 많아도 다음 스케줄 호출(매 수집 주기)에서 이어받음
    - Ollama bge-m3 로컬이라 API 토큰 비용 0. 검색 시 pgvector HNSW 인덱스로 수만건도 ms 수준

    private 타입(report/briefing/content): 내 캠프(tenant_id) 전용
    shared 타입(news/community/youtube): 같은 election 내에서는 재사용
    """
    result = {}
    BATCH = 1000

    # 보고서 + 브리핑 + 콘텐츠 — report_type 별로 embeddings.source_type 이 달라 배치 내에서 개별 분류
    reports = (await db.execute(text(f"""
        SELECT r.id, r.report_type, r.title, r.content_text
          FROM reports r
         WHERE r.tenant_id = :tid AND r.election_id = :eid
           AND r.content_text IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM embeddings e
              WHERE e.source_id = r.id::text
                AND e.source_type IN ('report','briefing','content')
                AND e.tenant_id = :tid::uuid
           )
         ORDER BY r.report_date DESC
         LIMIT {BATCH}
    """), {"tid": tenant_id, "eid": election_id})).fetchall()

    count = 0
    for r in reports:
        if r.report_type in ("daily", "weekly", "ai_daily"):
            stype = "report"
        elif r.report_type in ("morning_brief", "afternoon_brief", "ai_morning_brief", "ai_afternoon_brief"):
            stype = "briefing"
        elif r.report_type in ("blog", "sns", "youtube", "card", "press", "defense", "debate_script"):
            stype = "content"
        else:
            stype = "report"

        ok = await store_embedding(db, tenant_id, election_id, stype, str(r.id),
                                   r.title or r.report_type, r.content_text)
        if ok:
            count += 1
            try:
                await db.commit()
            except Exception:
                pass
    result["reports"] = count

    # 뉴스 (election-shared) — 미임베딩만
    news = (await db.execute(text(f"""
        SELECT n.id, n.title, n.ai_summary, n.ai_reason
          FROM news_articles n
         WHERE n.election_id = :eid
           AND n.is_relevant = true
           AND n.ai_summary IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM embeddings e
              WHERE e.source_type = 'news'
                AND e.source_id = n.id::text
                AND (e.tenant_id = :tid::uuid
                     OR (e.tenant_id IS NULL AND e.election_id = :eid::uuid))
           )
         ORDER BY n.collected_at DESC
         LIMIT {BATCH}
    """), {"tid": tenant_id, "eid": election_id})).fetchall()

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

    # 커뮤니티 (election-shared) — 미임베딩만
    comm = (await db.execute(text(f"""
        SELECT c.id, c.title, c.ai_summary
          FROM community_posts c
         WHERE c.election_id = :eid
           AND c.is_relevant = true
           AND c.ai_summary IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM embeddings e
              WHERE e.source_type = 'community'
                AND e.source_id = c.id::text
                AND (e.tenant_id = :tid::uuid
                     OR (e.tenant_id IS NULL AND e.election_id = :eid::uuid))
           )
         ORDER BY c.collected_at DESC
         LIMIT {BATCH}
    """), {"tid": tenant_id, "eid": election_id})).fetchall()

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

    # 유튜브 (election-shared) — 미임베딩만
    yt = (await db.execute(text(f"""
        SELECT y.id, y.title, y.ai_summary
          FROM youtube_videos y
         WHERE y.election_id = :eid
           AND y.is_relevant = true
           AND y.ai_summary IS NOT NULL
           AND NOT EXISTS (
             SELECT 1 FROM embeddings e
              WHERE e.source_type = 'youtube'
                AND e.source_id = y.id::text
                AND (e.tenant_id = :tid::uuid
                     OR (e.tenant_id IS NULL AND e.election_id = :eid::uuid))
           )
         ORDER BY y.collected_at DESC
         LIMIT {BATCH}
    """), {"tid": tenant_id, "eid": election_id})).fetchall()

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
