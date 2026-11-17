/**
 * Site standard for form errors: the field's container gets `invalidClass(msg)`
 * and this message sits directly under the field. Link the input to it with
 * `aria-describedby={fieldErrorId(id)}` and `aria-invalid`.
 * Styles live in app/globals.css (.field-invalid, .field-error).
 */

export type FieldErrors<K extends string = string> = Partial<Record<K, string>>;

export const fieldErrorId = (id: string) => `${id}-error`;

/** " field-invalid" when there is a message, for the field's container. */
export const invalidClass = (message?: string | null) => (message ? " field-invalid" : "");

/** Props that tie an input to its FieldError. */
export const invalidProps = (id: string, message?: string | null) =>
  message ? { "aria-invalid": true as const, "aria-describedby": fieldErrorId(id) } : {};

/** Scroll to and focus the first invalid field on the page. */
export function focusFirstInvalid() {
  const field = document.querySelector<HTMLElement>(".field-invalid");
  if (!field) return;
  field.scrollIntoView({ behavior: "smooth", block: "center" });
  field.querySelector<HTMLElement>("input:not([type=file]), select, textarea, button")?.focus({ preventScroll: true });
}

export default function FieldError({ id, message }: { id: string; message?: string | null }) {
  if (!message) return null;
  return (
    <p id={fieldErrorId(id)} className="field-error" role="alert">
      {message}
    </p>
  );
}
