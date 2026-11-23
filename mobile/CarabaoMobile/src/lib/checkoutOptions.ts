// CF-0115: checkout choices and messages. Delivery date rules = backend
// place_order_from_cart (not in the past, at most MAX_DELIVERY_DAYS_AHEAD days
// ahead, Philippine time); the default is tomorrow, as on the web checkout.
// Pure, for `npm test`.
import { addDays } from './dates.ts';

export const MAX_DELIVERY_DAYS_AHEAD = 30; // backend routes/orders.py
export const DATE_CHOICES = 14;

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Today", "Tomorrow", or "Mon 24 Nov" for a YYYY-MM-DD date. */
export function dateLabel(ymd: string, today: string): string {
  if (ymd === today) return 'Today';
  if (ymd === addDays(today, 1)) return 'Tomorrow';
  const [y, m, d] = ymd.split('-').map(Number);
  const day = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${WEEKDAYS[day]} ${d} ${MONTHS[m - 1]}`;
}

/** The dates offered as chips: today and the next days, within the backend limit. */
export function deliveryDateChoices(today: string, count = DATE_CHOICES): { value: string; label: string }[] {
  const n = Math.max(1, Math.min(count, MAX_DELIVERY_DAYS_AHEAD + 1));
  return Array.from({ length: n }, (_, i) => {
    const value = addDays(today, i);
    return { value, label: dateLabel(value, today) };
  });
}

export const defaultDeliveryDate = (today: string): string => addDays(today, 1);

/** Null when the date is accepted, else the backend's message. */
export function deliveryDateError(ymd: string, today: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return 'Choose a delivery date.';
  if (ymd < today) return 'Delivery date cannot be in the past';
  if (ymd > addDays(today, MAX_DELIVERY_DAYS_AHEAD)) return `Delivery date must be within ${MAX_DELIVERY_DAYS_AHEAD} days`;
  return null;
}

/**
 * What the "Order failed" alert says, and whether the cart must be read again
 * (stock, price or availability changed on the server: 400 / 409).
 */
export function placeOrderFailure(status: number, message: string | null | undefined): { text: string; reloadCart: boolean } {
  const server = (message ?? '').trim();
  const generic = !server || /^Request failed \(\d+\)$/.test(server);
  if (status === 429) {
    return { text: generic ? 'Too many tries. Wait a minute and try again.' : server, reloadCart: false };
  }
  if (status === 409 || status === 400) {
    const text = generic ? 'Your cart changed. Check it and try again.' : server;
    return { text: `${text}${status === 409 ? '\nYour cart was refreshed.' : ''}`, reloadCart: true };
  }
  if (status === 0) return { text: server || 'Could not reach Carabao. Check your connection.', reloadCart: false };
  return { text: generic ? 'The order was not placed. Please try again.' : server, reloadCart: false };
}
