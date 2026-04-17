set -euo pipefail

echo "===HOST==="
hostname

echo "===SERVICES==="
systemctl is-active genergi-api
systemctl is-active genergi-worker

echo "===LOCAL_API_HEALTH==="
curl -fsS http://127.0.0.1:8787/api/health
printf '\n'

echo "===HOST_HEADER_HEALTH==="
curl -fsS -H 'Host: ai.genergius.com' http://127.0.0.1/api/health
printf '\n'

echo "===PUBLIC_HTTP_HEAD==="
curl -I -fsS http://ai.genergius.com || true
