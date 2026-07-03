export type ProviderLinkType = "search" | "homepage";

type ProviderDefinition = {
  id: number;
  name: string;
  aliases: RegExp;
  homepage: string;
  logoPath: string;
  searchUrl?: (query: string) => string;
  mobileUrl?: string;
};

const PROVIDERS: ProviderDefinition[] = [
  {
    id: 8,
    name: "Netflix",
    aliases: /^netflix$/,
    homepage: "https://www.netflix.com/cz/",
    logoPath: "/pbpMk2JmcoNnQwx5JGpXngfoWtp.jpg",
    searchUrl: (query) => `https://www.netflix.com/search?q=${query}`,
    mobileUrl: "https://www.netflix.com/cz/",
  },
  {
    id: 337,
    name: "Disney Plus",
    aliases: /^disney(?: plus)?$/,
    homepage: "https://www.disneyplus.com/cs-cz",
    logoPath: "/97yvRBw1GzX7fXprcF80er19ot.jpg",
    mobileUrl: "https://www.disneyplus.com/cs-cz",
  },
  {
    id: 119,
    name: "Prime Video",
    aliases: /^(?:amazon )?prime video(?: with ads)?$/,
    homepage: "https://www.primevideo.com/",
    logoPath: "/pvske1MyAoymrs5bguRfVqYiM9a.jpg",
    searchUrl: (query) => `https://www.primevideo.com/search/ref=atv_nb_sr?phrase=${query}`,
    mobileUrl: "https://www.primevideo.com/",
  },
  {
    id: 350,
    name: "Apple TV Plus",
    aliases: /^apple tv(?: plus)?$/,
    homepage: "https://tv.apple.com/cz",
    logoPath: "/mcbz1LgtErU9p4UdbZ0rG6RTWHX.jpg",
    searchUrl: (query) => `https://tv.apple.com/cz/search?term=${query}`,
    mobileUrl: "https://tv.apple.com/cz",
  },
  {
    id: 1928,
    name: "Prima Plus",
    aliases: /^(?:i?prima)(?: plus)?$/,
    homepage: "https://www.iprima.cz/",
    logoPath: "/vrefjVylvD4RkEjQguuXebCp9UQ.jpg",
    searchUrl: (query) => `https://www.iprima.cz/vyhledavani?query=${query}`,
    mobileUrl: "https://www.iprima.cz/",
  },
  {
    id: 1899,
    name: "HBO Max",
    aliases: /^(?:hbo )?max$/,
    homepage: "https://play.hbomax.com/",
    logoPath: "/jbe4gVSfRlbPTdESXhEKpornsfu.jpg",
    searchUrl: (query) => `https://play.hbomax.com/search/result?q=${query}`,
    mobileUrl: "https://play.hbomax.com/",
  },
  {
    id: 2536,
    name: "Oneplay",
    aliases: /^oneplay$/,
    homepage: "https://www.oneplay.cz/",
    logoPath: "/rqjfOJNuH6W5wwSvaBaMOZdDX5w.jpg",
    searchUrl: (query) => `https://www.oneplay.cz/vyhledat?query=${query}`,
    mobileUrl: "https://www.oneplay.cz/",
  },
  {
    id: 1773,
    name: "SkyShowtime",
    aliases: /^skyshowtime$/,
    homepage: "https://www.skyshowtime.com/cz",
    logoPath: "/h0ZYcYHicKQ4Ixm5nOjqvwni5NG.jpg",
    mobileUrl: "https://www.skyshowtime.com/cz",
  },
];

export function isAllowedProvider(name: string) {
  return Boolean(normalizeProviderName(name));
}

export function getProviderLink(name: string, title?: string) {
  const provider = findProvider(name);
  if (!provider) return { url: null, linkType: undefined } as const;

  const searchTitle = normalizeSearchTitle(title);
  if (provider.searchUrl && searchTitle) {
    return {
      url: provider.searchUrl(encodeURIComponent(searchTitle)),
      linkType: "search",
      mobileUrl: provider.mobileUrl,
      mobileLinkType: provider.mobileUrl ? "homepage" : undefined,
    } as const;
  }

  return {
    url: provider.homepage,
    linkType: "homepage",
    mobileUrl: provider.mobileUrl ?? provider.homepage,
    mobileLinkType: "homepage",
  } as const;
}

export function getProviderMetadata(name: string) {
  const provider = findProvider(name);
  if (!provider) {
    const normalized = normalizeProviderName(name);
    if (!normalized) return null;
    return {
      id: createFallbackProviderId(normalized),
      name: name.trim(),
      logoPath: null,
    };
  }
  return {
    id: provider.id,
    name: provider.name,
    logoPath: provider.logoPath,
  };
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

const createFallbackProviderId = (normalized: string) => {
  let hash = 0;
  for (let index = 0; index < normalized.length; index += 1) {
    hash = (hash * 31 + normalized.charCodeAt(index)) >>> 0;
  }
  return -Math.max(1, hash);
};
