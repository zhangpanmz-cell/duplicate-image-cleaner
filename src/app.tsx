import { Routes, Route } from "react-router-dom";
import { Layout } from "@/components/Layout";
import HomePage from "@/pages/HomePage/HomePage";
import ScanningPage from "@/pages/ScanningPage/ScanningPage";
import ResultsPage from "@/pages/ResultsPage/ResultsPage";
import DonePage from "@/pages/DonePage/DonePage";
import NotFoundPage from "@/pages/NotFoundPage/NotFoundPage";

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<HomePage />} />
        <Route path="scanning" element={<ScanningPage />} />
        <Route path="results" element={<ResultsPage />} />
        <Route path="done" element={<DonePage />} />
      </Route>
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
