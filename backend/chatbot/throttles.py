from rest_framework.throttling import AnonRateThrottle


class ChatRateThrottle(AnonRateThrottle):
    """Each chat message enqueues a task onto the single-process 'ai_scoring'
    queue shared with fraud/listing/KYC scoring — inference takes ~60-90s on
    this hardware, so an unthrottled anonymous endpoint could starve that
    queue for every other admin/chat consumer. Scoped by IP since the widget
    is used by anonymous guests."""
    scope = "chatbot"
