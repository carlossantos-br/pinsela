import React from "react";
import { PinselaIcon } from "../index";

export interface CanvasFormat {
    id: string;
    name: string;
    category: string;
    width: number;
    height: number;
    icon: string;
}

export const CANVAS_PRESETS: CanvasFormat[] = [
    // Social Media
    { id: "ig-post", name: "Instagram Post", category: "Social Media", width: 1080, height: 1080, icon: "Square" },
    { id: "ig-portrait", name: "Instagram Portrait", category: "Social Media", width: 1080, height: 1350, icon: "RectangleVertical" },
    { id: "ig-story", name: "Instagram Story", category: "Social Media", width: 1080, height: 1920, icon: "Smartphone" },
    { id: "fb-post", name: "Facebook Post", category: "Social Media", width: 1200, height: 630, icon: "RectangleHorizontal" },
    { id: "fb-cover", name: "Facebook Cover", category: "Social Media", width: 820, height: 312, icon: "Monitor" },
    { id: "yt-thumb", name: "YouTube Thumbnail", category: "Social Media", width: 1280, height: 720, icon: "Play" },
    { id: "linkedin-post", name: "LinkedIn Post", category: "Social Media", width: 1200, height: 627, icon: "RectangleHorizontal" },
    { id: "tiktok-video", name: "TikTok / Reels", category: "Social Media", width: 1080, height: 1920, icon: "Smartphone" },

    // Print
    { id: "a4", name: "A4", category: "Print", width: 2480, height: 3508, icon: "FileText" },
    { id: "a5", name: "A5", category: "Print", width: 1748, height: 2480, icon: "FileText" },
    { id: "letter", name: "Letter (US)", category: "Print", width: 2550, height: 3300, icon: "FileText" },

    // Common
    { id: "square-1080", name: "Square 1080", category: "Common", width: 1080, height: 1080, icon: "Square" },
    { id: "fullhd", name: "Full HD", category: "Common", width: 1920, height: 1080, icon: "Monitor" },
    { id: "4k", name: "4K UHD", category: "Common", width: 3840, height: 2160, icon: "Monitor" },
    { id: "custom", name: "Custom", category: "Common", width: 1080, height: 1080, icon: "Settings" },
];

export interface FormatPickerProps {
    mode?: "initial" | "replace";
    onSelect: (format: CanvasFormat) => void;
    onBack?: () => void;
}

export function FormatPicker({ mode = "initial", onSelect, onBack }: FormatPickerProps) {
    const [customW, setCustomW] = React.useState("1080");
    const [customH, setCustomH] = React.useState("1080");
    const [hoveredId, setHoveredId] = React.useState<string | null>(null);
    const isReplacingArtwork = mode === "replace";

    const categories = React.useMemo(() => {
        const map = new Map<string, CanvasFormat[]>();
        for (const p of CANVAS_PRESETS) {
            if (p.id === "custom") continue;
            const list = map.get(p.category) || [];
            list.push(p);
            map.set(p.category, list);
        }
        return Array.from(map.entries());
    }, []);

    return (
        <div style={{
            position: "absolute", inset: 0,
            display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
            zIndex: 50,
            background: "radial-gradient(ellipse at center, rgba(37, 99, 235, 0.06) 0%, transparent 70%)",
        }}>
            {/* Header */}
            <div style={{
                width: "100%",
                maxWidth: 760,
                padding: "0 24px",
                marginBottom: 32,
                display: "grid",
                gap: 18,
            }}>
                <div style={{
                    display: "flex",
                    alignItems: "flex-start",
                    justifyContent: "space-between",
                    gap: 16,
                    flexWrap: "wrap",
                }}>
                    <div style={{ minWidth: 0, textAlign: "left" }}>
                        <div style={{
                            display: "inline-flex", alignItems: "center", gap: 10,
                            fontSize: 22, fontWeight: 700, color: "var(--color-text-primary, #171717)",
                            letterSpacing: "-0.02em",
                        }}>
                            {isReplacingArtwork ? "Choose a format for the new design" : "Choose a size for your first page"}
                        </div>
                        <div style={{
                            marginTop: 8, fontSize: 13, color: "var(--color-text-muted, #666666)",
                            maxWidth: 520,
                            lineHeight: 1.45,
                        }}>
                            {isReplacingArtwork
                                ? "This creates a blank design. Your current editor is only replaced after you choose a format."
                                : "Pick a preset or set a custom size to get started."}
                        </div>
                    </div>
                    {onBack ? (
                        <button
                            type="button"
                            onClick={onBack}
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                gap: 8,
                                minHeight: 38,
                                padding: "0 14px",
                                borderRadius: 999,
                                border: "1px solid rgba(23, 23, 23, 0.108)",
                                background: "rgba(23, 23, 23, 0.03)",
                                color: "var(--color-text-primary, #171717)",
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: "pointer",
                            }}
                        >
                            <PinselaIcon name="ArrowLeft" size={14} />
                            Back to editor
                        </button>
                    ) : null}
                </div>

                {isReplacingArtwork ? (
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 10,
                        padding: "12px 14px",
                        borderRadius: 14,
                        background: "rgba(245, 158, 11, 0.08)",
                        border: "1px solid rgba(245, 158, 11, 0.18)",
                        color: "var(--color-text-secondary, #525252)",
                        fontSize: 13,
                        lineHeight: 1.45,
                    }}>
                        <PinselaIcon name="TriangleAlert" size={15} style={{ color: "#f59e0b", flexShrink: 0 }} />
                        <span>If you got here by mistake, go back to the editor. Nothing is discarded until you choose a format.</span>
                    </div>
                ) : null}
            </div>

            {/* Preset grid */}
            <div style={{
                display: "flex", flexDirection: "column", gap: 20,
                maxWidth: 700, width: "100%", padding: "0 24px",
                maxHeight: "60vh", overflowY: "auto",
            }}>
                {categories.map(([cat, presets]) => (
                    <div key={cat}>
                        <div style={{
                            fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                            color: "var(--color-text-muted, #666666)",
                            marginBottom: 8, letterSpacing: "0.05em",
                        }}>
                            {cat}
                        </div>
                        <div style={{
                            display: "grid",
                            gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
                            gap: 8,
                        }}>
                            {presets.map((p) => (
                                <button
                                    key={p.id}
                                    onClick={() => onSelect(p)}
                                    onMouseEnter={() => setHoveredId(p.id)}
                                    onMouseLeave={() => setHoveredId(null)}
                                    style={{
                                        display: "flex", alignItems: "center", gap: 10,
                                        padding: "10px 14px",
                                        background: hoveredId === p.id
                                            ? "rgba(37, 99, 235, 0.08)"
                                            : "rgba(23, 23, 23, 0.024)",
                                        border: hoveredId === p.id
                                            ? "1px solid rgba(37, 99, 235, 0.4)"
                                            : "1px solid rgba(23, 23, 23, 0.1)",
                                        borderRadius: 8,
                                        cursor: "pointer",
                                        transition: "all 0.15s ease",
                                        textAlign: "left",
                                        color: "inherit",
                                        fontFamily: "inherit",
                                    }}
                                >
                                    <div style={{
                                        width: 32, height: 32, borderRadius: 6,
                                        background: "rgba(37, 99, 235, 0.1)",
                                        display: "flex", alignItems: "center", justifyContent: "center",
                                        flexShrink: 0,
                                    }}>
                                        <PinselaIcon name={p.icon as any} size={16} style={{ color: "#2563eb" }} />
                                    </div>
                                    <div style={{ flex: 1, minWidth: 0 }}>
                                        <div style={{
                                            fontSize: 13, fontWeight: 500,
                                            color: "var(--color-text-primary, #171717)",
                                            whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                                        }}>
                                            {p.name}
                                        </div>
                                        <div style={{
                                            fontSize: 11,
                                            color: "var(--color-text-muted, #666666)",
                                            fontFamily: "monospace",
                                        }}>
                                            {p.width} × {p.height}px
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                ))}

                {/* Custom Size */}
                <div>
                    <div style={{
                        fontSize: 11, fontWeight: 600, textTransform: "uppercase",
                        color: "var(--color-text-muted, #666666)",
                        marginBottom: 8, letterSpacing: "0.05em",
                    }}>
                        Custom
                    </div>
                    <div style={{
                        display: "flex", alignItems: "center", gap: 10,
                        padding: "10px 14px",
                        background: "rgba(23, 23, 23, 0.024)",
                        border: "1px solid rgba(23, 23, 23, 0.072)",
                        borderRadius: 8,
                    }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: 6,
                            background: "rgba(37, 99, 235, 0.1)",
                            display: "flex", alignItems: "center", justifyContent: "center",
                            flexShrink: 0,
                        }}>
                            <PinselaIcon name="Settings" size={16} style={{ color: "#2563eb" }} />
                        </div>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                            <input
                                type="number"
                                value={customW}
                                onChange={(e) => setCustomW(e.target.value)}
                                style={{
                                    width: 70, padding: "4px 8px", fontSize: 13,
                                    background: "rgba(23, 23, 23, 0.036)",
                                    border: "1px solid rgba(23, 23, 23, 0.108)",
                                    borderRadius: 6, color: "var(--color-text-primary, #171717)",
                                    textAlign: "center", fontFamily: "monospace",
                                }}
                                min={1}
                            />
                            <span style={{ color: "var(--color-text-muted, #666666)", fontSize: 13 }}>×</span>
                            <input
                                type="number"
                                value={customH}
                                onChange={(e) => setCustomH(e.target.value)}
                                style={{
                                    width: 70, padding: "4px 8px", fontSize: 13,
                                    background: "rgba(23, 23, 23, 0.036)",
                                    border: "1px solid rgba(23, 23, 23, 0.108)",
                                    borderRadius: 6, color: "var(--color-text-primary, #171717)",
                                    textAlign: "center", fontFamily: "monospace",
                                }}
                                min={1}
                            />
                            <span style={{ color: "var(--color-text-muted, #666666)", fontSize: 11 }}>px</span>
                        </div>
                        <button
                            onClick={() => {
                                const w = Math.max(1, parseInt(customW) || 1080);
                                const h = Math.max(1, parseInt(customH) || 1080);
                                onSelect({ id: "custom", name: `Custom ${w}×${h}`, category: "Custom", width: w, height: h, icon: "Settings" });
                            }}
                            style={{
                                padding: "6px 16px", fontSize: 13, fontWeight: 600,
                                background: "#171717",
                                border: "none", borderRadius: 6, cursor: "pointer",
                                color: "#fff", fontFamily: "inherit",
                                transition: "opacity 0.15s",
                            }}
                        >
                            Use size
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}
