export function isAllowedProvider(name: string) {
  const normalized = normalizeProviderName(name);
  return [
    /^oneplay$/,
    /^(?:i?prima)(?: plus)?$/,
    /^disney(?: plus)?$/,
    /^skyshowtime$/,
    /^apple tv(?: plus)?$/,
    /^(?:amazon )?prime video(?: with ads)?$/,
    /^(?:hbo )?max$/,
    /^netflix$/,
  ].some((pattern) => pattern.test(normalized));
}

export function getProviderUrl(name: string, title?: string) {
  const normalized = normalizeProviderName(name);
  const searchTitle = title
    ?.replace(/\s*-\s*(?:série|serie|season)\s+\d+\s*$/iu, "")
    .trim();
  const query = searchTitle ? encodeURIComponent(searchTitle) : null;

  if (query) {
    if (/^netflix$/.test(normalized)) {
      return `https://www.netflix.com/search?q=${query}`;
    }
    if (/^disney(?: plus)?$/.test(normalized)) {
      return `https://www.disneyplus.com/search?q=${query}`;
    }
    if (/^(?:amazon )?prime video(?: with ads)?$/.test(normalized)) {
      return `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${query}`;
    }
    if (/^apple tv(?: plus)?$/.test(normalized)) {
      return `https://tv.apple.com/cz/search?term=${query}`;
    }
    if (/^(?:i?prima)(?: plus)?$/.test(normalized)) {
      return `https://www.iprima.cz/vyhledavani?query=${query}`;
    }
    if (/^(?:hbo )?max$/.test(normalized)) {
      return `https://play.hbomax.com/search/result?q=${query}`;
    }
    if (/^oneplay$/.test(normalized)) {
      return `https://www.oneplay.cz/vyhledat?query=${query}`;
    }
  }

  const providers: Array<[RegExp, string]> = [
    [/^netflix$/, "https://www.netflix.com/cz/"],
    [/^(?:hbo )?max$/, "https://www.max.com/cz/cs"],
    [/^disney(?: plus)?$/, "https://www.disneyplus.com/cs-cz"],
    [/^(?:amazon )?prime video(?: with ads)?$/, "https://www.primevideo.com/"],
    [/^apple tv(?: plus)?$/, "https://tv.apple.com/cz"],
    [/^skyshowtime$/, "https://www.skyshowtime.com/cz"],
    [/^oneplay$/, "https://www.oneplay.cz/"],
    [/^(?:i?prima)(?: plus)?$/, "https://www.iprima.cz/"],
  ];
  return providers.find(([pattern]) => pattern.test(normalized))?.[1] ?? null;
}

function normalizeProviderName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
