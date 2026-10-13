import React from "react";

export interface GlassPanelProps extends React.HTMLAttributes<HTMLDivElement> {
  tone?: "chrome" | "panel" | "popover";
  density?: "comfortable" | "compact";
  border?: "none" | "subtle";
  children: React.ReactNode;
}

export function GlassPanel({
  tone = "panel",
  density = "comfortable",
  border = "subtle",
  children,
  className = "",
  ...props
}: GlassPanelProps) {
  const cn = [
    "dg-panel",
    `dg-panel-${tone}`,
    `dg-panel-density-${density}`,
    `dg-panel-border-${border}`,
    className,
  ].filter(Boolean).join(" ");

  return (
    <div className={cn} {...props}>
      {children}
    </div>
  );
}
