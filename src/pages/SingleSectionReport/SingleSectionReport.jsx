import React, { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./SingleSectionReport.css";
export default function SingleSectionReport() {
  const [data, setData] = useState([]);
  const [groupedData, setGroupedData] = useState({});
  const [financialYear, setFinancialYear] = useState("2026-27");
  const [selectedUnit, setSelectedUnit] = useState("Group");
  const [selectedWorkType, setSelectedWorkType] = useState("Group");
  const [selectedSection, setSelectedSection] = useState("");
  const [selectedGroupKey, setSelectedGroupKey] = useState("");
  const [workTypes, setWorkTypes] = useState([]);
  const parseDateSafe = (v) => {
    if (!v) return null;
    try { if (typeof v.toDate === "function") return v.toDate(); } catch (e) {}
    if (typeof v === "string") {
      const ddmmyyyy = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        const d = new Date(`${year}-${month}-${day}`);
        if (!isNaN(d)) return d;
      }
      const yyyymmdd = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (yyyymmdd) {
        const d = new Date(v);
        if (!isNaN(d)) return d;
      }
    }
    const dt = new Date(v);
    return isNaN(dt) ? null : dt;
  };
  const compareDatesDayMonthYear = (a, b) => {
    const da = parseDateSafe(a);
    const db2 = parseDateSafe(b);
    if (!da && !db2) return 0;
    if (!da) return 1;
    if (!db2) return -1;
    if (da.getFullYear() !== db2.getFullYear()) return da.getFullYear() - db2.getFullYear();
    if (da.getMonth() !== db2.getMonth()) return da.getMonth() - db2.getMonth();
    return da.getDate() - db2.getDate();
  };
  const buildRecdOnDisplay = (recdDates) => {
    const sorted = [...recdDates].sort((a, b) => compareDatesDayMonthYear(a, b));
    if (sorted.length === 0) return "";
    if (sorted.length === 1) return sorted[0];
    return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
  };
  const getGroupRecdOnDisplay = (entries) => {
    const uniqueDates = [...new Set(entries.map(e => e.recdOn).filter(Boolean))];
    return buildRecdOnDisplay(uniqueDates);
  };
  useEffect(() => {
    async function fetchData() {
      try {
        const querySnapshot = await getDocs(collection(db, "entries"));
        const items = querySnapshot.docs.map(doc => doc.data());
        setData(items);
        const uniqueWorkTypes = [...new Set(items.map(item => item["Work Type"] || "Unknown"))];
        setWorkTypes(uniqueWorkTypes);
        processData(items);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }
    fetchData();
  }, []);
  const processData = (items) => {
    const grouped = {};
    items.forEach(entry => {
      if (financialYear && financialYear !== "all" && entry.FinancialYear !== financialYear) return;
      if (selectedUnit !== "Group" && entry.Unit !== selectedUnit) return;
      if (selectedWorkType !== "Group" && (entry["Work Type"] || "Unknown") !== selectedWorkType) return;
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      const recdOn = entry["Received On"] || entry["Recd. On"] || "";
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();
        const groupKey = `${size}|||${width}|||${itemLength}`;
        const unit = entry["Unit"] || "";
        const workType = entry["Work Type"] || "";
        const supplier = entry["Name of the Supplier"] || "";
        const place = entry["Supplier Place"] || "";
        const itemCount = Number(item["Number of items Supplied"]) || 0;
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        const itemAmount = entryTotalBasic > 0
          ? (itemBasic / entryTotalBasic) * entryNetAmount
          : 0;
        if (!grouped[section]) grouped[section] = {};
        if (!grouped[section][groupKey]) grouped[section][groupKey] = [];
        grouped[section][groupKey].push({
          unit, workType, supplier, place,
          size, width, itemLength,
          itemCount, qty, amount: itemAmount,
          recdOn,
        });
      });
    });
    Object.keys(grouped).forEach(section => {
      Object.keys(grouped[section]).forEach(groupKey => {
        grouped[section][groupKey].sort((a, b) =>
          compareDatesDayMonthYear(a.recdOn, b.recdOn)
        );
      });
    });
    setGroupedData(grouped);
    const sections = Object.keys(grouped).sort();
    if (sections.length > 0 && !selectedSection) setSelectedSection(sections[0]);
  };
  useEffect(() => {
    processData(data);
  }, [financialYear, selectedUnit, selectedWorkType, data]);
  const buildGroupLabel = (groupKey) => {
    const [size, width, itemLength] = groupKey.split("|||");
    let label = size || "";
    if (width && itemLength) label += ` x ${width} x ${itemLength}`;
    else if (width) label += ` x ${width}`;
    else if (itemLength) label += ` x ${itemLength}`;
    return label;
  };
  const buildFullTitle = (section, groupKey) => {
    const label = buildGroupLabel(groupKey);
    return label ? `${section} - ${label}` : section;
  };
  const formatNumber = (v) =>
    (!v && v !== 0) ? "0" : Number(v).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const formatAmount = (v) =>
    (!v && v !== 0) ? "0" : Math.ceil(Number(v)).toLocaleString("en-IN");
  const calculateAvgRate = (amount, qty) => (!qty || qty === 0 ? 0 : amount / qty);
  const exportExcel = () => {
    if (!selectedSection || !selectedGroupKey) {
      alert("Please select Section and Size to export");
      return;
    }
    const wsData = [];
    const title = buildFullTitle(selectedSection, selectedGroupKey);
    wsData.push([title]);
    let filterText = "";
    if (selectedUnit !== "Group") filterText += `Unit: ${selectedUnit}`;
    if (selectedWorkType !== "Group") {
      if (filterText) filterText += " | ";
      filterText += `Work Type: ${selectedWorkType}`;
    }
    if (filterText) wsData.push([filterText]);
    wsData.push([]);
    const entries = groupedData[selectedSection][selectedGroupKey];
    const totalQty = entries.reduce((s, e) => s + e.qty, 0);
    const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
    const avgRate = calculateAvgRate(totalAmount, totalQty);
    const headers = ["Recd. On", "Unit", "Work Type", "Supplier", "Place", "Items", "Qty (MT)", "Amount", "Avg. Rate"];
    wsData.push(headers);
    entries.forEach(entry => {
      wsData.push([
        entry.recdOn || "",
        entry.unit,
        entry.workType,
        entry.supplier,
        entry.place,
        entry.itemCount,
        entry.qty,
        entry.amount,
        calculateAvgRate(entry.amount, entry.qty)
      ]);
    });
    wsData.push(["", "TOTAL", "", "", "", "", totalQty, totalAmount, avgRate]);
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = [
      { wch: 22 }, { wch: 12 }, { wch: 15 }, { wch: 25 },
      { wch: 15 }, { wch: 10 }, { wch: 12 }, { wch: 15 }, { wch: 15 },
    ];
    ws["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }
    ];
    const range = XLSX.utils.decode_range(ws["!ref"]);
    const dataStartRow = filterText ? 3 : 2;
    for (let R = dataStartRow; R <= range.e.r; R++) {
      [[5, "#,##0"], [6, "#,##0.000"], [7, "#,##0"], [8, "#,##0"]].forEach(([C, fmt]) => {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (ws[addr] && typeof ws[addr].v === "number") {
          ws[addr].t = "n";
          ws[addr].z = fmt;
        }
      });
    }
    XLSX.utils.book_append_sheet(wb, ws, "Single Section");
    const [size] = selectedGroupKey.split("|||");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `single_section_${selectedSection}_${size}_${timestamp}.xlsx`);
  };
  const exportPDF = () => {
    if (!selectedSection || !selectedGroupKey) {
      alert("Please select Section and Size to export");
      return;
    }
    const doc = new jsPDF("l", "pt", "a4");
    let title = buildFullTitle(selectedSection, selectedGroupKey);
    if (selectedUnit !== "Group") title += ` - ${selectedUnit}`;
    if (selectedWorkType !== "Group") title += ` (${selectedWorkType})`;
    doc.setFontSize(14);
    doc.text(title, 14, 25);
    const entries = groupedData[selectedSection][selectedGroupKey];
    const totalQty = entries.reduce((s, e) => s + e.qty, 0);
    const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
    const avgRate = calculateAvgRate(totalAmount, totalQty);
    const tableData = entries.map(e => [
      e.recdOn || "",
      e.unit,
      e.workType,
      e.supplier,
      e.place,
      e.itemCount.toLocaleString("en-IN"),
      formatNumber(e.qty),
      formatAmount(e.amount),
      formatAmount(calculateAvgRate(e.amount, e.qty))
    ]);
    tableData.push([
      "", "TOTAL", "", "", "", "",
      formatNumber(totalQty),
      formatAmount(totalAmount),
      formatAmount(avgRate)
    ]);
    autoTable(doc, {
      head: [["Recd. On", "Unit", "Work Type", "Supplier", "Place", "Items", "Qty (MT)", "Amount", "Avg. Rate"]],
      body: tableData,
      startY: 40,
      margin: { left: 14 },
      styles: { fontSize: 7, halign: "center" },
      headStyles: {
        fillColor: [230, 240, 255],
        textColor: [0, 0, 0],
        fontStyle: "bold"
      },
    });
    const [size] = selectedGroupKey.split("|||");
    doc.save(`Single_Section_Report_${selectedSection}_${size}.pdf`);
  };
  const sections = Object.keys(groupedData).sort();
  const groupKeys = selectedSection ? Object.keys(groupedData[selectedSection] || {}).sort() : [];
  const units = ["Group", ...Array.from(new Set(data.map(d => d.Unit)))];
  const clearFilters = () => {
    setFinancialYear("all");  // ← changed
    setSelectedUnit("Group");
    setSelectedWorkType("Group");
    setSelectedSection("");
    setSelectedGroupKey("");
  };
  return (
    <div className="single-section-container">
      <h1 className="single-section-heading">Single Section Report</h1>
      <div className="filter-container">
        <div className="filter-row">
          <label htmlFor="financial-year-select">Financial Year:</label>
          <select
            id="financial-year-select"
            className="filter-select"
            value={financialYear}
            onChange={(e) => { setFinancialYear(e.target.value); setSelectedSection(""); setSelectedGroupKey(""); }}
          >
            <option value="all">All Years</option>
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
            onChange={(e) => { setSelectedUnit(e.target.value); setSelectedSection(""); setSelectedGroupKey(""); }}
          >
            {units.map((unit, idx) => <option key={idx} value={unit}>{unit}</option>)}
          </select>
          <label htmlFor="worktype-select">Work Type:</label>
          <select
            id="worktype-select"
            className="filter-select"
            value={selectedWorkType}
            onChange={(e) => { setSelectedWorkType(e.target.value); setSelectedSection(""); setSelectedGroupKey(""); }}
          >
            <option value="Group">Group</option>
            {workTypes.map((type, idx) => <option key={idx} value={type}>{type}</option>)}
          </select>
          <label htmlFor="section-select">Section:</label>
          <select
            id="section-select"
            className="filter-select"
            value={selectedSection}
            onChange={(e) => { setSelectedSection(e.target.value); setSelectedGroupKey(""); }}
          >
            <option value="">-- Select Section --</option>
            {sections.map((section, idx) => <option key={idx} value={section}>{section}</option>)}
          </select>
          <label htmlFor="size-select">Size:</label>
          <select
            id="size-select"
            className="filter-select"
            value={selectedGroupKey}
            onChange={(e) => setSelectedGroupKey(e.target.value)}
            disabled={!selectedSection}
          >
            <option value="">-- Select Size --</option>
            {groupKeys.map((gk, idx) => (
              <option key={idx} value={gk}>{buildGroupLabel(gk)}</option>
            ))}
          </select>
        </div>
        <div className="button-row">
          <button onClick={clearFilters} className="btn-clear">Clear Filters</button>
          <button
            onClick={exportExcel}
            className="btn-export btn-excel"
            disabled={!selectedSection || !selectedGroupKey}
          >
            Export Excel
          </button>
          <button
            onClick={exportPDF}
            className="btn-export btn-pdf"
            disabled={!selectedSection || !selectedGroupKey}
          >
            Export PDF
          </button>
        </div>
      </div>
      {selectedSection && selectedGroupKey ? (
        <div className="table-wrapper">
          <div className="section-header">
            <h2 className="section-title">
              {buildFullTitle(selectedSection, selectedGroupKey)}
              {selectedWorkType !== "Group" && (
                <span className="work-type-badge"> ({selectedWorkType})</span>
              )}
            </h2>
          </div>
          {(() => {
            const entries = groupedData[selectedSection][selectedGroupKey];
            const totalQty = entries.reduce((s, e) => s + e.qty, 0);
            const totalAmount = entries.reduce((s, e) => s + e.amount, 0);
            const avgRate = calculateAvgRate(totalAmount, totalQty);
            return (
              <table className="single-section-table">
                <thead>
                  <tr>
                    <th style={{ whiteSpace: "nowrap" }}>Recd. On</th>
                    <th>Unit</th>
                    <th>Work Type</th>
                    <th>Supplier</th>
                    <th>Place</th>
                    <th>Items</th>
                    <th>Qty (MT)</th>
                    <th>Amount</th>
                    <th>Avg. Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry, idx) => (
                    <tr key={idx}>
                      <td style={{ whiteSpace: "nowrap" }}>{entry.recdOn || ""}</td>
                      <td>{entry.unit}</td>
                      <td>{entry.workType}</td>
                      <td className="text-left">{entry.supplier}</td>
                      <td>{entry.place}</td>
                      <td>{entry.itemCount.toLocaleString("en-IN")}</td>
                      <td>{formatNumber(entry.qty)}</td>
                      <td>{formatAmount(entry.amount)}</td>
                      <td>{formatAmount(calculateAvgRate(entry.amount, entry.qty))}</td>
                    </tr>
                  ))}
                  <tr className="total-row">
                    <td></td>
                    <td colSpan={4}>TOTAL</td>
                    <td></td>
                    <td>{formatNumber(totalQty)}</td>
                    <td>{formatAmount(totalAmount)}</td>
                    <td>{formatAmount(avgRate)}</td>
                  </tr>
                </tbody>
              </table>
            );
          })()}
        </div>
      ) : (
        <div className="empty-state">
          <p>Please select <strong>Unit, Work Type, Section & Size</strong> to view the report</p>
        </div>
      )}
    </div>
  );
}