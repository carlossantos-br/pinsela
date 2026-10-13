import React from "react";

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
    tone?: "ok" | "warn" | "bad" | "info";
    size?: "sm" | "md";
    children: React.ReactNode;
}

export function Badge({
    tone = "info",
    size = "sm",
    children,
    className = "",
    ...props
}: BadgeProps) {
    const cn = [
        "dg-badge",
        `dg-badge-${tone}`,
        `dg-badge-${size}`,
        className,
    ].filter(Boolean).join(" ");

    return (
        <span className={cn} {...props}>
            {children}
        </span>
    );
}
