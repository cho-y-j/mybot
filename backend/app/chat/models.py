"""챗 대화 이력 저장 모델."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class ChatMessage(Base):
    """챗 대화 메시지 (질문 + 응답 모두 저장)."""
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)

    role = Column(String(10), nullable=False, comment="user | ai")
    content = Column(Text, nullable=False)
    model_tier = Column(String(20), nullable=True, comment="사용된 모델 tier")

    created_at = Column(DateTime(timezone=True), default=utcnow)

    __table_args__ = (
        Index("ix_chat_tenant_election", "tenant_id", "election_id", "created_at"),
        Index("ix_chat_user", "user_id", "created_at"),
    )
