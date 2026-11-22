#!/bin/sh
set -eu

nginx -t
nginx
trap 'nginx -s quit' EXIT

for stage in '' /ev3; do
    url="http://127.0.0.1${stage}/checkout/webpay"
    response=$(curl -fsS --retry 2 --retry-connrefused "$url")
    printf '%s' "$response" | grep -q '<app-root'
    redirect=$(curl -fsS -o /dev/null -w '%{http_code} %{redirect_url}' \
        --data 'TBK_TOKEN=sample-token&TBK_ORDEN_COMPRA=sample-order&TBK_ID_SESION=sample-session&other=ignored' "$url")
    if [ "$redirect" != "303 ${url}#TBK_TOKEN=sample-token&TBK_ORDEN_COMPRA=sample-order&TBK_ID_SESION=sample-session" ]; then
        printf 'Unexpected redirect for %s: %s\n' "$url" "$redirect" >&2
        exit 1
    fi
    invalid=$(curl -sS -o /dev/null -w '%{http_code}' --data 'TBK_TOKEN=sample-token&TBK_TOKEN=duplicate' "$url")
    if [ "$invalid" != '400' ]; then
        printf 'Unexpected status for duplicate fields at %s: %s\n' "$url" "$invalid" >&2
        exit 1
    fi
done
