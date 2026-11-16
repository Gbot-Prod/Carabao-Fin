// Run with `npm test`.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeSurfaces } from './urls.ts';

const local = makeSurfaces({
  rootDomain: 'carabao.test',
  appSurface: 'public',
  appUrl: 'http://carabao.test:3000',
});
const admin = makeSurfaces({
  rootDomain: 'carabao.test',
  appSurface: 'admin',
  appUrl: 'http://carabao.test:3000',
  adminUrl: 'http://admin.carabao.test:3001',
});
const single = makeSurfaces({ rootDomain: 'carabao.online', appSurface: 'public', appUrl: 'http://localhost:3000' });

const req = (host: string, path: string) => {
  const url = new URL(path, `http://${host}`);
  return { host, pathname: url.pathname, search: url.search };
};

test('links: subdomain hosts come from the app URL', () => {
  assert.equal(local.subdomainMode, true);
  assert.equal(local.appUrl('/order'), 'http://carabao.test:3000/order');
  assert.equal(local.merchantUrl('/routing/5'), 'http://merchant.carabao.test:3000/routing/5');
  assert.equal(local.helpUrl('/'), 'http://help.carabao.test:3000/');
  assert.equal(admin.adminUrl('/admin/orders'), 'http://admin.carabao.test:3001/admin/orders');
});

test('links: one host when the app URL is not on the root domain', () => {
  assert.equal(single.subdomainMode, false);
  assert.equal(single.appUrl('/order'), '/order');
  assert.equal(single.merchantUrl('/'), '/merchant');
  assert.equal(single.merchantUrl('/onboarding'), '/merchant/onboarding');
  assert.equal(single.helpUrl('/contact'), '/help/contact');
});

test('merchant host: prefixed path redirects to the clean URL', () => {
  assert.deepEqual(local.route(req('merchant.carabao.test:3000', '/merchant/routing/7')), {
    kind: 'redirect',
    location: '/routing/7',
  });
  assert.deepEqual(local.route(req('merchant.carabao.test', '/merchant')), { kind: 'redirect', location: '/' });
});

test('merchant host: clean URL is rewritten to /merchant', () => {
  assert.deepEqual(local.route(req('merchant.carabao.test', '/routing/7')), {
    kind: 'rewrite',
    path: '/merchant/routing/7',
  });
  assert.deepEqual(local.route(req('merchant.carabao.test', '/')), { kind: 'rewrite', path: '/merchant' });
});

test('merchant host: sign-in pages pass, buyer pages go to the apex', () => {
  assert.deepEqual(local.route(req('merchant.carabao.test', '/auth?next=/')), { kind: 'next' });
  assert.deepEqual(local.route(req('merchant.carabao.test', '/two-factor')), { kind: 'next' });
  assert.deepEqual(local.route(req('merchant.carabao.test', '/order?q=1')), {
    kind: 'redirect',
    location: 'http://carabao.test:3000/order?q=1',
  });
});

test('apex: /merchant/* and /help/* go to their subdomains', () => {
  assert.deepEqual(local.route(req('carabao.test', '/merchant/routing/7?x=1')), {
    kind: 'redirect',
    location: 'http://merchant.carabao.test:3000/routing/7?x=1',
  });
  assert.deepEqual(local.route(req('carabao.test', '/help/contact')), {
    kind: 'redirect',
    location: 'http://help.carabao.test:3000/contact',
  });
  assert.deepEqual(local.route(req('carabao.test', '/order')), { kind: 'next' });
});

test('legacy: numeric /merchant/<id> is the shop page, before the subdomain rule', () => {
  assert.deepEqual(local.route(req('carabao.test', '/merchant/42')), {
    kind: 'redirect',
    location: 'http://carabao.test:3000/farms/42',
  });
  assert.deepEqual(local.route(req('merchant.carabao.test', '/merchant/42')), {
    kind: 'redirect',
    location: 'http://carabao.test:3000/farms/42',
  });
  assert.deepEqual(single.route(req('localhost:3000', '/merchant/42')), { kind: 'redirect', location: '/farms/42' });
});

test('legacy: dashboard and onboarding paths (mobile opens /merchantOnboarding)', () => {
  assert.deepEqual(local.route(req('carabao.test', '/merchantOnboarding')), {
    kind: 'redirect',
    location: 'http://merchant.carabao.test:3000/onboarding',
  });
  assert.deepEqual(local.route(req('carabao.test', '/merchantDashboard/routing/3')), {
    kind: 'redirect',
    location: 'http://merchant.carabao.test:3000/routing/3',
  });
  assert.deepEqual(single.route(req('localhost:3000', '/merchantDashboard')), { kind: 'redirect', location: '/merchant' });
});

test('legacy: /help?section= goes to the new pages', () => {
  assert.deepEqual(local.route(req('carabao.test', '/help?section=terms')), {
    kind: 'redirect',
    location: 'http://carabao.test:3000/terms',
  });
  assert.deepEqual(single.route(req('localhost:3000', '/help?section=contact')), {
    kind: 'redirect',
    location: '/help/contact',
  });
});

test('help host: clean URL rewritten, prefix redirected', () => {
  assert.deepEqual(local.route(req('help.carabao.test', '/contact')), { kind: 'rewrite', path: '/help/contact' });
  assert.deepEqual(local.route(req('help.carabao.test', '/help/contact')), { kind: 'redirect', location: '/contact' });
});

test('public deploy: /admin/* is 404 on every host', () => {
  for (const host of ['carabao.test', 'merchant.carabao.test', 'help.carabao.test', 'localhost:3000']) {
    assert.deepEqual(local.route(req(host, '/admin/dashboard')), { kind: 'notFound' }, host);
    assert.deepEqual(local.route(req(host, '/admin')), { kind: 'notFound' }, host);
  }
  // Not a prefix match: /administer is a normal path.
  assert.deepEqual(local.route(req('carabao.test', '/administer')), { kind: 'next' });
});

test('admin deploy: only /admin/* and the allow-list (R2)', () => {
  const host = 'admin.carabao.test:3001';
  assert.deepEqual(admin.route(req(host, '/admin/users')), { kind: 'next' });
  assert.deepEqual(admin.route(req(host, '/')), { kind: 'rewrite', path: '/admin/dashboard' });
  assert.deepEqual(admin.route(req(host, '/orders')), { kind: 'rewrite', path: '/admin/orders' });
  assert.deepEqual(admin.route(req(host, '/order')), { kind: 'rewrite', path: '/admin/order' });
  for (const p of ['/two-factor', '/two-factor/enrol?token=x', '/reset-password', '/forgot-password', '/api/auth/x']) {
    assert.deepEqual(admin.route(req(host, p)), { kind: 'next' }, p);
  }
});

test('one-host config ignores the host header (no redirect loops)', () => {
  for (const host of ['carabao.online', 'merchant.carabao.online', 'help.carabao.online']) {
    assert.deepEqual(single.route(req(host, '/merchant/routing/7')), { kind: 'next' }, host);
    assert.deepEqual(single.route(req(host, '/order')), { kind: 'next' }, host);
  }
});

test('static files are not routed', () => {
  assert.deepEqual(local.route(req('merchant.carabao.test', '/images/icons/logo.png')), { kind: 'next' });
  assert.deepEqual(admin.route(req('admin.carabao.test', '/robots.txt')), { kind: 'next' });
});

test('stored notification links (R3)', () => {
  assert.equal(local.resolveStoredLink('/merchantDashboard'), 'http://merchant.carabao.test:3000/');
  assert.equal(local.resolveStoredLink('/orders/12'), 'http://carabao.test:3000/orders/12');
  assert.equal(local.resolveStoredLink('/track'), 'http://carabao.test:3000/track');
  assert.equal(single.resolveStoredLink('/merchantDashboard'), '/merchant');
  assert.equal(single.resolveStoredLink('/admin/orders'), '/admin/orders');
  assert.equal(admin.resolveStoredLink('/admin/support'), '/admin/support');
  for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil', 'orders']) {
    assert.equal(local.resolveStoredLink(bad), null, String(bad));
  }
});

test('sign-in page per deploy', () => {
  assert.equal(local.signInPath(), '/auth');
  assert.equal(local.signInPath('/orders/3'), '/auth?next=%2Forders%2F3');
  assert.equal(admin.signInPath(), '/admin/login');
  assert.equal(admin.signInPath('/admin/users'), '/admin/login?next=%2Fadmin%2Fusers');
});

const helpDeploy = makeSurfaces({
  rootDomain: 'carabao.test',
  appSurface: 'help',
  appUrl: 'http://help.carabao.test:3002',
  mainUrl: 'http://carabao.test:3000',
});

test('help deploy: only /help, by clean URL', () => {
  const host = 'help.carabao.test:3002';
  assert.deepEqual(helpDeploy.route(req(host, '/')), { kind: 'rewrite', path: '/help' });
  assert.deepEqual(helpDeploy.route(req(host, '/contact')), { kind: 'rewrite', path: '/help/contact' });
  assert.deepEqual(helpDeploy.route(req(host, '/help/contact?x=1')), { kind: 'redirect', location: '/contact?x=1' });
  // Anything else is a help path that does not exist (404 from Next.js).
  assert.deepEqual(helpDeploy.route(req(host, '/order')), { kind: 'rewrite', path: '/help/order' });
  assert.deepEqual(helpDeploy.route(req(host, '/admin/users')), { kind: 'rewrite', path: '/help/admin/users' });
});

test('help deploy: /api is 404, framework files and assets pass', () => {
  const host = 'help.carabao.test:3002';
  for (const p of ['/api', '/api/auth/get-session', '/api/csp-report']) {
    assert.deepEqual(helpDeploy.route(req(host, p)), { kind: 'notFound' }, p);
  }
  assert.deepEqual(helpDeploy.route(req(host, '/_next/webpack-hmr')), { kind: 'next' });
  assert.deepEqual(helpDeploy.route(req(host, '/images/icons/carabaoLogo.png')), { kind: 'next' });
});

test('help deploy: links go back to the main site', () => {
  assert.equal(helpDeploy.subdomainMode, true);
  assert.equal(helpDeploy.appUrl('/terms'), 'http://carabao.test:3000/terms');
  assert.equal(helpDeploy.merchantUrl('/onboarding'), 'http://merchant.carabao.test:3000/onboarding');
  assert.equal(helpDeploy.helpUrl('/contact'), '/contact');
});

test('public and admin deploys leave /api to the app', () => {
  assert.deepEqual(local.route(req('carabao.test', '/api/auth/get-session')), { kind: 'next' });
  assert.deepEqual(local.route(req('merchant.carabao.test', '/api/auth/get-session')), { kind: 'next' });
  assert.deepEqual(admin.route(req('admin.carabao.test', '/api/auth/jwks')), { kind: 'next' });
});
