from dataclasses import dataclass
from functools import lru_cache

import jwt
from fastapi import HTTPException, Request
from jwt import PyJWKClient

from app.core.config import get_settings


@dataclass
class Actor:
    id: str
    role: str
    hospitals: frozenset[str] | None = None
    synthetic: bool = False

    def require(self, *roles):
        if self.role not in roles:
            raise HTTPException(403, f'Action requires role: {", ".join(roles)}')

    def scope(self, hospital_id):
        if self.hospitals is not None and hospital_id not in self.hospitals:
            raise HTTPException(403, 'Hospital outside actor scope')


@lru_cache
def jwks_client(issuer):
    return PyJWKClient(issuer + '/.well-known/jwks.json', cache_jwk_set=True, lifespan=300)


def actor_context(request: Request):
    settings = get_settings()
    if settings.auth_mode == 'demo':
        role = request.headers.get('X-Demo-Role')
        actor = request.headers.get('X-Demo-Actor')
        if not actor or role not in {'dispatcher', 'admin', 'physician', 'evaluator'}:
            raise HTTPException(401, 'Explicit local synthetic actor headers required')
        scope = request.headers.get('X-Demo-Hospitals')
        return Actor(actor, role, frozenset(scope.split(',')) if scope is not None else None, True)
    authorization = request.headers.get('Authorization', '')
    if not authorization.startswith('Bearer '):
        raise HTTPException(401, 'Cognito access token required')
    token = authorization[7:]
    issuer = f'https://cognito-idp.{settings.aws_region}.amazonaws.com/{settings.cognito_user_pool_id}'
    try:
        signing_key = jwks_client(issuer).get_signing_key_from_jwt(token)
        claims = jwt.decode(token, signing_key.key, algorithms=['RS256'], issuer=issuer,
                            options={'verify_aud': False, 'require': ['exp', 'iss', 'sub', 'token_use']})
        if claims['token_use'] != 'access' or claims.get('client_id') != settings.cognito_app_client_id:
            raise ValueError('Invalid access token client')
        groups = claims.get('cognito:groups', [])
        role = next((r for r in ['admin', 'dispatcher', 'physician', 'evaluator'] if r in groups), None)
        if not role:
            raise ValueError('Missing application role')
        scope = claims.get('hospital_ids', '')
        # Scope is issued by an authorized Cognito pre-token-generation trigger, never by the browser.
        hospitals = None if role == 'admin' and scope == '*' else frozenset(scope.split(','))
        return Actor(claims.get('physician_id', claims['sub']), role, hospitals)
    except (jwt.PyJWTError, ValueError):
        raise HTTPException(401, 'Invalid or expired Cognito access token') from None
