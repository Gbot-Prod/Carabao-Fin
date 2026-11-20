// CF-0109: the cart is the server cart (/carts/me), as on the web. It loads once per
// sign-in, so it survives an app restart and is the same cart as on the website.
// A change shows at once, then the whole list is sent (produce_id + quantity only);
// the server's answer (prices, fees, "no longer available") replaces the lines.
// CF-0108: the lines in memory belong to one user ID and are wiped on sign-out.
import React, { createContext, useCallback, useContext, useEffect, useRef, useState, ReactNode } from 'react';
import { Alert } from 'react-native';
import { useAuth } from './AuthContext';
import { api } from './api';
import { mustWipe, updateFor, valueFor, type Owned } from './ownedState';
import { fromServerLine, toServerItems } from './cartSync';

export interface CartItem {
  id: string;
  /** Backend produce id — required for checkout (/orders/me/place). */
  produceId: number;
  merchantId: number | null;
  farm: string;
  produce: string;
  unit: string;
  price: number;
  quantity: number;
  /** The farm's delivery fee for its order (C1); null if unknown. */
  deliveryFee?: number | null;
  // Set from the server line (CF-0109).
  minOrderQty?: number;
  stockQuantity?: number;
  /** Why checkout would refuse this line now (CF-0052); null when it can be bought. */
  unavailableReason?: string | null;
  /** The server issue code (CF-0042); every one, known or not, blocks checkout (CF-0129). */
  issue?: string | null;
  /** The price when the buyer last saved the line, when it has changed since. */
  previousPrice?: number | null;
}

interface CartContextType {
  items: CartItem[];
  itemCount: number;
  total: number;
  // `quantity` is used only when the item is not in the cart yet.
  addItem: (item: Omit<CartItem, 'quantity'>, quantity?: number) => void;
  removeItem: (id: string) => void;
  updateQuantity: (id: string, quantity: number) => void;
  clearCart: () => void;
  /** Read the server cart again (pull to refresh, after checkout). */
  reload: () => Promise<void>;
  /** True until the server cart has loaded once for this sign-in. */
  loading: boolean;
}

const CartContext = createContext<CartContextType | null>(null);
const NO_ITEMS: CartItem[] = [];

export function CartProvider({ children }: { children: ReactNode }) {
  const { user, token } = useAuth();
  const owner = user?.id ?? null;
  const [cart, setCart] = useState<Owned<CartItem[]>>(null);
  if (mustWipe(cart, owner)) setCart(null);
  const items = valueFor(cart, owner, NO_ITEMS);
  const loading = owner !== null && cart === null;

  // Only the newest server answer is applied (fast taps send several PUTs).
  const seq = useRef(0);
  const tokenRef = useRef(token);
  useEffect(() => {
    tokenRef.current = token;
  }, [token]);

  const fetchCart = useCallback((forToken: string, forOwner: string) => {
    const mine = ++seq.current;
    return api.cart
      .get(forToken)
      .then((res) => {
        if (mine === seq.current) setCart({ owner: forOwner, value: res.items.map(fromServerLine) });
      })
      .catch(() => {
        // Keep what is shown; an empty cart for this owner stops the loading state.
        if (mine === seq.current) setCart((prev) => prev ?? { owner: forOwner, value: [] });
      });
  }, []);

  // Once per sign-in (not on every token refresh).
  useEffect(() => {
    if (owner && tokenRef.current) void fetchCart(tokenRef.current, owner);
  }, [owner, fetchCart]);

  const reload = useCallback(
    () => (token && owner ? fetchCart(token, owner) : Promise.resolve()),
    [token, owner, fetchCart],
  );

  const write = (change: (prev: CartItem[]) => CartItem[]) => {
    if (!owner || !token) return;
    const next = change(items);
    setCart((prev) => updateFor(prev, owner, NO_ITEMS, () => next));
    const mine = ++seq.current;
    api.cart
      .replace(token, toServerItems(next))
      .then((res) => {
        if (mine === seq.current) setCart({ owner, value: res.items.map(fromServerLine) });
      })
      .catch((err: unknown) => {
        if (mine !== seq.current) return;
        // e.g. "'Kale' is no longer available" or the 50-line limit: show the server's cart again.
        Alert.alert('Cart not updated', err instanceof Error ? err.message : 'Please try again.');
        void fetchCart(token, owner);
      });
  };

  const addItem = (newItem: Omit<CartItem, 'quantity'>, quantity = 1) =>
    write((prev) => {
      const existing = prev.find((i) => i.id === newItem.id);
      if (existing) return prev.map((i) => (i.id === newItem.id ? { ...i, quantity: i.quantity + 1 } : i));
      return [...prev, { ...newItem, quantity }];
    });

  const removeItem = (id: string) => write((prev) => prev.filter((i) => i.id !== id));

  const updateQuantity = (id: string, quantity: number) =>
    write((prev) =>
      quantity <= 0 ? prev.filter((i) => i.id !== id) : prev.map((i) => (i.id === id ? { ...i, quantity } : i)),
    );

  const clearCart = () => write(() => []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{ items, itemCount, total, addItem, removeItem, updateQuantity, clearCart, reload, loading }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
