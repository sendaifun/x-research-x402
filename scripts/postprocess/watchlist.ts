/**
 * Shared watchlist loader for postprocess scripts.
 * Loads from data/watchlist.default.json + data/watchlist.json (user overrides).
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const DATA_DIR = join(import.meta.dir, "..", "..", "data");

export function loadWatchlistSet(): Set<string> {
  const usernames = new Set<string>();

  for (const file of ["watchlist.default.json", "watchlist.json"]) {
    const fp = join(DATA_DIR, file);
    if (!existsSync(fp)) continue;
    try {
      const data = JSON.parse(readFileSync(fp, "utf-8"));
      if (data.categories) {
        for (const [, info] of Object.entries(data.categories) as [string, any][]) {
          for (const account of info.accounts || []) {
            const username = (typeof account === "string" ? account : account.username)
              ?.toLowerCase().replace("@", "");
            if (username) usernames.add(username);
          }
        }
      }
    } catch {}
  }

  return usernames;
}
