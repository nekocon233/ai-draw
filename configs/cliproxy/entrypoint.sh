#!/bin/sh
set -eu

# The runtime configuration contains a secret. Keep it out of the image,
# source tree, command line, and logs.
case "${GPT_IMAGE_API_KEY:-}" in
  ''|*[!A-Za-z0-9_-]*)
    printf '%s\n' 'GPT_IMAGE_API_KEY must be a nonempty proxy key using letters, digits, underscores, or hyphens.' >&2
    exit 1
    ;;
esac

umask 077
mkdir -p /root/.cli-proxy-api
printf 'host: "0.0.0.0"\nport: 8317\nauth-dir: "/root/.cli-proxy-api"\napi-keys:\n  - "%s"\nremote-management:\n  allow-remote: false\n  secret-key: ""\n  disable-control-panel: true\ndebug: false\nlogging-to-file: false\nrequest-log: false\nrequest-retry: 0\nmax-retry-interval: 0\ndisable-image-generation: "chat"\n' "$GPT_IMAGE_API_KEY" > /tmp/ai-draw-cliproxy.yaml

exec /CLIProxyAPI/CLIProxyAPI -config /tmp/ai-draw-cliproxy.yaml "$@"
