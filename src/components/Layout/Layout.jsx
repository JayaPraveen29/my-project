import React from 'react';
import { Outlet } from 'react-router-dom';
import SideNavbar from '../SideNavbar/SideNavbar';
import './Layout.css';

export default function Layout() {
  return (
    <div className="layout-container">
      <SideNavbar />
      <main className="page-content">
        <Outlet />
      </main>
    </div>
  );
}