import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { HiChartBar, HiChartPie, HiMenu, HiX } from 'react-icons/hi';
import './SideNavbar.css';

export default function SideNavbar() {
  const [reportsOpen, setReportsOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  const closeMobileMenu = () => {
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* Hamburger Button (visible only on mobile) */}
      <button className="hamburger-btn" onClick={toggleMobileMenu}>
        {mobileMenuOpen ? <HiX /> : <HiMenu />}
      </button>

      {/* Overlay (to close menu when clicking outside) */}
      {mobileMenuOpen && (
        <div className="sidebar-overlay" onClick={closeMobileMenu}></div>
      )}

      {/* Sidebar */}
      <aside className={`sidebar ${mobileMenuOpen ? 'mobile-open' : ''}`}>
        <h2 className="sidebar-title">SIEC GROUP</h2>

        <ul className="sidebar-list">
          <li>
            <Link to="/EntryPage" className="menu-btn" onClick={closeMobileMenu}>
              <HiChartBar /> Add Entry
            </Link>
          </li>

          <li>
            <Link to="/view-data" className="menu-btn" onClick={closeMobileMenu}>
              <HiChartBar /> View Data
            </Link>
          </li>

          <li>
            <button
              className="menu-btn dropdown-btn"
              onClick={() => setReportsOpen(!reportsOpen)}
              type="button"
            >
              <HiChartPie /> Generate Reports
              <span className={`arrow ${reportsOpen ? "open" : ""}`}>▼</span>
            </button>

            {reportsOpen && (
              <ul className="dropdown-list">
                <li><Link to="/abstract-report" className="dropdown-item" onClick={closeMobileMenu}>Abstract Report</Link></li>
                <li><Link to="/section-wise-report" className="dropdown-item" onClick={closeMobileMenu}>Section Wise Report</Link></li>
                <li><Link to="/single-section-report" className="dropdown-item" onClick={closeMobileMenu}>Single Section Report</Link></li>
                <li><Link to="/supplier-report" className="dropdown-item" onClick={closeMobileMenu}>Supplier Report</Link></li>
                <li><Link to="/bill-search" className="dropdown-item" onClick={closeMobileMenu}>Bill Number Search</Link></li>
                <li><Link to="/last-purchased-report" className="dropdown-item" onClick={closeMobileMenu}>Last Purchase Summary</Link></li>
                <li><Link to="/Price-Comparison" className="dropdown-item" onClick={closeMobileMenu}>Price Comparison</Link></li>
              </ul>
            )}
          </li>

          </ul>

        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          <li>
            <Link to="/manage-masters" className="menu-btn" onClick={closeMobileMenu}>
              <HiChartBar /> Data Manager
            </Link>
          </li>
        </ul>

  

        <div className="sidebar-bottom">
          <Link to="/signin" className="logout-btn" onClick={closeMobileMenu}>LOGOUT</Link>
        </div>
      </aside>
    </>
  );
}