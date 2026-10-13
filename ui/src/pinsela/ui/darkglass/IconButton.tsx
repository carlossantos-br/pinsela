import React from "react";
import { useHoverHelpTooltip } from "./HoverHelpTooltip";

export interface IconButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    size?: "sm" | "md";
    tone?: "ghost" | "glass" | "solid";
    active?: boolean;
    danger?: boolean;
    icon: React.ReactNode;
    tooltipDescription?: string;
    tooltipDelayMs?: number;
}

export function IconButton({
    size = "md",
    tone = "ghost", // TODO: Implement glass/solid if needed, currently styled mostly as ghost/glass fusion
    active = false,
    danger = false,
    icon,
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
}: IconButtonProps) {
    const cn = [
        "dg-icon-btn",
        `dg-icon-btn-${size}`,
        active ? "active" : "",
        danger ? "danger" : "",
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
                {icon}
            </button>
            {help.tooltip}
        </>
    );
}
