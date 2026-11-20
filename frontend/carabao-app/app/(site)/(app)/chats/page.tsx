"use client";

import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import OrderChat from "@/components/OrderChat/OrderChat";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { useBuyerChats } from "@/components/Chats/BuyerChatsProvider";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import type { BuyerChatSummary } from "@/util/api/users";
import s from "./page.module.css";

function when(iso: string | null, locale: string) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale, { hour: "numeric", minute: "2-digit" })
    : d.toLocaleDateString(locale, { month: "short", day: "numeric" });
}

const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0]?.toUpperCase())
    .join("");

/** The farm's shop logo, or its initials when it has no logo. The name beside it says who it is. */
function FarmAvatar({ name, logoUrl }: { name: string; logoUrl: string | null }) {
  return (
    <span className={s.avatar} aria-hidden="true">
      {logoUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={logoUrl} alt="" className={s.avatarImg} loading="lazy" />
      ) : (
        <span className={s.avatarInitials}>{initials(name) || "?"}</span>
      )}
    </span>
  );
}

/** The buyer's order chats with farms: the list on the left, the open chat on the right. */
export default function BuyerChatsPage() {
  const { t, lang } = useLanguage();
  const c = t.chats;
  const locale = lang === "fil" ? "fil-PH" : "en-PH";
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();
  const { chats, loaded, error, reload, markRead, unreadCount } = useBuyerChats();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedId = Number(params.get("order")) || null;
  const selected = chats.find((chat) => chat.order_id === selectedId) ?? null;

  // The open chat reads its messages, and the server marks them read.
  useEffect(() => {
    if (selected && selected.unread > 0) markRead(selected.order_id);
  }, [selected, markRead]);

  const open = (orderId: number | null) => {
    router.replace(orderId ? `${pathname}?order=${orderId}` : pathname, { scroll: false });
  };

  return (
    <div className={s.container}>
      <div className={s.header}>
        <p className={s.eyebrow}>{c.eyebrow}</p>
        <h1 className={s.title}>{c.title}</h1>
        <p className={s.description}>
          {unreadCount > 0 ? fmt(c.descriptionUnread, { count: unreadCount }) : c.description}
        </p>
      </div>

      {authLoading ? (
        <SkeletonList label={c.loading} rows={4} />
      ) : !isAuthenticated ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>{c.signInTitle}</p>
          <button type="button" className={s.action} onClick={() => showPrompt()}>{c.signIn}</button>
        </div>
      ) : !loaded && error ? (
        <LoadError message={c.error} onRetry={() => void reload()} />
      ) : !loaded ? (
        <SkeletonList label={c.loading} rows={4} />
      ) : chats.length === 0 ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>{c.emptyTitle}</p>
          <p className={s.emptyText}>{c.emptyText}</p>
          <Link href="/order" className={s.action}>{c.browse}</Link>
        </div>
      ) : (
        <div className={`${s.layout} ${selected ? s.hasSelection : ""}`}>
          <ul className={s.list} aria-label={c.list}>
            {chats.map((chat) => (
              <li key={chat.order_id}>
                <ChatRow
                  chat={chat}
                  locale={locale}
                  active={chat.order_id === selectedId}
                  onOpen={() => open(chat.order_id)}
                />
              </li>
            ))}
          </ul>

          <div className={s.thread}>
            {selected ? (
              <>
                <div className={s.threadHead}>
                  <button type="button" className={s.back} onClick={() => open(null)}>
                    {c.back}
                  </button>
                  <div className={s.threadTitle}>
                    <strong>
                      {selected.merchant_id ? (
                        <Link href={`/farms/${selected.merchant_id}`} className={s.farmLink}>
                          {selected.farm_name ?? c.farm}
                        </Link>
                      ) : (
                        selected.farm_name ?? c.farm
                      )}
                    </strong>
                    <span>
                      {selected.order_ref} · {c.status[selected.order_status] ?? selected.order_status}
                    </span>
                  </div>
                  <Link href={`/orders/${selected.order_id}`} className={s.orderLink}>
                    {c.viewOrder} →
                  </Link>
                </div>
                <div className={s.threadBody}>
                  <OrderChat
                    key={selected.order_id}
                    orderId={selected.order_id}
                    title={c.threadTitle}
                    fill
                  />
                </div>
              </>
            ) : (
              <p className={s.pick}>{c.pick}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ChatRow({
  chat,
  locale,
  active,
  onOpen,
}: {
  chat: BuyerChatSummary;
  locale: string;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const c = t.chats;
  const unread = chat.unread > 0;
  const who = chat.last_mine ? c.you : chat.last_sender_role === "admin" ? c.support : "";
  return (
    <button
      type="button"
      className={`${s.row} ${active ? s.rowActive : ""} ${unread ? s.rowUnread : ""}`}
      onClick={onOpen}
      aria-current={active ? "true" : undefined}
    >
      <FarmAvatar name={chat.farm_name ?? c.farm} logoUrl={chat.farm_logo_url} />
      <span className={s.rowText}>
        <span className={s.rowTop}>
          <span className={s.rowName}>{chat.farm_name ?? c.farm}</span>
          <span className={s.rowTime}>{when(chat.last_at ?? chat.ordered_at, locale)}</span>
        </span>
        <span className={s.rowMeta}>
          {chat.order_ref} · {c.status[chat.order_status] ?? chat.order_status}
          {chat.closed && <span className={s.closedTag}>{c.closedTag}</span>}
        </span>
        <span className={s.rowBottom}>
          {chat.last_body == null ? (
            <span className={`${s.rowPreview} ${s.startHint}`}>{c.startChat}</span>
          ) : (
            <span className={s.rowPreview}>
              {who}
              {chat.last_body}
            </span>
          )}
          {unread && (
            <span className={s.badge} aria-label={fmt(c.newCount, { count: chat.unread })}>
              {chat.unread}
            </span>
          )}
        </span>
      </span>
    </button>
  );
}
