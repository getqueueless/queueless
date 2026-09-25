from slowapi import Limiter
from slowapi.util import get_remote_address
from starlette.requests import Request


def client_ip(request: Request) -> str:
    # The API is only reachable through the Cloudflare tunnel, and Cloudflare always
    # overwrites CF-Connecting-IP with the real client. The socket peer is the Caddy
    # container, so keying on it would put every user in one shared bucket.
    return request.headers.get("cf-connecting-ip") or get_remote_address(request)


limiter = Limiter(key_func=client_ip, headers_enabled=True)
