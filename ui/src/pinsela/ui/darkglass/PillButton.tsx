import React from "react";
import { useHoverHelpTooltip } from "./HoverHelpTooltip";

export interface PillButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    tone?: "primary" | "secondary" | "neutral";
    size?: "sm" | "md";
    children: React.ReactNode;
    tooltipDescription?: string;
    tooltipDelayMs?: number;
}

export function PillButton({
    tone = "neutral",
    size = "md",
    children,
    className = "",
    tooltipDescription,
    tooltipDelayMs,
    title,
    onMouseEnter,
    onMouseMove,
    onMouseLeave,
    onFocus,
    onBlur,
    onMouseDown,
    ...props
}: PillButtonProps) {
    const cn = [
        "dg-pill-btn",
        `dg-pill-btn-${tone}`,
        `dg-pill-btn-${size}`,
        className,
    ].filter(Boolean).join(" ");

    const tooltipLabel = typeof title === "string" ? title : undefined;
    const help = useHoverHelpTooltip({
        label: tooltipLabel,
        description: tooltipDescription,
        delayMs: tooltipDelayMs,
        disabled: !!props.disabled,
    });

    return (
        <>
            <button
                type="button"
                className={cn}
                aria-label={props["aria-label"] || tooltipLabel}
                {...props}
                onMouseEnter={(e) => { onMouseEnter?.(e); help.bind.onMouseEnter(e); }}
                onMouseMove={(e) => { onMouseMove?.(e); help.bind.onMouseMove(e); }}
                onMouseLeave={(e) => { onMouseLeave?.(e); help.bind.onMouseLeave(); }}
                onFocus={(e) => { onFocus?.(e); help.bind.onFocus(e); }}
                onBlur={(e) => { onBlur?.(e); help.bind.onBlur(); }}
                onMouseDown={(e) => { onMouseDown?.(e); help.bind.onMouseDown(); }}
            >
                {children}
            </button>
            {help.tooltip}
        </>
    );
}
