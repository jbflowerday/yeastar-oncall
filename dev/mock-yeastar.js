'use strict';
// Tiny fake Yeastar P-Series Open API for local testing.
//   node dev/mock-yeastar.js   (listens on :8099)
// Then set YEASTAR_BASE_URL=http://127.0.0.1:8099, YEASTAR_CLIENT_ID=test, YEASTAR_CLIENT_SECRET=test, YEASTAR_DRY_RUN=false

const http = require('node:http');

const routes = {
  1: { id: 1, name: 'Main DID', did_pattern: '0290001234', def_dest: 'ivr', def_dest_value: '6200' },
  2: { id: 2, name: 'Support line', did_pattern: '0290005678', def_dest: 'queue', def_dest_value: '6400' },
};
const TOKEN = 'mock-access-token';

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const send = (o) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(o)); };
    const json = body ? JSON.parse(body) : {};
    const p = url.pathname.replace('/openapi/v1.0/', '');
    console.log(req.method, p, body || '');
    if (req.headers['user-agent'] !== 'OpenAPI') return send({ errcode: 10001, errmsg: 'USER-AGENT ERROR' });
    if (p === 'get_token') {
      if (json.username !== 'test' || json.password !== 'test') return send({ errcode: 10003, errmsg: 'AUTHENTICATION FAILED' });
      return send({ errcode: 0, errmsg: 'SUCCESS', access_token: TOKEN, access_token_expire_time: 1800, refresh_token: 'r', refresh_token_expire_time: 86400 });
    }
    if (url.searchParams.get('access_token') !== TOKEN) return send({ errcode: 10004, errmsg: 'INVALID TOKEN' });
    if (p === 'inbound_route/list') return send({ errcode: 0, errmsg: 'SUCCESS', total_number: 2, data: Object.values(routes) });
    if (p === 'inbound_route/get') {
      const r = routes[url.searchParams.get('id')];
      return r ? send({ errcode: 0, errmsg: 'SUCCESS', data: r }) : send({ errcode: 20001, errmsg: 'NOT FOUND' });
    }
    if (p === 'inbound_route/update') {
      const r = routes[json.id];
      if (!r) return send({ errcode: 20001, errmsg: 'NOT FOUND' });
      Object.assign(r, json);
      console.log('  -> route now', r);
      return send({ errcode: 0, errmsg: 'SUCCESS' });
    }
    send({ errcode: 404, errmsg: 'UNKNOWN ENDPOINT' });
  });
}).listen(8099, () => console.log('mock Yeastar on :8099'));
