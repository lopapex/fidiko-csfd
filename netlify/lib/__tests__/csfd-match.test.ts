import { describe, expect, it, vi } from "vitest";
import type { CSFDMovie, CSFDSearchMovie } from "node-csfd-api";
import { CsfdUnavailableError, isUsableSearchResult, type CsfdClient } from "../csfd-client";
import { buildCsfdQueries, resolveCsfdTitle, titleSimilarity } from "../csfd-match";

const found = (id: number, title: string, year: number, type = "film", origins: string[] = []) =>
  ({ id, title, year, type, origins, url: `https://www.csfd.cz/film/${id}/prehled/` }) as CSFDSearchMovie;

const page = (id: number, title: string, titlesOther: string[] = [], rating: number | null = 80) =>
  ({
    id,
    title,
    rating,
    ratingCount: 100,
    url: `https://www.csfd.cz/film/${id}/prehled/`,
    titlesOther: titlesOther.map((other) => ({ country: "USA", title: other })),
    origins: [],
  }) as unknown as CSFDMovie;

/** A fake ČSFD: search results per query, detail pages per id. */
const fakeCsfd = (
  searches: Record<string, { movies?: CSFDSearchMovie[]; tvSeries?: CSFDSearchMovie[] }>,
  pages: Record<number, CSFDMovie> = {},
): CsfdClient & { search: ReturnType<typeof vi.fn>; movie: ReturnType<typeof vi.fn> } => ({
  search: vi.fn(async (query: string) => ({
    movies: searches[query]?.movies ?? [],
    tvSeries: searches[query]?.tvSeries ?? [],
  })),
  movie: vi.fn(async (id: number) => {
    if (!pages[id]) throw new CsfdUnavailableError(`no page ${id}`);
    return pages[id];
  }),
});

describe("title similarity", () => {
  it.each([
    ["Villeneuve: Zrození šampióna", "Villeneuve: Zrození šampiona", 100],
    ["The Hawk", "Hawk", 96],
    ["Fanny a Alexandr", "Fanny a Alexander", 94],
    ["Ovečka Shaun: Příšera z Mossy Bottom", "Ovečka Shaun ve filmu: Příšera z Mossy Bottom", 78],
    ["Wildwood: Tajemství zakázaného lesa", "Wildwood", 72],
    ["Vlny", "Vlny - Den boje za svobodu a demokracii", 72],
  ])("%s ~ %s = %i", (candidate, query, expected) => {
    expect(titleSimilarity(candidate, query)).toBe(expected);
  });

  it.each([
    ["Inspektor Hawk", "Hawk"],
    ["Vlny života", "Vlny"],
    ["Rocky IV", "Rocky V"],
    ["Avengers 2", "Avengers 3"],
  ])("does not confuse %s with %s", (candidate, query) => {
    expect(titleSimilarity(candidate, query)).toBeLessThan(72);
  });
});

describe("search queries", () => {
  it("falls back to the title without its subtitle", () => {
    expect(buildCsfdQueries(["Vlny - Den boje za svobodu a demokracii"])).toEqual([
      "Vlny - Den boje za svobodu a demokracii",
      "Vlny",
    ]);
  });

  it("asks for every distinct title once", () => {
    expect(buildCsfdQueries(["Wildwood", "wildwood", null, "Wildwood: Tajemství zakázaného lesa"])).toEqual([
      "Wildwood",
      "Wildwood: Tajemství zakázaného lesa",
    ]);
  });
});

describe("pairing a title with CSFD", () => {
  it("pairs Wildwood with its subtitled CSFD entry through the original title", async () => {
    const client = fakeCsfd(
      {
        Wildwood: {
          movies: [
            found(1433132, "Wildwood: Tajemství zakázaného lesa", 2026, "film", ["USA"]),
            found(881896, "Wildwood, NJ", 1994),
            found(1804521, "Wildwood: Where Magic Takes Flight", 2025),
          ],
        },
      },
      { 1433132: page(1433132, "Wildwood: Tajemství zakázaného lesa", ["Wildwood"], 92) },
    );

    const outcome = await resolveCsfdTitle({ titles: ["Wildwood"], kind: "movie", year: 2026 }, client);

    expect(outcome.status).toBe("matched");
    expect(outcome.status === "matched" && outcome.candidate.id).toBe(1433132);
    expect(outcome.status === "matched" && outcome.details?.rating).toBe(92);
  });

  it("prefers the film over a stage recording that happens to share the exact spelling", async () => {
    const client = fakeCsfd(
      {
        "Fanny a Alexander": {
          movies: [
            found(692, "Fanny a Alexandr", 1982, "film", ["Švédsko", "Francie"]),
            found(848023, "Fanny a Alexander", 2016, "theatrical", ["Slovensko"]),
          ],
        },
      },
      { 692: page(692, "Fanny a Alexandr", ["Fanny och Alexander"]), 848023: page(848023, "Fanny a Alexander") },
    );

    const outcome = await resolveCsfdTitle({ titles: ["Fanny a Alexander"], kind: "movie", currentYear: 2026 }, client);

    expect(outcome.status === "matched" && outcome.candidate.id).toBe(692);
  });

  it("uses the country to tell films of the same name apart", async () => {
    const client = fakeCsfd(
      {
        Vlny: {
          movies: [
            found(439978, "Vlny", 2016, "film", ["Polsko"]),
            found(859177, "Vlny", 2024, "film", ["Česko", "Slovensko"]),
            found(667871, "Vlny života", 2019, "film", ["USA"]),
          ],
        },
      },
      { 859177: page(859177, "Vlny"), 439978: page(439978, "Vlny") },
    );

    const outcome = await resolveCsfdTitle(
      { titles: ["Vlny"], kind: "movie", countries: ["Česká republika", "Thriller", "12+"], currentYear: 2026 },
      client,
    );

    expect(outcome.status === "matched" && outcome.candidate.id).toBe(859177);
  });

  it("does not take a longer title for a one-word query without any other agreement", async () => {
    const client = fakeCsfd({ Vlny: { movies: [found(667871, "Vlny života", 2019, "film", ["USA"])] } });

    const outcome = await resolveCsfdTitle(
      { titles: ["Vlny"], kind: "movie", countries: ["Česká republika"], currentYear: 2026 },
      client,
    );

    expect(outcome.status).toBe("not_found");
  });

  it("finds a film listed under another language through its alternative titles", async () => {
    const client = fakeCsfd(
      { "The Death of Robin Hood": { movies: [found(1515925, "Smrt Robina Hooda", 2026)] } },
      { 1515925: page(1515925, "Smrt Robina Hooda", ["The Death of Robin Hood"]) },
    );

    const outcome = await resolveCsfdTitle({ titles: ["The Death of Robin Hood"], kind: "movie", year: 2026 }, client);

    expect(outcome.status === "matched" && outcome.candidate.id).toBe(1515925);
  });

  it("keeps a re-released classic even though its year is far from the new premiere", async () => {
    const client = fakeCsfd(
      { "Po stopách krve": { movies: [found(8197, "Po stopách krve", 1969)] } },
      { 8197: page(8197, "Po stopách krve") },
    );

    const outcome = await resolveCsfdTitle({ titles: ["Po stopách krve"], kind: "movie", year: 2026 }, client);

    expect(outcome.status).toBe("matched");
  });

  it("finds the film again after the source adds an event to the title", async () => {
    const client = fakeCsfd(
      { Vlny: { movies: [found(859177, "Vlny", 2024, "film", ["Česko"])] } },
      { 859177: page(859177, "Vlny") },
    );

    const outcome = await resolveCsfdTitle(
      { titles: ["Vlny - Den boje za svobodu a demokracii"], kind: "movie", currentYear: 2026 },
      client,
    );

    expect(client.search).toHaveBeenCalledTimes(2);
    expect(outcome.status === "matched" && outcome.candidate.id).toBe(859177);
  });

  it("still pairs an exact title when the detail page cannot be loaded", async () => {
    const client = fakeCsfd({ "Avengers: Doomsday": { movies: [found(1219917, "Avengers: Doomsday", 2026)] } });

    const outcome = await resolveCsfdTitle({ titles: ["Avengers: Doomsday"], kind: "movie", year: 2026 }, client);

    expect(outcome.status).toBe("matched");
    expect(outcome.status === "matched" && outcome.details).toBeNull();
  });

  it("reports an outage as an error, never as a missing title", async () => {
    const client = fakeCsfd({});
    client.search.mockRejectedValue(new CsfdUnavailableError("blocked"));

    await expect(resolveCsfdTitle({ titles: ["Wildwood"], kind: "movie", year: 2026 }, client)).resolves.toEqual({
      status: "error",
    });
  });

  it("reports an unverifiable guess as an error when the detail page is down", async () => {
    const client = fakeCsfd({ "The Death of Robin Hood": { movies: [found(1515925, "Smrt Robina Hooda", 2026)] } });

    await expect(
      resolveCsfdTitle({ titles: ["The Death of Robin Hood"], kind: "movie", year: 2026 }, client),
    ).resolves.toEqual({ status: "error" });
  });

  it("says not found only when CSFD answered and nothing fits", async () => {
    const client = fakeCsfd({ "Hybe Cheering Party": { movies: [found(1, "Úplně jiný film", 2001)] } });

    await expect(
      resolveCsfdTitle({ titles: ["Hybe Cheering Party"], kind: "movie", year: 2026 }, client),
    ).resolves.toEqual({ status: "not_found" });
  });
});

describe("CSFD client", () => {
  it("treats a page with no results of any kind as a failed request", () => {
    expect(isUsableSearchResult({ movies: [], tvSeries: [], creators: [], users: [] })).toBe(false);
    expect(isUsableSearchResult({ movies: [], tvSeries: [], creators: [], users: [{}] })).toBe(true);
  });
});
