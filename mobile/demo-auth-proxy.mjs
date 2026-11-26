// TEMPORARY demo helper. Delete after the demonstration.
// Expo web (http://localhost:8081) -> http://localhost:8082 -> https://carabao.online
// The browser sees the auth cookies as localhost cookies, so CORS and
// cross-site cookie blocking do not apply. Run: node mobile/demo-auth-proxy.mjs
import http from 'node:http';
import https from 'node:https';

const PORT = 8082;
const UPSTREAM = 'carabao.online';
const APP_ORIGIN = 'http://localhost:8081';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', APP_ORIGIN);
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Vary', 'Origin');
}

http
  .createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      cors(res);
      res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', req.headers['access-control-request-headers'] || '*');
      res.setHeader('Access-Control-Max-Age', '600');
      res.writeHead(204).end();
      return;
    }
    const headers = { ...req.headers, host: UPSTREAM };
    delete headers['accept-encoding']; // plain bodies are easier to debug
    // Expo Go on a phone signs in as exp://<LAN-IP>:8081, which production does
    // not trust. Send the app scheme that production trusts instead.
    if (String(headers['expo-origin'] || '').startsWith('exp://')) headers['expo-origin'] = 'carabaomobile://';
    if (String(headers.origin || '').startsWith('exp://')) headers.origin = 'carabaomobile://';
    const up = https.request({ host: UPSTREAM, port: 443, path: req.url, method: req.method, headers }, (upRes) => {
      const out = { ...upRes.headers };
      for (const k of Object.keys(out)) if (k.startsWith('access-control-')) delete out[k];
      if (out['set-cookie']) {
        out['set-cookie'] = out['set-cookie'].map((c) => c.replace(/;\s*Domain=[^;]*/i, ''));
      }
      if (out.location) out.location = out.location.replace(`https://${UPSTREAM}`, `http://localhost:${PORT}`);
      cors(res);
      res.writeHead(upRes.statusCode, out);
      upRes.pipe(res);
    });
    up.on('error', (e) => {
      console.error(req.method, req.url, e.message);
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    req.pipe(up);
  })
  .listen(PORT, () => console.log(`demo auth proxy: http://localhost:${PORT} -> https://${UPSTREAM}`));
