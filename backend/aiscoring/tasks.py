import logging

from celery import shared_task

from platformops.utils import is_feature_enabled

from .model_service import ModelUnavailable

logger = logging.getLogger(__name__)


def _ai_scoring_enabled():
    return is_feature_enabled('ai_scoring_enabled', default=False)


def _heartbeat(task_name, success, error=''):
    from platformops.models import TaskHeartbeat
    TaskHeartbeat.record(task_name, success=success, error=error)


@shared_task(queue='ai_scoring')
def score_fraud_flag_task(flag_id):
    task_name = 'aiscoring.tasks.score_fraud_flag_task'
    if not _ai_scoring_enabled():
        return {'skipped': 'ai_scoring_enabled is off'}
    from trustsafety.models import FraudFlag
    from . import scorer
    try:
        flag = FraudFlag.objects.get(pk=flag_id)
        result = scorer.score_fraud_flag(flag)
        flag.ai_score = result['score']
        flag.ai_rationale = result['rationale']
        flag.save(update_fields=['ai_score', 'ai_rationale'])
        _heartbeat(task_name, success=True)
        return result
    except ModelUnavailable as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.warning('%s: %s', task_name, exc)
    except Exception as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.exception('%s failed for flag #%s', task_name, flag_id)
        raise


@shared_task(queue='ai_scoring')
def score_listing_flag_task(flag_id):
    task_name = 'aiscoring.tasks.score_listing_flag_task'
    if not _ai_scoring_enabled():
        return {'skipped': 'ai_scoring_enabled is off'}
    from inventory.models import ListingFlag
    from . import scorer
    try:
        flag = ListingFlag.objects.select_related('listing').get(pk=flag_id)
        result = scorer.score_listing_flag(flag)
        flag.ai_score = result['score']
        flag.ai_rationale = result['rationale']
        flag.save(update_fields=['ai_score', 'ai_rationale'])
        _heartbeat(task_name, success=True)
        return result
    except ModelUnavailable as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.warning('%s: %s', task_name, exc)
    except Exception as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.exception('%s failed for flag #%s', task_name, flag_id)
        raise


@shared_task(queue='ai_scoring')
def score_host_application_task(application_id):
    task_name = 'aiscoring.tasks.score_host_application_task'
    if not _ai_scoring_enabled():
        return {'skipped': 'ai_scoring_enabled is off'}
    from hostapplications.models import HostApplication
    from . import scorer
    try:
        application = HostApplication.objects.get(pk=application_id)
        result = scorer.score_host_application(application)
        application.ai_risk_score = result['score']
        application.ai_rationale = result['rationale']
        application.save(update_fields=['ai_risk_score', 'ai_rationale'])
        _heartbeat(task_name, success=True)
        return result
    except ModelUnavailable as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.warning('%s: %s', task_name, exc)
    except Exception as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.exception('%s failed for application #%s', task_name, application_id)
        raise


@shared_task(queue='ai_scoring')
def score_property_verification_task(verification_id):
    task_name = 'aiscoring.tasks.score_property_verification_task'
    if not _ai_scoring_enabled():
        return {'skipped': 'ai_scoring_enabled is off'}
    from propertyverifications.models import PropertyVerification
    from . import scorer
    try:
        verification = PropertyVerification.objects.get(pk=verification_id)
        result = scorer.score_property_verification(verification)
        verification.ai_risk_score = result['score']
        verification.ai_rationale = result['rationale']
        verification.save(update_fields=['ai_risk_score', 'ai_rationale'])
        _heartbeat(task_name, success=True)
        return result
    except ModelUnavailable as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.warning('%s: %s', task_name, exc)
    except Exception as exc:
        _heartbeat(task_name, success=False, error=str(exc))
        logger.exception('%s failed for verification #%s', task_name, verification_id)
        raise
