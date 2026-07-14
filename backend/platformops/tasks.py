from celery import shared_task


@shared_task
def collect_server_metrics():
    """Collect a server resource snapshot and persist it.
    Runs every 5 minutes via CELERY_BEAT_SCHEDULE.
    Prunes snapshots older than 7 days to cap table size.
    """
    import psutil
    from django.utils import timezone
    from .models import ServerMetricSnapshot

    mem = psutil.virtual_memory()
    disk = psutil.disk_usage('/')
    net = psutil.net_io_counters()

    ServerMetricSnapshot.objects.create(
        cpu_percent=psutil.cpu_percent(interval=0.5),
        memory_percent=round(mem.percent, 1),
        memory_used_mb=round(mem.used / 1e6, 1),
        memory_total_mb=round(mem.total / 1e6, 1),
        disk_used_percent=round(disk.percent, 1),
        disk_free_gb=round(disk.free / 1e9, 1),
        net_bytes_sent_mb=round(net.bytes_sent / 1e6, 1),
        net_bytes_recv_mb=round(net.bytes_recv / 1e6, 1),
    )

    cutoff = timezone.now() - timezone.timedelta(days=7)
    ServerMetricSnapshot.objects.filter(recorded_at__lt=cutoff).delete()
