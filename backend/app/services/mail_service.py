"""
ElectionPulse — SMTP 메일 발송 (2026-04-18 신설).

- Gmail SMTP 기본 (.env.server의 SMTP_* 변수)
- Celery task에서 동기 호출: send_mail_sync(...)
- FastAPI async route에서는 asyncio.to_thread(send_mail_sync, ...) 로 래핑
- 일일/주간 PDF 첨부 지원
- Gmail 한도: 일 500통 (초과 시 수신 거부)

수신자 결정:
- tenant_id 기준 public.users에서 가장 먼저 가입한 유효 이메일 (tenant owner)
- 별도 지정 시 파라미터로 override 가능
"""
from __future__ import annotations

import os
import smtplib
from email.mime.application import MIMEApplication
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText
from email.utils import formataddr
from typing import Optional

import structlog
from sqlalchemy import text as sql_text

logger = structlog.get_logger()


def _smtp_config() -> dict:
    """런타임에 env 재조회 — 테스트·재설정 대비."""
    return {
        "host": os.getenv("SMTP_HOST", "").strip(),
        "port": int(os.getenv("SMTP_PORT", "587") or 587),
        "user": os.getenv("SMTP_USER", "").strip(),
        "password": os.getenv("SMTP_PASSWORD", "").strip(),
        "from_addr": os.getenv("EMAIL_FROM", "").strip() or os.getenv("SMTP_USER", "").strip(),
        "from_name": os.getenv("EMAIL_FROM_NAME", "ElectionPulse").strip(),
    }


def is_configured() -> bool:
    c = _smtp_config()
    return bool(c["host"] and c["user"] and c["password"])


def send_mail_sync(
    to: str,
    subject: str,
    html_body: str,
    text_body: Optional[str] = None,
    attachments: Optional[list[tuple[str, bytes]]] = None,
) -> dict:
    """동기 SMTP 발송. 결과 dict: {status: 'sent'|'skipped'|'error', error?, ...}"""
    cfg = _smtp_config()
    if not (cfg["host"] and cfg["user"] and cfg["password"]):
        logger.warning("smtp_not_configured", host_empty=not cfg["host"])
        return {"status": "skipped", "reason": "smtp not configured"}

    if not to or "@" not in to:
        return {"status": "skipped", "reason": "invalid recipient"}

    msg = MIMEMultipart("mixed")
    msg["From"] = formataddr((cfg["from_name"], cfg["from_addr"]))
    msg["To"] = to
    msg["Subject"] = subject

    alt = MIMEMultipart("alternative")
    if text_body:
        alt.attach(MIMEText(text_body, "plain", "utf-8"))
    alt.attach(MIMEText(html_body, "html", "utf-8"))
    msg.attach(alt)

    for filename, data in (attachments or []):
        if not data:
            continue
        part = MIMEApplication(data, Name=filename)
        part["Content-Disposition"] = f'attachment; filename="{filename}"'
        msg.attach(part)

    try:
        with smtplib.SMTP(cfg["host"], cfg["port"], timeout=30) as s:
            s.ehlo()
            s.starttls()
            s.ehlo()
            s.login(cfg["user"], cfg["password"])
            s.send_message(msg)
        logger.info("mail_sent", to=to, subject=subject[:60],
                    attachments=len(attachments or []))
        return {"status": "sent"}
    except smtplib.SMTPAuthenticationError as e:
        logger.error("smtp_auth_error", error=str(e)[:200])
        return {"status": "error", "error": "인증 실패 (SMTP_USER/SMTP_PASSWORD 확인)"}
    except smtplib.SMTPRecipientsRefused as e:
        logger.warning("smtp_recipient_refused", to=to, error=str(e)[:200])
        return {"status": "error", "error": "수신자 거부"}
    except Exception as e:
        logger.error("mail_send_error", error=str(e)[:300], to=to)
        return {"status": "error", "error": str(e)[:200]}


def get_tenant_email_sync(db_sync, tenant_id: str) -> Optional[str]:
    """동기 SQLAlchemy 세션으로 tenant owner 이메일 조회."""
    row = db_sync.execute(sql_text(
        "SELECT email FROM public.users "
        "WHERE tenant_id = cast(:tid as uuid) AND email IS NOT NULL AND email != '' "
        "ORDER BY created_at ASC LIMIT 1"
    ), {"tid": str(tenant_id)}).first()
    return row.email if row else None


async def get_tenant_email_async(db, tenant_id: str) -> Optional[str]:
    """async SQLAlchemy 세션 버전."""
    row = (await db.execute(sql_text(
        "SELECT email FROM public.users "
        "WHERE tenant_id = cast(:tid as uuid) AND email IS NOT NULL AND email != '' "
        "ORDER BY created_at ASC LIMIT 1"
    ), {"tid": str(tenant_id)})).first()
    return row.email if row else None


# ─── 브리핑/보고서용 HTML 템플릿 ─────────────────────────────
def render_briefing_html(
    briefing_type: str,
    report_text: str,
    election_name: str = "",
    candidate_name: str = "",
    report_date: str = "",
) -> str:
    """브리핑 텍스트(마크다운 간이) → 메일 HTML 변환.

    줄바꿈 유지 + 간단한 헤딩·볼드만 처리. 복잡한 마크다운은 무시.
    """
    import html as html_mod
    import re

    type_label_map = {
        "morning": "오전 브리핑",
        "afternoon": "오후 브리핑",
        "daily": "일일 보고서",
        "weekly": "주간 전략 보고서",
    }
    label = type_label_map.get(briefing_type, briefing_type)

    # 간이 마크다운 — 해시 헤딩, 볼드만
    def md_line(line: str) -> str:
        esc = html_mod.escape(line)
        # **볼드**
        esc = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", esc)
        # ## 헤딩
        if esc.startswith("### "):
            return f"<h4 style='color:#1b61c9;margin:16px 0 8px'>{esc[4:]}</h4>"
        if esc.startswith("## "):
            return f"<h3 style='color:#181d26;margin:20px 0 10px'>{esc[3:]}</h3>"
        if esc.startswith("# "):
            return f"<h2 style='color:#181d26;margin:24px 0 12px'>{esc[2:]}</h2>"
        if not esc.strip():
            return "<br>"
        return f"<p style='margin:6px 0;line-height:1.6'>{esc}</p>"

    body_html = "\n".join(md_line(ln) for ln in report_text.split("\n"))

    header_meta = " · ".join(filter(None, [election_name, candidate_name, report_date]))

    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>{html_mod.escape(label)}</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,'Segoe UI',Roboto,'Noto Sans KR',sans-serif;color:#181d26">
<div style="max-width:640px;margin:0 auto;background:#fff;padding:32px 24px">
  <div style="border-bottom:2px solid #1b61c9;padding-bottom:12px;margin-bottom:20px">
    <div style="font-size:12px;color:#1b61c9;letter-spacing:2px;text-transform:uppercase">ElectionPulse</div>
    <h1 style="margin:4px 0 0;font-size:22px;color:#181d26">{html_mod.escape(label)}</h1>
    {f'<div style="font-size:13px;color:#666;margin-top:4px">{html_mod.escape(header_meta)}</div>' if header_meta else ''}
  </div>
  <div style="font-size:14px;line-height:1.65">
    {body_html}
  </div>
  <div style="border-top:1px solid #e0e2e6;margin-top:32px;padding-top:16px;font-size:12px;color:#94a3b8">
    이 메일은 ElectionPulse 시스템이 자동 발송합니다. 발신 전용 주소이며 답장은 받지 않습니다.
  </div>
</div>
</body></html>
"""
