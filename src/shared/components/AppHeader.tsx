import type { CSSProperties } from "react";
import { CalendarDays, Clapperboard, Download, Radar, type LucideIcon } from "lucide-react";

export type AppSection = "program" | "films" | "radar";

const SECTIONS: { section: AppSection; label: string; Icon: LucideIcon }[] = [
  { section: "program", label: "Program", Icon: CalendarDays },
  { section: "films", label: "Filmy", Icon: Clapperboard },
  { section: "radar", label: "Radar", Icon: Radar },
];

const CINEMA_SECTIONS = SECTIONS.filter(item => item.section !== "radar");
const RADAR_SECTION = SECTIONS.find(item => item.section === "radar")!;


/**
 * One navigation level: Program (by day) · Filmy (by film) · Radar.
 * Header tabs on wider screens, a bottom bar on phones.
 */
export const AppHeader = ({
  section,
  canInstall,
  onSectionChange,
  onInstall,
}: {
  section: AppSection;
  canInstall: boolean;
  onSectionChange: (section: AppSection) => void;
  onInstall: () => void;
}) => {
  const activeIndex = { "--active": SECTIONS.findIndex(item => item.section === section) } as CSSProperties;
  const cinemaIndex = { "--active": Math.max(0, CINEMA_SECTIONS.findIndex(item => item.section === section)) } as CSSProperties;
  const inCinema = section !== "radar";

  return (
    <>
      <header className="topbar">
        <h1>
          <img
            className="app-wordmark"
            src="/nzfd-wordmark.webp"
            alt="NŽFD"
            width="430"
            height="48"
            fetchPriority="high"
          />
        </h1>
        <nav className="topbar-nav" aria-label="Hlavní navigace">
          <div
            className={inCinema ? "topbar-tabs segmented" : "topbar-tabs segmented idle"}
            role="group"
            aria-label="Kino Fidiko"
            style={cinemaIndex}
          >
            {CINEMA_SECTIONS.map(({ section: option, label, Icon }) => (
              <button
                className={section === option ? "topbar-tab active" : "topbar-tab"}
                type="button"
                aria-current={section === option ? "page" : undefined}
                onClick={() => onSectionChange(option)}
                key={option}
              >
                <Icon size={17} aria-hidden="true" />
                <span>{label}</span>
              </button>
            ))}
          </div>
          <button
            className={section === "radar" ? "topbar-radar active" : "topbar-radar"}
            type="button"
            aria-current={section === "radar" ? "page" : undefined}
            onClick={() => onSectionChange("radar")}
          >
            <RADAR_SECTION.Icon size={17} aria-hidden="true" />
            <span>{RADAR_SECTION.label}</span>
          </button>
        </nav>
        {canInstall ? (
          <button
            className="header-icon-button"
            type="button"
            onClick={onInstall}
            title="Nainstalovat aplikaci"
            aria-label="Nainstalovat aplikaci"
          >
            <Download size={19} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      <nav className="bottom-nav" aria-label="Hlavní navigace" style={activeIndex}>
        {SECTIONS.map(({ section: option, label, Icon }) => (
          <button
            className={[
              "bottom-nav-button",
              section === option ? "active" : "",
              option === "radar" ? "bottom-nav-radar" : "",
            ].filter(Boolean).join(" ")}
            type="button"
            aria-current={section === option ? "page" : undefined}
            onClick={() => onSectionChange(option)}
            key={option}
          >
            <Icon size={22} aria-hidden="true" />
            <span>{label}</span>
          </button>
        ))}
      </nav>
    </>
  );
};
