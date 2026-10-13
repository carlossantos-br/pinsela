import React from "react";
import { Navigate, Route, Routes, useLocation, useParams } from "react-router-dom";
import { useAuth } from "./lib/auth";
import { getRemoteBackedLocalEditorPath } from "./pinsela/localAccount";

const PinselaDarkGlassPage = React.lazy(async () => {
  const mod = await import("./pages/PinselaDarkGlassPage");
  return { default: mod.PinselaDarkGlassPage };
});
const PinselaLoginPage = React.lazy(async () => {
  const mod = await import("./pages/PinselaLoginPage");
  return { default: mod.PinselaLoginPage };
});
const PinselaProjectsPage = React.lazy(async () => {
  const mod = await import("./pages/PinselaProjectsPage");
  return { default: mod.PinselaProjectsPage };
});

function RequireAuthFullScreen({ children }: { children: React.ReactNode }) {
  const { me, loading } = useAuth();
  if (loading) return <div style={{ padding: 24, color: "#fff" }}>Loading...</div>;
  if (!me) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function ProjectEditorRedirect() {
  const { id } = useParams<{ id?: string }>();
  return <Navigate to={getRemoteBackedLocalEditorPath(id)} replace />;
}

function LegacyEditorRedirect() {
  const { localProjectId } = useParams<{ localProjectId?: string }>();
  const location = useLocation();
  const query = location.search || "";
  const target = localProjectId ? getRemoteBackedLocalEditorPath(localProjectId) : "/projects";
  return <Navigate to={`${target}${query}`} replace />;
}

export function App() {
  return (
    <React.Suspense fallback={<div className="content">Loading...</div>}>
      <Routes>
        <Route path="/login" element={<PinselaLoginPage />} />
        <Route
          path="/projects"
          element={
            <RequireAuthFullScreen>
              <PinselaProjectsPage />
            </RequireAuthFullScreen>
          }
        />
        <Route path="/projects/:id" element={<ProjectEditorRedirect />} />
        <Route path="/project/:localProjectId" element={<PinselaDarkGlassPage />} />
        <Route path="/editor" element={<LegacyEditorRedirect />} />
        <Route path="/editor/project/:localProjectId" element={<LegacyEditorRedirect />} />
        <Route path="/editor/:sandboxId" element={<LegacyEditorRedirect />} />
        <Route path="/editor-local" element={<LegacyEditorRedirect />} />
        <Route path="/editor-local/project/:localProjectId" element={<LegacyEditorRedirect />} />
        <Route path="/editor-local/:sandboxId" element={<LegacyEditorRedirect />} />
        <Route path="/pinsela/*" element={<Navigate to="/projects" replace />} />
        <Route path="/pinsela-runtime" element={<Navigate to="/projects" replace />} />
        <Route path="/" element={<Navigate to="/projects" replace />} />
        <Route path="*" element={<Navigate to="/projects" replace />} />
      </Routes>
    </React.Suspense>
  );
}
