from uuid import uuid4

from app.models import AuditLog


def record(session, actor, dataset_id, action, entity_id, now, before=None, after=None, reason=''):
    row = AuditLog(id=str(uuid4()), dataset_id=dataset_id, actor=actor.id, role=actor.role,
                   action=action, entity_id=entity_id, created_at=now,
                   data={'before': before, 'after': after, 'reason': reason, 'synthetic_actor': actor.synthetic})
    session.add(row)
    return row
