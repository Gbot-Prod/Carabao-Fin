import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

// Reads auth.handler per request: lib/auth.ts makes Better Auth on first use,
// not while `next build` loads this module.
export const { GET, POST } = toNextJsHandler((request: Request) => auth.handler(request));
