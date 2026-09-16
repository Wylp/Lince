import { describe, expect, it } from "vitest";
import { parseCodebases, ranked, schedule } from "./discovery";
import type { Repository } from "./discovery";
const repos = ["aaa/one", "zzz/frequent", "bbb/recent"].map((name) => ({
  name,
  owner: name.split("/")[0],
  private: false,
  language: null,
  topics: [],
})) satisfies Repository[];
describe("PR discovery", () => {
  it("prioritizes weighted review frequency, then recency, then name", () => {
    expect(
      ranked(repos, [
        { repo: "ZZZ/FREQUENT", score: 4, sessions: 8, lastReviewedAt: 10 },
        { repo: "bbb/recent", score: 1, sessions: 1, lastReviewedAt: 20 },
      ]).map((r) => r.name),
    ).toEqual(["zzz/frequent", "bbb/recent", "aaa/one"]);
    expect(ranked(repos, []).map((r) => r.name)).toEqual([
      "aaa/one",
      "bbb/recent",
      "zzz/frequent",
    ]);
  });
  it("parses nested paths and rejects labels without a path", () => {
    expect(
      parseCodebases("apps/api/ = API\n\n packages/auth = Autenticação"),
    ).toEqual([
      { path: "apps/api", label: "API" },
      { path: "packages/auth", label: "Autenticação" },
    ]);
    expect(() => parseCodebases("apps/api")).toThrow();
  });
  it("bounds discovery concurrency and skips work abandoned before it starts", async () => {
    let running = 0,
      peak = 0,
      calls = 0,
      current = true;
    const jobs = Array.from({ length: 6 }, () =>
      schedule(
        async () => {
          calls++;
          running++;
          peak = Math.max(peak, running);
          await new Promise((r) => setTimeout(r, 10));
          running--;
          return true;
        },
        () => current,
      ),
    );
    current = false;
    const results = await Promise.allSettled(jobs);
    expect(peak).toBe(3);
    expect(calls).toBe(3);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
  });
});
