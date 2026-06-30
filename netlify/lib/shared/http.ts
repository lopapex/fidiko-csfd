export const jsonResponse = (
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...extraHeaders,
    },
  });

export const noContentResponse = () => new Response(null, { status: 204 });

export const errorJsonResponse = (
  body: unknown,
  status: number,
  extraHeaders: HeadersInit = {},
) => jsonResponse(body, status, extraHeaders);

export const cachedJsonResponse = ({
  body,
  cacheStatus,
  cacheHeader,
  timingHeader,
  extraHeaders = {},
}: {
  body: unknown;
  cacheStatus?: { name: string; value: string };
  cacheHeader: { maxAgeSeconds: number } | { noStore: true };
  timingHeader?: string;
  extraHeaders?: HeadersInit;
}) => {
  const headers = new Headers(extraHeaders);
  headers.set("content-type", "application/json; charset=utf-8");
  if ("noStore" in cacheHeader) {
    headers.set("cache-control", "no-store");
  } else {
    headers.set("cache-control", `public, max-age=${cacheHeader.maxAgeSeconds}`);
    headers.set("netlify-cdn-cache-control", `public, s-maxage=${cacheHeader.maxAgeSeconds}`);
  }
  if (timingHeader) {
    headers.set("server-timing", timingHeader);
  }
  if (cacheStatus) {
    headers.set(cacheStatus.name, cacheStatus.value);
  }

  return new Response(JSON.stringify(body), {
    status: 200,
    headers,
  });
};

export const serverTimingHeader = (timings: Record<string, number | null | undefined>) =>
  Object.entries(timings)
    .filter(([, duration]) => typeof duration === "number" && duration > 0)
    .map(([name, duration]) => `${name};dur=${duration!.toFixed(1)}`)
    .join(", ");

export const isPragueMidnight = () => {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  return hour === "00";
};
