/**
 * Shared stdin reader for postprocess scripts.
 * Reads JSON from stdin (piped hosted API response).
 */

import type { Tweet } from "../../lib/api";

export interface HostedResponse {
  data: Tweet | Tweet[];
  meta: Record<string, unknown>;
  usage?: Record<string, unknown>;
}

export async function readStdin(): Promise<HostedResponse> {
  const chunks: Buffer[] = [];
  for await (const chunk of Bun.stdin.stream()) {
    chunks.push(Buffer.from(chunk));
  }
  const raw = Buffer.concat(chunks).toString("utf-8").trim();
  if (!raw) {
    console.error("Error: no input. Pipe a hosted API JSON response to stdin.");
    process.exit(1);
  }
  try {
    return JSON.parse(raw);
  } catch {
    console.error("Error: invalid JSON on stdin.");
    process.exit(1);
  }
}

/** Normalize .data to always be an array of tweets */
export function toTweets(response: HostedResponse): Tweet[] {
  if (Array.isArray(response.data)) return response.data;
  if (response.data && typeof response.data === "object") return [response.data as Tweet];
  return [];
}
