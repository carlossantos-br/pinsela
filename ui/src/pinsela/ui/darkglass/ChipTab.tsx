import React from "react";
import { PinselaIcon } from "./index";

export interface ChipTabProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
    active?: boolean;
    closable?: boolean;
    onClose?: () => void;
    children: React.ReactNode;
}

export function ChipTab({
    active = false,
    closable = false,
    onClose,
    children,
    className = "",
    ...props
}: ChipTabProps) {
    const cn = [
        "dg-chip-tab",
        active ? "active" : "",
        className,
    ].filter(Boolean).join(" ");

    return (
        <button type="button" className={cn} {...props}>
            {children}
            {closable && (
                <span
                    className="dg-chip-tab-close"
                    onClick={(e) => {
                        e.stopPropagation();
                        onClose?.();
                    }}
                >
                    <PinselaIcon name="X" size={12} />
                </span>
            )}
        </button>
    );
}
