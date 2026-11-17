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
