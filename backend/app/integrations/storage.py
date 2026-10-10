"""Local, content-addressed fixture/export storage; S3 awaits a permitted deployment."""
import hashlib
from pathlib import Path


class LocalStorage:
    def __init__(self, root: Path):
        self.root = root

    def put(self, content: bytes) -> str:
        if len(content) > 2_000_000:
            raise ValueError('Dataset exceeds 2MB')
        digest = hashlib.sha256(content).hexdigest()
        self.root.mkdir(parents=True, exist_ok=True)
        path = self.root / f'{digest}.json'
        if not path.exists():
            path.write_bytes(content)
        return digest

    def get(self, digest: str) -> bytes:
        if len(digest) != 64 or any(c not in '0123456789abcdef' for c in digest):
            raise ValueError('Invalid content hash')
        return (self.root / f'{digest}.json').read_bytes()
