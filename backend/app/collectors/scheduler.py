"""
ElectionPulse - Collection Scheduler
테넌트별 스케줄 관리 및 실행 오케스트레이션
"""
from datetime import datetime, timezone, timedelta
from typing import Optional

from sqlalchemy import select, and_
from sqlalchemy.orm import Session

from app.elections.models import ScheduleConfig, ScheduleRun, Election
from app.auth.models import Tenant
import structlog

logger = structlog.get_logger()

KST = timezone(timedelta(hours=9))


class CollectionScheduler:
    """수집 스케줄러 — 모든 테넌트의 스케줄을 관리."""

    def __init__(self, session: Session):
        self.session = session

    def get_due_schedules(self, current_time: str = None) -> list[dict]:
        """
        현재 시각에 실행해야 할 스케줄 목록.
        current_time: "HH:MM" 형태 (미지정시 현재 KST 시각)
        """
        if not current_time:
            current_time = datetime.now(KST).strftime("%H:%M")

        # 활성 테넌트의 활성 스케줄만
        schedules = self.session.execute(
            select(ScheduleConfig, Tenant)
            .join(Tenant, ScheduleConfig.tenant_id == Tenant.id)
            .where(
                ScheduleConfig.enabled == True,
                Tenant.is_active == True,
            )
        ).all()

        due = []
        for schedule, tenant in schedules:
            if current_time in (schedule.fixed_times or []):
                # 오늘 이미 실행했는지 확인
                if not self._already_ran_today(schedule.id):
                    due.append({
                        "schedule_id": str(schedule.id),
                        "tenant_id": str(schedule.tenant_id),
                        "election_id": str(schedule.election_id),
                        "schedule_type": schedule.schedule_type,
                        "schedule_name": schedule.name,
                        "tenant_name": tenant.name,
                        "config": schedule.config or {},
                    })

        logger.info(
            "scheduler_check",
            time=current_time,
            total_schedules=len(schedules),
            due_count=len(due),
        )
        return due

    def _already_ran_today(self, schedule_id) -> bool:
        """오늘 이미 실행된 스케줄인지 확인 (KST 기준)."""
        # KST 오늘 00:00 = UTC 전날 15:00
        now_kst = datetime.now(KST)
        today_start_kst = now_kst.replace(hour=0, minute=0, second=0, microsecond=0)
        today_start_utc = today_start_kst.astimezone(timezone.utc)

        result = self.session.execute(
            select(ScheduleRun).where(
                ScheduleRun.schedule_id == schedule_id,
                ScheduleRun.started_at >= today_start_utc,
            )
        ).scalar_one_or_none()
        return result is not None

    def create_default_schedules(
        self,
        election_id: str,
        tenant_id: str,
        plan: str = "basic",
    ) -> list[ScheduleConfig]:
        """요금제에 맞는 기본 스케줄 생성."""
        templates = self._get_schedule_templates(plan)
        created = []

        for tmpl in templates:
            config = ScheduleConfig(
                election_id=election_id,
                tenant_id=tenant_id,
                name=tmpl["name"],
                schedule_type=tmpl["type"],
                fixed_times=tmpl["times"],
                enabled=True,
                config=tmpl.get("config", {}),
            )
            self.session.add(config)
            created.append(config)

        self.session.commit()
        logger.info(
            "schedules_created",
            tenant_id=tenant_id,
            plan=plan,
            count=len(created),
        )
        return created

    @staticmethod
    def _get_schedule_templates(plan: str) -> list[dict]:
        """
        요금제별 스케줄 템플릿.
        All plans use the 06/08/13/14/17/18 pattern.
        Higher plans add more collection frequency.
        """
        # Standard pattern for all plans
        standard = [
            {
                "name": "오전 수집 (06:00)",
                "type": "full_collection",
                "times": ["06:00"],
                "config": {"description": "전체 수집 (뉴스+커뮤니티+유튜브+트렌드+댓글)"},
            },
            {
                "name": "오전 브리핑 (08:00)",
                "type": "briefing",
                "times": ["08:00"],
                "config": {"briefing_type": "morning", "send_telegram": True},
            },
            {
                "name": "오후 수집 (13:00)",
                "type": "full_collection",
                "times": ["13:00"],
                "config": {"description": "전체 수집 (뉴스+커뮤니티+유튜브+트렌드+댓글)"},
            },
            {
                "name": "오후 브리핑 (14:00)",
                "type": "briefing",
                "times": ["14:00"],
                "config": {"briefing_type": "afternoon", "send_telegram": True},
            },
            {
                "name": "마감 수집 (17:00)",
                "type": "full_collection",
                "times": ["17:00"],
                "config": {"description": "전체 수집 (뉴스+커뮤니티+유튜브+트렌드+댓글)"},
            },
            {
                "name": "일일 보고서 (18:00)",
                "type": "briefing",
                "times": ["18:00"],
                "config": {"briefing_type": "daily", "send_telegram": True},
            },
        ]

        if plan == "basic":
            # Basic: just morning/evening collection + daily report
            return [
                {
                    "name": "오전 수집 (06:00)",
                    "type": "full_collection",
                    "times": ["06:00"],
                    "config": {},
                },
                {
                    "name": "마감 수집 (17:00)",
                    "type": "full_collection",
                    "times": ["17:00"],
                    "config": {},
                },
                {
                    "name": "일일 보고서 (18:00)",
                    "type": "briefing",
                    "times": ["18:00"],
                    "config": {"briefing_type": "daily", "send_telegram": True},
                },
            ]

        elif plan == "pro":
            return standard

        elif plan == "enterprise":
            # Enterprise: standard + midday collection + extra alert times
            return standard + [
                {
                    "name": "추가 수집 (10:00)",
                    "type": "full_collection",
                    "times": ["10:00"],
                    "config": {"description": "추가 수집"},
                },
                {
                    "name": "추가 수집 (15:30)",
                    "type": "full_collection",
                    "times": ["15:30"],
                    "config": {"description": "추가 수집"},
                },
            ]

        return standard  # Default: pro pattern
