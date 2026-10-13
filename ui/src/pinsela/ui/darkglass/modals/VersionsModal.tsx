import React, { useState, useEffect } from "react";
import { ModalFrame } from "./ModalFrame";
import { PillButton, Badge } from "../index";
import type { NativeVersionItem } from "../../../platform/api/pinselaNativeApi";

export interface VersionsModalProps {
    onClose: () => void;
    onRestore: (versionId: string) => void;
    versions?: NativeVersionItem[];
    loading?: boolean;
    onLoadVersions?: () => void;
}

export function VersionsModal({ onClose, onRestore, versions = [], loading, onLoadVersions }: VersionsModalProps) {
    useEffect(() => {
        onLoadVersions?.();
    }, []);

    return (
        <ModalFrame
            title="Version history"
            onClose={onClose}
            width={720}
            footer={
                <div style={{ display: "flex", justifyContent: "flex-end", gap: 12 }}>
                    <PillButton tone="neutral" onClick={onClose}>Close</PillButton>
                </div>
            }
        >
            <div className="dg-versions-list">
                {loading && (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        Loading versions…
                    </div>
                )}
                {!loading && versions.length === 0 && (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--color-text-muted)' }}>
                        No versions found
                    </div>
                )}
                {versions.map((v) => (
                    <div key={v.pack_version} className="dg-version-item">
                        <div className="dg-version-thumb" style={v.preview_url ? { backgroundImage: `url(${v.preview_url})`, backgroundSize: 'cover' } : {}} />
                        <div className="dg-version-info">
                            <div className="dg-version-title">
                                {v.pack_version}
                                {v.is_current && <Badge tone="ok" size="sm" style={{ marginLeft: 8 }}>Current</Badge>}
                            </div>
                            <div className="dg-version-meta">
                                Source: {v.source || "–"} • {v.node_count} elements
                                {v.uploaded_at ? ` • ${new Date(v.uploaded_at).toLocaleDateString("en-US")}` : ""}
                            </div>
                        </div>
                        <div className="dg-version-actions">
                            {!v.is_current && (
                                <PillButton tone="secondary" size="sm" onClick={() => onRestore(v.pack_version)}>Restore</PillButton>
                            )}
                        </div>
                    </div>
                ))}
            </div>
        </ModalFrame>
    );
}
