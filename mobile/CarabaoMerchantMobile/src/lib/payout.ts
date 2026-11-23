// S9 (plan §5.5, part 1): the payout destination rules behind the Earnings screen, copied from
// the web merchant CashOutPanel.tsx (M/components/CashOutPanel.tsx) and the two rules the web
// and the backend share. Pure, for `npm test`; payout.test.ts checks each string below against
// the file it came from.
//
// A payout method is saved only with the SMS code sent for exactly it (CF-0004): the code's key
// is a fingerprint of the five destination fields (backend app/services/payout_otp.py
// fingerprint), so editing any of them after "Send code" makes the old code useless and the
// screen asks for a new one. `codeIsFor` is that check.
//
// Rule 7: an account number never goes into a log line, and never on screen whole. The screen
// prints `maskAccountNumber` and `destinationName` only.
import type {
  AvailablePayout,
  MerchantPayoutBatch,
  MerchantTransaction,
  PayoutInfo,
  PayoutInfoPayload,
  PayoutProvider,
  PayoutStatus,
  PayoutType,
  TransactionStatus,
} from './api.ts';
import { formatDate, formatPeso } from './format.ts';

/** The web select's options, in page order (CashOutPanel renderForm). */
export const PAYOUT_TYPES: readonly PayoutType[] = ['gcash', 'maya', 'bank'];

/** CashOutPanel PAYOUT_METHOD_LABELS, word for word. */
export const PAYOUT_METHOD_LABELS: Record<PayoutType, string> = {
  gcash: 'GCash',
  maya: 'Maya',
  bank: 'Bank Transfer',
};

/** The web account-number input: pattern="[0-9]{6,20}" (the backend allows 6 to 20 digits). */
export const ACCOUNT_NUMBER_PATTERN = /^[0-9]{6,20}$/;
/** Its title: the browser's message when that pattern fails, shown here as the app's own line. */
export const ACCOUNT_NUMBER_HINT = 'Digits only, no spaces or dashes';
export const ACCOUNT_NUMBER_PLACEHOLDER = 'Digits only, e.g. 001234567890';
export const EWALLET_PLACEHOLDER = '09171234567';

/** The web code input: pattern="[0-9]{6}" maxLength={6} placeholder="6-digit code". */
export const PAYOUT_CODE_PATTERN = /^[0-9]{6}$/;
export const PAYOUT_CODE_PLACEHOLDER = '6-digit code';
/** The app's wording for a bad code (src/screens/AuthScreen.tsx has the same box at sign-up). */
export const PAYOUT_CODE_PROBLEM = 'Enter the 6-digit code from the text.';

/**
 * One minute between codes for one destination: backend app/services/otp.py
 * OTP_RESEND_COOLDOWN_SECONDS and the web lib/otp-cooldown.ts OTP_RESEND_SECONDS.
 */
export const PAYOUT_RESEND_SECONDS = 60;
/** The app's wait wording (AuthScreen); the server enforces the wait itself. */
export const PAYOUT_RESEND_WAIT = 'Please wait a minute before asking for another code.';

// The web CashOutPanel's messages, word for word (saveError, renderForm, renderMethod).
export const PAYOUT_SAVED = 'Payout method saved.';
export const PAYOUT_INCOMPLETE_BANK =
  "Pick your bank and enter the account number and account holder's name.";
export const PAYOUT_INCOMPLETE_EWALLET =
  "Enter the account holder's name and a mobile number like 09171234567.";
export const PAYOUT_UPSTREAM_ERROR = 'Could not reach PayMongo or send the code. Please try again.';
export const PAYOUT_SAVE_ERROR = 'Could not save payout details. Please try again.';
export const PAYOUT_BANK_LIST_ERROR = 'Could not load the bank list.';
export const PAYOUT_BANK_LOADING = 'Loading banks…';
export const PAYOUT_BANK_PLACEHOLDER = 'Select your bank';
export const PAYOUT_BANK_NOTE =
  "A wrong code or number makes the transfer fail and delays your payout until it's corrected.";
export const PAYOUT_EMPTY = 'Set up your payout method to request a cash out.';
export const PAYOUT_PROBLEM_PREFIX = 'Update your payout method before cashing out: ';
export const PAYOUT_SETUP_LABEL = 'Set Up Payout Method';
export const PAYOUT_EDIT_LABEL = 'Edit Method';
export const PAYOUT_SEND_CODE_LABEL = 'Send Code to Save';
export const PAYOUT_CONFIRM_LABEL = 'Confirm and Save';
export const PAYOUT_WAIT_LABEL = 'Please wait…';
export const PAYOUT_CODE_HINT =
  'For your security, a change of payout account must be confirmed by SMS.';
export const GCASH_PESONET_NOTE =
  'GCash payouts go through PESONet, so they arrive on banking-day cycles instead of within minutes.';

/** The form's text, one box per PayoutInfoUpdate field (CashOutPanel's PayoutDraft). */
export type PayoutDraft = {
  payout_type: PayoutType;
  bank_code: string;
  account_number: string;
  account_name: string;
  ewallet_number: string;
};

/** CashOutPanel draftFrom: the saved method as form text; a new farm starts on GCash. */
export function draftFrom(info: PayoutInfo | null): PayoutDraft {
  return {
    payout_type: info?.payout_type ?? 'gcash',
    bank_code: info?.bank_code ?? '',
    account_number: info?.account_number ?? '',
    account_name: info?.account_name ?? '',
    ewallet_number: info?.ewallet_number ?? '',
  };
}

/** CashOutPanel payload(): a blank box goes as null, so the server sees a missing field. */
export function draftPayload(draft: PayoutDraft): PayoutInfoPayload {
  return {
    payout_type: draft.payout_type,
    bank_code: draft.bank_code || null,
    account_number: draft.account_number || null,
    account_name: draft.account_name || null,
    ewallet_number: draft.ewallet_number || null,
  };
}

/**
 * The destination a code was sent for, as the web's `codeTarget`
 * (`JSON.stringify(payload())`): two drafts with the same key are the same destination, so a
 * code sent for one is never used to save an edited one.
 */
export function destinationKey(payload: PayoutInfoPayload): string {
  return JSON.stringify({
    payout_type: payload.payout_type,
    bank_code: payload.bank_code ?? null,
    account_number: payload.account_number ?? null,
    account_name: payload.account_name ?? null,
    ewallet_number: payload.ewallet_number ?? null,
  });
}

/** True while the draft still is the destination the code's key `sentKey` was sent for. */
export function codeIsFor(sentKey: string | null, draft: PayoutDraft): boolean {
  return sentKey !== null && destinationKey(draftPayload(draft)) === sentKey;
}

/**
 * Why the destination cannot be saved yet, in the web's words, or null.
 *
 * The web leaves "required" and pattern="[0-9]{6,20}" to the browser and everything else to the
 * server, whose 422 it turns into the same two sentences (payoutSaveMessage). This is that check
 * done first, so a code is not spent on a destination the server would refuse.
 */
export function destinationProblem(draft: PayoutDraft): string | null {
  if (!draft.account_name.trim()) {
    return draft.payout_type === 'bank' ? PAYOUT_INCOMPLETE_BANK : PAYOUT_INCOMPLETE_EWALLET;
  }
  if (draft.payout_type === 'bank') {
    if (!draft.bank_code.trim() || !draft.account_number.trim()) return PAYOUT_INCOMPLETE_BANK;
    // The web pattern and the backend rule (schemas/payout.py): digits only, no spaces to trim.
    return ACCOUNT_NUMBER_PATTERN.test(draft.account_number) ? null : ACCOUNT_NUMBER_HINT;
  }
  // The server normalizes and checks an e-wallet number ("like 09171234567"); the web only asks
  // for one, so a bad number comes back as its 422 sentence.
  return draft.ewallet_number.trim() ? null : PAYOUT_INCOMPLETE_EWALLET;
}


/** The words over the code box: the web's "Code sent to your number ending {sentTo}". */
export function codeSentLabel(sentTo: string): string {
  return `Code sent to your number ending ${sentTo}`;
}

/** The web's formatCountdown (frontend/carabao-app/lib/otp-cooldown.ts): "0:45", "12:00". */
export function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

/** "Send a new code", or the web's countdown while the server's wait runs. */
export function resendLabel(secondsLeft: number): string {
  return secondsLeft > 0 ? `Send a new code in ${formatCountdown(secondsLeft)}` : 'Send a new code';
}

// The clock lives here, not in the render body: React's purity lint refuses `Date.now()` in a
// component (chatInbox.sinceLabel takes its `now` the same way).
/** The moment a code texted now for `key` may be asked for again: a minute on. */
export function resendStart(key: string, now: number = Date.now()): { key: string; at: number } {
  return { key, at: now + PAYOUT_RESEND_SECONDS * 1000 };
}

/** The seconds left of that wait at `now`, clamped to the minute; 0 for another destination. */
export function resendSeconds(
  wait: { key: string; at: number } | null,
  key: string,
  now: number = Date.now(),
): number {
  if (wait === null || wait.key !== key) return 0;
  return Math.max(0, Math.min(PAYOUT_RESEND_SECONDS, Math.ceil((wait.at - now) / 1000)));
}

/** The save button's text: the web's three states (saving, code sent, no code yet). */
export function saveLabel(sending: boolean, codeSent: boolean): string {
  if (sending) return PAYOUT_WAIT_LABEL;
  return codeSent ? PAYOUT_CONFIRM_LABEL : PAYOUT_SEND_CODE_LABEL;
}

/** The bank's code under the picker, as the web shows it once a bank is chosen. */
export function bankCodeHint(code: string): string | null {
  return code ? `Bank code: ${code}` : null;
}

/** The GCash transfer note, only for a GCash destination (web: `payout_type === "gcash"`). */
export function gcashPesonetNote(payoutType: PayoutType): string | null {
  return payoutType === 'gcash' ? GCASH_PESONET_NOTE : null;
}

/**
 * What the screen says when a save or a send fails: the web's saveError, word for word.
 * `detail` is ApiError.message, which is the server's detail for 400 and 429.
 */
export function payoutSaveMessage(
  status: number,
  detail: string | null | undefined,
  payoutType: PayoutType,
): string {
  // 422: the backend rejects incomplete payout details instead of saving them.
  if (status === 422) {
    return payoutType === 'bank' ? PAYOUT_INCOMPLETE_BANK : PAYOUT_INCOMPLETE_EWALLET;
  }
  // 400 (wrong code, no verified number) and 429 carry a message for the merchant.
  if ((status === 400 || status === 429) && detail) return detail;
  if (status === 502) return PAYOUT_UPSTREAM_ERROR;
  // No status: the request never reached the server, and its own words say why.
  if (status === 0 && detail) return detail;
  return PAYOUT_SAVE_ERROR;
}

/** The mask the app prints instead of a stored number. */
export const ACCOUNT_MASK = '••••';

/**
 * "•••• 7890": the last four digits only - the part the backend's payout_otp.describe puts in
 * the SMS ("GCash ending 4567") and the web shows after a payout. Four digits or fewer is masked
 * whole. Rule 7: callers print this, never the whole number.
 */
export function maskAccountNumber(value: string | null | undefined): string {
  const text = (value ?? '').trim();
  if (!text) return '';
  return text.length <= 4 ? ACCOUNT_MASK : `${ACCOUNT_MASK} ${text.slice(-4)}`;
}

/**
 * The backend's payout_otp.describe, word for word: "GCash ending 4567", "BPI account ending
 * 7890" (the bank's name, else its code, else "bank"), so the SMS and this card agree.
 */
export function destinationName(
  info: Pick<
    PayoutInfo,
    'payout_type' | 'bank_name' | 'bank_code' | 'account_number' | 'ewallet_number'
  >,
): string {
  if (info.payout_type === 'bank') {
    const bank = info.bank_name || info.bank_code || 'bank';
    return `${bank} account ending ${(info.account_number ?? '').slice(-4)}`;
  }
  return `${PAYOUT_METHOD_LABELS[info.payout_type]} ending ${(info.ewallet_number ?? '').slice(-4)}`;
}

// ── S10 (plan §5.5, part 2): the balance, cash out, history and sales ─────────
//
// The words come from the web EarningsTab/CashOutPanel, the dashboard's revenue card and
// util/api/statuses.ts; the rules from backend app/api/routes/merchant_payouts.py and
// merchant_sales.py. Pure, so `npm test` can read every string without the app around it.

/** util/api/statuses.ts PAYOUT_STATUS_LABELS, word for word. */
export const PAYOUT_STATUS_LABELS: Record<PayoutStatus, string> = {
  pending: 'Requested',
  approved: 'Approved',
  processing: 'Processing',
  released: 'Released',
  failed: 'Failed',
};

/** util/api/statuses.ts TRANSACTION_STATUS_LABELS, word for word. */
export const TRANSACTION_STATUS_LABELS: Record<TransactionStatus, string> = {
  pending: 'Checkout open',
  paid: 'Paid',
  failed: 'Failed',
  expired: 'Expired',
  refund_pending: 'Refund pending',
  refunded: 'Refunded',
};

/**
 * Payouts a merchant has already asked for (backend app/models/statuses.py OPEN_PAYOUT_STATUSES,
 * the web analytics useMemo): while one of these is open, no new cash out may be requested.
 */
export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ['pending', 'approved', 'processing'];

/** util/api/merchants.ts PAYOUT_PROVIDER_LABELS, word for word. */
export const PAYOUT_PROVIDER_LABELS: Record<PayoutProvider, string> = {
  instapay: 'InstaPay',
  pesonet: 'PESONet',
};

/** util/api/merchants.ts PAYOUT_PROVIDER_TIMING, word for word. */
export const PAYOUT_PROVIDER_TIMING: Record<PayoutProvider, string> = {
  instapay: 'usually arrives within 20 minutes',
  pesonet: 'arrives on the next PESONet cycle (1 PM, 4 PM or 7 PM on banking days)',
};

// A Badge tone (src/components/UI.tsx). The web colours them in page.module.css: green for money
// that arrived, amber for money still moving, blue for a payout in flight, red for a failure.
export type StatusTone = 'green' | 'blue' | 'yellow' | 'red' | 'gray';

/** The badge tone for one payout status (page.module.css .txBadge_*). */
export function payoutTone(status: PayoutStatus): StatusTone {
  if (status === 'released') return 'green';
  if (status === 'approved' || status === 'processing') return 'blue';
  if (status === 'failed') return 'red';
  return 'yellow';
}

/** The badge tone for one transaction status (page.module.css .txBadge_*). */
export function transactionTone(status: TransactionStatus): StatusTone {
  if (status === 'paid') return 'green';
  if (status === 'refunded') return 'gray';
  if (status === 'failed' || status === 'expired') return 'red';
  return 'yellow';
}

/** One payout, as far as the totals care. */
export type PayoutRow = Pick<MerchantPayoutBatch, 'status' | 'net_amount' | 'gross_amount'>;

export type EarningsSummary<T extends PayoutRow> = {
  paidCount: number;
  totalEarned: number;
  totalPaidOut: number;
  /** The payout already asked for and not sent yet; it blocks a new cash out. */
  openBatch: T | null;
  /** The newest failed payout (the list is newest first). */
  failedBatch: T | null;
};

/**
 * EarningsTab analytics, as numbers: paid transactions add up to what the farm earned, released
 * payouts to what actually reached it (fees already taken out).
 */
export function earningsSummary<T extends PayoutRow>(
  transactions: readonly Pick<MerchantTransaction, 'status' | 'merchant_amount'>[],
  payouts: readonly T[],
): EarningsSummary<T> {
  const paid = transactions.filter((t) => t.status === 'paid');
  return {
    paidCount: paid.length,
    totalEarned: paid.reduce((sum, t) => sum + t.merchant_amount, 0),
    totalPaidOut: payouts
      .filter((p) => p.status === 'released')
      .reduce((sum, p) => sum + (p.net_amount ?? p.gross_amount), 0),
    openBatch: payouts.find((p) => OPEN_PAYOUT_STATUSES.includes(p.status)) ?? null,
    failedBatch: payouts.find((p) => p.status === 'failed') ?? null,
  };
}

/** Why the Cash Out button cannot be pressed, or null when it can. */
export type CashOutBlock =
  | 'open' // a payout is already pending, approved or processing
  | 'no_method' // no payout destination saved yet
  | 'method_problem' // the saved destination is incomplete (PayoutInfo.problem)
  | 'no_balance' // nothing earned and buyer-confirmed yet
  | 'under_fee'; // earned, but not enough to cover the transfer fee

export type CashOutState = {
  /** What the farm earned: what a cash out asks for before the fee. */
  gross: number;
  fee: number;
  /** What would reach the farm (the backend's net_amount, never below zero). */
  net: number;
  /** A payout is already open: the button is not shown at all, as on the web. */
  open: boolean;
  /** True only when pressing it would ask the server for a payout. */
  enabled: boolean;
  block: CashOutBlock | null;
};

/**
 * The web's `canCashOut = !openBatch && !info.problem && gross > fee` (CashOutPanel renderMethod),
 * with the reason kept, so the screen can say what is missing instead of only greying out.
 */
export function cashOutState(
  available: Pick<AvailablePayout, 'gross_amount' | 'transfer_fee' | 'net_amount'> | null,
  info: Pick<PayoutInfo, 'problem'> | null,
  openBatch: Pick<MerchantPayoutBatch, 'status'> | null,
  requesting = false,
): CashOutState {
  const gross = available?.gross_amount ?? 0;
  const fee = available?.transfer_fee ?? 0;
  const open = openBatch !== null;
  const block: CashOutBlock | null = open
    ? 'open'
    : !info
      ? 'no_method'
      : info.problem
        ? 'method_problem'
        : gross <= 0
          ? 'no_balance'
          : gross <= fee
            ? 'under_fee'
            : null;
  return {
    gross,
    fee,
    net: available?.net_amount ?? 0,
    open,
    enabled: block === null && !requesting,
    block,
  };
}

/** The fee line above the button: "{gross} earned − {fee} transfer fee = {net} to you". */
export function payoutFeeLine(gross: number, fee: number, net: number): string {
  return `${formatPeso(gross)} earned − ${formatPeso(fee)} transfer fee = ${formatPeso(net)} to you`;
}

/** Under the button when the balance does not cover the fee (CashOutPanel renderMethod). */
export function payoutUnderFeeLine(fee: number): string {
  return `Earn more than ${formatPeso(fee)} to cover the transfer fee before cashing out.`;
}

/** The cash out button: the web's two states. */
export function cashOutLabel(net: number, requesting: boolean): string {
  return requesting ? 'Submitting…' : `Cash Out ${formatPeso(net)}`;
}

/** The confirmation the app asks for before spending the balance (the web has no dialog). */
export function cashOutConfirm(net: number, destination: string): string {
  return `Send ${formatPeso(net)} to ${destination}? The transfer fee is already taken out.`;
}

/** CashOutPanel handleRequestPayout's success message, word for word. */
export function cashOutRequested(net: number): string {
  return `Cash out requested. You'll receive ${formatPeso(net)} once the admin sends it.`;
}

/** CashOutPanel's fallback when the request fails without a server message. */
export const PAYOUT_REQUEST_ERROR = 'Could not submit cash out request.';
/** 403 on POST /merchants/me/payouts/request: only a verified farm may be paid out. */
export const PAYOUT_NOT_VERIFIED = 'Your farm must be verified before you can cash out.';

/**
 * What to say when POST /merchants/me/payouts/request refuses: the server's own detail for a 400
 * (nothing to cash out, a payout already open, no payout method), the verification rule for a 403,
 * and the web's fallback for anything else (a dropped connection keeps its own message).
 */
export function payoutRequestMessage(
  status: number,
  detail: string | null | undefined,
): string {
  if (status === 403) return PAYOUT_NOT_VERIFIED;
  if ((status === 400 || status === 422 || status === 0) && detail) return detail;
  return PAYOUT_REQUEST_ERROR;
}



/**
 * "GCash •••• 4567", or the web's "your payout account" when no snapshot was kept. The web
 * prints the whole number here (CashOutPanel buildMessage); the app masks it (rule 7).
 */
export function payoutDestination(
  batch: Pick<MerchantPayoutBatch, 'destination_type' | 'destination_number'>,
): string {
  if (!batch.destination_type) return 'your payout account';
  const masked = maskAccountNumber(batch.destination_number);
  return `${PAYOUT_METHOD_LABELS[batch.destination_type]} ${masked}`.trim();
}

/** The history row's "Sent To": the web prints an em dash when no destination was kept. */
export function payoutSentTo(
  batch: Pick<MerchantPayoutBatch, 'destination_type' | 'destination_number'>,
): string {
  return batch.destination_type ? payoutDestination(batch) : '—';
}

/** The payout in flight: CashOutPanel renderOpenBatch, word for word. */
export function openBatchMessage(batch: MerchantPayoutBatch): string {
  const net = batch.net_amount ?? batch.gross_amount;
  if (batch.status === 'processing') {
    const provider = batch.transfer_provider;
    const via = provider
      ? ` via ${PAYOUT_PROVIDER_LABELS[provider]}. It ${PAYOUT_PROVIDER_TIMING[provider]}`
      : '';
    return `Sending ${formatPeso(net)} to ${payoutDestination(batch)}${via}.`;
  }
  const fee = formatPeso(batch.transfer_fee ?? 0);
  return (
    `You requested ${formatPeso(net)} on ${formatDate(batch.created_at)} ` +
    `(${formatPeso(batch.gross_amount)} earned minus the ${fee} transfer fee). ` +
    'The admin will send it shortly.'
  );
}

/** The newest failed payout: CashOutPanel's notice, word for word. */
export function failedBatchMessage(batch: MerchantPayoutBatch): string {
  const net = formatPeso(batch.net_amount ?? batch.gross_amount);
  const reason = batch.failure_reason ? ` (${batch.failure_reason})` : '';
  return (
    `Your ${net} payout could not be sent${reason}. Check your payout method below. ` +
    'If you change it, the admin sends it to the new one.'
  );
}

// ── Sales and the CSV export ──────────────────────────────────────────────────

/** GET /merchants/me/sales?days=: backend merchant_sales.ALLOWED_DAYS = (30, 90). */
export const SALES_DAYS = [30, 90] as const;
export type SalesDays = (typeof SALES_DAYS)[number];

/**
 * GET /merchants/me/sales/export?days=: backend merchant_sales.EXPORT_DAYS = (7, 30, 90) and the
 * web downloadMySalesCsv's `days: 7 | 30 | 90`. Any other value is a 422 on the server.
 */
export const EXPORT_DAYS = [7, 30, 90] as const;
export type ExportDays = (typeof EXPORT_DAYS)[number];

/** "30 days": the range tabs, as the web's dashboard prints them. */
export function rangeLabel(days: SalesDays | ExportDays): string {
  return `${days} days`;
}

/**
 * The file the export is written to. The server names its download "sales-{days}d-{stamp}.csv"
 * (Content-Disposition, which a text-only response does not carry here); the web falls back to
 * "sales-{days}d.csv" and so does this screen.
 */
export function salesCsvName(days: ExportDays): string {
  return `sales-${days}d.csv`;
}

/** The web dashboard's export button: "Export CSV", or "Preparing…" while it writes. */
export const EXPORT_LABEL = 'Export CSV';
export const EXPORT_PREPARING = 'Preparing…';
/** page.tsx exportCsv's fallback message. */
export const EXPORT_ERROR = 'The sales file could not be downloaded.';
/** The app's own line when the phone has no share sheet (expo-sharing isAvailableAsync). */
export const EXPORT_NO_SHARING = 'This phone cannot open a share sheet to save the file.';
/** The web dashboard's empty state for a range with no sales. */
export function salesEmpty(days: SalesDays): string {
  return `No sales in the last ${days} days.`;
}
/** The web's message when the sales call fails ("Refresh the page" reads as pull-to-refresh here). */
export const SALES_ERROR = 'We could not load your sales. Pull down to try again.';
/** When GET /merchants/me/payouts/available fails: the balance is unknown, not zero. */
export const AVAILABLE_ERROR = 'We could not load your balance. Pull down to try again.';

// ── The small lines under those numbers ──────────────────────────────────────

/** Under the balance: EarningsTab's "N buyer-confirmed orders not yet cashed out". */
export function availableSub(count: number): string {
  return count === 1
    ? '1 buyer-confirmed order not yet cashed out.'
    : `${count} buyer-confirmed orders not yet cashed out.`;
}

/** Under Total Earned: how many payments make it up. */
export function paidOrdersSub(count: number): string {
  return count === 1 ? 'From 1 paid transaction.' : `From ${count} paid transactions.`;
}

/** A history row's first line: when it was requested and how many orders it covers. */
export function batchSub(
  batch: Pick<MerchantPayoutBatch, 'created_at' | 'transaction_count'>,
): string {
  const orders =
    batch.transaction_count === 1 ? '1 order' : `${batch.transaction_count} orders`;
  return `${formatDate(batch.created_at)} · ${orders}`;
}

/** Under the sales revenue: "N orders in the last D days." */
export function salesOrdersSub(orders: number, days: number): string {
  return orders === 1
    ? `1 order in the last ${days} days.`
    : `${orders} orders in the last ${days} days.`;
}

