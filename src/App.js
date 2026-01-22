import React from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import SignIn from './pages/SignIn/SignIn';
import SignUp from './pages/SignUp/SignUp';
import EntryPage from './pages/EntryPage/EntryPage';
import ViewData from './pages/ViewData/ViewData';
import AbstractReport from './pages/AbstractReport/AbstractReport';
import SectionWiseReport from './pages/SectionWiseReport/SectionWiseReport';
import SingleSectionReport from './pages/SingleSectionReport/SingleSectionReport';
import SupplierReport from './pages/SupplierReport/SupplierReport';
import BillNumberSearch from './pages/BillNumberSearch/BillNumberSearch';
import Layout from './components/Layout/Layout';
import UpdateData from './pages/UpdateData/UpdateData';


function App() {
  return (
    <Router>
      <Routes>
        {/* Routes WITHOUT Sidebar */}
        <Route path="/signin" element={<SignIn />} />
        <Route path="/signup" element={<SignUp />} />
        <Route path="/" element={<Navigate to="/signin" replace />} />
        
        {/* Routes WITH Sidebar (wrapped in Layout) */}
        <Route element={<Layout />}>
          <Route path="/EntryPage" element={<EntryPage />} />
          <Route path="/view-data" element={<ViewData />} />
          <Route path="/update-data/:id" element={<UpdateData />} />
          <Route path="/abstract-report" element={<AbstractReport />} />
          <Route path="/section-wise-report" element={<SectionWiseReport />} />
          <Route path="/single-section-report" element={<SingleSectionReport />} />
          <Route path="/supplier-report" element={<SupplierReport />} />
          <Route path="/bill-search" element={<BillNumberSearch />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;