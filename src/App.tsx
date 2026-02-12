// src/App.tsx
import { useEffect, useMemo, useState } from "react";
import { NavLink, Route, Routes, useLocation } from "react-router-dom";
import ImportPage from "./pages/ImportPage";
import TodayPage from "./pages/TodayPage";
import WeekPage from "./pages/WeekPage";
import SubjectPage from "./pages/SubjectPage";
import MatrixPage from "./pages/MatrixPage";
import TemplateMappingPage from "./pages/TemplateMappingPage";
import BlocksPage from "./pages/BlocksPage";
import SubjectsPage from "./pages/SubjectsPage";
import SetupPage from "./pages/SetupPage";

export default function App() {
  const location = useLocation();
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
    if (location.pathname.startsWith("/subjects")) return "Subjects";
    if (location.pathname.startsWith("/setup")) return "Setup";
    if (location.pathname.startsWith("/subject")) return "Subject";
    if (location.pathname.startsWith("/import")) return "Import";
    if (location.pathname.startsWith("/mapping")) return "Mapping";
    if (location.pathname.startsWith("/blocks")) return "Blocks";
    return "DayBook";
  }, [location.pathname]);

  return (
    <>
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
      </header>

      <div className={sidebarOpen ? "layout" : "layout layout--collapsed"}>
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
            <NavLink to="/subjects" className={({ isActive }) => (isActive ? "active" : "")}>
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
          </nav>
        </aside>

        <div className="container">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/week" element={<WeekPage />} />
          <Route path="/subject" element={<SubjectPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/matrix" element={<MatrixPage />} />
          <Route path="/mapping" element={<TemplateMappingPage />} />
          <Route path="/blocks" element={<BlocksPage />} />
          <Route path="/subjects" element={<SubjectsPage />} />
          <Route path="/setup" element={<SetupPage />} />
        </Routes>
      </div>
      </div>
    </>
  );
}