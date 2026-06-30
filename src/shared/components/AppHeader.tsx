import { Clapperboard, Download, Radar } from "lucide-react";
import type { AppMode, ViewMode } from "../../types";

export const AppHeader = ({
  mode,
  view,
  canInstall,
  onModeChange,
  onViewChange,
  onInstall,
}: {
  mode: AppMode;
  view: ViewMode;
  canInstall: boolean;
  onModeChange: (mode: AppMode) => void;
  onViewChange: (view: ViewMode) => void;
  onInstall: () => void;
}) => {
  return (
    <header className="topbar topbar-standalone">
      <div className="brand-block">
        <img
          className="app-wordmark"
          src="/nzfd-wordmark.png"
          alt="NZFD"
          width="430"
          height="48"
          fetchPriority="high"
        />
      </div>
      <div className="topbar-actions">
        {mode === "program" ? (
          <div className="view-switch" role="group" aria-label="Zobrazení programu">
            {(["week", "all"] as const).map(option => (
              <button
                className={view === option ? "view-switch-button active" : "view-switch-button"}
                type="button"
                aria-pressed={view === option}
                onClick={() => onViewChange(option)}
                key={option}
              >
                {option === "week" ? "Týden" : "Vše"}
              </button>
            ))}
          </div>
        ) : (
          <div className="view-switch view-switch-placeholder" aria-hidden="true">
            <span className="view-switch-button">Týden</span>
            <span className="view-switch-button">Vše</span>
          </div>
        )}
        {mode === "program" && canInstall ? (
          <InstallButton onInstall={onInstall} />
        ) : null}
        <div className="mode-switch" role="group" aria-label="Hlavní část aplikace">
          <button
            className={mode === "program" ? "mode-button active" : "mode-button"}
            type="button"
            aria-pressed={mode === "program"}
            onClick={() => onModeChange("program")}
            aria-label="Program"
            title="Program"
          >
            <Clapperboard size={18} aria-hidden="true" />
            <span>Program</span>
          </button>
          <button
            className={mode === "radar" ? "mode-button active" : "mode-button"}
            type="button"
            aria-pressed={mode === "radar"}
            onClick={() => onModeChange("radar")}
            aria-label="Radar"
            title="Radar"
          >
            <Radar size={18} aria-hidden="true" />
            <span>Radar</span>
          </button>
        </div>
        {mode === "radar" && canInstall ? (
          <InstallButton onInstall={onInstall} />
        ) : null}
      </div>
    </header>
  );
};

const InstallButton = ({ onInstall }: { onInstall: () => void }) => {
  return (
    <button
      className="header-icon-button"
      type="button"
      onClick={onInstall}
      title="Nainstalovat aplikaci"
      aria-label="Nainstalovat aplikaci"
    >
      <Download size={19} aria-hidden="true" />
    </button>
  );
};