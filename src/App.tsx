// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import {
  NavLink,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";

import { AuthProvider, useAuth } from "./auth/AuthProvider";
import RequireAuth from "./auth/RequireAuth";

import ImportPage from "./pages/ImportPage";
import TodayPage from "./pages/TodayPage";
import WeekPage from "./pages/WeekPage";
import SubjectPage from "./pages/SubjectPage";
import MatrixPage from "./pages/MatrixPage";
import TemplateMappingPage from "./pages/TemplateMappingPage";
import BlocksPage from "./pages/BlocksPage";
import SubjectsPage from "./pages/SubjectsPage";
import SetupPage from "./pages/SetupPage";
import LoginPage from "./pages/LoginPage";
import TodosPage from "./pages/TodosPage";

export default function App() {
  const location = useLocation();
  const navigate = useNavigate();

  function LogoutButton() {
    const { user, logout } = useAuth();
    if (!user) return null;
    return (
      <button
        className="logoutBtn"
        onClick={async () => {
          await logout();
          navigate("/login");
        }}
        title="Sign out"
      >
        Sign out
      </button>
    );
  }

  const [theme, setTheme] = useState<"dark" | "light">(() => {
    try {
      const v = localStorage.getItem("daybook.theme");
      return v === "light" ? "light" : "dark";
    } catch {
      return "dark";
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("daybook.theme", theme);
    } catch {
      // ignore
    }
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function ThemeToggle() {
    return (
      <button
        className="themeBtn"
        type="button"
        onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
        title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
      >
        {theme === "dark" ? (
          // Moon — currently dark, click for light
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>
          </svg>
        ) : (
          // Sun — currently light, click for dark
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="5"/>
            <line x1="12" y1="1" x2="12" y2="3"/>
            <line x1="12" y1="21" x2="12" y2="23"/>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/>
            <line x1="1" y1="12" x2="3" y2="12"/>
            <line x1="21" y1="12" x2="23" y2="12"/>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>
          </svg>
        )}
      </button>
    );
  }

  const [sidebarOpen, setSidebarOpen] = useState<boolean>(() => {
    try {
      const v = localStorage.getItem("daybook.sidebarOpen");
      return v ? v === "1" : true;
    } catch {
      return true;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem("daybook.sidebarOpen", sidebarOpen ? "1" : "0");
    } catch {
      // ignore
    }
  }, [sidebarOpen]);

  const pageTitle = useMemo(() => {
    if (location.pathname === "/") return "Today";
    if (location.pathname.startsWith("/week")) return "Week";
    if (location.pathname.startsWith("/matrix")) return "Matrix";
    if (location.pathname.startsWith("/lessons")) return "Lessons";
    if (location.pathname.startsWith("/subjects")) return "Subjects";
    if (location.pathname.startsWith("/setup")) return "Setup";
    if (location.pathname.startsWith("/subject")) return "Subject";
    if (location.pathname.startsWith("/import")) return "Import";
    if (location.pathname.startsWith("/mapping")) return "Mapping";
    if (location.pathname.startsWith("/blocks")) return "Blocks";
    if (location.pathname.startsWith("/todos")) return "To-Dos";
    if (location.pathname.startsWith("/login")) return "Login";
    return "DayBook";
  }, [location.pathname]);

  return (
    <AuthProvider>
      <header className="topbar">
        <button
          className="hamburger"
          title={sidebarOpen ? "Hide menu" : "Show menu"}
          onClick={() => setSidebarOpen((v) => !v)}
        >
          ☰
        </button>
        <div className="topbarTitle">
          <span className="brand">DayBook</span>
          <span className="pageTitle">{pageTitle}</span>
        </div>
        <ThemeToggle />
      </header>

      <div className={sidebarOpen ? "layout" : "layout layout--collapsed"}>
        {sidebarOpen ? (
          <aside className="sidebar">
            <nav className="sidenav">
              <NavLink
                to="/"
                end
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Today
              </NavLink>
              <NavLink
                to="/week"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Week
              </NavLink>
              <NavLink
                to="/matrix"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Matrix
              </NavLink>
              <NavLink
                to="/lessons"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Lessons
              </NavLink>
              <NavLink
                to="/todos"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                To-Dos
              </NavLink>
              <div className="navDivider" />
              <NavLink
                to="/setup"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Setup
              </NavLink>
              <NavLink
                to="/subjects"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Subjects
              </NavLink>
              <NavLink
                to="/import"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Import
              </NavLink>
              <NavLink
                to="/mapping"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Mapping
              </NavLink>
              <NavLink
                to="/blocks"
                className={({ isActive }) => (isActive ? "active" : "")}
              >
                Blocks
              </NavLink>
              <div className="navDivider" />
              <LogoutButton />
            </nav>
          </aside>
        ) : null}

        <div className="container">
          <Routes>
            <Route path="/login" element={<LoginPage />} />

            <Route
              path="/"
              element={
                <RequireAuth>
                  <TodayPage />
                </RequireAuth>
              }
            />
            <Route
              path="/week"
              element={
                <RequireAuth>
                  <WeekPage />
                </RequireAuth>
              }
            />
            <Route
              path="/subjects"
              element={
                <RequireAuth>
                  <SubjectsPage />
                </RequireAuth>
              }
            />
            <Route
              path="/import"
              element={
                <RequireAuth>
                  <ImportPage />
                </RequireAuth>
              }
            />
            <Route
              path="/matrix"
              element={
                <RequireAuth>
                  <MatrixPage />
                </RequireAuth>
              }
            />
            <Route
              path="/mapping"
              element={
                <RequireAuth>
                  <TemplateMappingPage />
                </RequireAuth>
              }
            />
            <Route
              path="/blocks"
              element={
                <RequireAuth>
                  <BlocksPage />
                </RequireAuth>
              }
            />
            <Route
              path="/lessons"
              element={
                <RequireAuth>
                  <SubjectPage />
                </RequireAuth>
              }
            />
            <Route
              path="/setup"
              element={
                <RequireAuth>
                  <SetupPage />
                </RequireAuth>
              }
            />
            <Route
              path="/todos"
              element={
                <RequireAuth>
                  <TodosPage />
                </RequireAuth>
              }
            />
          </Routes>
        </div>
      </div>
    </AuthProvider>
  );
}
