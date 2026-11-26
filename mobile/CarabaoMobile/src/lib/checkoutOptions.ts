// CF-0115: checkout messages. The farm decides when to deliver, so checkout
// takes no date or time window. Pure, for `npm test`.

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
