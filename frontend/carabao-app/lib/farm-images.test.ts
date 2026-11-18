import { test } from 'node:test';
import assert from 'node:assert/strict';
import { farmImages } from './farm-images.ts';

// CF-0056
test('images come from the listed shop page', () => {
  assert.deepEqual(
    farmImages({ shop_page: { logo_url: 'https://r2/l.png', banner_image_url: 'https://r2/b.png' } }),
    { logoUrl: 'https://r2/l.png', bannerUrl: 'https://r2/b.png' },
  );
});

test('no shop page or blank urls give no images', () => {
  assert.deepEqual(farmImages({}), { logoUrl: null, bannerUrl: null });
  assert.deepEqual(farmImages({ shop_page: null }), { logoUrl: null, bannerUrl: null });
  assert.deepEqual(farmImages({ shop_page: { logo_url: '  ', banner_image_url: null } }), { logoUrl: null, bannerUrl: null });
});
