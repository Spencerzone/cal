// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation, useNavigate } from "react-router-dom";

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
      className="btn"
      type="button"
      onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}
      title="Toggle theme"
      style={{ marginLeft: 8 }}
    >
      {theme === "dark" ? "Light mode" : "Dark mode"}
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
    if (location.pathname.startsWith("/login")) return "Login";
    return "DayBook";
  }, [location.pathname]);

  return (
    <AuthProvider>
      <style>{`
:root{--accent:#4c8dff;}
:root[data-theme='dark']{--bg:#0b0b0b;--panel:#111;--panel2:#0f0f0f;--text:#f3f3f3;--muted:#a3a3a3;--border:#2a2a2a;}
:root[data-theme='light']{--bg:#f6f6f6;--panel:#ffffff;--panel2:#ffffff;--text:#111111;--muted:#555555;--border:#d0d0d0;}
body{background:var(--bg);color:var(--text);}
.card{background:var(--panel);border:1px solid var(--border);}
.btn{background:var(--panel2);color:var(--text);border:1px solid var(--border);} 
input,select,textarea{background:var(--panel2);color:var(--text);border:1px solid var(--border);} 
.muted{color:var(--muted);}
`}</style>
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
              <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
                Today
              </NavLink>
              <NavLink to="/week" className={({ isActive }) => (isActive ? "active" : "")}>
                Week
              </NavLink>
              <NavLink to="/matrix" className={({ isActive }) => (isActive ? "active" : "")}>
                Matrix
              </NavLink>
              <NavLink to="/lessons" className={({ isActive }) => (isActive ? "active" : "")}>
                Subjects
              </NavLink>
              <div className="navDivider" />
              <NavLink to="/setup" className={({ isActive }) => (isActive ? "active" : "")}>
                Setup
              </NavLink>
              <NavLink to="/subject" className={({ isActive }) => (isActive ? "active" : "")}>
                Subject
              </NavLink>
              <NavLink to="/import" className={({ isActive }) => (isActive ? "active" : "")}>
                Import
              </NavLink>
              <NavLink to="/mapping" className={({ isActive }) => (isActive ? "active" : "")}>
                Mapping
              </NavLink>
              <NavLink to="/blocks" className={({ isActive }) => (isActive ? "active" : "")}>
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
                path="/subject"
                element={
                  <RequireAuth>
                    <SubjectPage />
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
                path="/subjects"
                element={
                  <RequireAuth>
                    <SubjectsPage />
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
          </Routes>
        </div>
      </div>
    </AuthProvider>
  );
}