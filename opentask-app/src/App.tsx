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
import { TaskRedirectPage } from "./pages/TaskRedirectPage";
import { NotFoundPage } from "./pages/NotFound";
import { SettingsModal } from "./components/modals/SettingsModal";
import { TelegramLinkPrompt } from "./components/notifications/TelegramLinkPrompt";
import { useState } from "react";
import { ThemeProvider } from "./context/themeContext";
import { NetworkBadge } from "./components/ui/NetworkBadge";
import { FeedbackModal } from "./components/modals/FeedbackModal";
import { MeetingUploadTray } from "./components/meetings/MeetingUploadTray";
import "./App.css";

function AppShell() {
  const { user, isLoading } = useAuth();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isFeedbackOpen, setIsFeedbackOpen] = useState(false);

  if (isLoading) return <LoadingScreen message="Resolving session…" />;
  if (!user) return <LoginPage />;

  return (
    <div className="h-screen w-full bg-[var(--cmd-app-bg)] text-[var(--cmd-text-body)] font-sans flex overflow-hidden selection:bg-[#FFE600]/30 transition-colors duration-150 relative">
      <Sidebar
        onOpenSettings={() => setIsSettingsOpen(true)}
        onOpenFeedback={() => setIsFeedbackOpen(true)}
      />

      {/* Global Telemetry & Network Status Badge */}
      <NetworkBadge />

      <main className="flex-1 overflow-y-auto no-scrollbar bg-dots flex flex-col">
        <div className="px-4 pt-4 sm:pt-6 pb-6 flex-1 flex flex-col min-h-0">
          <Routes>
          <Route path="/" element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/workspaces" element={<WorkspacesPage />} />
          <Route path="/projects/:projectId" element={<ProjectDetailsPageWrapper />} />
          <Route path="/tasks/:taskId" element={<TaskRedirectPage />} />
          <Route path="/notifications" element={<NotificationsPage />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
        </div>
      </main>

      <TelegramLinkPrompt onOpenSettings={() => setIsSettingsOpen(true)} />
      <MeetingUploadTray />
      <SettingsModal isOpen={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />
      <FeedbackModal isOpen={isFeedbackOpen} onClose={() => setIsFeedbackOpen(false)} />
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
import { UpdateProvider } from './components/updater/UpdateChecker';

export default function App() {
  return (
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <ToastProvider>
            <UpdateProvider>
              <AppShell />
            </UpdateProvider>
          </ToastProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  );
}

