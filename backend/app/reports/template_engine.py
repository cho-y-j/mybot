"""
ElectionPulse - Template Engine
Jinja2 기반 보고서 렌더링 엔진.
"""
from jinja2 import Environment, FileSystemLoader
from pathlib import Path

_env = Environment(
    loader=FileSystemLoader(Path(__file__).parent / "templates"),
    trim_blocks=True,
    lstrip_blocks=True,
)


def render(template_name: str, **context) -> str:
    """템플릿 렌더링. template_name은 templates/ 디렉토리 내 파일명."""
    return _env.get_template(template_name).render(**context)
