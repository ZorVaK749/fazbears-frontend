import querystring from 'querystring';

const FORM = /^application\/x-www-form-urlencoded(?:\s*;|$)/i;
const FIELDS = ['token_ws', 'TBK_TOKEN', 'TBK_ORDEN_COMPRA', 'TBK_ID_SESION'];
const VALUE = /^[A-Za-z0-9-]{1,128}$/;

function callback(request) {
    if (request.method === 'GET' || request.method === 'HEAD') {
        request.internalRedirect('/index.html');
        return;
    }
    if (request.method !== 'POST') {
        request.headersOut.Allow = 'GET, HEAD, POST';
        request.return(405);
        return;
    }
    if (!FORM.test(request.headersIn['Content-Type'] || '')) {
        request.return(415);
        return;
    }

    const form = querystring.parse(request.requestText || '', '&', '=', { maxKeys: 0 });
    const fields = {};
    for (let i = 0; i < FIELDS.length; i++) {
        const key = FIELDS[i];
        if (form[key] === undefined) continue;
        if (typeof form[key] !== 'string' || !VALUE.test(form[key])) {
            request.return(400);
            return;
        }
        fields[key] = form[key];
    }
    if (Object.keys(fields).length === 0) {
        request.return(400);
        return;
    }

    // A relative redirect retains the public Gateway stage. Fragments stay in the browser.
    request.return(303, 'webpay#' + querystring.stringify(fields));
}

export default { callback };
