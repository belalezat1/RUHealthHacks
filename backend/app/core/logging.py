import json
import logging
import time
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware

logger = logging.getLogger('sevaro')


class RequestLoggingMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request, call_next):
        request_id = str(uuid4())
        start = time.perf_counter()
        response = await call_next(request)
        response.headers['X-Request-ID'] = request_id
        logger.info(json.dumps({'request_id': request_id, 'method': request.method,
                               'path': request.url.path, 'status': response.status_code,
                               'duration_ms': round((time.perf_counter() - start) * 1000, 2)}))
        # No headers, query strings, credentials, bodies or free-text notes are logged.
        return response
