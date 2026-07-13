from datetime import timedelta

# Response-time targets by priority. Not configurable per-category yet — a
# single table per priority level, recomputed from `created_at` whenever
# priority changes (not from "now", so raising priority doesn't reset the
# clock to look better than it is).
SLA_WINDOWS = {
    'urgent': timedelta(hours=4),
    'high': timedelta(hours=24),
    'medium': timedelta(days=3),
    'low': timedelta(days=7),
}


def sla_deadline_for(priority, created_at):
    window = SLA_WINDOWS.get(priority, SLA_WINDOWS['medium'])
    return created_at + window
