#!/usr/bin/env bash
# A Cloudflare Quick Tunnel to a local port, for a browser that a forwarded port does not reach.
#
#   yarn tunnel 3005    tunnels http://127.0.0.1:3005 and prints its https://*.trycloudflare.com address
#
# HTTP/2 rather than the default QUIC, as a container often cannot hold a UDP connection. The binary is downloaded on
# first use into ~/.local/bin.
set -euo pipefail

port="${1:?usage: yarn tunnel <port>}"
bin="$(command -v cloudflared || echo "$HOME/.local/bin/cloudflared")"
if [ ! -x "$bin" ]; then
  arch="$(uname -m | sed 's/aarch64/arm64/; s/x86_64/amd64/')"
  mkdir -p "$(dirname "$bin")"
  curl -fsSL -o "$bin" "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-$arch"
  chmod +x "$bin"
fi
exec "$bin" tunnel --no-autoupdate --protocol http2 --url "http://127.0.0.1:$port"
