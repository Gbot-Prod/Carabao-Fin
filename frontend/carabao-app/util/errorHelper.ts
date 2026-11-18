type ApiErrorResponse = {
  response?: {
    status?: number;
    data?: unknown;
  };
};

function getApiErrorResponse(error: unknown): ApiErrorResponse | undefined {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return undefined;
  }

  return error as ApiErrorResponse;
}

export function getApiErrorStatus(error: unknown): number | undefined {
  return getApiErrorResponse(error)?.response?.status;
}

export function getApiErrorDetail(error: unknown): string | undefined {
  const response = getApiErrorResponse(error)?.response;

  if (
    typeof response?.data === "object" &&
    response.data !== null &&
    "detail" in response.data &&
    typeof response.data.detail === "string"
  ) {
    return response.data.detail;
  }

  if (typeof response?.data === "string" && response.data.trim()) {
    return response.data;
  }

  // CF-0053: FastAPI's 422 sends detail as a list of {loc, msg}. Show the first
  // one ("name: String should have at most 100 characters") instead of the
  // generic "Request failed with status code 422".
  if (typeof response?.data === "object" && response.data !== null && "detail" in response.data) {
    const detail = (response.data as { detail: unknown }).detail;
    if (Array.isArray(detail)) return validationMessage(detail);
  }

  return undefined;
}

function validationMessage(items: unknown[]): string | undefined {
  for (const item of items) {
    if (typeof item !== "object" || item === null) continue;
    const { loc, msg } = item as { loc?: unknown; msg?: unknown };
    if (typeof msg !== "string" || !msg.trim()) continue;
    // loc is ["body", "name"]; the last part names the field ("body" alone: none).
    const field = Array.isArray(loc) ? loc[loc.length - 1] : undefined;
    const name = typeof field === "string" && field !== "body" ? field.replace(/_/g, " ") : null;
    return name ? `${name}: ${msg}` : msg;
  }
  return undefined;
}

/** The backend refused because the account has no verified mobile number
 * (checkout, merchant applications, order chat). Show PhoneVerifyDialog, then retry. */
export function isPhoneVerificationRequired(error: unknown): boolean {
  return getApiErrorStatus(error) === 403 && getApiErrorDetail(error) === "PHONE_VERIFICATION_REQUIRED";
}

export default function getApiErrorMessage(error: unknown): string | undefined;
export default function getApiErrorMessage(
  error: unknown,
  fallback: string,
): string;
export default function getApiErrorMessage(
  error: unknown,
  fallback?: string,
): string | undefined {
  const detail = getApiErrorDetail(error);
  if (detail?.trim()) {
    return detail;
  }

  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  return fallback;
}
/** Per-field messages from a backend FieldErrors response
 * ({"detail", "errors": {field: message}}), or {} when there are none. */
export function getApiFieldErrors(error: unknown): Record<string, string> {
  const data = getApiErrorResponse(error)?.response?.data;
  if (typeof data !== "object" || data === null || !("errors" in data)) return {};
  const errors = (data as { errors: unknown }).errors;
  if (typeof errors !== "object" || errors === null) return {};
  return Object.fromEntries(
    Object.entries(errors).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
  );
}
