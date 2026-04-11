"""
ElectionPulse - Admin Panel API (컴포저)

원래 1047줄 단일 파일이었으나 P2-11 리팩터로 5개 서브모듈로 분리:
    - users_router.py      — 가입 승인, 사용자 CRUD, 비밀번호
    - tenants_router.py    — 캠프 CRUD, 캠프 사용자, 목록, 상세
    - monitoring_router.py — 시스템 헬스, 데이터 통계, 스케줄 제어
    - ai_ops_router.py     — AI 계정, 고객 API 키, Opus 검증

이 파일은 include_router로 위 서브모듈을 조합. 모든 URL은 /admin/* 그대로.
main.py는 기존처럼 `app.include_router(admin_router, prefix="/api/admin")`.
"""
from fastapi import APIRouter

from . import ai_ops_router, monitoring_router, tenants_router, users_router

router = APIRouter()

router.include_router(users_router.router)
router.include_router(tenants_router.router)
router.include_router(monitoring_router.router)
router.include_router(ai_ops_router.router)
