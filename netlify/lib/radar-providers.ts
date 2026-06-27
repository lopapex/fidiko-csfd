export type ProviderLinkType = "search" | "homepage";

type ProviderDefinition = {
  aliases: RegExp;
  homepage: string;
  searchUrl?: (query: string) => string;
};

const PROVIDERS: ProviderDefinition[] = [
  {
    aliases: /^netflix$/,
    homepage: "https://www.netflix.com/cz/",
    searchUrl: (query) => `https://www.netflix.com/search?q=${query}`,
  },
  {
    aliases: /^disney(?: plus)?$/,
    homepage: "https://www.disneyplus.com/cs-cz",
  },
  {
    aliases: /^(?:amazon )?prime video(?: with ads)?$/,
    homepage: "https://www.primevideo.com/",
    searchUrl: (query) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${query}`,
  },
  {
    aliases: /^apple tv(?: plus)?$/,
    homepage: "https://tv.apple.com/cz",
    searchUrl: (query) => `https://tv.apple.com/cz/search?term=${query}`,
  },
  {
    aliases: /^(?:i?prima)(?: plus)?$/,
    homepage: "https://www.iprima.cz/",
    searchUrl: (query) => `https://www.iprima.cz/vyhledavani?query=${query}`,
  },
  {
    aliases: /^(?:hbo )?max$/,
    homepage: "https://play.hbomax.com/",
    searchUrl: (query) => `https://play.hbomax.com/search/result?q=${query}`,
  },
  {
    aliases: /^oneplay$/,
    homepage: "https://www.oneplay.cz/",
    searchUrl: (query) => `https://www.oneplay.cz/vyhledat?query=${query}`,
  },
  {
    aliases: /^skyshowtime$/,
    homepage: "https://www.skyshowtime.com/cz",
  },
];

export function isAllowedProvider(name: string) {
  return Boolean(findProvider(name));
}

export function getProviderLink(name: string, title?: string) {
  const provider = findProvider(name);
  if (!provider) return { url: null, linkType: undefined } as const;

  const searchTitle = normalizeSearchTitle(title);
  if (provider.searchUrl && searchTitle) {
    return {
      url: provider.searchUrl(encodeURIComponent(searchTitle)),
      linkType: "search",
    } as const;
  }

  return { url: provider.homepage, linkType: "homepage" } as const;
}

function findProvider(name: string) {
  const normalized = normalizeProviderName(name);
  return PROVIDERS.find((provider) => provider.aliases.test(normalized));
}

function normalizeSearchTitle(title?: string) {
  return title
    ?.replace(/\s*-\s*(?:série|serie|season)\s+\d+\s*$/iu, "")
    .trim() || null;
}

function normalizeProviderName(name: string) {
  return name
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
