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
    test "$redirect" = "303 ${url}#TBK_TOKEN=sample-token&TBK_ORDEN_COMPRA=sample-order&TBK_ID_SESION=sample-session"
    invalid=$(curl -sS -o /dev/null -w '%{http_code}' --data 'TBK_TOKEN=sample-token&TBK_TOKEN=duplicate' "$url")
    test "$invalid" = '400'
done
