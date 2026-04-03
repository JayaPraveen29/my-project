import React, { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./PriceComparison.css";
export default function PriceComparison() {
  const [data, setData] = useState([]);
  const [reportRows, setReportRows] = useState([]);
  const [financialYear, setFinancialYear] = useState("all");  // ← changed
  const [selectedUnit, setSelectedUnit] = useState("Group");
  const [selectedWorkType, setSelectedWorkType] = useState("Group");
  const [workTypes, setWorkTypes] = useState([]);
  useEffect(() => {
    async function fetchData() {
      try {
        const querySnapshot = await getDocs(collection(db, "entries"));
        const items = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setData(items);
        const uniqueWorkTypes = [...new Set(items.map(item => item["Work Type"] || "Unknown"))];
        setWorkTypes(uniqueWorkTypes);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }
    fetchData();
  }, []);
  const buildGroupLabel = (size, width, itemLength) => {
    let label = size || "";
    if (width && itemLength) label += ` x ${width} x ${itemLength}`;
    else if (width) label += ` x ${width}`;
    else if (itemLength) label += ` x ${itemLength}`;
    return label;
  };
  const buildFullTitle = (section, size, width, itemLength) => {
    const label = buildGroupLabel(size, width, itemLength);
    return label ? `${section} - ${label}` : section;
  };
  useEffect(() => {
    processData();
  }, [data, financialYear, selectedUnit, selectedWorkType]);
  const processData = () => {
    const perEntryMap = {};
    const metaMap = {};
    data.forEach(entry => {
      if (financialYear && financialYear !== "all" && entry.FinancialYear !== financialYear) return;  // ← changed
      if (selectedUnit !== "Group" && entry.Unit !== selectedUnit) return;
      if (selectedWorkType !== "Group" && (entry["Work Type"] || "Unknown") !== selectedWorkType) return;
      const itemsArray = Array.isArray(entry.items) ? entry.items : [];
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      const entryGroupMap = {};
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();
        const groupKey = `${section}|||${size}|||${width}|||${itemLength}`;
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        const itemAmount = entryTotalBasic > 0
          ? (itemBasic / entryTotalBasic) * entryNetAmount
          : 0;
        if (!entryGroupMap[groupKey]) {
          entryGroupMap[groupKey] = { totalQty: 0, totalAmount: 0, section, size, width, itemLength };
        }
        entryGroupMap[groupKey].totalQty += qty;
        entryGroupMap[groupKey].totalAmount += itemAmount;
        if (!metaMap[groupKey]) {
          metaMap[groupKey] = {
            section,
            size,
            width,
            itemLength,
            unit: entry.Unit || "",
            workType: entry["Work Type"] || "",
          };
        }
      });
      Object.entries(entryGroupMap).forEach(([groupKey, vals]) => {
        const entryAvgRate = vals.totalQty > 0 ? vals.totalAmount / vals.totalQty : 0;
        if (entryAvgRate <= 0) return;
        if (!perEntryMap[groupKey]) perEntryMap[groupKey] = [];
        perEntryMap[groupKey].push(entryAvgRate);
      });
    });
    const overallWeightedMap = {};
    data.forEach(entry => {
      if (financialYear && financialYear !== "all" && entry.FinancialYear !== financialYear) return;  // ← changed
      if (selectedUnit !== "Group" && entry.Unit !== selectedUnit) return;
      if (selectedWorkType !== "Group" && (entry["Work Type"] || "Unknown") !== selectedWorkType) return;
      const itemsArray = Array.isArray(entry.items) ? entry.items : [];
      const entryTotalBasic = itemsArray.reduce((sum, item) => sum + (Number(item["Bill Basic Amount"]) || 0), 0);
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();
        const groupKey = `${section}|||${size}|||${width}|||${itemLength}`;
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        const itemAmount = entryTotalBasic > 0
          ? (itemBasic / entryTotalBasic) * entryNetAmount
          : 0;
        if (!overallWeightedMap[groupKey]) overallWeightedMap[groupKey] = { totalAmount: 0, totalQty: 0 };
        overallWeightedMap[groupKey].totalAmount += itemAmount;
        overallWeightedMap[groupKey].totalQty += qty;
      });
    });
    const rows = Object.keys(metaMap).map(groupKey => {
      const meta = metaMap[groupKey];
      const entryRates = perEntryMap[groupKey] || [];
      const { totalAmount = 0, totalQty = 0 } = overallWeightedMap[groupKey] || {};
      const weightedAvgRate = totalQty > 0 ? totalAmount / totalQty : 0;
      const highestRate = entryRates.length > 0 ? Math.max(...entryRates) : 0;
      const lowestRate = entryRates.length > 0 ? Math.min(...entryRates) : 0;
      return {
        groupKey,
        section: meta.section,
        size: meta.size,
        width: meta.width,
        itemLength: meta.itemLength,
        unit: meta.unit,
        workType: meta.workType,
        weightedAvgRate,
        highestRate,
        lowestRate,
      };
    }).sort((a, b) => {
      const titleA = buildFullTitle(a.section, a.size, a.width, a.itemLength);
      const titleB = buildFullTitle(b.section, b.size, b.width, b.itemLength);
      return titleA.localeCompare(titleB);
    });
    setReportRows(rows);
  };
  const formatAmount = (value) =>
    !value && value !== 0
      ? "0"
      : Math.ceil(Number(value)).toLocaleString("en-IN");
  const showUnitColumn = selectedUnit === "Group";
  const showWorkTypeColumn = selectedWorkType === "Group";
  const exportExcel = () => {
    if (reportRows.length === 0) { alert("No data to export"); return; }
    const wsData = [];
    wsData.push(["Price Comparison Report"]);
    const filterParts = [];
    if (financialYear && financialYear !== "all") filterParts.push(financialYear);  // ← changed
    if (selectedUnit !== "Group") filterParts.push(selectedUnit);
    if (selectedWorkType !== "Group") filterParts.push(selectedWorkType);
    if (filterParts.length > 0) wsData.push([filterParts.join(" | ")]);
    wsData.push([]);
    const headers = ["S.No", "Section"];
    if (showUnitColumn) headers.push("Unit");
    if (showWorkTypeColumn) headers.push("Work Type");
    headers.push("Avg. Rate", "Highest Rate", "Lowest Rate");
    wsData.push(headers);
    reportRows.forEach((row, idx) => {
      const title = buildFullTitle(row.section, row.size, row.width, row.itemLength);
      const r = [idx + 1, title];
      if (showUnitColumn) r.push(row.unit);
      if (showWorkTypeColumn) r.push(row.workType);
      r.push(
        Math.ceil(row.weightedAvgRate),
        Math.ceil(row.highestRate),
        Math.ceil(row.lowestRate)
      );
      wsData.push(r);
    });
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = headers.map((h) => ({
      wch: h === "Section" ? 30 : 15
    }));
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
    XLSX.utils.book_append_sheet(wb, ws, "Price Comparison");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `price_comparison_report_${timestamp}.xlsx`);
  };
  const exportPDF = () => {
    if (reportRows.length === 0) { alert("No data to export"); return; }
    const doc = new jsPDF("p", "pt", "a4");
    doc.setFontSize(16);
    doc.text("Price Comparison Report", 14, 25);
    const filterParts = [];
    if (financialYear && financialYear !== "all") filterParts.push(financialYear);  // ← changed
    if (selectedUnit !== "Group") filterParts.push(selectedUnit);
    if (selectedWorkType !== "Group") filterParts.push(selectedWorkType);
    if (filterParts.length > 0) {
      doc.setFontSize(10);
      doc.text(filterParts.join(" | "), 14, 40);
    }
    const headers = ["S.No", "Section"];
    if (showUnitColumn) headers.push("Unit");
    if (showWorkTypeColumn) headers.push("Work Type");
    headers.push("Avg. Rate", "Highest Rate", "Lowest Rate");
    const tableData = reportRows.map((row, idx) => {
      const title = buildFullTitle(row.section, row.size, row.width, row.itemLength);
      const r = [idx + 1, title];
      if (showUnitColumn) r.push(row.unit);
      if (showWorkTypeColumn) r.push(row.workType);
      r.push(
        formatAmount(row.weightedAvgRate),
        formatAmount(row.highestRate),
        formatAmount(row.lowestRate)
      );
      return r;
    });
    autoTable(doc, {
      head: [headers],
      body: tableData,
      startY: filterParts.length > 0 ? 50 : 35,
      margin: { left: 14 },
      styles: { fontSize: 6.5, cellPadding: 0.5, halign: "center" },
      headStyles: { fillColor: [230, 240, 255], textColor: [0, 0, 0], fontStyle: "bold", cellPadding: 1 },
      columnStyles: {
        1: { halign: "left", cellWidth: 180 },
      },
      rowPageBreak: "avoid",
    });
    doc.save("Price_Comparison_Report.pdf");
  };
  const clearFilters = () => {
    setFinancialYear("all");  // ← changed
    setSelectedUnit("Group");
    setSelectedWorkType("Group");
  };
  return (
    <div className="price-comparison-container">
      <h1 className="price-comparison-heading">Price Comparison Report</h1>
      <div className="filter-container">
        <div className="filter-row">
          <label htmlFor="financial-year-select">Financial Year:</label>
          <select
            id="financial-year-select"
            className="filter-select"
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
          >
            <option value="all">All Years</option>  {/* ← added */}
            <option value="2024-25">2024-25</option>
            <option value="2025-26">2025-26</option>
            <option value="2026-27">2026-27</option>
            <option value="2027-28">2027-28</option>
          </select>
          <label htmlFor="unit-select">Select Unit:</label>
          <select
            id="unit-select"
            className="filter-select"
            value={selectedUnit}
            onChange={(e) => setSelectedUnit(e.target.value)}
          >
            <option value="Group">Group</option>
            {Array.from(new Set(data.map((item) => item.Unit).filter(Boolean))).sort().map((unit, i) => (
              <option key={i} value={unit}>{unit}</option>
            ))}
          </select>
          <label htmlFor="worktype-select">Work Type:</label>
          <select
            id="worktype-select"
            className="filter-select"
            value={selectedWorkType}
            onChange={(e) => setSelectedWorkType(e.target.value)}
          >
            <option value="Group">Group</option>
            {workTypes.map((type, i) => (
              <option key={i} value={type}>{type}</option>
            ))}
          </select>
          <button onClick={clearFilters} className="btn-clear">Clear Filters</button>
          <button onClick={exportExcel} className="btn-export btn-excel">Export Excel</button>
          <button onClick={exportPDF} className="btn-export btn-pdf">Export PDF</button>
        </div>
      </div>
      <div className="report-summary">
        <span className="summary-badge">{reportRows.length} Sections</span>
      </div>
      <div className="table-container">
        {reportRows.length === 0 ? (
          <div className="empty-state">
            <p>No data available. Please add entries first.</p>
          </div>
        ) : (
          <table className="price-comparison-table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <th className="col-section">Section</th>
                {showUnitColumn && <th className="col-unit">Unit</th>}
                {showWorkTypeColumn && <th className="col-worktype">Work Type</th>}
                <th className="col-rate">Avg. Rate</th>
                <th className="col-rate col-highest">Highest Rate</th>
                <th className="col-rate col-lowest">Lowest Rate</th>
              </tr>
            </thead>
            <tbody>
              {reportRows.map((row, idx) => {
                const title = buildFullTitle(row.section, row.size, row.width, row.itemLength);
                return (
                  <tr key={row.groupKey}>
                    <td className="text-center">{idx + 1}</td>
                    <td className="text-left section-cell">{title}</td>
                    {showUnitColumn && <td className="text-center">{row.unit}</td>}
                    {showWorkTypeColumn && <td className="text-center">{row.workType}</td>}
                    <td className="text-right">{formatAmount(row.weightedAvgRate)}</td>
                    <td className="text-right rate-high">{formatAmount(row.highestRate)}</td>
                    <td className="text-right rate-low">{formatAmount(row.lowestRate)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}