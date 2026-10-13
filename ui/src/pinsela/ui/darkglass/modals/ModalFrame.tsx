import React from "react";
import { GlassPanel, PinselaIcon } from "../index";

export interface ModalFrameProps {
    title: string;
    onClose: () => void;
    width?: number | string;
    children: React.ReactNode;
    footer?: React.ReactNode;
}

export function ModalFrame({ title, onClose, width = 640, children, footer }: ModalFrameProps) {
    const titleId = React.useId();
    const dialogRef = React.useRef<HTMLDivElement | null>(null);

    React.useEffect(() => {
        const previouslyFocused = document.activeElement as HTMLElement | null;
        // Move focus into the dialog so keyboard users start inside it.
        dialogRef.current?.focus();
        function onKeyDown(ev: KeyboardEvent) {
            if (ev.key === "Escape") {
                // Capture-phase + stopPropagation so the canvas Escape handler
                // (deselect) doesn't also fire underneath the open modal.
                ev.stopPropagation();
                onClose();
            }
        }
        document.addEventListener("keydown", onKeyDown, true);
        return () => {
            document.removeEventListener("keydown", onKeyDown, true);
            if (previouslyFocused && typeof previouslyFocused.focus === "function") {
                previouslyFocused.focus();
            }
        };
    }, [onClose]);

    return (
        <div className="dg-modal-backdrop" onClick={onClose}>
            <div
                ref={dialogRef}
                className="dg-modal-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
                onClick={e => e.stopPropagation()}
                style={{ width, maxWidth: '95vw' }}
            >
                <GlassPanel tone="popover" density="comfortable" border="subtle" className="dg-modal-panel">

                    {/* Header */}
                    <div className="dg-modal-header">
                        <h2 className="dg-modal-title" id={titleId}>{title}</h2>
                        <button className="dg-modal-close" onClick={onClose} aria-label="Close"><PinselaIcon name="X" size={16} /></button>
                    </div>

                    {/* Body */}
                    <div className="dg-modal-body">
                        {children}
                    </div>

                    {/* Footer (optional) */}
                    {footer && (
                        <div className="dg-modal-footer">
                            {footer}
                        </div>
                    )}

                </GlassPanel>
            </div>
        </div>
    );
}
