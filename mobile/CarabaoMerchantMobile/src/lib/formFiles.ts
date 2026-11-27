// src/lib/formFiles.ts
// Expo 58 replaces the global fetch with expo/fetch (expo/src/winter/runtime.native.ts). Its
// FormData encoder does not take React Native's { uri, name, type } file part: it throws
// "Unsupported FormDataPart implementation" and nothing is sent. This copies the form and
// gives each file part a bytes() reader (expo-file-system), which the encoder takes.
// In the browser preview the FormData has already turned the part into "[object Object]",
// so there is no { uri } part here and the body goes unchanged (the server answers 422).
import { File } from 'expo-file-system';

type UriPart = { uri: string; name?: string; type?: string };

function isUriPart(value: unknown): value is UriPart {
  return typeof value === 'object' && value !== null && typeof (value as UriPart).uri === 'string';
}

/** The body with each { uri } file part made readable for fetch; other bodies unchanged. */
export async function withFileBytes<B>(body: B): Promise<B> {
  if (!(body instanceof FormData)) return body;
  const entries = [...(body as unknown as Iterable<[string, unknown]>)];
  if (!entries.some(([, value]) => isUriPart(value))) return body;
  const form = new FormData();
  for (const [name, value] of entries) {
    if (isUriPart(value)) {
      const file = new File(value.uri);
      const part = { name: value.name ?? file.name, type: value.type, bytes: () => file.bytes() };
      form.append(name, part as unknown as Blob);
    } else {
      form.append(name, value as string | Blob);
    }
  }
  return form as unknown as B;
}
