"""챗 대화 세션 + 메시지 모델."""
import uuid
from datetime import datetime, timezone

from sqlalchemy import Column, DateTime, ForeignKey, Index, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow():
    return datetime.now(timezone.utc)


class ChatSession(Base):
    """챗 대화 세션 (ChatGPT 스타일)."""
    __tablename__ = "chat_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    title = Column(String(200), nullable=False, default="새 대화")

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    messages = relationship("ChatMessage", back_populates="session", cascade="all, delete-orphan",
                            order_by="ChatMessage.created_at")

    __table_args__ = (
        Index("ix_chat_sessions_user", "user_id", "updated_at"),
    )


class ChatMessage(Base):
    """챗 대화 메시지."""
    __tablename__ = "chat_messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    tenant_id = Column(UUID(as_uuid=True), nullable=False)
    election_id = Column(UUID(as_uuid=True), nullable=False)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    session_id = Column(UUID(as_uuid=True), ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=True)

    role = Column(String(10), nullable=False, comment="user | ai")
    content = Column(Text, nullable=False)
    model_tier = Column(String(20), nullable=True)

    created_at = Column(DateTime(timezone=True), default=utcnow)

    session = relationship("ChatSession", back_populates="messages")

    __table_args__ = (
        Index("ix_chat_tenant_election", "tenant_id", "election_id", "created_at"),
        Index("ix_chat_user", "user_id", "created_at"),
        Index("ix_chat_messages_session", "session_id", "created_at"),
    )
