export type Screening = {
  id: string;
  title: string;
  fidikoUrl: string;
  ticketUrl: string | null;
  posterUrl: string | null;
  dateText: string;
  dateLabel: string;
  dateISO: string;
  weekday: string | null;
  time: string | null;
  description: string;
  formats: string[];
  hasSubtitles: boolean;
};

export type CsfdMatch = {
  title: string;
  rating: number | null;
  ratingCount: number | null;
  url: string | null;
  poster: string | null;
};

export type FilmGroup = {
  id: string;
  title: string;
  posterUrl: string | null;
  description: string;
  hasSubtitles: boolean;
  csfd: CsfdMatch | null;
  screenings: Screening[];
};

export type ViewMode = "week" | "all";
export type AppMode = "radar" | "program";

export type ScheduleResponse = {
  fetchedAt: string;
  totals: { films: number; screenings: number; withSubtitles: number };
  period: {
    mode: ViewMode;
    weekStart: string | null;
    weekEnd: string | null;
    previousWeekStart: string | null;
    nextWeekStart: string | null;
  };
  films: FilmGroup[];
};

export type RadarProvider = { id: number; name: string; logoUrl: string; url: string | null };
export type RadarProgramMatch = {
  filmId: string;
  firstScreeningDate: string;
  screeningCount: number;
  upcomingScreeningCount: number;
  nextScreening: { dateISO: string; time: string | null } | null;
};
export type RadarItem = {
  id: string;
  tmdbId: number;
  mediaType: "movie" | "series";
  channel: "cinema" | "streaming";
  title: string;
  originalTitle: string | null;
  overview: string;
  posterUrl: string | null;
  releaseDate: string;
  providers: RadarProvider[];
  watchUrl: string | null;
  csfd: CsfdMatch | null;
  program: RadarProgramMatch | null;
};

export type RadarResponse = {
  fetchedAt: string;
  period: {
    mode: "week";
    start: string;
    end: string;
    weekStart: string;
    weekEnd: string;
    previousWeekStart: string;
    nextWeekStart: string;
  };
  items: RadarItem[];
};

export type PageState = {
  mode: AppMode;
  view: ViewMode;
  week: string | null;
  day: string | null;
  query: string;
  subtitles: boolean;
  radarWeek: string | null;
  radarDay: string | null;
  filmId: string | null;
};

export type LoadState<T> = {
  status: "loading" | "ready" | "error";
  data: T | null;
  error: string | null;
  refreshing: boolean;
};

export type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};
