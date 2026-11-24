// src/screens/ShopScreen.tsx
// S14 (plan §5.9): the farm's public shop page — the web merchant shell's Shop tab.
// Every edit goes to a draft. Publish copies the draft to the live page, and until the
// first publish the farm is not in the buyer app's farm list at all (merchant_is_public).
// Only a verified farm may publish; Carabao's approval never publishes by itself.
import React, { useState } from 'react';
import {
  ActivityIndicator, Alert, RefreshControl, SafeAreaView, ScrollView, StyleSheet,
  Text, TextInput, TouchableOpacity, View, type TextInputProps,
} from 'react-native';
import { Image } from 'expo-image';
import * as ImagePicker from 'expo-image-picker';
import * as WebBrowser from 'expo-web-browser';
import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { api, ApiError, WEB_BASE, type ApiShopPage, type ShopPageUpdatePayload } from '../lib/api';
import { useAuth } from '../lib/AuthContext';
import { useMerchantData } from '../lib/MerchantDataContext';
import { checkImage, filePart, imageMimeType } from '../lib/uploads';
import { safeImageUri } from '../lib/imageUri';
import { shopSlug } from '../lib/shopSlug';
import {
  canPublish, publishLabel, SHOP_DESCRIPTION_MAX, SHOP_SLUG_MAX, SHOP_SLUG_MIN, SHOP_TITLE_MAX,
  shopState, shopStateBadge, shopStateText, showsDiscard, slugProblem,
} from '../lib/shopPage';
import { Colors, FontSize, Radius, Shadow, Spacing } from '../lib/theme';
import { Badge, Button } from '../components/UI';
import { LoadError, SkeletonList } from '../components/Skeleton';

// One image, as the web input takes it (ShopTab.tsx: PNG, JPG or WebP). The server
// re-encodes it, so there is no crop here; `quality` only shortens the upload.
const IMAGE_OPTIONS: ImagePicker.ImagePickerOptions = {
  mediaTypes: ['images'],
  allowsEditing: false,
  quality: 0.9,
  exif: false,
};

// The chip colours UI.tsx offers: grey while not live, amber while it waits, green live.
const STATE_BADGE = { unverified: 'gray', draft: 'gray', changed: 'yellow', live: 'green' } as const;

/** The calls that hold the page while they run; null when nothing is happening. */
type Busy = 'create' | 'save' | 'publish' | 'unpublish' | 'discard' | 'logo' | 'banner' | null;

/** What the merchant has typed since the page last answered (see the fields below). */
type Edits = { title?: string; slug?: string; description?: string };

const errorText = (err: unknown, fallback: string) =>
  err instanceof Error && err.message ? err.message : fallback;

export default function ShopScreen() {
  const router = useRouter();
  const { token } = useAuth();
  const {
    shopPage, performance, loading, error: dataError, refreshShopPage, refreshPerformance,
  } = useMerchantData();

  // The draft fields. What the merchant types wins until the next server answer: a save,
  // a discard or an upload fills these from the response, so the boxes never keep showing
  // an old draft. (An edit made on another device arrives with pull-to-refresh.)
  const [edits, setEdits] = useState<Edits>({});
  // The suffix shopSlug() appends when a title has nothing to build a link from
  // (CF-0053). Fixed for this visit so the link shown does not change as they type.
  const [suffix] = useState(() => Date.now().toString(36));
  const [busy, setBusy] = useState<Busy>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [slugError, setSlugError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const title = edits.title ?? shopPage?.draft_title ?? '';
  const description = edits.description ?? shopPage?.draft_description ?? '';
  const slug = edits.slug ?? shopPage?.slug ?? '';
  const suggestedSlug = shopSlug(title, suffix);

  // Publishing needs Carabao's approval; the server refuses it anyway (403, same words).
  // While the performance call is still out, let the button through rather than block an
  // approved farm on a slow network — a refusal comes back with the server's message.
  const verified = !performance || performance.verification_status === 'verified';
  const state = shopPage ? shopState(shopPage, verified) : null;
  const canPublishNow = shopPage ? canPublish(shopPage, verified) : false;
  const dirty = shopPage
    ? title.trim() !== shopPage.draft_title.trim()
      || description.trim() !== (shopPage.draft_description ?? '').trim()
      || slug.trim() !== shopPage.slug
    : title.trim().length > 0 || description.trim().length > 0;
  const linkProblem = slug ? slugProblem(slug) : null;
  // The format check runs as the merchant types a new link. A link the server refused keeps
  // the server's words until the next save.
  const slugMessage = slugError ?? (shopPage && slug.trim() !== shopPage.slug ? linkProblem : null);

  const reload = async () => {
    setRefreshing(true);
    setActionError(null);
    await Promise.all([refreshShopPage(), refreshPerformance()]);
    setRefreshing(false);
  };

  /**
   * Send one change, then take the server's answer as the form's values and refresh the
   * shared copy (the tabs and Home read it too). Returns null, or the reason the call failed
   * (also left in `actionError`, and under a field the server named — CF-0123).
   */
  const send = async (
    kind: Busy, call: () => Promise<ApiShopPage>, fallback: string,
  ): Promise<string | null> => {
    setBusy(kind);
    setActionError(null);
    try {
      const next = await call();
      setEdits({ title: next.draft_title, slug: next.slug, description: next.draft_description ?? '' });
      setTitleError(null);
      setSlugError(null);
      await refreshShopPage();
      return null;
    } catch (err) {
      const message = errorText(err, fallback);
      setActionError(message);
      // CF-0123: the server names the field it refused, so the message lands under it.
      if (err instanceof ApiError) {
        if (err.fieldErrors.title) setTitleError(err.fieldErrors.title);
        if (err.fieldErrors.slug) setSlugError(err.fieldErrors.slug);
      }
      return message;
    } finally {
      setBusy(null);
    }
  };

  // CF-0053: a new page's link comes from its title, as on the web, so any title can start
  // a page. A title with nothing a link can be built from (only symbols) still gets a page
  // with a shop-<…> link, which the merchant can change in the editor.
  const createDraft = async () => {
    if (!token) return;
    const nextTitle = title.trim();
    if (!nextTitle) {
      setTitleError('Enter a title for your shop.');
      return;
    }
    setTitleError(null);
    const base = shopSlug(nextTitle, suffix);
    await send(
      'create',
      () => api.merchants.createShopPage(token, {
        title: nextTitle,
        slug: base.length >= SHOP_SLUG_MIN ? base : shopSlug('', suffix),
        description: description.trim() || null,
      }),
      'Could not create the shop page. Try again.',
    );
  };

  const saveDraft = async () => {
    if (!token || !shopPage) return;
    const nextTitle = title.trim();
    const nextSlug = slug.trim();
    const nextDescription = description.trim();
    const titleProblem = nextTitle ? null : 'Enter a title for your shop.';
    const problem = slugProblem(nextSlug);
    setTitleError(titleProblem);
    setSlugError(problem);
    if (titleProblem || problem) return;
    // Only what changed is sent (backend ShopPageUpdate: a field left out keeps its draft
    // value). The slug is not part of the draft: the server applies it at once and keeps
    // the old link pointing at the farm.
    const payload: ShopPageUpdatePayload = {};
    if (nextTitle !== shopPage.draft_title) payload.title = nextTitle;
    if (nextDescription !== (shopPage.draft_description ?? '')) {
      payload.description = nextDescription || null;
    }
    if (nextSlug !== shopPage.slug) payload.slug = nextSlug;
    if (!Object.keys(payload).length) return;
    await send('save', () => api.merchants.updateShopPage(token, payload), 'Could not save the draft. Try again.');
  };

  const publish = async () => {
    if (!token) return;
    await send('publish', () => api.merchants.publishShopPage(token), 'Could not publish. Try again.');
  };

  // The web's confirm texts (lib/i18n/strings/en.ts merchantConfirm.*). Unpublishing hides
  // the farm from buyers; open orders continue because their screens do not check
  // merchant_is_public.
  const confirmUnpublish = () => {
    if (!token) return;
    Alert.alert(
      'Unpublish your shop?',
      'Buyers cannot find your farm or order from it until you publish again. Open orders continue.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Unpublish',
          style: 'destructive',
          onPress: () => {
            void send('unpublish', () => api.merchants.unpublishShopPage(token), 'Could not unpublish. Try again.');
          },
        },
      ],
    );
  };

  // Discard copies the live page back over the draft, so a shop that was never published
  // (or has nothing waiting) does not offer it; the backend answers 400 for those too.
  const confirmDiscard = () => {
    if (!token) return;
    Alert.alert(
      'Discard your draft changes?',
      'The draft goes back to the live page.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            void send('discard', () => api.merchants.discardShopPageDraft(token), 'Could not discard the draft. Try again.');
          },
        },
      ],
    );
  };

  // S14: the buyer-facing page on the web. Until the first publish there is no public page
  // to open, so point at the draft preview in this screen instead of a dead link.
  const openPreview = async () => {
    if (!shopPage) return;
    if (!shopPage.is_published) {
      Alert.alert(
        'Your shop isn’t live yet',
        'Buyers cannot open your shop page until you publish it. The preview below shows your draft.',
      );
      return;
    }
    const url = `${WEB_BASE}/farms/${shopPage.slug}`;
    try {
      await WebBrowser.openBrowserAsync(url);
    } catch {
      Alert.alert('Could not open the page', `Open ${url} in a browser to see your shop page.`);
    }
  };

  // S14: one logo or banner from the photo library, checked with the web's rules
  // (checkImage) before anything is sent. The uploads change the draft only, and the server
  // stores each under a new name, so the live image stays as buyers see it.
  const pickImage = async (which: 'logo' | 'banner') => {
    if (!token) return;
    setImageError(null);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        setImageError('Allow photo access in your phone settings to choose an image.');
        return;
      }
      const result = await ImagePicker.launchImageLibraryAsync(IMAGE_OPTIONS);
      const asset = result.canceled ? undefined : result.assets?.[0];
      if (!asset) return;
      // The picker can leave the type out; the file name makes up for it (uploads.ts).
      const mimeType = imageMimeType(asset.uri, asset.mimeType);
      const problem = checkImage({ size: asset.fileSize, mimeType });
      if (problem) {
        setImageError(problem);
        return;
      }
      const file = filePart(asset.uri, asset.fileName, mimeType);
      const call = which === 'logo'
        ? () => api.merchants.uploadShopLogo(token, file)
        : () => api.merchants.uploadShopBanner(token, file);
      // The reason shows by the images, where the merchant just acted; the state card above
      // need not repeat it.
      const failure = await send(which, call, 'Image upload failed. Try again.');
      if (failure) {
        setImageError(failure);
        setActionError(null);
      }
    } catch {
      setImageError('The image could not be opened. Try again.');
    }
  };

  const banner = safeImageUri(shopPage?.draft_banner_image_url, __DEV__);
  const logo = safeImageUri(shopPage?.draft_logo_url, __DEV__);
  const merchantName = performance?.merchant_name ?? shopPage?.title ?? '';

  return (
    <SafeAreaView style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          style={styles.back}
          accessibilityRole="button"
          accessibilityLabel="Back"
        >
          <Ionicons name="chevron-back" size={24} color={Colors.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Shop page</Text>
      </View>

      {loading ? (
        <View style={styles.scroll}>
          <SkeletonList label="Loading your shop page" rows={3} />
        </View>
      ) : dataError && !shopPage ? (
        <LoadError message={dataError} onRetry={() => { void reload(); }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.scroll}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => { void reload(); }}
              tintColor={Colors.primary}
            />
          }
        >
          <Text style={styles.lead}>
            Your public shop page. Buyers see your farm only after you publish; every edit
            stays in a draft until then.
          </Text>

          {shopPage && state ? (
            <View style={styles.card}>
              <View style={styles.stateRow}>
                <Badge label={shopStateBadge(state)} color={STATE_BADGE[state]} />
              </View>
              <Text style={styles.stateText}>{shopStateText(state)}</Text>
              {actionError ? (
                <Text style={styles.error} accessibilityRole="alert">{actionError}</Text>
              ) : null}

              <View style={styles.actions}>
                <ActionButton
                  label="Preview"
                  onPress={() => { void openPreview(); }}
                  disabled={busy !== null}
                />
                {showsDiscard(shopPage) ? (
                  <ActionButton
                    label={busy === 'discard' ? 'Discarding…' : 'Discard changes'}
                    tone="danger"
                    onPress={confirmDiscard}
                    disabled={busy !== null}
                  />
                ) : null}
                {shopPage.is_published ? (
                  <ActionButton
                    label={busy === 'unpublish' ? 'Unpublishing…' : 'Unpublish'}
                    tone="danger"
                    onPress={confirmUnpublish}
                    disabled={busy !== null}
                  />
                ) : null}
              </View>

              <Button
                label={publishLabel(shopPage)}
                onPress={() => { void publish(); }}
                loading={busy === 'publish'}
                disabled={busy !== null || !canPublishNow}
                fullWidth
              />
              {!verified ? (
                <Text style={styles.hint}>
                  Publishing opens once Carabao approves your documents.
                </Text>
              ) : !shopPage.draft_title.trim() ? (
                <Text style={styles.hint}>Add a title before you publish.</Text>
              ) : !shopPage.has_unpublished_changes ? (
                <Text style={styles.hint}>The live page is up to date.</Text>
              ) : null}
            </View>
          ) : null}

          {shopPage ? (
            <>
              <View style={styles.card}>
                <Text style={styles.cardTitle}>Images</Text>
                <TouchableOpacity
                  style={styles.banner}
                  onPress={() => { void pickImage('banner'); }}
                  disabled={busy !== null}
                  accessibilityRole="button"
                  accessibilityLabel={banner ? 'Replace the shop banner image' : 'Add a shop banner image'}
                >
                  {banner ? (
                    <Image source={{ uri: banner }} style={styles.bannerImg} contentFit="cover" />
                  ) : (
                    <View style={styles.bannerEmpty}>
                      <Ionicons name="image-outline" size={26} color={Colors.textLight} />
                      <Text style={styles.emptyTitle}>Add a banner image</Text>
                      <Text style={styles.hint}>Shown across the top of your shop page</Text>
                    </View>
                  )}
                  {busy === 'banner' ? (
                    <View style={styles.overlay}>
                      <ActivityIndicator color={Colors.white} />
                      <Text style={styles.overlayText}>Uploading…</Text>
                    </View>
                  ) : (
                    <View style={styles.chip}>
                      <Ionicons name="camera-outline" size={14} color={Colors.white} />
                      <Text style={styles.chipText}>{banner ? 'Replace banner' : 'Upload banner'}</Text>
                    </View>
                  )}
                </TouchableOpacity>
                <Text style={styles.hint}>
                  A wide image works best, about 4:1 (for example 1600 × 400 px). JPG, PNG or
                  WebP, 5MB or smaller.
                </Text>

                <View style={styles.logoRow}>
                  <TouchableOpacity
                    style={styles.logoBtn}
                    onPress={() => { void pickImage('logo'); }}
                    disabled={busy !== null}
                    accessibilityRole="button"
                    accessibilityLabel={logo ? 'Change the shop logo' : 'Add a shop logo'}
                  >
                    {logo ? (
                      <Image source={{ uri: logo }} style={styles.logo} contentFit="cover" />
                    ) : (
                      <View style={styles.logoEmpty}>
                        <Ionicons name="storefront-outline" size={22} color={Colors.textLight} />
                        <Text style={styles.hint}>Logo</Text>
                      </View>
                    )}
                    {busy === 'logo' ? (
                      <View style={styles.overlay}>
                        <ActivityIndicator color={Colors.white} />
                      </View>
                    ) : null}
                  </TouchableOpacity>
                  <View style={styles.logoNote}>
                    <Text style={styles.label}>{logo ? 'Change logo' : 'Add a logo'}</Text>
                    <Text style={styles.hint}>
                      A square image works best. JPG, PNG or WebP, 5MB or smaller.
                    </Text>
                  </View>
                </View>
                {imageError ? (
                  <Text style={styles.error} accessibilityRole="alert">{imageError}</Text>
                ) : null}
                <Text style={styles.hint}>
                  An upload changes your draft. Buyers see the new image after you publish.
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Shop details</Text>
                <FieldInput
                  label="Title"
                  value={title}
                  onChangeText={(v) => { setEdits((e) => ({ ...e, title: v })); setTitleError(null); }}
                  maxLength={SHOP_TITLE_MAX}
                  placeholder="e.g. Dela Cruz Farm"
                  error={titleError}
                  editable={busy === null}
                  accessibilityLabel="Shop page title"
                />

                <View style={styles.field}>
                  <Text style={styles.label}>Shop link</Text>
                  <View style={[styles.slugRow, slugMessage ? styles.inputBad : null]}>
                    <Text style={styles.slugPrefix}>/farms/</Text>
                    <TextInput
                      style={styles.slugInput}
                      value={slug}
                      onChangeText={(v) => { setEdits((e) => ({ ...e, slug: v })); setSlugError(null); }}
                      maxLength={SHOP_SLUG_MAX}
                      autoCapitalize="none"
                      autoCorrect={false}
                      placeholder="dela-cruz-farm"
                      placeholderTextColor={Colors.textLight}
                      editable={busy === null}
                      accessibilityLabel="Shop page link"
                    />
                  </View>
                  <Text style={slugMessage ? styles.error : styles.hint}>
                    {slugMessage
                      ?? 'Lowercase letters, numbers and single hyphens. Saving changes the link at once, and your old links still work.'}
                  </Text>
                </View>

                <FieldInput
                  label="Description"
                  value={description}
                  onChangeText={(v) => setEdits((e) => ({ ...e, description: v }))}
                  maxLength={SHOP_DESCRIPTION_MAX}
                  placeholder="What you grow, how you farm, where you are"
                  multiline
                  editable={busy === null}
                  accessibilityLabel="Shop page description"
                />
                <Text style={styles.hint}>
                  {description.length} of {SHOP_DESCRIPTION_MAX} characters
                </Text>

                <Button
                  label="Save draft"
                  onPress={() => { void saveDraft(); }}
                  loading={busy === 'save'}
                  disabled={busy !== null || !dirty || !title.trim() || !slug.trim() || !!linkProblem}
                  fullWidth
                />
                <Text style={styles.hint}>
                  {dirty
                    ? 'Unsaved changes. They reach buyers only after you save and publish.'
                    : 'No unsaved changes.'}
                </Text>
              </View>

              <View style={styles.card}>
                <Text style={styles.cardTitle}>Preview</Text>
                <Text style={styles.hint}>
                  {shopPage.is_published
                    ? 'Draft. Buyers see the published page, not this version, until you publish again.'
                    : 'Draft. Buyers do not see this version yet.'}
                </Text>
                <View style={styles.preview}>
                  {banner ? (
                    <Image source={{ uri: banner }} style={styles.previewBanner} contentFit="cover" />
                  ) : (
                    <View style={styles.previewBannerEmpty} />
                  )}
                  <View style={styles.previewBody}>
                    {logo ? (
                      <Image source={{ uri: logo }} style={styles.previewLogo} contentFit="cover" />
                    ) : null}
                    <View style={styles.previewInfo}>
                      <Text style={styles.previewName}>{merchantName || title.trim()}</Text>
                      {description.trim() ? (
                        <Text style={styles.body}>{description.trim()}</Text>
                      ) : (
                        <Text style={styles.muted}>
                          No description yet. Tell buyers about your farm.
                        </Text>
                      )}
                    </View>
                  </View>
                </View>
                <Text style={styles.hint}>
                  The page title in search results and the browser tab:{' '}
                  <Text style={styles.hintStrong}>{title.trim() || '—'}</Text>
                </Text>
              </View>
            </>
          ) : (
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Set up your shop page</Text>
              <Text style={styles.body}>
                Buyers do not see your farm until you publish your page, so you can add a logo,
                banner and description first.
              </Text>
              <FieldInput
                label="Title"
                value={title}
                onChangeText={(v) => { setEdits((e) => ({ ...e, title: v })); setTitleError(null); }}
                maxLength={SHOP_TITLE_MAX}
                placeholder="e.g. Dela Cruz Farm"
                error={titleError}
                editable={busy === null}
                accessibilityLabel="Shop page title"
              />
              <FieldInput
                label="Description"
                value={description}
                onChangeText={(v) => setEdits((e) => ({ ...e, description: v }))}
                maxLength={SHOP_DESCRIPTION_MAX}
                placeholder="A short description for your shop page"
                multiline
                editable={busy === null}
                accessibilityLabel="Shop page description"
              />
              <Text style={styles.hint}>
                Your link will be /farms/{suggestedSlug}. You can change it after this step.
              </Text>
              {actionError ? (
                <Text style={styles.error} accessibilityRole="alert">{actionError}</Text>
              ) : null}
              <Button
                label="Start shop page draft"
                onPress={() => { void createDraft(); }}
                loading={busy === 'create'}
                disabled={busy !== null || !title.trim()}
                fullWidth
              />
            </View>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

/** A secondary action: outlined and 44 high, red for the two that remove something. */
function ActionButton({
  label, onPress, disabled, tone = 'plain',
}: { label: string; onPress: () => void; disabled?: boolean; tone?: 'plain' | 'danger' }) {
  return (
    <TouchableOpacity
      style={[styles.action, tone === 'danger' && styles.actionDanger, disabled && styles.actionOff]}
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={label.replace('…', '')}
    >
      <Text style={[styles.actionText, tone === 'danger' && styles.actionTextDanger]}>{label}</Text>
    </TouchableOpacity>
  );
}

/** A label, a box and its message, so the text fields on both cards look the same. */
function FieldInput({
  label, error, style, ...input
}: TextInputProps & { label: string; error?: string | null }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={[styles.input, input.multiline && styles.textArea, error ? styles.inputBad : null, style]}
        placeholderTextColor={Colors.textLight}
        {...input}
      />
      {error ? <Text style={styles.error} accessibilityRole="alert">{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: Colors.offWhite },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm, backgroundColor: Colors.white,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  back: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { fontSize: FontSize.xl, fontWeight: '800', color: Colors.text },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xxl },
  lead: { fontSize: FontSize.sm, color: Colors.textMuted, lineHeight: 20 },
  card: {
    backgroundColor: Colors.white, borderRadius: Radius.md, padding: Spacing.lg,
    gap: Spacing.sm, ...Shadow.sm,
  },
  cardTitle: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
  stateRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stateText: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  action: {
    minHeight: 44, paddingHorizontal: Spacing.lg, justifyContent: 'center',
    borderRadius: Radius.md, borderWidth: 1, borderColor: Colors.border, backgroundColor: Colors.white,
  },
  actionDanger: { borderColor: Colors.error },
  actionOff: { opacity: 0.5 },
  actionText: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  actionTextDanger: { color: Colors.error },
  banner: {
    height: 120, borderRadius: Radius.md, overflow: 'hidden',
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
  },
  bannerImg: { width: '100%', height: '100%' },
  bannerEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  emptyTitle: { fontSize: FontSize.sm, fontWeight: '700', color: Colors.text },
  overlay: {
    position: 'absolute', top: 0, right: 0, bottom: 0, left: 0,
    alignItems: 'center', justifyContent: 'center', gap: Spacing.xs,
    backgroundColor: 'rgba(17, 24, 39, 0.45)',
  },
  overlayText: { color: Colors.white, fontSize: FontSize.sm, fontWeight: '700' },
  chip: {
    position: 'absolute', right: Spacing.sm, bottom: Spacing.sm,
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    backgroundColor: 'rgba(17, 24, 39, 0.7)', borderRadius: Radius.full,
    paddingHorizontal: Spacing.sm, paddingVertical: Spacing.xs,
  },
  chipText: { color: Colors.white, fontSize: FontSize.xs, fontWeight: '700' },
  logoRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  logoBtn: {
    width: 72, height: 72, borderRadius: Radius.md, overflow: 'hidden',
    backgroundColor: Colors.surfaceAlt, borderWidth: 1, borderColor: Colors.border,
  },
  logo: { width: '100%', height: '100%' },
  logoEmpty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.xs },
  logoNote: { flex: 1, gap: Spacing.xs },
  field: { gap: Spacing.xs },
  label: { fontSize: FontSize.sm, fontWeight: '600', color: Colors.text },
  input: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    paddingHorizontal: Spacing.md, paddingVertical: 10, fontSize: FontSize.md,
    color: Colors.text, backgroundColor: Colors.white,
  },
  textArea: { minHeight: 96, textAlignVertical: 'top' },
  inputBad: { borderColor: Colors.error, backgroundColor: Colors.errorBg },
  slugRow: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 1, borderColor: Colors.border,
    borderRadius: Radius.md, backgroundColor: Colors.white, paddingHorizontal: Spacing.md,
  },
  slugPrefix: { fontSize: FontSize.sm, color: Colors.textMuted },
  slugInput: { flex: 1, paddingVertical: 10, fontSize: FontSize.md, color: Colors.text },
  hint: { fontSize: FontSize.xs, color: Colors.textMuted, lineHeight: 16 },
  hintStrong: { fontWeight: '700', color: Colors.text },
  error: { fontSize: FontSize.sm, color: Colors.error },
  muted: { fontSize: FontSize.sm, color: Colors.textMuted },
  body: { fontSize: FontSize.sm, color: Colors.text, lineHeight: 20 },
  preview: {
    borderWidth: 1, borderColor: Colors.border, borderRadius: Radius.md,
    overflow: 'hidden', backgroundColor: Colors.white,
  },
  previewBanner: { width: '100%', height: 84 },
  previewBannerEmpty: { width: '100%', height: 84, backgroundColor: Colors.primaryLight },
  previewBody: {
    flexDirection: 'row', alignItems: 'flex-start', gap: Spacing.sm, padding: Spacing.md,
  },
  previewLogo: {
    width: 44, height: 44, borderRadius: Radius.full, backgroundColor: Colors.surfaceAlt,
  },
  previewInfo: { flex: 1, gap: Spacing.xs },
  previewName: { fontSize: FontSize.md, fontWeight: '700', color: Colors.text },
});
