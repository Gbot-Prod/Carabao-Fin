import { merchantUrl, resolveStoredLink } from "@/lib/urls";
import { merchantPageForNotification, positiveId } from "@/lib/merchant-links";

// R3: stored links are paths ("/merchantDashboard", "/admin/orders"); the
// mobile app reads them too. Map to the right host here, do not change them.
// A plain "/merchantDashboard" opens the merchant page for this kind (new order -> Orders).
export function notificationTarget(item: { link: string | null; kind: string }): string | null {
  const merchantPage = merchantPageForNotification(item.link, item.kind);
  return merchantPage ? merchantUrl(merchantPage) : resolveStoredLink(buyerChatLink(item));
}

/**
 * Older buyer chat notifications link to the order ("/orders/12"); open the
 * order's chat instead, as new ones do ("/chats?order=12").
 */
export function buyerChatLink({ link, kind }: { link: string | null; kind: string }): string | null {
  if (kind !== "chat_message" || !link) return link;
  const m = /^\/orders\/([^/?#]+)\/?$/.exec(link);
  const id = m ? positiveId(m[1]) : null;
  return id ? `/chats?order=${id}` : link;
}

/** Open a notification's link: a full page load for another host, else client navigation. */
export function openNotificationTarget(target: string, push: (href: string) => void): void {
  if (/^https?:\/\//.test(target) && new URL(target).origin !== window.location.origin) {
    window.location.assign(target);
  } else {
    push(target);
  }
}
