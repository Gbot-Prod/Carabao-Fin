import { auth } from "@/lib/auth";
import { toNextJsHandler } from "better-auth/next-js";

export const POST = toNextJsHandler(auth.handler);
export const GET = toNextJsHandler(auth.handler);
