import { BrowserRouter, Routes, Route, Navigate, useNavigate } from "react-router-dom";
import { AuthProvider } from "./auth/authContext";
import { useAuth } from "./auth/useAuth";
import { LoadingScreen } from "./components/ui/LoadingScreen";
import { LoginPage } from "./auth/LoginPage";
import { Sidebar } from "./components/layout/Sidebar";
import { DashboardPage } from "./pages/Dashboard";
import { WorkspacesPage } from "./pages/Workspaces";
import { ProjectDetailsPage } from "./pages/ProjectDetails";
import { NotificationsPage } from "./pages/Notifications";
import { SettingsModal } from "./components/modals/SettingsModal";
import { TelegramLinkPrompt } from "./components/notifications/TelegramLinkPrompt";
import { useState } from "react";
import { ThemeProvider } from "./context/themeContext";
import "./App.css";

function AppShell() {
  const { user, isLoading } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  if (isLoading) return <LoadingScreen message="Resolving session…" />;
  if (!user) return <LoginPage />;

  return (
    <div className="h-screen w-full bg-[var(--cmd-app-bg)] text-[var(--cmd-text-body)] font-sans flex overflow-hidden selection:bg-[#FFE600]/30 transition-colors duration-150">
      <Sidebar onOpenSettings={() => setIsSettingsOpen(true)} />

      <main className="flex-1 overflow-y-auto no-scrollbar bg-dots">
        <div className="px-4 pt-8 pb-12">
          <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailsPageWrapper />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
        </div>
      </main>

      <TelegramLinkPrompt onOpenSettings={() => setIsSettingsOpen(true)} />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
    </div>
  );
}

// Wrapper to pass the projectId param correctly to the old component prop structure
import { useParams } from "react-router-dom";
function ProjectDetailsPageWrapper() {
  const { projectId } = useParams();
  const navigate = useNavigate();

  if (!projectId) {
    navigate('/workspaces', { replace: true });
    return null;
  }

  return <ProjectDetailsPage projectId={projectId} />;
}

import { ToastProvider } from './design-system/Toast';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <AppShell />
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

