// src/screens/EarningsScreen.tsx
// S9 (plan §5.5, part 1): the payout destination - the web merchant CashOutPanel's method card
// (masked number, the server's `problem` warning) and its edit form: method, bank picker, the
// SMS code step and the save.
// S10 (plan §5.5, part 2): the balance and its transfer fee, Cash out with a confirmation and the
// web's "nothing to cash out / no destination / payout already open" rules, the payout history,
// the transactions behind it, the 30/90 sales summary and the 7/30/90 CSV export (written with
// expo-file-system and handed to the share sheet by expo-sharing).
//
// CF-0004: a new destination is saved only with the code texted for exactly it, so every edit
// drops the code already sent (src/lib/payout.ts codeIsFor) and the button asks for a new one.
// Rule 7: the whole account number is never logged and never printed - the card shows
// maskAccountNumber/destinationName, and the server only ever sends the last 4 digits it texted.
import React, { useEffect, useState } from 'react';
import {
  View, Text, ScrollView, TouchableOpacity, StyleSheet, SafeAreaView, RefreshControl,
  TextInput, Modal, ActivityIndicator, Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useAuth } from '../lib/AuthContext';
import {
  api, ApiError,
  type AvailablePayout, type MerchantPayoutBatch, type MerchantSales, type MerchantTransaction,
  type PayoutInfo, type PayoutInstitution, type PayoutType,
} from '../lib/api';
import {
  ACCOUNT_NUMBER_HINT, ACCOUNT_NUMBER_PLACEHOLDER, AVAILABLE_ERROR, EWALLET_PLACEHOLDER,
  EXPORT_DAYS, EXPORT_ERROR, EXPORT_LABEL, EXPORT_NO_SHARING, EXPORT_PREPARING,
  PAYOUT_BANK_LIST_ERROR, PAYOUT_BANK_LOADING, PAYOUT_BANK_NOTE, PAYOUT_BANK_PLACEHOLDER,
  PAYOUT_CODE_HINT, PAYOUT_CODE_PATTERN, PAYOUT_CODE_PLACEHOLDER, PAYOUT_CODE_PROBLEM,
  PAYOUT_EDIT_LABEL, PAYOUT_EMPTY, PAYOUT_METHOD_LABELS, PAYOUT_PROBLEM_PREFIX,
  PAYOUT_PROVIDER_LABELS, PAYOUT_RESEND_SECONDS, PAYOUT_SAVED, PAYOUT_SETUP_LABEL,
  PAYOUT_STATUS_LABELS, PAYOUT_TYPES, SALES_DAYS, SALES_ERROR, TRANSACTION_STATUS_LABELS,
  availableSub, bankCodeHint, batchSub, cashOutConfirm, cashOutLabel, cashOutRequested,
  cashOutState, codeIsFor, codeSentLabel, destinationKey, destinationName, destinationProblem,
  draftFrom, draftPayload, earningsSummary, failedBatchMessage,
  maskAccountNumber, openBatchMessage, paidOrdersSub, payoutFeeLine, payoutRequestMessage,
  payoutSaveMessage, payoutSentTo, payoutTone, payoutUnderFeeLine, rangeLabel, resendLabel,
  resendSeconds, resendStart, salesCsvName, salesEmpty, salesOrdersSub, saveLabel,
  transactionTone,
  type ExportDays, type PayoutDraft, type SalesDays,
} from '../lib/payout';
import { formatDate, formatPeso } from '../lib/format';
import { Colors, Spacing, Radius, FontSize, Shadow } from '../lib/theme';
import { Badge, Button, Card, Divider, StatRow } from '../components/UI';
import { LoadError, SkeletonList } from '../components/Skeleton';

/** A line above the cards: the server's own words after a failed cash out, or the success note. */
type Banner = { tone: 'success' | 'error'; text: string };

export default function EarningsScreen() {
  const router = useRouter();
  const { token } = useAuth();

  const [info, setInfo] = useState<PayoutInfo | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // S10: the money. Everything below loads beside the payout method so one failing call does not
  // blank the screen; only the method is fatal, because nothing can be cashed out without it.
  const [available, setAvailable] = useState<AvailablePayout | null>(null);
  const [payouts, setPayouts] = useState<MerchantPayoutBatch[]>([]);
  const [transactions, setTransactions] = useState<MerchantTransaction[]>([]);
  const [cashBanner, setCashBanner] = useState<Banner | null>(null);
  const [requesting, setRequesting] = useState(false);

  // The sales card: 30 or 90 days (the endpoint's own two), and the export's three. There is no
  // "loading" flag: the card spins while it has no answer for the chosen range, which a switch
  // clears by asking for the new range (the server echoes `days`, so a stale answer is ignored).
  const [salesDays, setSalesDays] = useState<SalesDays>(30);
  const [sales, setSales] = useState<MerchantSales | null>(null);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [exportDays, setExportDays] = useState<ExportDays>(30);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<PayoutDraft>(() => draftFrom(null));
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The code texted for one exact destination: its key, the last 4 digits the server sent it
  // to, and what the merchant is typing.
  const [sentKey, setSentKey] = useState<string | null>(null);
  const [codeSentTo, setCodeSentTo] = useState<string | null>(null);
  const [code, setCode] = useState('');

  const [banks, setBanks] = useState<PayoutInstitution[] | null>(null);
  const [banksError, setBanksError] = useState(false);
  const [pickBank, setPickBank] = useState(false);

  // A minute between codes for one destination (backend app/services/otp.py), counted down
  // here as the web does and keyed by the destination, as the server keys it.
  const [resend, setResend] = useState<{ key: string; at: number } | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);

  useEffect(() => {
    let active = true;
    // The method is the only fatal one (the screen cannot cash out without it); the balance, the
    // history and the transactions each keep whatever the last good load answered.
    Promise.allSettled([
      api.payout.info(token),
      api.payout.availablePayout(token),
      api.payout.payouts(token),
      api.payout.transactions(token),
    ])
      .then(([infoResult, availableResult, payoutsResult, transactionsResult]) => {
        if (!active) return;
        if (infoResult.status === 'fulfilled') {
          setInfo(infoResult.value);
          setLoadError(null);
        } else {
          const err: unknown = infoResult.reason;
          setLoadError(
            err instanceof Error && err.message
              ? err.message
              : 'We couldn’t load your payout method.',
          );
        }
        if (availableResult.status === 'fulfilled') setAvailable(availableResult.value);
        if (payoutsResult.status === 'fulfilled') setPayouts(payoutsResult.value);
        if (transactionsResult.status === 'fulfilled') setTransactions(transactionsResult.value);
      })
      .finally(() => {
        if (!active) return;
        setLoaded(true);
        setRefreshing(false);
      });
    return () => { active = false; };
  }, [token, attempt]);

  // S10: the sales card follows its own 30/90 switch (and a pull-to-refresh), not the method.
  // The switch/refresh clear the old error before asking, so only this effect writes the answer.
  useEffect(() => {
    let active = true;
    api.merchants
      .sales(token, salesDays)
      .then((data) => { if (active) setSales(data); })
      .catch(() => { if (active) setSalesError(SALES_ERROR); });
    return () => { active = false; };
  }, [token, salesDays, attempt]);

  // The PayMongo InstaPay list, only once the form needs it.
  const needsBanks = editing && draft.payout_type === 'bank' && banks === null && !banksError;
  useEffect(() => {
    if (!needsBanks) return;
    let active = true;
    api.payout
      .institutions(token)
      .then((list) => { if (active) setBanks(list); })
      .catch(() => { if (active) setBanksError(true); });
    return () => { active = false; };
  }, [needsBanks, token]);

  useEffect(() => {
    if (!resend) return;
    const id = setInterval(() => {
      const left = resendSeconds(resend, resend.key);
      setSecondsLeft(left);
      if (left === 0) setResend(null);
    }, 1000);
    return () => clearInterval(id);
  }, [resend]);

  const target = destinationKey(draftPayload(draft));
  // A wait set for another destination is not this one's (the server keys the wait the same).
  const cooling = resend !== null && resend.key === target ? secondsLeft : 0;
  const selectedBank = banks?.find((b) => b.code === draft.bank_code) ?? null;
  const type = draft.payout_type;

  /** A field edit: the code already sent was for the old text, so it is dropped (CF-0004). */
  const change = (patch: Partial<PayoutDraft>) => {
    setDraft((d) => ({ ...d, ...patch }));
    resetCode();
    setFormError(null);
    setNotice(null);
  };
  const resetCode = () => {
    setSentKey(null);
    setCodeSentTo(null);
    setCode('');
  };

  const startEditing = () => {
    setDraft(draftFrom(info));
    setBanksError(false);
    resetCode();
    setFormError(null);
    setNotice(null);
    setEditing(true);
  };
  const stopEditing = () => {
    resetCode();
    setFormError(null);
    setEditing(false);
  };

  /** The web's saveError, applied to the app's ApiError (status 0 when the phone is offline). */
  const messageFor = (err: unknown, payoutType: PayoutType) => {
    if (err instanceof ApiError) return payoutSaveMessage(err.status, err.message, payoutType);
    return payoutSaveMessage(0, err instanceof Error ? err.message : null, payoutType);
  };

  const sendCode = async () => {
    const problem = destinationProblem(draft);
    if (problem) { setFormError(problem); return; }
    if (!token || saving) return;
    const payload = draftPayload(draft);
    const key = destinationKey(payload);
    setSaving(true);
    setFormError(null);
    setNotice(null);
    try {
      const sentTo = await api.payout.sendCode(token, payload);
      setSentKey(key);
      setCodeSentTo(sentTo);
      setCode('');
      setSecondsLeft(PAYOUT_RESEND_SECONDS);
      setResend(resendStart(key));
    } catch (err) {
      setFormError(messageFor(err, payload.payout_type));
    } finally {
      setSaving(false);
    }
  };

  /** No code yet → text one (the web's first submit); a code → save with it. */
  const submit = async () => {
    if (saving) return;
    if (codeSentTo === null || !codeIsFor(sentKey, draft)) {
      await sendCode();
      return;
    }
    if (!PAYOUT_CODE_PATTERN.test(code.trim())) { setFormError(PAYOUT_CODE_PROBLEM); return; }
    if (!token) return;
    setSaving(true);
    setFormError(null);
    try {
      const updated = await api.payout.update(token, {
        ...draftPayload(draft),
        code: code.trim(),
      });
      setInfo(updated);
      setNotice(PAYOUT_SAVED);
      stopEditing();
    } catch (err) {
      setFormError(messageFor(err, draft.payout_type));
    } finally {
      setSaving(false);
    }
  };

  const onRefresh = () => {
    setRefreshing(true);
    // A pull retries everything on screen, including a sales range whose call failed.
    setSalesError(null);
    setAttempt((n) => n + 1);
  };

  // S10: the numbers over the screen and the rules behind the button (src/lib/payout.ts, pure).
  const summary = earningsSummary(transactions, payouts);
  const cash = cashOutState(available, info, summary.openBatch, requesting);

  /**
   * POST /merchants/me/payouts/request. A 400 comes back with the server's reason (nothing to cash
   * out, a payout already open, under the fee, over PayMongo's limit), a 403 with the farm being
   * unverified; both are shown as they are worded (src/lib/payout.ts payoutRequestMessage).
   */
  const requestCashOut = async () => {
    if (!token || requesting) return;
    setRequesting(true);
    setCashBanner(null);
    try {
      const batch = await api.payout.requestPayout(token);
      const net = batch.net_amount ?? batch.gross_amount;
      // The payout is open now, so the balance is spent: the server's answer is the history row.
      setPayouts((rows) => [batch, ...rows]);
      setAvailable((current) => (current ? { ...current, transaction_count: 0, gross_amount: 0, net_amount: 0 } : current));
      setCashBanner({ tone: 'success', text: cashOutRequested(net) });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? payoutRequestMessage(err.status, err.message)
          : payoutRequestMessage(0, err instanceof Error ? err.message : null);
      setCashBanner({ tone: 'error', text: message });
    } finally {
      setRequesting(false);
    }
  };

  /** The confirmation the web does not need: the balance leaves only after a second tap. */
  const confirmCashOut = () => {
    if (!cash.enabled || !info) return;
    Alert.alert(
      'Cash out',
      cashOutConfirm(cash.net, destinationName(info)),
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Cash Out', onPress: () => { void requestCashOut(); } },
      ],
    );
  };

  /**
   * GET /merchants/me/sales/export?days=, written to the cache and handed to the share sheet (the
   * web saves the same file through the browser). The name is sales-{days}d.csv, the web's fallback.
   */
  const exportCsv = async () => {
    if (!token || exporting) return;
    setExporting(true);
    setExportError(null);
    try {
      const csv = await api.merchants.salesCsv(token, exportDays);
      const file = new File(Paths.cache, salesCsvName(exportDays));
      if (file.exists) file.delete();
      file.create();
      await file.write(csv);
      if (!(await Sharing.isAvailableAsync())) {
        setExportError(EXPORT_NO_SHARING);
        return;
      }
      await Sharing.shareAsync(file.uri, {
        mimeType: 'text/csv',
        dialogTitle: `Sales — last ${rangeLabel(exportDays)}`,
        UTI: 'public.comma-separated-values-text',
      });
    } catch (err) {
      setExportError(err instanceof ApiError && err.message ? err.message : EXPORT_ERROR);
    } finally {
      setExporting(false);
    }
  };

  const header = (
    <View style={styles.header}>
      <TouchableOpacity
        style={styles.back}
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Back"
      >
        <Ionicons name="chevron-back" size={24} color={Colors.text} />
      </TouchableOpacity>
      <Text style={styles.headerTitle} numberOfLines={1}>Earnings</Text>
    </View>
  );


  if (!loaded) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <SkeletonList label="Loading your payout method" rows={3} />
      </SafeAreaView>
    );
  }

  if (loadError && !info) {
    return (
      <SafeAreaView style={styles.root}>
        {header}
        <LoadError message={loadError} onRetry={onRefresh} />
      </SafeAreaView>
    );
  }

  /** The saved method: the masked destination, the server's warning, and the edit button. */
  const renderMethod = (saved: PayoutInfo) => (
    <>
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>{PAYOUT_METHOD_LABELS[saved.payout_type]}</Text>
        <Text style={styles.destination} numberOfLines={1}>{destinationName(saved)}</Text>
        <StatRow label="Account Name" value={saved.account_name ?? ''} />
        {saved.payout_type === 'bank' ? (
          <>
            <StatRow label="Bank" value={saved.bank_name ?? saved.bank_code ?? ''} />
            <StatRow label="Account No." value={maskAccountNumber(saved.account_number)} />
          </>
        ) : (
          <StatRow label="Mobile" value={maskAccountNumber(saved.ewallet_number)} />
        )}
      </Card>
      {saved.problem ? (
        <Text style={styles.problem} accessibilityRole="alert">
          {PAYOUT_PROBLEM_PREFIX}{saved.problem}
        </Text>
      ) : null}
      {/* The web's CashOutPanel renderMethod, in the same order: fee line, button, under-fee line. */}
      {!cash.open && cash.gross > 0 ? (
        <Text style={styles.feeLine}>{payoutFeeLine(cash.gross, cash.fee, cash.net)}</Text>
      ) : null}
      {cash.open && summary.openBatch ? (
        <Text style={styles.notice}>{openBatchMessage(summary.openBatch)}</Text>
      ) : available === null ? null : (
        // A balance that failed to load is named on the card above; the button would only say ₱0.
        <Button
          label={cashOutLabel(cash.net, requesting)}
          onPress={confirmCashOut}
          loading={requesting}
          disabled={!cash.enabled}
          fullWidth
        />
      )}
      {!cash.open && cash.gross > 0 && cash.gross <= cash.fee ? (
        <Text style={styles.hint}>{payoutUnderFeeLine(cash.fee)}</Text>
      ) : null}
      <Button label={PAYOUT_EDIT_LABEL} onPress={startEditing} fullWidth />
    </>
  );

  /** The web's empty state: nothing set up yet. */
  const renderEmpty = () => (
    <Card style={styles.card}>
      <Text style={styles.body}>{PAYOUT_EMPTY}</Text>
      <Button label={PAYOUT_SETUP_LABEL} onPress={startEditing} fullWidth />
    </Card>
  );

  /** The balance card: what a cash out would ask for, and what has been earned and paid out. */
  const renderBalance = () => (
    <Card style={styles.card}>
      <Text style={styles.balanceLabel}>Available to Cash Out</Text>
      {/* A failed balance call leaves the number unknown: "—", not a balance of nothing. */}
      <Text style={styles.balanceValue}>{available ? formatPeso(cash.gross) : '—'}</Text>
      <Text style={styles.hint}>
        {available ? availableSub(available.transaction_count) : AVAILABLE_ERROR}
      </Text>
      <Divider />
      <StatRow label="Total Earned" value={formatPeso(summary.totalEarned)} />
      <Text style={styles.hint}>{paidOrdersSub(summary.paidCount)}</Text>
      <StatRow label="Total Paid Out" value={formatPeso(summary.totalPaidOut)} />
      <Text style={styles.hint}>Released to your payout account, after transfer fees.</Text>
    </Card>
  );

  const renderHistory = () => {
    if (payouts.length === 0) return null;
    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Payout History</Text>
        {payouts.map((batch, index) => (
          <View key={batch.id} style={[styles.row, index > 0 && styles.rowBorder]}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>{formatPeso(batch.net_amount ?? batch.gross_amount)}</Text>
              <Badge label={PAYOUT_STATUS_LABELS[batch.status]} color={payoutTone(batch.status)} />
            </View>
            <Text style={styles.hint}>{batchSub(batch)}</Text>
            <Text style={styles.hint}>{`Sent to ${payoutSentTo(batch)}`}</Text>
            {batch.transfer_provider ? (
              <Text style={styles.hint}>
                {batch.provider_reference
                  ? `${PAYOUT_PROVIDER_LABELS[batch.transfer_provider]} · Ref ${batch.provider_reference}`
                  : PAYOUT_PROVIDER_LABELS[batch.transfer_provider]}
              </Text>
            ) : null}
            {batch.released_at ? (
              <Text style={styles.hint}>{`Released ${formatDate(batch.released_at)}`}</Text>
            ) : null}
            {batch.status === 'failed' && batch.failure_reason ? (
              <Text style={styles.error}>{batch.failure_reason}</Text>
            ) : null}
          </View>
        ))}
      </Card>
    );
  };

  const renderTransactions = () => (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Transactions</Text>
      {transactions.length === 0 ? (
        <Text style={styles.hint}>No payments yet.</Text>
      ) : (
        transactions.map((tx, index) => (
          <View key={tx.id} style={[styles.row, index > 0 && styles.rowBorder]}>
            <View style={styles.rowTop}>
              <Text style={styles.rowTitle}>#{tx.order_id}</Text>
              <Text style={styles.rowAmount}>{formatPeso(tx.merchant_amount)}</Text>
            </View>
            <View style={styles.rowTop}>
              <Text style={styles.hint}>
                {`${formatDate(tx.paid_at ?? tx.created_at)} · ${formatPeso(tx.amount)} order`}
              </Text>
              <Badge
                label={TRANSACTION_STATUS_LABELS[tx.status]}
                color={transactionTone(tx.status)}
              />
            </View>
          </View>
        ))
      )}
    </Card>
  );

  /**
   * The sales summary (30 or 90 days, GET /merchants/me/sales) and the CSV export (7, 30 or 90,
   * GET /merchants/me/sales/export written to the cache and shared): two switches on one card,
   * because the export is the same numbers taken away as a file.
   */
  const renderSales = () => {
    // A switch keeps the old range's numbers on screen until the new ones arrive, so show only
    // the answer that belongs to the chosen range (the server echoes `days`).
    const shown = sales && sales.days === salesDays ? sales : null;
    return (
      <Card style={styles.card}>
        <Text style={styles.cardTitle}>Sales</Text>
        <View style={styles.chips}>
          {SALES_DAYS.map((days) => {
            const on = days === salesDays;
            return (
              <TouchableOpacity
                key={days}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => {
                  // The new range starts unanswered: clear any old error so the card spins.
                  setSalesError(null);
                  setSalesDays(days);
                }}
                accessibilityRole="radio"
                accessibilityState={{ selected: on }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{rangeLabel(days)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {salesError ? <Text style={styles.error} accessibilityRole="alert">{salesError}</Text> : null}
        {shown === null ? (
          // An error above already explains the silence; otherwise the answer is on its way.
          salesError ? null : <ActivityIndicator color={Colors.primary} style={styles.salesLoading} />
        ) : shown.total_orders === 0 ? (
          <Text style={styles.hint}>{salesEmpty(salesDays)}</Text>
        ) : (
          <>
            <Text style={styles.balanceValue}>{formatPeso(shown.total_revenue)}</Text>
            <Text style={styles.hint}>{salesOrdersSub(shown.total_orders, shown.days)}</Text>
            {shown.top_products.slice(0, 3).map((product) => (
              <StatRow
                key={`${product.produce_id ?? 'gone'}-${product.name}`}
                label={`${product.name} · ${product.quantity} sold`}
                value={formatPeso(product.revenue)}
              />
            ))}
          </>
        )}
        <Divider />
        <Text style={styles.label}>Export</Text>
        <View style={styles.chips}>
          {EXPORT_DAYS.map((days) => {
            const on = days === exportDays;
            return (
              <TouchableOpacity
                key={days}
                style={[styles.chip, on && styles.chipOn]}
                onPress={() => { setExportDays(days); setExportError(null); }}
                disabled={exporting}
                accessibilityRole="radio"
                accessibilityState={{ selected: on, disabled: exporting }}
              >
                <Text style={[styles.chipText, on && styles.chipTextOn]}>{rangeLabel(days)}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
        {exportError ? (
          <Text style={styles.error} accessibilityRole="alert">{exportError}</Text>
        ) : null}
        <Button
          label={exporting ? EXPORT_PREPARING : EXPORT_LABEL}
          onPress={() => void exportCsv()}
          loading={exporting}
          fullWidth
        />
      </Card>
    );
  };

  const renderForm = () => (
    <Card style={styles.card}>
      <Text style={styles.cardTitle}>Payout Method</Text>
      <View style={styles.chips}>
        {PAYOUT_TYPES.map((option) => {
          const on = type === option;
          return (
            <TouchableOpacity
              key={option}
              style={[styles.chip, on && styles.chipOn]}
              onPress={() => change({ payout_type: option })}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
            >
              <Text style={[styles.chipText, on && styles.chipTextOn]}>
                {PAYOUT_METHOD_LABELS[option]}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>

      {type === 'bank' ? (
        <>
          <Text style={styles.label}>Bank</Text>
          {banksError ? (
            <View style={styles.retryRow}>
              <Text style={styles.error}>{PAYOUT_BANK_LIST_ERROR}</Text>
              <TouchableOpacity onPress={() => setBanksError(false)} accessibilityRole="button">
                <Text style={styles.link}>Try again</Text>
              </TouchableOpacity>
            </View>
          ) : (
            <TouchableOpacity
              style={styles.input}
              onPress={() => setPickBank(true)}
              disabled={banks === null}
              accessibilityRole="button"
              accessibilityLabel="Bank"
            >
              <Text style={selectedBank ? styles.inputText : styles.placeholder} numberOfLines={1}>
                {banks === null ? PAYOUT_BANK_LOADING : selectedBank?.name ?? PAYOUT_BANK_PLACEHOLDER}
              </Text>
              <Ionicons name="chevron-down" size={18} color={Colors.textMuted} />
            </TouchableOpacity>
          )}
          {draft.bank_code && !banksError ? (
            <Text style={styles.hint}>{bankCodeHint(draft.bank_code)}</Text>
          ) : null}
          <Text style={styles.hint}>{PAYOUT_BANK_NOTE}</Text>
        </>
      ) : null}

      <Text style={styles.label}>Account Holder Name</Text>
      <TextInput
        style={styles.input}
        value={draft.account_name}
        onChangeText={(text) => change({ account_name: text })}
        placeholder={
          type === 'bank'
            ? 'Name on the bank account'
            : `Name on the ${PAYOUT_METHOD_LABELS[type]} account`
        }
        placeholderTextColor={Colors.textLight}
        autoCapitalize="words"
        autoComplete="name"
      />

      {type === 'bank' ? (
        <>
          <Text style={styles.label}>Account Number</Text>
          <TextInput
            style={styles.input}
            value={draft.account_number}
            onChangeText={(text) => change({ account_number: text })}
            placeholder={ACCOUNT_NUMBER_PLACEHOLDER}
            placeholderTextColor={Colors.textLight}
            keyboardType="number-pad"
            maxLength={20}
          />
          <Text style={styles.hint}>{ACCOUNT_NUMBER_HINT}</Text>
        </>
      ) : (
        <>
          <Text style={styles.label}>{PAYOUT_METHOD_LABELS[type]} Mobile Number</Text>
          <TextInput
            style={styles.input}
            value={draft.ewallet_number}
            onChangeText={(text) => change({ ewallet_number: text })}
            placeholder={EWALLET_PLACEHOLDER}
            placeholderTextColor={Colors.textLight}
            keyboardType="phone-pad"
            maxLength={13}
          />
        </>
      )}

      {codeSentTo !== null ? (
        <>
          <Text style={styles.label}>{codeSentLabel(codeSentTo)}</Text>
          <TextInput
            style={styles.input}
            value={code}
            onChangeText={setCode}
            placeholder={PAYOUT_CODE_PLACEHOLDER}
            placeholderTextColor={Colors.textLight}
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="one-time-code"
            textContentType="oneTimeCode"
          />
          <Text style={styles.hint}>{PAYOUT_CODE_HINT}</Text>
          <TouchableOpacity
            onPress={() => void sendCode()}
            disabled={saving || cooling > 0}
            accessibilityRole="button"
            accessibilityState={{ disabled: saving || cooling > 0 }}
          >
            <Text style={[styles.link, (saving || cooling > 0) && styles.linkOff]}>
              {resendLabel(cooling)}
            </Text>
          </TouchableOpacity>
        </>
      ) : null}

      {formError ? (
        <Text style={styles.error} accessibilityRole="alert">{formError}</Text>
      ) : null}

      <Button
        label={saveLabel(saving, codeSentTo !== null)}
        onPress={() => void submit()}
        loading={saving}
        fullWidth
      />
      <TouchableOpacity onPress={stopEditing} accessibilityRole="button" style={styles.cancel}>
        <Text style={styles.cancelText}>Cancel</Text>
      </TouchableOpacity>
    </Card>
  );

  return (
    <SafeAreaView style={styles.root}>
      {header}
      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        {notice ? <Text style={styles.notice}>{notice}</Text> : null}
        {/* A refresh that failed leaves the saved method on screen with what went wrong. */}
        {loadError && info ? <Text style={styles.error}>{loadError}</Text> : null}
        {cashBanner ? (
          <Text
            style={cashBanner.tone === 'success' ? styles.notice : styles.error}
            accessibilityRole="alert"
          >
            {cashBanner.text}
          </Text>
        ) : null}
        {renderBalance()}
        {/* The newest failed payout, unless a newer one is in flight (CashOutPanel's notice). */}
        {!editing && !cash.open && summary.failedBatch ? (
          <Text style={styles.problem} accessibilityRole="alert">
            {failedBatchMessage(summary.failedBatch)}
          </Text>
        ) : null}
        {editing ? renderForm() : info ? renderMethod(info) : renderEmpty()}
        {renderHistory()}
        {renderTransactions()}
        {renderSales()}

        <Modal
          visible={pickBank}
          animationType="slide"
          transparent
          onRequestClose={() => setPickBank(false)}
        >
          <View style={styles.backdrop}>
            <View style={styles.sheet}>
              <Text style={styles.sheetTitle}>Select your bank</Text>
              {banks === null ? (
                <ActivityIndicator color={Colors.primary} style={styles.sheetLoading} />
              ) : (
                <ScrollView>
                  {banks.map((bank) => (
                    <TouchableOpacity
                      key={bank.code}
                      style={styles.bankRow}
                      onPress={() => {
                        change({ bank_code: bank.code });
                        setPickBank(false);
                      }}
                      accessibilityRole="button"
                    >
                      <Text style={styles.bankName} numberOfLines={1}>{bank.name}</Text>
                      {draft.bank_code === bank.code ? (
                        <Ionicons name="checkmark" size={18} color={Colors.primaryDark} />
                      ) : null}
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
              <TouchableOpacity
                onPress={() => setPickBank(false)}
                accessibilityRole="button"
                style={styles.cancel}
              >
                <Text style={styles.cancelText}>Cancel</Text>
              </TouchableOpacity>
            </View>
          </View>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}


const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.white, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { padding: Spacing.xs },
  headerTitle: { flex: 1, fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  card: { gap: Spacing.sm },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  destination: { fontSize: FontSize.lg, fontWeight: '800', color: Colors.text },
  body: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  problem: {
    fontSize: FontSize.sm, color: Colors.error, backgroundColor: Colors.errorBg,
    borderRadius: Radius.md, padding: Spacing.md, lineHeight: 20,
  },
  notice: {
    fontSize: FontSize.sm, color: Colors.success, backgroundColor: Colors.successBg,
    borderRadius: Radius.md, padding: Spacing.md, lineHeight: 20,
  },
  chips: { flexDirection: 'row', gap: Spacing.sm },
  chip: {
    flex: 1, borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.full,
    paddingVertical: Spacing.sm, alignItems: 'center', backgroundColor: Colors.white,
  },
  chipOn: { borderColor: Colors.primary, backgroundColor: Colors.primaryLight },
  chipText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  chipTextOn: { color: Colors.primaryDark, fontWeight: '700' },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text, marginTop: Spacing.xs },
  input: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 12, minHeight: 46,
    fontSize: FontSize.md, color: Colors.text, backgroundColor: Colors.white,
  },
  inputText: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  placeholder: { flex: 1, fontSize: FontSize.md, color: Colors.textLight },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 17 },
  error: { fontSize: FontSize.sm, color: Colors.error, lineHeight: 20 },
  retryRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, flexWrap: 'wrap' },
  link: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.primaryDark, paddingVertical: Spacing.xs },
  linkOff: { color: Colors.textLight },
  cancel: { alignItems: 'center', paddingVertical: Spacing.sm },
  cancelText: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(17, 24, 39, 0.45)' },
  sheet: {
    maxHeight: '70%', backgroundColor: Colors.white, borderTopLeftRadius: Radius.lg,
    borderTopRightRadius: Radius.lg, padding: Spacing.lg, gap: Spacing.sm, ...Shadow.lg,
  },
  sheetTitle: { fontSize: FontSize.lg, fontWeight: '700', color: Colors.text },
  sheetLoading: { paddingVertical: Spacing.xxl },
  bankRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm,
    paddingVertical: Spacing.md, borderBottomWidth: 1, borderBottomColor: Colors.borderLight,
    minHeight: 44,
  },
  bankName: { flex: 1, fontSize: FontSize.md, color: Colors.text },
  // S10: the balance, the history rows, the transactions and the sales card.
  balanceLabel: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.textMuted },
  balanceValue: { fontSize: 30, fontWeight: '800', color: Colors.text },
  feeLine: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  row: { paddingVertical: Spacing.sm, gap: 2 },
  rowBorder: { borderTopWidth: 1, borderTopColor: Colors.borderLight },
  rowTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: Spacing.sm },
  rowTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  rowAmount: { fontSize: FontSize.md, fontWeight: '700', color: Colors.primaryDark },
  salesLoading: { paddingVertical: Spacing.lg },
});

