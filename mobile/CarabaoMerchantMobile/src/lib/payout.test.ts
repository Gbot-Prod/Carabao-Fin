/// <reference types="node" />
// Run with `npm test`. S9 (plan §5.5, part 1): the payout destination's rules, checked against
// the web merchant CashOutPanel.tsx, the shared OTP cooldown and the backend's payout schema and
// payout_otp service.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  ACCOUNT_MASK,
  ACCOUNT_NUMBER_HINT,
  ACCOUNT_NUMBER_PATTERN,
  ACCOUNT_NUMBER_PLACEHOLDER,
  EWALLET_PLACEHOLDER,
  GCASH_PESONET_NOTE,
  PAYOUT_BANK_LIST_ERROR,
  PAYOUT_BANK_LOADING,
  PAYOUT_BANK_PLACEHOLDER,
  PAYOUT_CODE_HINT,
  PAYOUT_CODE_PATTERN,
  PAYOUT_CODE_PLACEHOLDER,
  PAYOUT_CODE_PROBLEM,
  PAYOUT_CONFIRM_LABEL,
  PAYOUT_EDIT_LABEL,
  PAYOUT_EMPTY,
  PAYOUT_INCOMPLETE_BANK,
  PAYOUT_INCOMPLETE_EWALLET,
  PAYOUT_METHOD_LABELS,
  PAYOUT_PROBLEM_PREFIX,
  PAYOUT_RESEND_SECONDS,
  PAYOUT_SAVED,
  PAYOUT_SAVE_ERROR,
  PAYOUT_SEND_CODE_LABEL,
  PAYOUT_SETUP_LABEL,
  PAYOUT_TYPES,
  PAYOUT_UPSTREAM_ERROR,
  PAYOUT_WAIT_LABEL,
  bankCodeHint,
  codeIsFor,
  codeSentLabel,
  destinationKey,
  destinationName,
  destinationProblem,
  draftFrom,
  draftPayload,
  formatCountdown,
  gcashPesonetNote,
  maskAccountNumber,
  payoutSaveMessage,
  resendLabel,
  resendSeconds,
  resendStart,
  saveLabel,
  // S10 (plan §5.5, part 2): the money side of Earnings.
  AVAILABLE_ERROR,
  EXPORT_DAYS,
  EXPORT_ERROR,
  EXPORT_LABEL,
  EXPORT_NO_SHARING,
  EXPORT_PREPARING,
  OPEN_PAYOUT_STATUSES,
  PAYOUT_NOT_VERIFIED,
  PAYOUT_PROVIDER_LABELS,
  PAYOUT_REQUEST_ERROR,
  PAYOUT_STATUS_LABELS,
  SALES_DAYS,
  SALES_ERROR,
  TRANSACTION_STATUS_LABELS,
  availableSub,
  batchSub,
  cashOutConfirm,
  cashOutLabel,
  cashOutRequested,
  cashOutState,
  earningsSummary,
  failedBatchMessage,
  openBatchMessage,
  paidOrdersSub,
  payoutDestination,
  payoutFeeLine,
  payoutRequestMessage,
  payoutSentTo,
  payoutTone,
  payoutUnderFeeLine,
  rangeLabel,
  salesCsvName,
  salesEmpty,
  salesOrdersSub,
  transactionTone,
  type PayoutDraft,
} from './payout.ts';
import type { MerchantPayoutBatch, PayoutStatus } from './api.ts';

const repo = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
// Line ends differ between checkouts (CRLF on Windows): compare text with LF only.
const read = (path: string) => readFileSync(join(repo, path), 'utf8').split('\r\n').join('\n');

const PANEL = 'frontend/carabao-app/app/(site)/(merchant)/merchant/components/CashOutPanel.tsx';
const COOLDOWN = 'frontend/carabao-app/lib/otp-cooldown.ts';
const SCREEN = 'mobile/CarabaoMerchantMobile/src/screens/EarningsScreen.tsx';
const MODULE = 'mobile/CarabaoMerchantMobile/src/lib/payout.ts';

const panel = read(PANEL);


test('payout types and labels are the web select, in its order', () => {
  assert.deepEqual([...PAYOUT_TYPES], ['gcash', 'maya', 'bank']);
  assert.match(
    panel,
    /export const PAYOUT_METHOD_LABELS: Record<PayoutType, string> = \{\n {2}gcash: "GCash",\n {2}maya: "Maya",\n {2}bank: "Bank Transfer",\n\};/,
  );
  const select =
    /<select className=\{styles\.formInput\} \{\.\.\.field\("payout_type"\)\}>([\s\S]*?)<\/select>/.exec(
      panel,
    )?.[1] ?? '';
  const options = [...select.matchAll(/<option value="(\w+)">([^<]+)<\/option>/g)].map((m) => ({
    type: m[1],
    label: m[2],
  }));
  assert.deepEqual(options, [
    { type: 'gcash', label: 'GCash' },
    { type: 'maya', label: 'Maya' },
    { type: 'bank', label: 'Bank Transfer' },
  ]);
  for (const type of PAYOUT_TYPES) {
    assert.equal(PAYOUT_METHOD_LABELS[type], options.find((o) => o.type === type)?.label, type);
  }
});

test('destination validation: the web input rules and its two 422 sentences', () => {
  const bank: PayoutDraft = {
    payout_type: 'bank',
    bank_code: 'BNORPHMMXXX',
    account_number: '001234567890',
    account_name: 'Juan Cruz',
    ewallet_number: '',
  };
  assert.equal(destinationProblem(bank), null);

  assert.equal(destinationProblem({ ...bank, bank_code: '' }), PAYOUT_INCOMPLETE_BANK);
  assert.equal(destinationProblem({ ...bank, account_number: '' }), PAYOUT_INCOMPLETE_BANK);
  assert.equal(destinationProblem({ ...bank, account_name: ' ' }), PAYOUT_INCOMPLETE_BANK);
  assert.equal(destinationProblem({ ...bank, account_number: '12345' }), ACCOUNT_NUMBER_HINT);
  assert.equal(destinationProblem({ ...bank, account_number: '0012-34567' }), ACCOUNT_NUMBER_HINT);
  assert.equal(
    destinationProblem({ ...bank, account_number: '001234567890 ' }),
    ACCOUNT_NUMBER_HINT,
    'the web pattern has no spaces, and neither has the phone',
  );

  const wallet: PayoutDraft = {
    payout_type: 'gcash',
    bank_code: '',
    account_number: '',
    account_name: 'Juan Cruz',
    ewallet_number: '09171234567',
  };
  assert.equal(destinationProblem(wallet), null);
  assert.equal(destinationProblem({ ...wallet, ewallet_number: ' ' }), PAYOUT_INCOMPLETE_EWALLET);
  assert.equal(destinationProblem({ ...wallet, account_name: '' }), PAYOUT_INCOMPLETE_EWALLET);

  // The same rules and words as the web's inputs and its saveError.
  assert.ok(panel.includes('pattern="[0-9]{6,20}"'), 'account number pattern');
  assert.ok(panel.includes(`title="${ACCOUNT_NUMBER_HINT}"`), 'account number title');
  assert.ok(
    panel.includes(`placeholder="${ACCOUNT_NUMBER_PLACEHOLDER}"`),
    'account number placeholder',
  );
  assert.ok(panel.includes(`placeholder="${EWALLET_PLACEHOLDER}"`), 'e-wallet placeholder');
  assert.ok(panel.includes(PAYOUT_INCOMPLETE_BANK), 'the bank 422 sentence');
  assert.ok(panel.includes(PAYOUT_INCOMPLETE_EWALLET), 'the e-wallet 422 sentence');

  // The regex is the web's pattern: the same verdict on the same values. A browser anchors
  // pattern="..." at both ends, so the same pattern object is anchored here too.
  const webPattern = new RegExp(`^(?:${/pattern="(\[0-9\]\{6,20\})"/.exec(panel)?.[1] ?? 'x'})$`);
  for (const value of ['001234567890', '123456', '12345', '0012-34567', '123456789012345678901', '']) {
    assert.equal(ACCOUNT_NUMBER_PATTERN.test(value), webPattern.test(value), value);
  }
  assert.match(
    read('backend/app/schemas/payout.py'),
    /re\.fullmatch\(r"\\d\{6,20\}", self\.account_number\)/,
  );
});

test('a code sent for one destination does not save an edited one', () => {
  const bank: PayoutDraft = {
    payout_type: 'bank',
    bank_code: 'BNORPHMMXXX',
    account_number: '001234567890',
    account_name: 'Juan Cruz',
    ewallet_number: '',
  };
  const sent = destinationKey(draftPayload(bank));
  assert.equal(codeIsFor(sent, bank), true, 'nothing edited');
  assert.equal(codeIsFor(sent, { ...bank }), true, 'a copy is the same destination');
  assert.equal(codeIsFor(null, bank), false, 'no code sent yet');

  const edits: PayoutDraft[] = [
    { ...bank, payout_type: 'gcash' },
    { ...bank, bank_code: 'BOPIPHMMXXX' },
    { ...bank, account_number: '001234567891' },
    { ...bank, account_name: 'Juan Cruz Jr' },
    { ...bank, ewallet_number: '09171234567' },
  ];
  for (const edited of edits) {
    assert.equal(codeIsFor(sent, edited), false, `an edit asks for a new code: ${JSON.stringify(edited)}`);
  }

  // The web's key is JSON.stringify(payload()), with a blank box as null.
  assert.equal(
    destinationKey(draftPayload(draftFrom(null))),
    '{"payout_type":"gcash","bank_code":null,"account_number":null,"account_name":null,"ewallet_number":null}',
  );
  assert.match(panel, /const codeTarget = JSON\.stringify\(payload\(\)\);/);
});

test('the saved method fills the form, and a blank box posts as null', () => {
  const info = {
    id: 1,
    merchant_id: 2,
    payout_type: 'bank' as const,
    bank_code: 'BNORPHMMXXX',
    bank_name: 'BDO Unibank',
    account_number: '001234567890',
    account_name: 'Juan Cruz',
    ewallet_number: null,
    created_at: '2026-11-01T00:00:00Z',
    updated_at: '2026-11-01T00:00:00Z',
    problem: null,
  };
  assert.deepEqual(draftFrom(info), {
    payout_type: 'bank',
    bank_code: 'BNORPHMMXXX',
    account_number: '001234567890',
    account_name: 'Juan Cruz',
    ewallet_number: '',
  });
  assert.deepEqual(draftFrom(null), {
    payout_type: 'gcash',
    bank_code: '',
    account_number: '',
    account_name: '',
    ewallet_number: '',
  });
  assert.deepEqual(draftPayload(draftFrom(info)), {
    payout_type: 'bank',
    bank_code: 'BNORPHMMXXX',
    account_number: '001234567890',
    account_name: 'Juan Cruz',
    ewallet_number: null,
  });
});

test('only the last four digits are shown, as the SMS and the web name a destination', () => {
  assert.equal(maskAccountNumber('001234567890'), `${ACCOUNT_MASK} 7890`);
  assert.equal(maskAccountNumber('09171234567'), `${ACCOUNT_MASK} 4567`);
  assert.equal(maskAccountNumber(' 001234567890 '), `${ACCOUNT_MASK} 7890`);
  assert.equal(maskAccountNumber('1234'), ACCOUNT_MASK, 'four digits or fewer is masked whole');
  assert.equal(maskAccountNumber(''), '');
  assert.equal(maskAccountNumber(null), '');
  assert.equal(maskAccountNumber(undefined), '');
  // Rule 7: the mask never carries the whole number the app was given.
  for (const number of ['001234567890', '09171234567', '123456']) {
    assert.ok(!maskAccountNumber(number).includes(number), number);
  }

  // The backend's payout_otp.describe, word for word.
  const otp = read('backend/app/services/payout_otp.py');
  assert.match(otp, /return f"\{bank\} account ending \{\(values\.get\('account_number'\) or ''\)\[-4:\]\}"/);
  assert.match(otp, /return f"\{label\} ending \{\(values\.get\('ewallet_number'\) or ''\)\[-4:\]\}"/);
  assert.match(otp, /label = \{"gcash": "GCash", "maya": "Maya"\}\.get\(kind, kind or "account"\)/);

  const card = {
    payout_type: 'bank' as const,
    bank_name: 'BPI',
    bank_code: 'BOPIPHMMXXX',
    account_number: '001234567890',
    ewallet_number: null,
  };
  assert.equal(destinationName(card), 'BPI account ending 7890');
  assert.equal(destinationName({ ...card, bank_name: null }), 'BOPIPHMMXXX account ending 7890');
  assert.equal(destinationName({ ...card, bank_name: null, bank_code: null }), 'bank account ending 7890');
  const wallet = {
    payout_type: 'gcash' as const,
    bank_name: null,
    bank_code: null,
    account_number: null,
    ewallet_number: '09171234567',
  };
  assert.equal(destinationName(wallet), 'GCash ending 4567');
  assert.equal(destinationName({ ...wallet, payout_type: 'maya' }), 'Maya ending 4567');
});

test('what the screen says when a save fails is the web saveError', () => {
  assert.equal(payoutSaveMessage(422, 'detail', 'bank'), PAYOUT_INCOMPLETE_BANK);
  assert.equal(payoutSaveMessage(422, 'detail', 'gcash'), PAYOUT_INCOMPLETE_EWALLET);
  assert.equal(payoutSaveMessage(422, 'detail', 'maya'), PAYOUT_INCOMPLETE_EWALLET);
  assert.equal(
    payoutSaveMessage(400, 'The code is wrong or has expired.', 'gcash'),
    'The code is wrong or has expired.',
  );
  assert.equal(
    payoutSaveMessage(429, 'Too many codes. Try again in 45 seconds.', 'maya'),
    'Too many codes. Try again in 45 seconds.',
  );
  assert.equal(payoutSaveMessage(502, null, 'bank'), PAYOUT_UPSTREAM_ERROR);
  assert.equal(payoutSaveMessage(500, 'Internal Server Error', 'bank'), PAYOUT_SAVE_ERROR);
  assert.equal(payoutSaveMessage(400, null, 'bank'), PAYOUT_SAVE_ERROR, 'no detail to show');
  // A request that never left the phone keeps its own words (api.ts, status 0).
  assert.equal(payoutSaveMessage(0, 'Could not reach the server at http://x.', 'bank'), 'Could not reach the server at http://x.');

  assert.ok(panel.includes('if (status === 422) {'));
  assert.ok(panel.includes('if ((status === 400 || status === 429) && typeof detail === "string") return detail;'));
  assert.ok(panel.includes(`if (status === 502) return "${PAYOUT_UPSTREAM_ERROR}";`));
  assert.ok(panel.includes(`return "${PAYOUT_SAVE_ERROR}";`));
});


test('the labels, the countdown and the GCash note are the web panel and the shared cooldown', () => {
  assert.equal(codeSentLabel('4567'), 'Code sent to your number ending 4567');
  assert.ok(panel.includes('Code sent to your number ending {codeSentTo}'));
  assert.ok(panel.includes(`placeholder="${PAYOUT_CODE_PLACEHOLDER}"`));
  assert.ok(panel.includes('pattern="[0-9]{6}"'));
  assert.ok(panel.includes('maxLength={6}'));
  assert.ok(panel.includes(PAYOUT_CODE_HINT));

  // The code box on this phone uses the same rule and words as the sign-up screen.
  assert.equal(PAYOUT_CODE_PATTERN.test('123456'), true);
  assert.equal(PAYOUT_CODE_PATTERN.test('12345'), false);
  assert.equal(PAYOUT_CODE_PATTERN.test('1234567'), false);
  assert.match(read('mobile/CarabaoMerchantMobile/src/screens/AuthScreen.tsx'), new RegExp(`'${PAYOUT_CODE_PROBLEM}'`));

  // The web's formatCountdown/logic/detail, and the same one-minute wait.
  assert.ok(read(COOLDOWN).includes(`export const OTP_RESEND_SECONDS = ${PAYOUT_RESEND_SECONDS};`));
  assert.match(read(COOLDOWN), /const s = Math\.max\(0, Math\.ceil\(seconds\)\);/);
  assert.match(read(COOLDOWN), /return `\$\{Math\.floor\(s \/ 60\)\}:\$\{String\(s % 60\)\.padStart\(2, "0"\)\}`;/);
  assert.match(read('backend/app/services/otp.py'), new RegExp(`OTP_RESEND_COOLDOWN_SECONDS = ${PAYOUT_RESEND_SECONDS}`));
  assert.equal(formatCountdown(45), '0:45');
  assert.equal(formatCountdown(60), '1:00');
  assert.equal(formatCountdown(720), '12:00');
  assert.equal(formatCountdown(0.2), '0:01', 'a fraction of a second still shows');
  assert.equal(formatCountdown(-3), '0:00');
  assert.equal(resendLabel(0), 'Send a new code');
  assert.equal(resendLabel(45), 'Send a new code in 0:45');

  // The wait itself: a minute from the send, only for the destination it was sent for.
  const sentAt = 1_000_000;
  assert.deepEqual(resendStart('k', sentAt), { key: 'k', at: sentAt + PAYOUT_RESEND_SECONDS * 1000 });
  assert.equal(resendSeconds(resendStart('k', sentAt), 'k', sentAt), PAYOUT_RESEND_SECONDS);
  assert.equal(resendSeconds(resendStart('k', sentAt), 'k', sentAt + 15_400), 45);
  assert.equal(resendSeconds(resendStart('k', sentAt), 'k', sentAt + PAYOUT_RESEND_SECONDS * 1000), 0);
  assert.equal(resendSeconds(resendStart('k', sentAt), 'k', sentAt + 90_000), 0, 'never negative');
  assert.equal(resendSeconds(resendStart('k', sentAt), 'other', sentAt), 0, 'another destination');
  assert.equal(resendSeconds(null, 'k', sentAt), 0);

  // The save button's three states.
  assert.equal(saveLabel(true, false), PAYOUT_WAIT_LABEL);
  assert.equal(saveLabel(false, true), PAYOUT_CONFIRM_LABEL);
  assert.equal(saveLabel(false, false), PAYOUT_SEND_CODE_LABEL);
  assert.ok(panel.includes('saving ? "Please wait…" : codeSentTo === null ? "Send Code to Save" : "Confirm and Save"'));

  // The GCash note only for gcash, as the web renders it.
  assert.match(panel, /\{draft\.payout_type === "gcash" && \(/);
  assert.ok(panel.includes(GCASH_PESONET_NOTE));
  assert.equal(gcashPesonetNote('gcash'), GCASH_PESONET_NOTE);
  assert.equal(gcashPesonetNote('maya'), null);
  assert.equal(gcashPesonetNote('bank'), null);

  // The picker's own words, and the bank's code under it.
  for (const text of [PAYOUT_BANK_PLACEHOLDER, PAYOUT_BANK_LOADING, PAYOUT_BANK_LIST_ERROR]) {
    assert.ok(panel.includes(text), text);
  }
  assert.ok(panel.includes('Bank code: {draft.bank_code}'));
  assert.equal(bankCodeHint('BNORPHMMXXX'), 'Bank code: BNORPHMMXXX');
  assert.equal(bankCodeHint(''), null);

  // The card's three states, word for word.
  for (const text of [
    PAYOUT_EMPTY,
    PAYOUT_PROBLEM_PREFIX,
    PAYOUT_SETUP_LABEL,
    PAYOUT_EDIT_LABEL,
    PAYOUT_SAVED,
  ]) {
    assert.ok(panel.includes(text), text);
  }
});

test('the screen never prints or logs a whole account number (rule 7)', () => {
  const screen = read(SCREEN);
  const module = read(MODULE);
  assert.ok(screen.includes('maskAccountNumber('), 'the card masks the number');
  assert.ok(screen.includes('destinationName('), 'the card names the destination');
  // No console line carries the draft, and nothing in either file logs at all.
  assert.ok(!/console\.(log|debug|info|warn|error)\([^)]*draft/.test(screen));
  assert.ok(!/console\.(log|debug|info|warn|error)\([^)]*(account_number|ewallet_number)/.test(screen + module));
  assert.ok(!/console\.(log|debug|info|warn|error)/.test(module), 'the module logs nothing');
});

test('the screen texts a code for the destination before it saves, and an edit drops it (CF-0004)', () => {
  const screen = read(SCREEN);

  // The web's order: check the details, text a code, then save with that code.
  assert.ok(screen.includes('destinationProblem(draft)'), 'the details are checked first');
  assert.ok(screen.includes('api.payout.sendCode(token, payload)'), 'a code is texted');
  assert.ok(screen.includes('api.payout.update(token, {'), 'the save posts the code');
  assert.ok(screen.includes('codeIsFor(sentKey, draft)'), 'only the code for this destination saves');

  // Every field edit drops the code already texted (the screen's change()).
  const changeAt = screen.indexOf('const change = (patch');
  const resetAt = screen.indexOf('resetCode();', changeAt);
  assert.ok(changeAt > 0 && resetAt > changeAt, 'change() forgets the code');
  assert.ok(resetAt - changeAt < 200, 'the code is dropped with the edit, not later');

  // The form says what the web says, through the module's own words.
  for (const call of [
    'codeSentLabel(codeSentTo)',
    'resendLabel(cooling)',
    'saveLabel(saving, codeSentTo !== null)',
    'draftPayload(draft)',
    'destinationKey(draftPayload(draft))',
    'gcashPesonetNote(type)',
    'bankCodeHint(draft.bank_code)',
    'destinationProblem(draft)',
    'payoutSaveMessage(',
    'PAYOUT_PROBLEM_PREFIX',
    'PAYOUT_EMPTY',
    'PAYOUT_SAVED',
  ]) {
    assert.ok(screen.includes(call), call);
  }

  // The InstaPay list is asked of the server, once the form needs it.
  assert.ok(screen.includes('.institutions(token)'), 'the bank list comes from the server');
  assert.ok(screen.includes('PAYOUT_BANK_LIST_ERROR'), 'and its failure has the web words');
});

// ── S10 (plan §5.5, part 2): the balance, cash out, history and sales ─────────

/** One payout batch as the API answers it, with only the fields a test cares about set. */
const batch = (over: Partial<MerchantPayoutBatch> = {}): MerchantPayoutBatch => ({
  id: 1,
  merchant_id: 1,
  period_date: '2026-11-01',
  transaction_count: 2,
  gross_amount: 0,
  status: 'pending' as PayoutStatus,
  notes: null,
  released_at: null,
  created_at: '2026-11-01T12:00:00Z',
  transfer_fee: null,
  net_amount: null,
  attempts: 0,
  failure_reason: null,
  provider_reference: null,
  paymongo_transfer_id: null,
  sent_at: null,
  destination_type: null,
  destination_name: null,
  destination_number: null,
  transfer_provider: null,
  ...over,
});

test('the payout and transaction statuses are the web status labels and tones', () => {
  assert.deepEqual(PAYOUT_STATUS_LABELS, {
    pending: 'Requested',
    approved: 'Approved',
    processing: 'Processing',
    released: 'Released',
    failed: 'Failed',
  });
  assert.deepEqual(TRANSACTION_STATUS_LABELS, {
    pending: 'Checkout open',
    paid: 'Paid',
    failed: 'Failed',
    expired: 'Expired',
    refund_pending: 'Refund pending',
    refunded: 'Refunded',
  });
  // The backend's OPEN_PAYOUT_STATUSES: while one of these is open no new cash out is allowed.
  assert.deepEqual([...OPEN_PAYOUT_STATUSES], ['pending', 'approved', 'processing']);
  assert.deepEqual(PAYOUT_PROVIDER_LABELS, { instapay: 'InstaPay', pesonet: 'PESONet' });

  assert.equal(payoutTone('released'), 'green');
  assert.equal(payoutTone('approved'), 'blue');
  assert.equal(payoutTone('processing'), 'blue');
  assert.equal(payoutTone('pending'), 'yellow');
  assert.equal(payoutTone('failed'), 'red');
  assert.equal(transactionTone('paid'), 'green');
  assert.equal(transactionTone('refunded'), 'gray');
  assert.equal(transactionTone('refund_pending'), 'yellow');
  assert.equal(transactionTone('pending'), 'yellow');
  assert.equal(transactionTone('failed'), 'red');
  assert.equal(transactionTone('expired'), 'red');
});

test('the earnings summary adds up paid orders and released payouts', () => {
  const transactions = [
    { status: 'paid' as const, merchant_amount: 1000 },
    { status: 'paid' as const, merchant_amount: 500 },
    { status: 'pending' as const, merchant_amount: 9999 },
  ];
  const payouts = [
    batch({ id: 3, status: 'released', net_amount: 800, gross_amount: 850 }),
    batch({ id: 2, status: 'pending', net_amount: 500, gross_amount: 550 }),
    batch({ id: 1, status: 'released', net_amount: null, gross_amount: 400 }),
  ];
  const summary = earningsSummary(transactions, payouts);
  assert.equal(summary.paidCount, 2);
  assert.equal(summary.totalEarned, 1500, 'only paid orders are earned');
  // A released batch counts its net (the fee is already out); one without a net counts its gross.
  assert.equal(summary.totalPaidOut, 1200);
  assert.equal(summary.openBatch?.id, 2, 'the open payout blocks a new one');
  assert.equal(summary.failedBatch, null);

  const failed = earningsSummary(
    [],
    [batch({ id: 9, status: 'failed' }), batch({ id: 8, status: 'failed' })],
  );
  assert.equal(failed.failedBatch?.id, 9, 'the newest failed payout is the one named');
  assert.equal(failed.openBatch, null);
  assert.equal(earningsSummary([], []).totalPaidOut, 0);
});

test('the cash out button is off while a payout is open, a method is missing or the fee is not covered', () => {
  const earned = { gross_amount: 1500, transfer_fee: 50, net_amount: 1450 };
  assert.deepEqual(cashOutState(earned, { problem: null }, null), {
    gross: 1500,
    fee: 50,
    net: 1450,
    open: false,
    enabled: true,
    block: null,
  });

  // The reasons are checked in the web's order: open, no method, a broken method, no money, fee.
  const open = cashOutState(earned, { problem: 'Account number is incomplete.' }, { status: 'processing' });
  assert.equal(open.block, 'open');
  assert.equal(open.open, true);
  assert.equal(open.enabled, false);
  assert.equal(open.gross, 1500, 'the balance is still shown while a payout is open');

  assert.equal(cashOutState(earned, null, null).block, 'no_method');
  assert.equal(cashOutState(earned, { problem: 'Account number is incomplete.' }, null).block, 'method_problem');
  assert.equal(
    cashOutState({ gross_amount: 0, transfer_fee: 50, net_amount: 0 }, { problem: null }, null).block,
    'no_balance',
  );
  const under = cashOutState({ gross_amount: 50, transfer_fee: 50, net_amount: 0 }, { problem: null }, null);
  assert.equal(under.block, 'under_fee', 'the fee would eat the whole balance');
  assert.equal(under.enabled, false);

  // A second tap while the first request is in flight asks the server nothing.
  const again = cashOutState(earned, { problem: null }, null, true);
  assert.equal(again.enabled, false);
  assert.equal(again.block, null, 'nothing is wrong, it is only busy');

  // Before the first load there is nothing to ask for.
  assert.deepEqual(cashOutState(null, null, null), {
    gross: 0,
    fee: 0,
    net: 0,
    open: false,
    enabled: false,
    block: 'no_method',
  });
});

test('the fee line, the button, the dialog and the request messages are the web panel’s', () => {
  assert.equal(payoutFeeLine(1500, 50, 1450), '₱1,500 earned − ₱50 transfer fee = ₱1,450 to you');
  assert.equal(payoutUnderFeeLine(50), 'Earn more than ₱50 to cover the transfer fee before cashing out.');
  assert.equal(cashOutLabel(1450, false), 'Cash Out ₱1,450');
  assert.equal(cashOutLabel(1450, true), 'Submitting…');
  assert.equal(
    cashOutConfirm(1450, 'GCash ending 4567'),
    'Send ₱1,450 to GCash ending 4567? The transfer fee is already taken out.',
  );
  assert.equal(
    cashOutRequested(1450),
    "Cash out requested. You'll receive ₱1,450 once the admin sends it.",
  );

  // A 400 carries the server's own reason (nothing to cash out, one already open, under the fee),
  // a 403 is the verification rule, and a dropped connection keeps its own message.
  assert.equal(payoutRequestMessage(400, 'Nothing to cash out yet.'), 'Nothing to cash out yet.');
  assert.equal(payoutRequestMessage(422, 'No payout method saved.'), 'No payout method saved.');
  assert.equal(payoutRequestMessage(0, 'Network request failed'), 'Network request failed');
  assert.equal(payoutRequestMessage(403, 'Forbidden'), PAYOUT_NOT_VERIFIED);
  assert.equal(payoutRequestMessage(500, 'Internal error'), PAYOUT_REQUEST_ERROR);
  assert.equal(payoutRequestMessage(400, null), PAYOUT_REQUEST_ERROR, 'no detail: the web fallback');
});

test('a payout in flight or failed is worded as the web panel words it, with the number masked', () => {
  const net = { net_amount: 500, gross_amount: 550, transfer_fee: 50 };

  // Waiting for the admin (CashOutPanel renderOpenBatch, the pending branch).
  assert.equal(
    openBatchMessage(batch({ ...net, status: 'pending' })),
    'You requested ₱500 on Nov 01, 2026 (₱550 earned minus the ₱50 transfer fee). ' +
      'The admin will send it shortly.',
  );
  // On its way through PayMongo: the provider and how long it takes.
  assert.equal(
    openBatchMessage(batch({ ...net, status: 'processing', transfer_provider: 'instapay' })),
    'Sending ₱500 to your payout account via InstaPay. It usually arrives within 20 minutes.',
  );

  // The failed payout's notice, with and without the server's reason.
  assert.equal(
    failedBatchMessage(batch({ net_amount: 500, failure_reason: 'Recipient bank rejected the transfer' })),
    'Your ₱500 payout could not be sent (Recipient bank rejected the transfer). ' +
      'Check your payout method below. If you change it, the admin sends it to the new one.',
  );
  assert.equal(
    failedBatchMessage(batch({ net_amount: 500 })),
    'Your ₱500 payout could not be sent. Check your payout method below. ' +
      'If you change it, the admin sends it to the new one.',
  );

  // The history's "Sent To" (EarningsTab), rule 7: the snapshot number is masked, never whole.
  const gcash = batch({ destination_type: 'gcash', destination_number: '09171234567' });
  assert.equal(payoutSentTo(gcash), 'GCash •••• 4567');
  assert.equal(payoutDestination(gcash), 'GCash •••• 4567');
  assert.ok(!payoutSentTo(gcash).includes('09171234567'), 'the whole number is never printed');
  assert.equal(payoutSentTo(batch({ destination_type: 'bank', destination_number: '1234567890' })), 'Bank Transfer •••• 7890');
  assert.equal(payoutSentTo(batch()), '—', 'no snapshot kept: the web prints an em dash');
  assert.equal(payoutDestination(batch()), 'your payout account');
});

test('the sales card and the export take the day counts the endpoints allow', () => {
  // GET /merchants/me/sales?days= takes 30 or 90; the export takes 7, 30 or 90 (a 422 otherwise).
  assert.deepEqual([...SALES_DAYS], [30, 90]);
  assert.deepEqual([...EXPORT_DAYS], [7, 30, 90]);
  assert.equal(rangeLabel(30), '30 days');
  assert.equal(rangeLabel(90), '90 days');
  assert.equal(rangeLabel(7), '7 days');
  assert.equal(salesCsvName(7), 'sales-7d.csv');
  assert.equal(salesCsvName(90), 'sales-90d.csv');
  assert.equal(salesEmpty(30), 'No sales in the last 30 days.');
  assert.equal(salesEmpty(90), 'No sales in the last 90 days.');

  // The one-line labels under each number.
  assert.equal(availableSub(1), '1 buyer-confirmed order not yet cashed out.');
  assert.equal(availableSub(4), '4 buyer-confirmed orders not yet cashed out.');
  assert.equal(paidOrdersSub(1), 'From 1 paid transaction.');
  assert.equal(paidOrdersSub(3), 'From 3 paid transactions.');
  assert.equal(batchSub(batch({ transaction_count: 1 })), 'Nov 01, 2026 · 1 order');
  assert.equal(batchSub(batch({ transaction_count: 5 })), 'Nov 01, 2026 · 5 orders');
  assert.equal(salesOrdersSub(1, 30), '1 order in the last 30 days.');
  assert.equal(salesOrdersSub(12, 90), '12 orders in the last 90 days.');

  assert.equal(EXPORT_LABEL, 'Export CSV');
  assert.equal(EXPORT_PREPARING, 'Preparing…');
  assert.equal(EXPORT_ERROR, 'The sales file could not be downloaded.');
  assert.equal(EXPORT_NO_SHARING, 'This phone cannot open a share sheet to save the file.');
  assert.equal(SALES_ERROR, 'We could not load your sales. Pull down to try again.');
  assert.equal(AVAILABLE_ERROR, 'We could not load your balance. Pull down to try again.');
});

test('the screen confirms a cash out, then writes the CSV to the cache and shares it', () => {
  const screen = read(SCREEN);

  // The numbers and the rules come from the module, not from the screen.
  assert.ok(screen.includes('earningsSummary(transactions, payouts)'));
  assert.ok(screen.includes('cashOutState(available, info, summary.openBatch, requesting)'));
  assert.ok(screen.includes('payoutRequestMessage(err.status, err.message)'));
  assert.ok(screen.includes('api.payout.requestPayout(token)'));

  // The balance, the history, the transactions and the sales card are all on the page.
  for (const call of ['renderBalance()', 'renderHistory()', 'renderTransactions()', 'renderSales()']) {
    assert.ok(screen.includes(`{${call}}`), call);
  }

  // The app asks before spending the balance, and cannot press twice.
  assert.ok(screen.includes('Alert.alert('), 'the app asks before spending the balance');
  assert.ok(screen.includes('cashOutConfirm(cash.net, destinationName(info))'));
  assert.ok(screen.includes('disabled={!cash.enabled}'));

  // The export is written to the cache as sales-{days}d.csv and handed to the share sheet.
  assert.ok(screen.includes('api.merchants.salesCsv(token, exportDays)'));
  assert.ok(screen.includes('salesCsvName(exportDays)'));
  assert.ok(screen.includes('file.write(csv)'));
  assert.ok(screen.includes('Sharing.isAvailableAsync()'));
  assert.ok(screen.includes('EXPORT_NO_SHARING'));
  assert.ok(screen.includes('Sharing.shareAsync(file.uri'));
  assert.ok(screen.includes("mimeType: 'text/csv'"));

  // A switch never shows the old range's numbers under the new range's tab.
  assert.ok(screen.includes('sales.days === salesDays'));
  // A balance that failed to load reads as unknown, never as ₱0.
  assert.ok(screen.includes('AVAILABLE_ERROR'));
  // The newest failed payout is named once, not on top of the panel's own notice.
  assert.ok(screen.includes('failedBatchMessage(summary.failedBatch)'));
});

