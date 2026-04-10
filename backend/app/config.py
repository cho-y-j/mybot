"""
ElectionPulse - Application Configuration
모든 환경변수를 타입 안전하게 관리
"""
from pathlib import Path
from functools import lru_cache
from pydantic_settings import BaseSettings
from pydantic import field_validator


class Settings(BaseSettings):
    # --- App ---
    APP_ENV: str = "development"
    APP_DEBUG: bool = False
    APP_SECRET_KEY: str = "CHANGE-THIS"
    APP_DOMAIN: str = "localhost"
    BASE_DIR: Path = Path(__file__).resolve().parent.parent

    # --- Database ---
    DATABASE_URL: str = "postgresql+asyncpg://electionpulse:password@localhost:5432/electionpulse"
    DATABASE_ECHO: bool = False

    # --- Redis ---
    REDIS_URL: str = "redis://localhost:6379/0"
    CELERY_BROKER_URL: str = "redis://localhost:6379/1"

    # --- JWT ---
    JWT_PRIVATE_KEY_PATH: str = "keys/jwt_private.pem"
    JWT_PUBLIC_KEY_PATH: str = "keys/jwt_public.pem"
    JWT_ACCESS_TOKEN_EXPIRE_MINUTES: int = 15
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    JWT_ALGORITHM: str = "RS256"

    # --- Email ---
    SMTP_HOST: str = "smtp.gmail.com"
    SMTP_PORT: int = 587
    SMTP_USER: str = ""
    SMTP_PASSWORD: str = ""
    EMAIL_FROM: str = "noreply@electionpulse.kr"

    # --- Naver API ---
    NAVER_CLIENT_ID: str = ""
    NAVER_CLIENT_SECRET: str = ""
    NAVER_SEARCHAD_API_KEY: str = ""
    NAVER_SEARCHAD_SECRET: str = ""
    NAVER_SEARCHAD_CUSTOMER_ID: str = ""

    # --- Google/YouTube ---
    GOOGLE_API_KEY: str = ""
    YOUTUBE_API_KEY: str = ""

    # --- Admin ---
    ADMIN_EMAIL: str = "admin@electionpulse.kr"
    ADMIN_INITIAL_PASSWORD: str = "CHANGE-THIS"

    # --- Payments ---
    TOSS_CLIENT_KEY: str = ""
    TOSS_SECRET_KEY: str = ""

    # --- 선관위 공공데이터 API ---
    NEC_API_KEY: str = ""
    NEC_LOCAL_ELECTION_URL: str = "http://apis.data.go.kr/9760000/ScgnLocElctExctSttnService"
    NEC_PRESIDENT_ELECTION_URL: str = "http://apis.data.go.kr/9760000/ScgnPresElctExctSttnService"
    NEC_CONGRESS_ELECTION_URL: str = "http://apis.data.go.kr/9760000/ScgnConElctExctSttnService"
    NEC_PLEDGE_URL: str = "http://apis.data.go.kr/9760000/ElecPrmsInfoInqireService"

    # --- AI API (챗 기능용) ---
    ANTHROPIC_API_KEY: str = ""
    OPENAI_API_KEY: str = ""

    # --- Meta Ad Library ---
    META_AD_LIBRARY_TOKEN: str = ""

    # --- Sentry ---
    SENTRY_DSN: str = ""

    # --- Rate Limiting ---
    RATE_LIMIT_LOGIN: str = "5/minute"
    RATE_LIMIT_API: str = "100/minute"
    RATE_LIMIT_REGISTER: str = "3/hour"

    # --- Security ---
    ACCOUNT_LOCKOUT_ATTEMPTS: int = 5
    ACCOUNT_LOCKOUT_MINUTES: int = 30
    PASSWORD_MIN_LENGTH: int = 8

    @field_validator("APP_SECRET_KEY")
    @classmethod
    def secret_key_must_be_changed(cls, v: str) -> str:
        if v == "CHANGE-THIS":
            import os
            if os.getenv("APP_ENV", "development") == "production":
                raise ValueError("APP_SECRET_KEY must be changed from default in production")
        return v

    @property
    def is_production(self) -> bool:
        return self.APP_ENV == "production"

    model_config = {
        "env_file": ".env",
        "env_file_encoding": "utf-8",
        "case_sensitive": True,
    }


@lru_cache()
def get_settings() -> Settings:
    return Settings()
