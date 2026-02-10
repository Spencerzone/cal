// src/App.tsx
import { NavLink, Route, Routes } from "react-router-dom";
import ImportPage from "./pages/ImportPage";
import TodayPage from "./pages/TodayPage";
import WeekPage from "./pages/WeekPage";
import SubjectPage from "./pages/SubjectPage";
import MatrixPage from "./pages/MatrixPage";
import TemplateMappingPage from "./pages/TemplateMappingPage";



export default function App() {
  return (
    <>
      <nav className="nav">
        <NavLink to="/" end className={({ isActive }) => (isActive ? "active" : "")}>
          Today
        </NavLink>
        <NavLink to="/week" className={({ isActive }) => (isActive ? "active" : "")}>
          Week
        </NavLink>
        <NavLink to="/subject" className={({ isActive }) => (isActive ? "active" : "")}>
          Subject
        </NavLink>
        <NavLink to="/import" className={({ isActive }) => (isActive ? "active" : "")}>
          Import
        </NavLink>
        <NavLink to="/matrix" className={({ isActive }) => (isActive ? "active" : "")}>
        Matrix
        </NavLink>
        <NavLink to="/mapping" className={({ isActive }) => (isActive ? "active" : "")}>
        Mapping
        </NavLink>
      </nav>

      <div className="container">
        <Routes>
          <Route path="/" element={<TodayPage />} />
          <Route path="/week" element={<WeekPage />} />
          <Route path="/subject" element={<SubjectPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/matrix" element={<MatrixPage />} />
          <Route path="/mapping" element={<TemplateMappingPage />} />
        </Routes>
      </div>
    </>
  );
}