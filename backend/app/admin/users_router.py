"""Admin — 사용자 승인/CRUD/비밀번호."""
import json as _json
import uuid as _uuid
from datetime import datetime, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.auth.models import Tenant, User, AuditLog
from app.common.dependencies import CurrentUser
from app.common.security import hash_password

from .common import require_superadmin
from .schemas import ApprovalNote, PasswordChangeReq

router = APIRouter()


# ──── 가입 승인 ────

@router.get("/pending-users")
async def list_pending_users(user: CurrentUser, db: AsyncSession = Depends(get_db)):
    """승인 대기 중인 가입 신청 목록."""
    require_superadmin(user)
    query = (
        select(User)
        .where(User.approval_status == "pending")
        .order_by(User.created_at.desc())
    )
    rows = (await db.execute(query)).scalars().all()
    return [{
        "id": str(u.id),
        "email": u.email,
        "name": u.name,
        "phone": u.phone,
        "organization": u.organization,
        "election_type": u.election_type_applied,
        "region": u.region_applied,
        "candidate_name": u.candidate_name_applied,
        "position": u.position_in_camp,
        "reason": u.apply_reason,
        "applied_at": u.applied_at.isoformat() if u.applied_at else (u.created_at.isoformat() if u.created_at else None),
    } for u in rows]


@router.post("/approve-user/{user_id}")
async def approve_user(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db), req: ApprovalNote = ApprovalNote(),
):
    """가입 신청 승인."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.approval_status != "pending":
        raise HTTPException(400, f"이미 처리된 신청입니다 (상태: {target.approval_status})")

    target.approval_status = "approved"
    target.is_active = True
    target.email_verified = True
    target.approved_at = datetime.now(timezone.utc)
    if req.note:
        target.approval_note = req.note

    db.add(AuditLog(
        user_id=user["id"], action="admin_approve_user",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": target.email, "note": req.note}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": f"{target.name}님의 가입이 승인되었습니다.", "email": target.email}


@router.post("/reject-user/{user_id}")
async def reject_user(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db), req: ApprovalNote = ApprovalNote(),
):
    """가입 신청 거절."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.approval_status != "pending":
        raise HTTPException(400, f"이미 처리된 신청입니다 (상태: {target.approval_status})")

    target.approval_status = "rejected"
    if req.note:
        target.approval_note = req.note

    db.add(AuditLog(
        user_id=user["id"], action="admin_reject_user",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": target.email, "note": req.note}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": f"{target.name}님의 가입이 거절되었습니다.", "email": target.email}


@router.post("/users/{user_id}/toggle-active")
async def toggle_user_active(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """사용자 활성/정지 토글."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    target.is_active = not target.is_active
    action = "activate" if target.is_active else "deactivate"
    db.add(AuditLog(
        user_id=user["id"], action=f"admin_{action}_user",
        resource_type="user", resource_id=str(user_id),
    ))
    await db.commit()
    return {"message": f"{target.name} {'활성화' if target.is_active else '정지'} 완료", "is_active": target.is_active}


# ──── 사용자 비번/삭제/목록 ────

@router.put("/users/{user_id}/password")
async def change_user_password_admin(
    user_id: UUID, req: PasswordChangeReq, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 사용자 비밀번호 변경."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if len(req.new_password) < 8:
        raise HTTPException(400, "비밀번호는 최소 8자 이상이어야 합니다")

    target.password_hash = hash_password(req.new_password)
    target.password_plain = req.new_password
    target.failed_login_attempts = 0
    target.is_locked = False
    target.locked_until = None

    db.add(AuditLog(
        user_id=user["id"], action="admin_change_password",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"target_email": target.email}, ensure_ascii=False),
    ))
    await db.commit()
    return {"message": "비밀번호 변경 완료", "email": target.email}


@router.delete("/users/{user_id}", status_code=204)
async def delete_user_admin(
    user_id: UUID, user: CurrentUser, db: AsyncSession = Depends(get_db),
):
    """슈퍼관리자: 사용자 삭제."""
    require_superadmin(user)
    target = (await db.execute(select(User).where(User.id == user_id))).scalar_one_or_none()
    if not target:
        raise HTTPException(404, "사용자를 찾을 수 없습니다")
    if target.is_superadmin:
        raise HTTPException(403, "슈퍼관리자는 삭제할 수 없습니다")

    email_for_log = target.email
    await db.delete(target)
    db.add(AuditLog(
        user_id=user["id"], action="admin_delete_user",
        resource_type="user", resource_id=str(user_id),
        details=_json.dumps({"email": email_for_log}, ensure_ascii=False),
    ))
    await db.commit()


@router.get("/users")
async def list_admin_users(
    user: CurrentUser, db: AsyncSession = Depends(get_db),
    unassigned: bool = False,
):
    """슈퍼관리자: 사용자 목록 (unassigned=true면 캠프 미할당만)."""
    require_superadmin(user)

    query = select(User, Tenant.name).outerjoin(Tenant, User.tenant_id == Tenant.id)
    if unassigned:
        query = query.where(User.tenant_id.is_(None))
    query = query.order_by(User.created_at.desc())

    rows = (await db.execute(query)).all()
    return [{
        "id": str(u.id), "email": u.email, "name": u.name,
        "phone": u.phone, "role": u.role, "is_active": u.is_active,
        "is_superadmin": u.is_superadmin, "email_verified": u.email_verified,
        "password_plain": u.password_plain,
        "tenant_id": str(u.tenant_id) if u.tenant_id else None,
        "tenant_name": tname,
        "approval_status": getattr(u, 'approval_status', None),
        "organization": getattr(u, 'organization', None),
        "candidate_name": getattr(u, 'candidate_name_applied', None),
        "election_type": getattr(u, 'election_type_applied', None),
        "applied_at": u.applied_at.isoformat() if getattr(u, 'applied_at', None) else None,
        "created_at": u.created_at.isoformat() if u.created_at else None,
    } for u, tname in rows]
