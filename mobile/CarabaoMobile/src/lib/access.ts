// CF-0120: who may open a protected screen. Merchant screens ask the server
// (/users/me `merchant`), not local state; the screen is not mounted (so it makes
// no merchant API call) until the server says yes. Admins are web-only
// (ADMIN_WEB_ONLY): no mobile screen is for them. Pure, for `npm test`.

export type RequiredRole = 'user' | 'merchant' | 'admin';
export type MerchantCheck = 'idle' | 'loading' | 'error' | { isMerchant: boolean };
export type Access = 'wait' | 'signin' | 'allowed' | 'forbidden' | 'error';

export function decideAccess(
  auth: { isLoading: boolean; isAuthenticated: boolean },
  required: RequiredRole | undefined,
  merchant: MerchantCheck,
): Access {
  if (auth.isLoading) return 'wait';
  if (!auth.isAuthenticated) return 'signin';
  if (!required || required === 'user') return 'allowed';
  if (required === 'admin') return 'forbidden';
  if (merchant === 'idle' || merchant === 'loading') return 'wait';
  if (merchant === 'error') return 'error';
  return merchant.isMerchant ? 'allowed' : 'forbidden';
}
