import type {
  CsfdMatch,
  CsfdRating,
  FilmGroup,
  RadarItem,
  RadarResponse,
  ScheduleResponse,
} from "./types";

export function collectScheduleCsfdUrls(schedule: ScheduleResponse | null) {
  return uniqueCsfdUrls(schedule?.films.map(film => film.csfd?.url) ?? []);
}

export function collectRadarCsfdUrls(radar: RadarResponse | null) {
  return uniqueCsfdUrls(radar?.items.map(item => item.csfd?.url) ?? []);
}

export function applyLiveRatingsToFilms(
  films: FilmGroup[],
  ratings: Record<string, CsfdRating>,
) {
  return films.map(film => ({
    ...film,
    csfd: patchCsfdRating(film.csfd, ratings),
  }));
}

export function applyLiveRatingsToRadarItems(
  items: RadarItem[],
  ratings: Record<string, CsfdRating>,
) {
  return items.map(item => ({
    ...item,
    csfd: patchCsfdRating(item.csfd, ratings),
  }));
}

function uniqueCsfdUrls(urls: Array<string | null | undefined>) {
  return [...new Set(urls.filter((url): url is string => Boolean(url)))];
}

function patchCsfdRating(csfd: CsfdMatch | null, ratings: Record<string, CsfdRating>) {
  if (!csfd?.url) return csfd;
  const rating = ratings[csfd.url];
  return rating ? { ...csfd, ...rating } : csfd;
}
