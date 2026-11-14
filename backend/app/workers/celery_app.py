from celery import Celery

from app.core.config import settings

celery_app = Celery("worklio", broker=settings.celery_broker_url, include=["app.workers.tasks", "app.workers.ai_tasks"])
celery_app.conf.update(
    task_acks_late=True,
    worker_prefetch_multiplier=1,
    timezone="UTC",
    # Needs a beat scheduler running (`celery ... beat`, or `worker -B` in development).
    beat_schedule={
        "delete-orphaned-uploads": {
            "task": "app.workers.tasks.delete_orphaned_uploads",
            "schedule": 3600.0,
        },
    },
)

# Wave A2 messaging: scheduled sends go out every 30 s.
celery_app.conf.beat_schedule.update(
    {
        "send-due-scheduled-messages": {
            "task": "app.workers.tasks.send_due_scheduled_messages",
            "schedule": 30.0,
            # A run that waited longer than one interval is superseded by the next one.
            "options": {"expires": 25},
        },
    }
)

# Wave A1 productivity: due reminders are delivered every 30 s.
celery_app.conf.beat_schedule.update(
    {
        "deliver-due-reminders": {
            "task": "app.workers.tasks.deliver_reminders",
            "schedule": 30.0,
            "options": {"expires": 25},
        },
    }
)

# Calendar: "starts soon" reminders and "starting now" rings for scheduled meetings, every 30 s.
celery_app.conf.beat_schedule.update(
    {
        "deliver-meeting-alerts": {
            "task": "app.workers.tasks.deliver_meeting_alerts",
            "schedule": 30.0,
            "options": {"expires": 25},
        },
    }
)
