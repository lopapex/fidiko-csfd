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

export const isPragueMidnight = () => {
  const hour = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Prague",
    hour: "2-digit",
    hourCycle: "h23",
  }).format(new Date());
  return hour === "00";
};
