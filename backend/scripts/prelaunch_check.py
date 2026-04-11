#!/usr/bin/env python
"""Pre-launch deployment checks for the Django backend.

Usage:
  python scripts/prelaunch_check.py
  python scripts/prelaunch_check.py --allow-dev

Exit codes:
  0 = all required checks passed
  1 = one or more required checks failed
"""

from __future__ import annotations

import argparse
import os
import sys
from dataclasses import dataclass
from typing import Callable
from pathlib import Path


@dataclass
class CheckResult:
    name: str
    status: str  # PASS, WARN, FAIL
    detail: str


def _bool(value: str | None, default: bool = False) -> bool:
    if value is None:
        return default
    return value.lower() in {"1", "true", "yes", "on"}


def run_checks(allow_dev: bool) -> list[CheckResult]:
    backend_root = Path(__file__).resolve().parents[1]
    if str(backend_root) not in sys.path:
        sys.path.insert(0, str(backend_root))

    os.environ.setdefault("DJANGO_SETTINGS_MODULE", "realestate_backend.settings")

    try:
        import django
        django.setup()
    except Exception as exc:
        return [CheckResult("Django bootstrap", "FAIL", f"Could not initialize Django: {exc}")]

    results: list[CheckResult] = []

    from django.conf import settings

    def add(name: str, status: str, detail: str) -> None:
        results.append(CheckResult(name=name, status=status, detail=detail))

    def require(name: str, condition: bool, ok: str, fail: str) -> None:
        add(name, "PASS" if condition else "FAIL", ok if condition else fail)

    def warnable(name: str, condition: bool, ok: str, warn: str) -> None:
        add(name, "PASS" if condition else "WARN", ok if condition else warn)

    debug = bool(getattr(settings, "DEBUG", True))
    if allow_dev:
        warnable("DEBUG mode", not debug, "DEBUG is disabled.", "DEBUG is enabled (allowed by --allow-dev).")
    else:
        require("DEBUG mode", not debug, "DEBUG is disabled.", "DEBUG must be false in production.")

    secret_key = getattr(settings, "SECRET_KEY", "")
    if allow_dev:
        warnable(
            "Secret key quality",
            bool(secret_key) and secret_key != "change-me-in-prod" and len(secret_key) >= 32,
            "SECRET_KEY appears non-default and strong enough.",
            "SECRET_KEY is missing, default, or too short (<32 chars).",
        )
    else:
        require(
            "Secret key quality",
            bool(secret_key) and secret_key != "change-me-in-prod" and len(secret_key) >= 32,
            "SECRET_KEY appears non-default and strong enough.",
            "SECRET_KEY is missing, default, or too short (<32 chars).",
        )

    allowed_hosts = list(getattr(settings, "ALLOWED_HOSTS", []))
    require(
        "Allowed hosts",
        bool(allowed_hosts) and "*" not in allowed_hosts,
        f"ALLOWED_HOSTS configured: {allowed_hosts}",
        "ALLOWED_HOSTS must not be empty or wildcard.",
    )

    require(
        "Email verification gate",
        bool(getattr(settings, "AUTH_REQUIRE_EMAIL_VERIFICATION", True)),
        "Email verification is required before login.",
        "AUTH_REQUIRE_EMAIL_VERIFICATION should be true in production.",
    )

    db_engine = settings.DATABASES["default"]["ENGINE"]
    if allow_dev:
        warnable(
            "Database engine",
            "postgresql" in db_engine,
            f"Database engine is production-ready: {db_engine}",
            f"Database engine is {db_engine}; postgres is recommended for production.",
        )
    else:
        require(
            "Database engine",
            "postgresql" in db_engine,
            f"Database engine is production-ready: {db_engine}",
            f"Database engine is {db_engine}; postgres is required for production deploy.",
        )

    # Check pending migrations
    try:
        from django.db import connections
        from django.db.migrations.executor import MigrationExecutor

        executor = MigrationExecutor(connections["default"])
        pending = executor.migration_plan(executor.loader.graph.leaf_nodes())
        require(
            "Database migrations",
            len(pending) == 0,
            "No pending migrations.",
            f"Pending migrations found: {len(pending)}",
        )
    except Exception as exc:
        add("Database migrations", "FAIL", f"Could not verify migrations: {exc}")

    cache_backend = settings.CACHES["default"]["BACKEND"]
    redis_url = os.environ.get("REDIS_URL")
    if allow_dev:
        warnable(
            "Cache backend",
            "redis" in cache_backend.lower(),
            f"Cache backend is Redis: {cache_backend}",
            f"Cache backend is {cache_backend}; Redis is recommended for production scale.",
        )
    else:
        require(
            "Cache backend",
            "redis" in cache_backend.lower() and bool(redis_url),
            f"Cache backend is Redis: {cache_backend}",
            "Redis cache backend with REDIS_URL is required for production.",
        )

    # Redis connectivity (if configured)
    if redis_url:
        try:
            import redis
            client = redis.Redis.from_url(redis_url)
            client.ping()
            add("Redis connectivity", "PASS", "Connected to Redis successfully.")
        except Exception as exc:
            add("Redis connectivity", "FAIL", f"Could not connect to Redis: {exc}")
    else:
        status = "WARN" if allow_dev else "FAIL"
        add("Redis connectivity", status, "REDIS_URL is not set.")

    email_backend = getattr(settings, "EMAIL_BACKEND", "")
    smtp_required = "console" not in email_backend
    if allow_dev and not smtp_required:
        add("Email backend", "WARN", f"Using dev email backend: {email_backend}")
    else:
        require(
            "Email backend",
            smtp_required,
            f"Email backend is SMTP-like: {email_backend}",
            "Console email backend is not valid for production.",
        )

    smtp_user = os.environ.get("EMAIL_HOST_USER", "")
    smtp_pass = os.environ.get("EMAIL_HOST_PASSWORD", "")
    from_email = os.environ.get("DEFAULT_FROM_EMAIL", "")
    if allow_dev:
        warnable(
            "Email credentials",
            bool(smtp_user and smtp_pass and from_email),
            "EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL are set.",
            "Missing email credentials or sender address.",
        )
    else:
        require(
            "Email credentials",
            bool(smtp_user and smtp_pass and from_email),
            "EMAIL_HOST_USER, EMAIL_HOST_PASSWORD, DEFAULT_FROM_EMAIL are set.",
            "Missing email credentials or sender address.",
        )

    celery_eager = _bool(os.environ.get("CELERY_ALWAYS_EAGER"), default=bool(getattr(settings, "DEBUG", True)))
    if allow_dev:
        warnable(
            "Celery eager mode",
            not celery_eager,
            "CELERY_ALWAYS_EAGER is false.",
            "CELERY_ALWAYS_EAGER is true (allowed by --allow-dev).",
        )
    else:
        require(
            "Celery eager mode",
            not celery_eager,
            "CELERY_ALWAYS_EAGER is false.",
            "CELERY_ALWAYS_EAGER must be false in production.",
        )

    cors_origins = list(getattr(settings, "CORS_ALLOWED_ORIGINS", []))
    has_localhost = any("localhost" in origin or "127.0.0.1" in origin for origin in cors_origins)
    if allow_dev:
        warnable(
            "CORS origins",
            not has_localhost,
            f"CORS origins look production-ready: {cors_origins}",
            f"CORS origins include localhost entries: {cors_origins}",
        )
    else:
        require(
            "CORS origins",
            bool(cors_origins) and not has_localhost,
            f"CORS origins look production-ready: {cors_origins}",
            "CORS_ALLOWED_ORIGINS should only include production frontend domains.",
        )

    # Payment gateway readiness
    try:
        from payments.models import PaymentGateway

        gateway = PaymentGateway.objects.filter(name="mtn_momo", is_active=True).first()
        if allow_dev:
            warnable(
                "MTN gateway row",
                gateway is not None,
                "Active mtn_momo gateway exists in database.",
                "No active mtn_momo gateway row found in PaymentGateway table.",
            )
        else:
            require(
                "MTN gateway row",
                gateway is not None,
                "Active mtn_momo gateway exists in database.",
                "No active mtn_momo gateway row found in PaymentGateway table.",
            )
        if gateway is not None:
            if allow_dev:
                warnable(
                    "MTN gateway secrets",
                    bool(gateway.api_key and gateway.secret_key and gateway.merchant_id),
                    "Gateway credentials are set on mtn_momo row.",
                    "mtn_momo gateway is missing api_key/secret_key/merchant_id.",
                )
            else:
                require(
                    "MTN gateway secrets",
                    bool(gateway.api_key and gateway.secret_key and gateway.merchant_id),
                    "Gateway credentials are set on mtn_momo row.",
                    "mtn_momo gateway is missing api_key/secret_key/merchant_id.",
                )
    except Exception as exc:
        add("Payments configuration", "FAIL", f"Could not verify MTN gateway config: {exc}")

    # Optional smoke check for static security flags in non-debug mode
    if not debug:
        require(
            "Secure cookies",
            bool(getattr(settings, "SESSION_COOKIE_SECURE", False) and getattr(settings, "CSRF_COOKIE_SECURE", False)),
            "Secure cookie flags are enabled.",
            "SESSION_COOKIE_SECURE and CSRF_COOKIE_SECURE should both be true.",
        )

    return results


def print_report(results: list[CheckResult]) -> int:
    order = {"PASS": 0, "WARN": 1, "FAIL": 2}
    results_sorted = sorted(results, key=lambda r: (order.get(r.status, 3), r.name.lower()))

    for item in results_sorted:
        print(f"[{item.status}] {item.name}: {item.detail}")

    fail_count = sum(1 for r in results if r.status == "FAIL")
    warn_count = sum(1 for r in results if r.status == "WARN")
    pass_count = sum(1 for r in results if r.status == "PASS")

    print("\nSummary")
    print(f"PASS: {pass_count}")
    print(f"WARN: {warn_count}")
    print(f"FAIL: {fail_count}")

    return 1 if fail_count else 0


def main() -> int:
    parser = argparse.ArgumentParser(description="Run production pre-launch checks")
    parser.add_argument(
        "--allow-dev",
        action="store_true",
        help="Downgrade some production-only failures to warnings for local dry runs.",
    )
    args = parser.parse_args()

    results = run_checks(allow_dev=args.allow_dev)
    return print_report(results)


if __name__ == "__main__":
    sys.exit(main())
