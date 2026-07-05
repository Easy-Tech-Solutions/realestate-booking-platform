"""
Central logging configuration for HomeKonet.

Four rotating log files written to  BASE_DIR/logs/:
  application.log  — HTTP request trace + general INFO events
  activity.log     — user-level audit trail (auth, bookings, listings …)
  transactions.log — payment and financial events
  errors.log       — WARNING and above from all loggers

Each file rotates at 10 MB and keeps 10 backups (≈ 110 MB max per category).
All file entries are written as single-line JSON for easy log-aggregator ingest.
"""
import json
import logging
from pathlib import Path

_BASE_DIR = Path(__file__).resolve().parent.parent
LOGS_DIR = _BASE_DIR / 'logs'
LOGS_DIR.mkdir(exist_ok=True)

_LOG_PATH = str(LOGS_DIR)


class _JsonFormatter(logging.Formatter):
    """Emit single-line JSON log entries."""

    # Standard LogRecord attrs that are already captured in the top-level keys
    # or are internal noise — skip them when building the extra-fields section.
    _SKIP = frozenset({
        'args', 'created', 'exc_info', 'exc_text', 'filename', 'funcName',
        'id', 'levelname', 'levelno', 'lineno', 'module', 'msecs', 'msg',
        'name', 'pathname', 'process', 'processName', 'relativeCreated',
        'stack_info', 'thread', 'threadName', 'taskName',
    })

    def format(self, record: logging.LogRecord) -> str:
        entry: dict = {
            'ts': self.formatTime(record, self.datefmt),
            'level': record.levelname,
            'logger': record.name,
            'msg': record.getMessage(),
        }
        if record.exc_info:
            entry['exception'] = self.formatException(record.exc_info)
        # Append any extra= fields added by the caller
        for k, v in record.__dict__.items():
            if k not in self._SKIP and not k.startswith('_'):
                entry[k] = v
        return json.dumps(entry, default=str)


LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,

    'formatters': {
        # Human-readable format for the console (development / Daphne stdout)
        'verbose': {
            'format': '[{asctime}] {levelname:<8} {name}: {message}',
            'style': '{',
            'datefmt': '%Y-%m-%d %H:%M:%S',
        },
        # Structured JSON format for log files
        'json': {
            '()': 'realestate_backend.logging_config._JsonFormatter',
            'datefmt': '%Y-%m-%dT%H:%M:%S',
        },
    },

    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
            'level': 'DEBUG',
        },
        'application_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': f'{_LOG_PATH}/application.log',
            'maxBytes': 10 * 1024 * 1024,   # 10 MB
            'backupCount': 10,
            'formatter': 'json',
            'level': 'INFO',
            'encoding': 'utf-8',
        },
        'activity_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': f'{_LOG_PATH}/activity.log',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 10,
            'formatter': 'json',
            'level': 'INFO',
            'encoding': 'utf-8',
        },
        'transactions_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': f'{_LOG_PATH}/transactions.log',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 10,
            'formatter': 'json',
            'level': 'INFO',
            'encoding': 'utf-8',
        },
        'errors_file': {
            'class': 'logging.handlers.RotatingFileHandler',
            'filename': f'{_LOG_PATH}/errors.log',
            'maxBytes': 10 * 1024 * 1024,
            'backupCount': 10,
            'formatter': 'json',
            'level': 'WARNING',
            'encoding': 'utf-8',
        },
    },

    'loggers': {
        # ── HomeKonet structured loggers ────────────────────────────────────
        # homekonet.application  → written by RequestLogMiddleware (one entry
        #   per request) and also receives propagated activity/transaction logs
        #   so application.log contains a full unified timeline.
        'homekonet.application': {
            'handlers': ['application_file'],
            'level': 'INFO',
            'propagate': False,
        },
        'homekonet.activity': {
            'handlers': ['activity_file', 'application_file'],
            'level': 'INFO',
            'propagate': False,
        },
        'homekonet.transactions': {
            'handlers': ['transactions_file', 'application_file'],
            'level': 'INFO',
            'propagate': False,
        },

        # ── Django built-in loggers ─────────────────────────────────────────
        # django.request logs 4xx/5xx automatically at WARNING/ERROR level.
        'django.request': {
            'handlers': ['errors_file', 'console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'django.security': {
            'handlers': ['errors_file', 'console'],
            'level': 'WARNING',
            'propagate': False,
        },
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },

    # Root logger: catches WARNING+ from all app code that uses the default
    # getLogger(__name__) pattern — goes to errors.log and console.
    'root': {
        'handlers': ['console', 'errors_file'],
        'level': 'WARNING',
    },
}
