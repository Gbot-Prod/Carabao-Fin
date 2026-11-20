"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import OrderChat from "@/components/OrderChat/OrderChat";
import SkeletonList, { LoadError } from "@/components/Skeleton/Skeleton";
import { useAuthPrompt } from "@/components/AuthPrompt/AuthPromptContext";
import { useBuyerChats } from "@/components/Chats/BuyerChatsProvider";
import { useAuth } from "@/hooks/useAuth";
import { useLanguage } from "@/lib/i18n/LanguageProvider";
import { fmt } from "@/lib/i18n/format";
import { fetchMerchantById } from "@/util/api";
import { farmInquiryEndpoint, type BuyerChatSummary, type InquirySummary } from "@/util/api/users";
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

/** One row in the list: a chat about an order, or a question to a farm (no order). */
type ChatItem =
  | { kind: "order"; key: string; chat: BuyerChatSummary }
  | { kind: "farm"; key: string; chat: InquirySummary };

const orderKey = (orderId: number) => `order-${orderId}`;
const farmKey = (merchantId: number) => `farm-${merchantId}`;
const lastAt = (item: ChatItem) => item.chat.last_at;

// useSearchParams needs a Suspense boundary for the build. It lives here, not
// around every page in (app)/layout.tsx: that one sent the 200 status before a
// server page could call notFound(), so missing farms never got a real 404.
export default function BuyerChatsPage() {
  return (
    <Suspense fallback={<div />}>
      <BuyerChats />
    </Suspense>
  );
}

/** The buyer's chats with farms: the list on the left, the open chat on the right. */
function BuyerChats() {
  const { t, lang } = useLanguage();
  const c = t.chats;
  const locale = lang === "fil" ? "fil-PH" : "en-PH";
  const { isAuthenticated, isLoading: authLoading } = useAuth();
  const { showPrompt } = useAuthPrompt();
  const { chats, inquiries, loaded, error, reload, markRead, markInquiryRead, unreadCount } = useBuyerChats();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const selectedOrder = Number(params.get("order")) || null;
  const selectedFarm = Number(params.get("farm")) || null;
  const selectedKey = selectedOrder ? orderKey(selectedOrder) : selectedFarm ? farmKey(selectedFarm) : null;

  // Chats with messages first, newest first; then paid orders with no messages yet.
  const items = useMemo<ChatItem[]>(() => {
    const all: ChatItem[] = [
      ...chats.map((chat) => ({ kind: "order" as const, key: orderKey(chat.order_id), chat })),
      ...inquiries.map((chat) => ({ kind: "farm" as const, key: farmKey(chat.merchant_id), chat })),
    ];
    const withMessages = all.filter((i) => i.chat.last_body != null);
    const without = all.filter((i) => i.chat.last_body == null);
    withMessages.sort((a, b) => Date.parse(lastAt(b) ?? "") - Date.parse(lastAt(a) ?? ""));
    return [...withMessages, ...without];
  }, [chats, inquiries]);

  const selected = items.find((item) => item.key === selectedKey) ?? null;

  // Opened from a farm page with no question asked yet: a new, empty thread.
  const [draftFarm, setDraftFarm] = useState<{ id: number; name: string } | null>(null);
  const needsDraft = isAuthenticated && loaded && selectedFarm != null && selected == null;
  useEffect(() => {
    if (!needsDraft || selectedFarm == null) return;
    if (draftFarm?.id === selectedFarm) return;
    let cancelled = false;
    fetchMerchantById(selectedFarm)
      .then((m) => {
        if (!cancelled) setDraftFarm({ id: m.id, name: m.merchant_name });
      })
      .catch(() => {
        if (!cancelled) setDraftFarm({ id: selectedFarm, name: c.farm });
      });
    return () => {
      cancelled = true;
    };
  }, [needsDraft, selectedFarm, draftFarm?.id, c.farm]);
  const draft = needsDraft && draftFarm?.id === selectedFarm ? draftFarm : null;

  // The open chat reads its messages, and the server marks them read.
  useEffect(() => {
    if (!selected || selected.chat.unread === 0) return;
    if (selected.kind === "order") markRead(selected.chat.order_id);
    else markInquiryRead(selected.chat.merchant_id);
  }, [selected, markRead, markInquiryRead]);

  const open = (item: ChatItem | null) => {
    const query =
      item == null
        ? ""
        : item.kind === "order"
          ? `?order=${item.chat.order_id}`
          : `?farm=${item.chat.merchant_id}`;
    router.replace(`${pathname}${query}`, { scroll: false });
  };

  const hasThread = selected != null || draft != null;

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
      ) : !loaded || (needsDraft && !draft) ? (
        <SkeletonList label={c.loading} rows={4} />
      ) : items.length === 0 && !draft ? (
        <div className={s.empty}>
          <p className={s.emptyTitle}>{c.emptyTitle}</p>
          <p className={s.emptyText}>{c.emptyText}</p>
          <Link href="/order" className={s.action}>{c.browse}</Link>
        </div>
      ) : (
        <div className={`${s.layout} ${hasThread ? s.hasSelection : ""}`}>
          <ul className={s.list} aria-label={c.list}>
            {items.map((item) => (
              <li key={item.key}>
                <ChatRow
                  item={item}
                  locale={locale}
                  active={item.key === selectedKey}
                  onOpen={() => open(item)}
                />
              </li>
            ))}
          </ul>

          <div className={s.thread}>
            {selected?.kind === "order" ? (
              <OrderThread chat={selected.chat} onBack={() => open(null)} />
            ) : selected?.kind === "farm" ? (
              <FarmThread
                merchantId={selected.chat.merchant_id}
                farmName={selected.chat.farm_name ?? c.farm}
                onBack={() => open(null)}
                onSent={() => void reload()}
              />
            ) : draft ? (
              <FarmThread
                merchantId={draft.id}
                farmName={draft.name}
                onBack={() => open(null)}
                onSent={() => void reload()}
              />
            ) : (
              <p className={s.pick}>{c.pick}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OrderThread({ chat, onBack }: { chat: BuyerChatSummary; onBack: () => void }) {
  const { t } = useLanguage();
  const c = t.chats;
  return (
    <>
      <div className={s.threadHead}>
        <button type="button" className={s.back} onClick={onBack}>
          {c.back}
        </button>
        <div className={s.threadTitle}>
          <strong>
            {chat.merchant_id ? (
              <Link href={`/farms/${chat.merchant_id}`} className={s.farmLink}>
                {chat.farm_name ?? c.farm}
              </Link>
            ) : (
              chat.farm_name ?? c.farm
            )}
          </strong>
          <span>
            {chat.order_ref} · {c.status[chat.order_status] ?? chat.order_status}
          </span>
        </div>
        <Link href={`/orders/${chat.order_id}`} className={s.orderLink}>
          {c.viewOrder} →
        </Link>
      </div>
      <div className={s.threadBody}>
        <OrderChat key={chat.order_id} orderId={chat.order_id} title={c.threadTitle} fill />
      </div>
    </>
  );
}

function FarmThread({
  merchantId,
  farmName,
  onBack,
  onSent,
}: {
  merchantId: number;
  farmName: string;
  onBack: () => void;
  onSent: () => void;
}) {
  const { t } = useLanguage();
  const c = t.chats;
  return (
    <>
      <div className={s.threadHead}>
        <button type="button" className={s.back} onClick={onBack}>
          {c.back}
        </button>
        <div className={s.threadTitle}>
          <strong>
            <Link href={`/farms/${merchantId}`} className={s.farmLink}>
              {farmName}
            </Link>
          </strong>
          <span>{c.inquiryTag}</span>
        </div>
        <Link href={`/farms/${merchantId}`} className={s.orderLink}>
          {c.visitFarm} →
        </Link>
      </div>
      <div className={s.threadBody}>
        <OrderChat
          key={merchantId}
          endpoint={farmInquiryEndpoint(merchantId)}
          title={c.threadTitle}
          emptyText={fmt(c.inquiryEmpty, { farm: farmName })}
          closedText={c.inquiryClosed}
          onSent={onSent}
          fill
        />
      </div>
    </>
  );
}

function ChatRow({
  item,
  locale,
  active,
  onOpen,
}: {
  item: ChatItem;
  locale: string;
  active: boolean;
  onOpen: () => void;
}) {
  const { t } = useLanguage();
  const c = t.chats;
  const chat = item.chat;
  const unread = chat.unread > 0;
  const who = chat.last_mine ? c.you : chat.last_sender_role === "admin" ? c.support : "";
  const time = item.kind === "order" ? chat.last_at ?? item.chat.ordered_at : chat.last_at;
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
          <span className={s.rowTime}>{when(time, locale)}</span>
        </span>
        <span className={s.rowMeta}>
          {item.kind === "order"
            ? `${item.chat.order_ref} · ${c.status[item.chat.order_status] ?? item.chat.order_status}`
            : c.inquiryTag}
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
