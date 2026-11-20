// CF-0002: receives CSP violation reports while the policy is Report-Only.
// Browsers send either the old "csp-report" body (report-uri) or a list of
// Reporting API objects (report-to). Only a short summary is logged.
// CF-0090: anyone can post here, so the body read is capped (also for chunked
// posts with no content-length), logged URLs have no query or fragment, and
// each server process logs at most LOG_BUDGET_PER_MINUTE reports a minute.

import { MAX_BODY_BYTES, createLogBudget, readCappedText, summarizeReports } from '@/lib/csp-report';

const budget = createLogBudget();

export async function POST(request: Request) {
  const length = Number(request.headers.get('content-length') ?? '0');
  if (length > MAX_BODY_BYTES) return new Response(null, { status: 413 });

  const text = await readCappedText(request.body, MAX_BODY_BYTES);
  if (text === null) return new Response(null, { status: 413 });

  let summaries;
  try {
    summaries = summarizeReports(JSON.parse(text));
  } catch {
    // A body that is not JSON is ignored.
    return new Response(null, { status: 204 });
  }

  const { allowed, droppedBefore } = budget.take(summaries.length, Date.now());
  if (droppedBefore > 0) {
    console.warn('[csp-report]', JSON.stringify({ dropped: droppedBefore }));
  }
  for (const s of summaries.slice(0, allowed)) {
    console.warn('[csp-report]', JSON.stringify(s));
  }
  return new Response(null, { status: 204 });
}
