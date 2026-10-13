import React from "react";
import { Badge, IconButton, PinselaIcon } from "../index";

export interface ZoomHUDProps {
  zoom: number;
  onZoomOut?: () => void;
  onZoomIn?: () => void;
}

export function ZoomHUD({ zoom, onZoomOut, onZoomIn }: ZoomHUDProps) {
  return (
    <div className="dg-hud dg-zoom-hud">
      <IconButton size="sm" icon={<PinselaIcon name="Minus" size={14} />} onClick={onZoomOut} title="Zoom out" />
      <span className="dg-hud-val">{zoom}%</span>
      <IconButton size="sm" icon={<PinselaIcon name="Plus" size={14} />} onClick={onZoomIn} title="Zoom in" />
    </div>
  );
}

export interface ModeHUDProps {
  mode: string;
}

export function ModeHUD({ mode }: ModeHUDProps) {
  return (
    <div className="dg-hud dg-mode-hud">
      <Badge tone="info" size="md">{String(mode || "select").toUpperCase()}</Badge>
    </div>
  );
}
