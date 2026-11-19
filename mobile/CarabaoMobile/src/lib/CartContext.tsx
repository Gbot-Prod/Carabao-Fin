import React, { createContext, useContext, useState, ReactNode } from 'react';
import { useAuth } from './AuthContext';
import { mustWipe, updateFor, valueFor, type Owned } from './ownedState';

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
}

const CartContext = createContext<CartContextType | null>(null);

const NO_ITEMS: CartItem[] = [];

export function CartProvider({ children }: { children: ReactNode }) {
  // CF-0108: the cart belongs to the signed-in user ID. Sign-out (any path: button,
  // idle, refused session) or another account wipes it during render.
  const { user } = useAuth();
  const owner = user?.id ?? null;
  const [cart, setCart] = useState<Owned<CartItem[]>>(null);
  if (mustWipe(cart, owner)) setCart(null);
  const items = valueFor(cart, owner, NO_ITEMS);
  const setItems = (change: (prev: CartItem[]) => CartItem[]) =>
    setCart((prev) => updateFor(prev, owner, NO_ITEMS, change));

  const addItem = (newItem: Omit<CartItem, 'quantity'>, quantity = 1) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.id === newItem.id);
      if (existing) {
        return prev.map((i) =>
          i.id === newItem.id ? { ...i, quantity: i.quantity + 1 } : i
        );
      }
      return [...prev, { ...newItem, quantity }];
    });
  };

  const removeItem = (id: string) => {
    setItems((prev) => prev.filter((i) => i.id !== id));
  };

  const updateQuantity = (id: string, quantity: number) => {
    if (quantity <= 0) {
      removeItem(id);
      return;
    }
    setItems((prev) =>
      prev.map((i) => (i.id === id ? { ...i, quantity } : i))
    );
  };

  const clearCart = () => setItems(() => []);

  const itemCount = items.reduce((sum, i) => sum + i.quantity, 0);
  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider value={{ items, itemCount, total, addItem, removeItem, updateQuantity, clearCart }}>
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
