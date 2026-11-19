/// <reference types="node" />
// Run with `npm test`. CF-0114.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isAllowedCheckoutUrl } from './paymentUrl.ts';

test('PayMongo checkout pages are allowed', () => {
  for (const ok of [
    'https://checkout.paymongo.com/cs_abc123',
    'https://checkout.paymongo.com/cs_abc?x=1#y',
    'https://paymongo.com/',
    'https://pm.checkout.paymongo.com:443/cs_1',
    'HTTPS://CHECKOUT.PAYMONGO.COM/cs_1',
  ]) {
    assert.equal(isAllowedCheckoutUrl(ok), true, ok);
  }
});

test('other hosts, look-alikes, user info and other schemes are refused', () => {
  for (const bad of [
    'http://checkout.paymongo.com/cs_1', // not https
    'https://checkout.paymongo.com.evil.example/cs_1',
    'https://evilpaymongo.com/cs_1',
    'https://evil.example/checkout.paymongo.com',
    'https://evil.example/?u=https://checkout.paymongo.com',
    'https://checkout.paymongo.com@evil.example/cs_1',
    'https://user:pw@checkout.paymongo.com/cs_1',
    'https://checkout.paymongo.com\\@evil.example/',
    'https://checkout.paymongo.com:8443/cs_1',
    'javascript:alert(1)//checkout.paymongo.com',
    'carabaomobile://checkout.paymongo.com',
    'https://checkout.paymongo.com/cs 1',
    '',
  ]) {
    assert.equal(isAllowedCheckoutUrl(bad), false, bad);
  }
  assert.equal(isAllowedCheckoutUrl(null), false);
  assert.equal(isAllowedCheckoutUrl(42), false);
  assert.equal(isAllowedCheckoutUrl(`https://checkout.paymongo.com/${'a'.repeat(2100)}`), false);
});
