import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useAppContext } from './AppContext';
import { Toaster } from '@/components/ui/sonner';

import LandingPage from './pages/LandingPage';
import OnboardingPage from './pages/OnboardingPage';
import DashboardLayout from './layouts/DashboardLayout';
import OverviewPage from './pages/OverviewPage';
import ExpensesPage from './pages/ExpensesPage';
import PantryPage from './pages/PantryPage';
import ChoresPage from './pages/ChoresPage';
import NoticeBoardPage from './pages/NoticeBoardPage';
import VaultPage from './pages/VaultPage';

const ProtectedRoute = ({ children }: { children: React.ReactNode }) => {
  const { user, isAuthReady, flatId } = useAppContext();

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/" replace />;
  }

  if (!flatId) {
    return <Navigate to="/onboarding" replace />;
  }

  return <>{children}</>;
};

const AppRoutes = () => {
  const { user, isAuthReady, flatId } = useAppContext();

  if (!isAuthReady) {
    return <div className="min-h-screen flex items-center justify-center bg-background text-foreground">Loading...</div>;
  }

  return (
    <Routes>
      <Route path="/" element={user ? (flatId ? <Navigate to="/dashboard" /> : <Navigate to="/onboarding" />) : <LandingPage />} />
      <Route path="/onboarding" element={user && !flatId ? <OnboardingPage /> : <Navigate to={user ? "/dashboard" : "/"} />} />
      
      <Route path="/dashboard" element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
        <Route index element={<OverviewPage />} />
        <Route path="expenses" element={<ExpensesPage />} />
        <Route path="pantry" element={<PantryPage />} />
        <Route path="chores" element={<ChoresPage />} />
        <Route path="board" element={<NoticeBoardPage />} />
        <Route path="vault" element={<VaultPage />} />
      </Route>
    </Routes>
  );
};

import { ThemeProvider } from './components/theme-provider';

export default function App() {
  return (
    <ThemeProvider defaultTheme="light" storageKey="flatos-theme">
      <AppProvider>
        <Router>
          <AppRoutes />
          <Toaster />
        </Router>
      </AppProvider>
    </ThemeProvider>
  );
}
