export type ProviderLinkType = "search" | "homepage";

type ProviderDefinition = {
  id: number;
  name: string;
  aliases: RegExp;
  homepage?: string;
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
  { id: 381, name: "Canal+", aliases: /^canal plus$|^canal$/, homepage: "https://www.canalplus.com/cz/", logoPath: "/geOzgeKZWpZC3lymAVEHVIk3X0q.jpg", mobileUrl: "https://www.canalplus.com/cz/" },
  { id: 1939, name: "Lepsi TV", aliases: /^lepsi tv$|^lepsi\.tv$/, homepage: "https://www.lepsitv.cz/", logoPath: "/489t5n9o1KhH7voGNQkrXT7vBKV.jpg", mobileUrl: "https://www.lepsitv.cz/" },
  { id: 11, name: "MUBI", aliases: /^mubi$/, homepage: "https://mubi.com/", logoPath: "/x570VpH2C9EKDf1riP83rYc5dnL.jpg", mobileUrl: "https://mubi.com/" },
  { id: 35, name: "Rakuten TV", aliases: /^rakuten tv$/, homepage: "https://rakuten.tv/cz", logoPath: "/bZvc9dXrXNly7cA0V4D9pR8yJwm.jpg", mobileUrl: "https://rakuten.tv/cz" },
  { id: 283, name: "Crunchyroll", aliases: /^crunchyroll$/, homepage: "https://www.crunchyroll.com/", logoPath: "/fzN5Jok5Ig1eJ7gyNGoMhnLSCfh.jpg", mobileUrl: "https://www.crunchyroll.com/" },
  { id: 701, name: "FilmBox+", aliases: /^filmbox(?: plus)?$/, homepage: "https://www.filmbox.com/", logoPath: "/fbveJTcro9Xw2KuPIIoPPePHiwy.jpg", mobileUrl: "https://www.filmbox.com/" },
  { id: 538, name: "Plex", aliases: /^plex$/, homepage: "https://watch.plex.tv/", logoPath: "/vLZKlXUNDcZR7ilvfY9Wr9k80FZ.jpg", mobileUrl: "https://watch.plex.tv/" },
  { id: 2285, name: "JustWatch TV", aliases: /^justwatch tv$/, homepage: "https://www.justwatch.com/cz", logoPath: "/g2IaWyo6jCY0rIFjb4qgZ0bSmm3.jpg", mobileUrl: "https://www.justwatch.com/cz" },
  { id: 223, name: "Hayu", aliases: /^hayu$/, homepage: "https://www.hayu.com/", logoPath: "/jxIBXlxRbCcy7Y4GvOZKszCd0dv.jpg", mobileUrl: "https://www.hayu.com/" },
  { id: 190, name: "Curiosity Stream", aliases: /^curiosity stream$/, homepage: "https://curiositystream.com/", logoPath: "/oR1aNm1Qu9jQBkW4VrGPWhqbC3P.jpg", mobileUrl: "https://curiositystream.com/" },
  { id: 546, name: "WOW Presents Plus", aliases: /^wow presents plus$/, homepage: "https://www.wowpresentsplus.com/", logoPath: "/6dET59jNU0ADysghEjl8Unuc7Ca.jpg", mobileUrl: "https://www.wowpresentsplus.com/" },
  { id: 551, name: "Magellan TV", aliases: /^magellan tv$/, homepage: "https://www.magellantv.com/", logoPath: "/mSH24WQcRDJ2fsL5iucXqqRnSRb.jpg", mobileUrl: "https://www.magellantv.com/" },
  { id: 554, name: "BroadwayHD", aliases: /^broadwayhd$/, homepage: "https://www.broadwayhd.com/", logoPath: "/6IYZ4NjwPikxN7J9cfSmuyeHeMm.jpg", mobileUrl: "https://www.broadwayhd.com/" },
  { id: 559, name: "Filmzie", aliases: /^filmzie$/, homepage: "https://filmzie.com/", logoPath: "/eUBxtrqO26wAJfYOZJOzhQEo3mm.jpg", mobileUrl: "https://filmzie.com/" },
  { id: 569, name: "DocAlliance Films", aliases: /^docalliance films$/, homepage: "https://dafilms.com/", logoPath: "/vbXJBJVv3u3YWt6ml0l0ldDblXT.jpg", mobileUrl: "https://dafilms.com/" },
  { id: 692, name: "Cultpix", aliases: /^cultpix$/, homepage: "https://www.cultpix.com/", logoPath: "/uauVx3dGWt0GICqdMCBYJObd3Mo.jpg", mobileUrl: "https://www.cultpix.com/" },
  { id: 309, name: "Sun Nxt", aliases: /^sun nxt$/, homepage: "https://www.sunnxt.com/", logoPath: "/6KEQzITx2RrCAQt5Nw9WrL1OI8z.jpg", mobileUrl: "https://www.sunnxt.com/" },
  { id: 315, name: "Hoichoi", aliases: /^hoichoi$/, homepage: "https://www.hoichoi.tv/", logoPath: "/u7dwMceEbjxd1N3TLEUBILSK2x6.jpg", mobileUrl: "https://www.hoichoi.tv/" },
  { id: 15, name: "Hulu", aliases: /^hulu$/, logoPath: "/bxBlRPEPpMVDc4jMhSrTf2339DW.jpg" },
  { id: 531, name: "Paramount Plus", aliases: /^paramount(?: plus)?$/, logoPath: "/h5DcR0J2EESLitnhR8xLG1QymTE.jpg" },
  { id: 386, name: "Peacock Premium", aliases: /^peacock(?: premium)?$/, logoPath: "/2aGrp1xw3qhwCYvNGAJZPdjfeeX.jpg" },
  { id: 526, name: "AMC+", aliases: /^amc(?: plus)?$/, logoPath: "/ovmu6uot1XVvsemM2dDySXLiX57.jpg" },
  { id: 34, name: "MGM Plus", aliases: /^mgm(?: plus)?$/, logoPath: "/ctiRpS16dlaTXQBSsiFncMrgWmh.jpg" },
  { id: 43, name: "Starz", aliases: /^starz(?:play)?$/, logoPath: "/yIKwylTLP1u8gl84Is7FItpYLGL.jpg" },
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

  if (!provider.homepage) return { url: null, linkType: undefined } as const;

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
