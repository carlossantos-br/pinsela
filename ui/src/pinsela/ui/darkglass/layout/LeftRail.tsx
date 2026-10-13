import React from "react";
import ReactDOM from "react-dom";
import { IconButton, PinselaIcon } from "../index";

export interface LeftRailProps {
  uiVariant?: "default" | "local_sandbox";
  activeSection: string;
  collapsed: boolean;
  theme?: "obsidian" | "sand";
  onShowVersions?: () => void;
  onSectionChange?: (section: string) => void;
  /* "My projects" back link (rendered at the very top of the rail
     for local sandbox; replaces the Topbar back link). */
  homeHref?: string;
  /* Canvas rules — moved from the Topbar "Settings" pill into the
     LeftRail settings popover. */
  snapEnabled?: boolean;
  gridEnabled?: boolean;
  onToggleSnap?: () => void;
  onToggleGrid?: () => void;
}

export const LeftRail = React.memo(function LeftRail({
  uiVariant = "default",
  activeSection,
  collapsed,
  theme = "sand",
  onShowVersions,
  onSectionChange,
  homeHref,
  snapEnabled = true,
  gridEnabled = true,
  onToggleSnap,
  onToggleGrid,
}: LeftRailProps) {
  const isLocalSandboxUi = uiVariant === "local_sandbox";
  const [settingsOpen, setSettingsOpen] = React.useState(false);
  const allSections = [
    { id: "assets", label: "Media", hint: "Library", icon: <PinselaIcon name="ImagePlus" size={18} /> },
    { id: "stroke", label: "Stroke", hint: "Border", icon: <PinselaIcon name="CircleDashed" size={18} /> },
    { id: "effects", label: "Effects", hint: "Visual", icon: <PinselaIcon name="Sparkles" size={18} /> },
    { id: "auto_layout", label: "Layout", hint: "Flow", icon: <PinselaIcon name="LayoutTemplate" size={18} /> },
    { id: "boolean_ops", label: "Shapes", hint: "Vector", icon: <PinselaIcon name="SquaresUnite" size={18} /> },
    { id: "perspective_warp", label: "Persp.", hint: "Distortion", icon: <PinselaIcon name="Expand" size={18} /> },
    { id: "image_trace", label: "Trace", hint: "Vector", icon: <PinselaIcon name="ScanLine" size={18} /> },
  ];
  const localSections = [
    { id: "elements", label: "Elements", hint: "Insert", icon: <PinselaIcon name="Pentagon" size={18} /> },
    { id: "templates", label: "Templates", hint: "Start", icon: <PinselaIcon name="LayoutTemplate" size={18} /> },
    { id: "assets", label: "Media", hint: "Library", icon: <PinselaIcon name="ImagePlus" size={18} /> },
    { id: "stroke", label: "Stroke", hint: "Border", icon: <PinselaIcon name="CircleDashed" size={18} /> },
    { id: "effects", label: "Effects", hint: "Visual", icon: <PinselaIcon name="Sparkles" size={18} /> },
    { id: "boolean_ops", label: "Shapes", hint: "Vector", icon: <PinselaIcon name="SquaresUnite" size={18} /> },
  ];
  const sections = isLocalSandboxUi ? localSections : allSections;

  React.useEffect(() => {
    if (!settingsOpen) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setSettingsOpen(false);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [settingsOpen]);

  return (
    <div className={`dg-left-rail ${collapsed ? "collapsed" : ""}`}>
      {isLocalSandboxUi && homeHref ? (
        <div className="dg-left-rail-head">
          <a
            className="dg-rail-home-link"
            href={homeHref}
            title="Back to my projects"
            aria-label="Back to my projects"
          >
            <PinselaIcon name="ArrowLeft" size={18} />
          </a>
        </div>
      ) : null}
      <div className="dg-left-rail-sections">
        {sections.map((section) => (
          <div key={section.id} className={`dg-rail-item-wrapper ${activeSection === section.id && !collapsed ? "active" : ""}`}>
            {isLocalSandboxUi ? (
              <button
                type="button"
                className={`dg-rail-nav-btn ${activeSection === section.id && !collapsed ? "active" : ""}`}
                onClick={() => onSectionChange?.(section.id)}
                title={section.label}
                aria-label={section.label}
              >
                <span className="dg-rail-nav-icon">{section.icon}</span>
                <span className="dg-rail-nav-copy">
                  <span className="dg-rail-nav-label">{section.label}</span>
                  <span className="dg-rail-nav-hint">{section.hint}</span>
                </span>
              </button>
            ) : (
              <IconButton
                icon={section.icon}
                active={activeSection === section.id && !collapsed}
                className="dg-rail-item"
                onClick={() => onSectionChange?.(section.id)}
                title={section.label}
                aria-label={section.label}
              />
            )}
          </div>
        ))}
      </div>

      <div className="dg-left-rail-bottom">
        {isLocalSandboxUi ? (
          <button
            type="button"
            className={`dg-rail-settings-btn ${settingsOpen ? "active" : ""}`}
            onClick={() => setSettingsOpen((current) => !current)}
            title="Editor settings"
            aria-label="Editor settings"
          >
            <PinselaIcon name="Settings2" size={17} />
          </button>
        ) : null}
      </div>

      {isLocalSandboxUi && settingsOpen && ReactDOM.createPortal(
        <div className="dg-floating-popover-layer dg-workspace-settings-layer" onMouseDown={() => setSettingsOpen(false)}>
          <div className="dg-workspace-settings-popover" onMouseDown={(event) => event.stopPropagation()}>
            <div className="dg-workspace-settings-head">
              <strong>Settings</strong>
              <button type="button" onClick={() => setSettingsOpen(false)} aria-label="Close settings">
                <PinselaIcon name="X" size={14} />
              </button>
            </div>
            {(onToggleSnap || onToggleGrid) ? (
              <div className="dg-workspace-settings-section">
                <span>Canvas</span>
                <div className="dg-workspace-settings-rules">
                  {onToggleSnap ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={snapEnabled}
                      className={`dg-settings-switch-row${snapEnabled ? " is-on" : ""}`}
                      onClick={onToggleSnap}
                      title="Turn magnetic guides on or off"
                    >
                      <PinselaIcon name="Magnet" size={15} />
                      <span className="dg-settings-switch-copy">
                        <strong>Snap to guides</strong>
                        <small>Magnet when moving and resizing</small>
                      </span>
                      <span className="dg-settings-switch-track" aria-hidden="true"><i /></span>
                    </button>
                  ) : null}
                  {onToggleGrid ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={gridEnabled}
                      className={`dg-settings-switch-row${gridEnabled ? " is-on" : ""}`}
                      onClick={onToggleGrid}
                      title="Turn grid snapping on or off"
                    >
                      <PinselaIcon name="Grid" size={15} />
                      <span className="dg-settings-switch-copy">
                        <strong>Snap to grid</strong>
                        <small>Multiples of the grid size</small>
                      </span>
                      <span className="dg-settings-switch-track" aria-hidden="true"><i /></span>
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="dg-workspace-settings-section">
              <span>History</span>
              <div className="dg-workspace-settings-actions">
                <button type="button" onClick={() => { setSettingsOpen(false); onShowVersions?.(); }} disabled={!onShowVersions}>
                  <PinselaIcon name="History" size={14} />
                  Versions
                </button>
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
});
