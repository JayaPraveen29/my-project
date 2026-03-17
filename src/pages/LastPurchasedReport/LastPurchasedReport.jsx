import React, { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./LastPurchasedReport.css";

export default function LastPurchasedReport() {
  const [data, setData] = useState([]);
  const [reportRows, setReportRows] = useState([]);
  const [financialYear, setFinancialYear] = useState("2025-26");
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

  const parseDate = (dateStr) => {
    if (!dateStr) return null;
    const ddmmyyyy = dateStr.match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (ddmmyyyy) return new Date(`${ddmmyyyy[3]}-${ddmmyyyy[2]}-${ddmmyyyy[1]}`);
    const yyyymmdd = dateStr.match(/^\d{4}-\d{2}-\d{2}$/);
    if (yyyymmdd) return new Date(dateStr);
    return null;
  };

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
    // bestMap: groupKey -> latest entry candidate
    const bestMap = {};
    // rateMap: groupKey -> array of all landed cost rates
    const rateMap = {};

    data.forEach(entry => {
      if (financialYear && entry.FinancialYear !== financialYear) return;
      if (selectedUnit !== "Group" && entry.Unit !== selectedUnit) return;
      if (selectedWorkType !== "Group" && (entry["Work Type"] || "Unknown") !== selectedWorkType) return;

      const receivedOn = entry["Received On"] || "";
      const receivedDate = parseDate(receivedOn);
      const entryNo = Number(entry.No) || 0;

      const itemsArray = Array.isArray(entry.items) ? entry.items : [];

      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();

        const groupKey = `${section}|||${size}|||${width}|||${itemLength}`;

        const subtotal = parseFloat(item["Section Subtotal"]) || 0;
        const mt = parseFloat(item["Quantity in Metric Tons"]) || 0;
        const landedRate = mt > 0 ? subtotal / mt : 0;

        // Collect all rates for highest/lowest
        if (landedRate > 0) {
          if (!rateMap[groupKey]) rateMap[groupKey] = [];
          rateMap[groupKey].push(landedRate);
        }

        const candidate = {
          groupKey,
          section,
          size,
          width,
          itemLength,
          receivedOn,
          receivedDate,
          entryNo,
          avgRate: landedRate,
          supplier: entry["Name of the Supplier"] || "",
          unit: entry.Unit || "",
          workType: entry["Work Type"] || "",
          billNumber: entry["Bill Number"] || "",
        };

        if (!bestMap[groupKey]) {
          bestMap[groupKey] = candidate;
        } else {
          const existing = bestMap[groupKey];
          const existingDate = existing.receivedDate;
          const newDate = receivedDate;

          if (newDate && existingDate) {
            if (newDate > existingDate) {
              bestMap[groupKey] = candidate;
            } else if (newDate.getTime() === existingDate.getTime() && entryNo > existing.entryNo) {
              bestMap[groupKey] = candidate;
            }
          } else if (newDate && !existingDate) {
            bestMap[groupKey] = candidate;
          } else if (!newDate && !existingDate && entryNo > existing.entryNo) {
            bestMap[groupKey] = candidate;
          }
        }
      });
    });

    // Attach highest and lowest rates
    const rows = Object.values(bestMap).map(row => {
      const rates = rateMap[row.groupKey] || [];
      return {
        ...row,
        highestRate: rates.length > 0 ? Math.max(...rates) : 0,
        lowestRate: rates.length > 0 ? Math.min(...rates) : 0,
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
    wsData.push(["Last Purchased Report"]);

    const filterParts = [];
    if (financialYear) filterParts.push(financialYear);
    if (selectedUnit !== "Group") filterParts.push(selectedUnit);
    if (selectedWorkType !== "Group") filterParts.push(selectedWorkType);
    if (filterParts.length > 0) wsData.push([filterParts.join(" | ")]);
    wsData.push([]);

    const headers = ["S.No", "Section"];
    if (showUnitColumn) headers.push("Unit");
    if (showWorkTypeColumn) headers.push("Work Type");
    headers.push("Supplier", "Bill No", "Recd. Date", "Avg. Rate", "Highest Rate", "Lowest Rate");
    wsData.push(headers);

    reportRows.forEach((row, idx) => {
      const title = buildFullTitle(row.section, row.size, row.width, row.itemLength);
      const r = [idx + 1, title];
      if (showUnitColumn) r.push(row.unit);
      if (showWorkTypeColumn) r.push(row.workType);
      r.push(
        row.supplier,
        row.billNumber,
        row.receivedOn,
        Math.ceil(row.avgRate),
        Math.ceil(row.highestRate),
        Math.ceil(row.lowestRate)
      );
      wsData.push(r);
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    ws["!cols"] = headers.map((h) => ({
      wch: h === "Section" ? 28 : h === "Supplier" ? 25 : 14
    }));
    ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];

    XLSX.utils.book_append_sheet(wb, ws, "Last Purchased");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `last_purchased_report_${timestamp}.xlsx`);
  };

  const exportPDF = () => {
    if (reportRows.length === 0) { alert("No data to export"); return; }

    const doc = new jsPDF("l", "pt", "a4");
    doc.setFontSize(16);
    doc.text("Last Purchased Report", 14, 25);

    const filterParts = [];
    if (financialYear) filterParts.push(financialYear);
    if (selectedUnit !== "Group") filterParts.push(selectedUnit);
    if (selectedWorkType !== "Group") filterParts.push(selectedWorkType);
    if (filterParts.length > 0) {
      doc.setFontSize(10);
      doc.text(filterParts.join(" | "), 14, 40);
    }

    const headers = ["S.No", "Section"];
    if (showUnitColumn) headers.push("Unit");
    if (showWorkTypeColumn) headers.push("Work Type");
    headers.push("Supplier", "Bill No", "Recd. Date", "Avg. Rate", "Highest Rate", "Lowest Rate");

    const tableData = reportRows.map((row, idx) => {
      const title = buildFullTitle(row.section, row.size, row.width, row.itemLength);
      const r = [idx + 1, title];
      if (showUnitColumn) r.push(row.unit);
      if (showWorkTypeColumn) r.push(row.workType);
      r.push(
        row.supplier,
        row.billNumber,
        row.receivedOn,
        formatAmount(row.avgRate),
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
      styles: { fontSize: 8, cellPadding: 3, halign: "center" },
      headStyles: { fillColor: [230, 240, 255], textColor: [0, 0, 0], fontStyle: "bold" },
      columnStyles: { 1: { halign: "left" }, 4: { halign: "left" } },
    });

    doc.save("Last_Purchased_Report.pdf");
  };

  const clearFilters = () => {
    setFinancialYear("2025-26");
    setSelectedUnit("Group");
    setSelectedWorkType("Group");
  };

  return (
    <div className="last-purchased-container">
      <h1 className="last-purchased-heading">Last Purchased Report</h1>

      <div className="filter-container">
        <div className="filter-row">
          <label htmlFor="financial-year-select">Financial Year:</label>
          <select
            id="financial-year-select"
            className="filter-select"
            value={financialYear}
            onChange={(e) => setFinancialYear(e.target.value)}
          >
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
          <table className="last-purchased-table">
            <thead>
              <tr>
                <th className="col-sno">S.No</th>
                <th className="col-section">Section</th>
                {showUnitColumn && <th className="col-unit">Unit</th>}
                {showWorkTypeColumn && <th className="col-worktype">Work Type</th>}
                <th className="col-supplier">Supplier</th>
                <th className="col-billno">Bill No</th>
                <th className="col-date">Recd. Date</th>
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
                    <td className="text-left">{row.supplier}</td>
                    <td className="text-center">{row.billNumber}</td>
                    <td className="text-center">{row.receivedOn}</td>
                    <td className="text-right">{formatAmount(row.avgRate)}</td>
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