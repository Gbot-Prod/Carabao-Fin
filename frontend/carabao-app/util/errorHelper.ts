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