// CF-0113: write or edit the review of a delivered order (web orders/[orderId]).
import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import { checkReview, REVIEW_COMMENT_MAX, starLabel } from '../lib/reviewForm';
import { Colors, Spacing, Radius, FontSize } from '../lib/theme';
import { Button } from './UI';

type Props = {
  initialRating?: number | null;
  initialComment?: string | null;
  submitLabel: string;
  /** Resolves when saved; rejects with the server's message. */
  onSubmit: (body: { rating: number; comment: string | null }) => Promise<void>;
  onCancel?: () => void;
};

export function OrderReviewForm({ initialRating = null, initialComment = '', submitLabel, onSubmit, onCancel }: Props) {
  const [rating, setRating] = useState<number | null>(initialRating);
  const [comment, setComment] = useState(initialComment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const r = checkReview(rating, comment);
    if ('error' in r) return setError(r.error);
    setError(null);
    setSaving(true);
    try {
      await onSubmit(r.ok);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save your review.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <View style={styles.stars} accessibilityRole="radiogroup" accessibilityLabel="Rating">
        {[1, 2, 3, 4, 5].map((n) => {
          const on = rating !== null && n <= rating;
          return (
            <TouchableOpacity
              key={n}
              style={styles.star}
              onPress={() => setRating(n)}
              accessibilityRole="radio"
              accessibilityLabel={starLabel(n)}
              accessibilityState={{ checked: rating === n }}
            >
              <Text style={[styles.starText, on && styles.starOn]}>{on ? '★' : '☆'}</Text>
            </TouchableOpacity>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        value={comment}
        onChangeText={setComment}
        placeholder="What was good? What could be better? (optional)"
        placeholderTextColor={Colors.textLight}
        multiline
        maxLength={REVIEW_COMMENT_MAX + 50}
        accessibilityLabel="Review comment"
      />
      <Text style={styles.count}>{comment.trim().length} / {REVIEW_COMMENT_MAX}</Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
      <View style={styles.actions}>
        {onCancel && (
          <TouchableOpacity style={styles.cancel} onPress={onCancel} disabled={saving}>
            <Text style={styles.cancelText}>Cancel</Text>
          </TouchableOpacity>
        )}
        <Button label={submitLabel} onPress={submit} loading={saving} disabled={rating === null} style={{ flex: 1 }} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: Spacing.sm },
  stars: { flexDirection: 'row', gap: Spacing.xs },
  star: { minWidth: 44, minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  starText: { fontSize: 30, color: Colors.textLight },
  starOn: { color: Colors.warning },
  input: {
    minHeight: 96, textAlignVertical: 'top', borderWidth: 1.5, borderColor: Colors.border, borderRadius: Radius.md,
    padding: Spacing.md, fontSize: FontSize.sm, color: Colors.text, backgroundColor: Colors.surfaceAlt,
  },
  count: { fontSize: FontSize.xs, color: Colors.textMuted, textAlign: 'right' },
  error: { fontSize: FontSize.sm, color: Colors.error },
  actions: { flexDirection: 'row', gap: Spacing.md, alignItems: 'center' },
  cancel: { flex: 1, minHeight: 48, alignItems: 'center', justifyContent: 'center', borderRadius: Radius.md, borderWidth: 1.5, borderColor: Colors.border },
  cancelText: { fontSize: FontSize.md, color: Colors.textMuted, fontWeight: '600' },
});
