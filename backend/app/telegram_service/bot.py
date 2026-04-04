"""
ElectionPulse - Telegram Bot Service
고객별 텔레그램봇 관리 및 메시지 발송
"""
import asyncio
from typing import Optional

import httpx
import structlog

logger = structlog.get_logger()

# 텔레그램 메시지 길이 제한
MAX_MESSAGE_LENGTH = 4096


class TelegramBot:
    """개별 텔레그램봇 인스턴스."""

    BASE_URL = "https://api.telegram.org/bot{token}"

    def __init__(self, token: str, chat_id: str):
        self.token = token
        self.chat_id = chat_id
        self.base_url = self.BASE_URL.format(token=token)

    async def send_message(
        self,
        text: str,
        parse_mode: str = "HTML",
        disable_preview: bool = True,
    ) -> bool:
        """메시지 발송 (긴 메시지 자동 분할)."""
        chunks = self._split_message(text)

        async with httpx.AsyncClient() as client:
            for chunk in chunks:
                try:
                    resp = await client.post(
                        f"{self.base_url}/sendMessage",
                        json={
                            "chat_id": self.chat_id,
                            "text": chunk,
                            "parse_mode": parse_mode,
                            "disable_web_page_preview": disable_preview,
                        },
                        timeout=30,
                    )
                    if resp.status_code != 200:
                        logger.error(
                            "telegram_send_error",
                            status=resp.status_code,
                            response=resp.text[:200],
                        )
                        return False
                except Exception as e:
                    logger.error("telegram_send_exception", error=str(e))
                    return False

        return True

    async def send_document(
        self,
        file_path: str,
        caption: str = "",
    ) -> bool:
        """파일 전송."""
        async with httpx.AsyncClient() as client:
            try:
                with open(file_path, "rb") as f:
                    resp = await client.post(
                        f"{self.base_url}/sendDocument",
                        data={
                            "chat_id": self.chat_id,
                            "caption": caption[:1024],
                        },
                        files={"document": f},
                        timeout=60,
                    )
                    return resp.status_code == 200
            except Exception as e:
                logger.error("telegram_file_error", error=str(e))
                return False

    async def verify_token(self) -> Optional[dict]:
        """봇 토큰 유효성 확인."""
        async with httpx.AsyncClient() as client:
            try:
                resp = await client.get(
                    f"{self.base_url}/getMe",
                    timeout=10,
                )
                if resp.status_code == 200:
                    data = resp.json()
                    return data.get("result")
                return None
            except Exception:
                return None

    @staticmethod
    def _split_message(text: str) -> list[str]:
        """긴 메시지를 4096자 단위로 분할."""
        if len(text) <= MAX_MESSAGE_LENGTH:
            return [text]

        chunks = []
        while text:
            if len(text) <= MAX_MESSAGE_LENGTH:
                chunks.append(text)
                break

            # 줄바꿈 기준으로 자르기
            split_at = text.rfind("\n", 0, MAX_MESSAGE_LENGTH)
            if split_at == -1:
                split_at = MAX_MESSAGE_LENGTH

            chunks.append(text[:split_at])
            text = text[split_at:].lstrip("\n")

        return chunks


class TelegramBotManager:
    """전체 테넌트의 텔레그램봇 관리."""

    def __init__(self):
        self._bots: dict[str, TelegramBot] = {}

    def register_bot(self, tenant_id: str, token: str, chat_id: str):
        """봇 등록."""
        self._bots[tenant_id] = TelegramBot(token, chat_id)

    def get_bot(self, tenant_id: str) -> Optional[TelegramBot]:
        """테넌트 봇 조회."""
        return self._bots.get(tenant_id)

    async def send_report(
        self,
        tenant_id: str,
        report_text: str,
        files: list[str] = None,
    ) -> bool:
        """보고서 발송."""
        bot = self.get_bot(tenant_id)
        if not bot:
            logger.warning("telegram_no_bot", tenant_id=tenant_id)
            return False

        success = await bot.send_message(report_text)

        if success and files:
            for file_path in files:
                await bot.send_document(file_path)

        return success

    async def send_alert(self, tenant_id: str, alert_message: str) -> bool:
        """긴급 알림 발송."""
        bot = self.get_bot(tenant_id)
        if not bot:
            return False
        return await bot.send_message(f"🚨 [긴급 알림]\n\n{alert_message}")


# 싱글턴 매니저
bot_manager = TelegramBotManager()
