import React from "react";
import { IconButton, PinselaIcon } from "../index";

export interface RightRailProps {
  uiVariant?: "default" | "local_sandbox";
  activeSection: string;
  collapsed: boolean;
  showAutomations?: boolean;
  onSectionChange?: (section: string) => void;
}

export const RightRail = React.memo(function RightRail({
  uiVariant = "default",
  activeSection,
  collapsed,
  showAutomations = true,
  onSectionChange,
}: RightRailProps) {
  const isLocalSandboxUi = uiVariant === "local_sandbox";
  const sections = [
    { id: "layers", label: "Layers", hint: "Structure", icon: <PinselaIcon name="Layers" size={18} /> },
    { id: "imports", label: "Files", hint: "Project", icon: <PinselaIcon name="FileImage" size={18} /> },
    ...(showAutomations ? [{ id: "automations", label: "Flows", hint: "Generation", icon: <PinselaIcon name="Bot" size={18} /> }] : []),
  ];

  return (
    <div className={`dg-right-rail ${collapsed ? "collapsed" : ""}`}>
      <div className="dg-right-rail-sections">
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
      {/* Settings intentionally removed here: it opened the same
          snap/grid/guides panel as the LeftRail "Editor settings"
          popover (which also carries the theme switch). One Settings, not two. */}
    </div>
  );
});
