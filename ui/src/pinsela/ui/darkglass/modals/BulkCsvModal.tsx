import React, { useState } from "react";
import { ModalFrame } from "./ModalFrame";
import { PillButton } from "../index";

export interface BulkCsvModalProps {
    onClose: () => void;
    onCreateJobs?: (csv: string) => void;
    busy?: boolean;
}

export function BulkCsvModal({ onClose, onCreateJobs, busy }: BulkCsvModalProps) {
    const [csv, setCsv] = useState("");

    // Parse CSV for preview
    const rows = csv.trim().split("\n").filter(Boolean);
    const headers = rows.length > 0 ? rows[0].split(",").map(h => h.trim()) : [];
    const dataRows = rows.slice(1).map(r => r.split(",").map(c => c.trim()));

    return (
        <ModalFrame
            title="Bulk processing (CSV)"
            onClose={onClose}
            width={720}
            footer={
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
                    <PillButton tone="neutral">Download sample CSV</PillButton>
                    <div style={{ display: "flex", gap: 12 }}>
                        <PillButton tone="neutral" onClick={onClose}>Cancel</PillButton>
                        <PillButton
                            tone="primary"
                            onClick={() => onCreateJobs?.(csv)}
                            style={{ opacity: csv.trim() && !busy ? 1 : 0.5 }}
                        >
                            {busy ? "Creating…" : "Create jobs"}
                        </PillButton>
                    </div>
                </div>
            }
        >
            <div className="dg-bulk-content">
                <textarea
                    className="dg-input dg-textarea"
                    placeholder="Paste your CSV data here…"
                    style={{ height: 120, marginBottom: 12 }}
                    value={csv}
                    onChange={e => setCsv(e.target.value)}
                />

                {headers.length > 0 && (
                    <div className="dg-panel-section">
                        <h3>Preview ({dataRows.length} {dataRows.length === 1 ? "row" : "rows"})</h3>
                        <div className="dg-table-mock">
                            <div className="dg-table-row header">
                                {headers.map((h, i) => <span key={i}>{h}</span>)}
                            </div>
                            {dataRows.slice(0, 5).map((row, ri) => (
                                <div key={ri} className="dg-table-row">
                                    {row.map((cell, ci) => <span key={ci}>{cell}</span>)}
                                </div>
                            ))}
                            {dataRows.length > 5 && (
                                <div style={{ padding: '8px 12px', fontSize: 11, color: 'var(--color-text-muted)' }}>
                                    … e mais {dataRows.length - 5} {dataRows.length - 5 === 1 ? "row" : "rows"}
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </div>
        </ModalFrame>
    );
}
