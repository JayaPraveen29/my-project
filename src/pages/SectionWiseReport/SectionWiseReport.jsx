import React, { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./SectionWiseReport.css";

export default function SectionWiseReport() {
  const [data, setData] = useState([]);
  const [groupedData, setGroupedData] = useState({});
  const [financialYear, setFinancialYear] = useState("2025-26");
  const [selectedUnit, setSelectedUnit] = useState("Group");
  const [selectedWorkType, setSelectedWorkType] = useState("Group");
  const [workTypes, setWorkTypes] = useState([]);

  // ─── Recd. On helpers (same as AbstractReport) ───────────────────────────
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
    if (da.getDate() !== db2.getDate()) return da.getDate() - db2.getDate();
    if (da.getMonth() !== db2.getMonth()) return da.getMonth() - db2.getMonth();
    return da.getFullYear() - db2.getFullYear();
  };

  const buildRecdOnDisplay = (recdDates) => {
    const sorted = [...recdDates].sort(compareDatesDayMonthYear);
    if (sorted.length === 0) return "";
    if (sorted.length === 1) return sorted[0];
    return `${sorted[0]} to ${sorted[sorted.length - 1]}`;
  };
  // ─────────────────────────────────────────────────────────────────────────

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
      if (financialYear && entry.FinancialYear !== financialYear) return;
      if (selectedUnit !== "Group" && entry.Unit !== selectedUnit) return;
      if (selectedWorkType !== "Group" && (entry["Work Type"] || "Unknown") !== selectedWorkType) return;

      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];

      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);

      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);

      // ── grab Recd. On from the entry ──
      const recdOn = entry["Received On"] || entry["Recd. On"] || "";

      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();

        const groupKey = `${section}|||${size}|||${width}|||${itemLength}`;

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
          recdOn,   // ← attach to each row
        });
      });
    });

    setGroupedData(grouped);
  };

  useEffect(() => {
    processData(data);
  }, [financialYear, selectedUnit, selectedWorkType, data]);

  const formatNumber = (value) =>
    !value && value !== 0
      ? "0"
      : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const formatAmount = (value) =>
    !value && value !== 0
      ? "0"
      : Math.ceil(Number(value)).toLocaleString("en-IN");

  const calculateAvgRate = (amount, qty) => (!qty || qty === 0 ? 0 : amount / qty);

  const buildTableTitle = (section, groupKey) => {
    const [, size, width, itemLength] = groupKey.split("|||");
    let title = `${section}`;
    if (size) title += ` - ${size}`;
    if (width && itemLength) title += ` x ${width} x ${itemLength}`;
    else if (width) title += ` x ${width}`;
    else if (itemLength) title += ` x ${itemLength}`;
    return title;
  };

  const showUnitColumn = selectedUnit === "Group";
  const showWorkTypeColumn = selectedWorkType === "Group";

  // ── helper: collect unique recdOn values from a group's entries ──
  const getGroupRecdOnDisplay = (entries) => {
    const uniqueDates = [...new Set(entries.map(e => e.recdOn).filter(Boolean))];
    return buildRecdOnDisplay(uniqueDates);
  };

  const exportExcel = () => {
    if (Object.keys(groupedData).length === 0) {
      alert("No data to export");
      return;
    }

    const wsData = [];
    wsData.push(["Section Wise Report"]);

    if (selectedUnit !== "Group" || selectedWorkType !== "Group") {
      let filterText = "";
      if (selectedUnit !== "Group") filterText += selectedUnit;
      if (selectedWorkType !== "Group") {
        if (filterText) filterText += " ";
        filterText += selectedWorkType;
      }
      wsData.push([filterText]);
    }

    wsData.push([]);

    Object.keys(groupedData).sort().forEach(section => {
      const groupKeys = groupedData[section];

      Object.keys(groupKeys).sort().forEach(groupKey => {
        const entries = groupKeys[groupKey];
        const title = buildTableTitle(section, groupKey);

        wsData.push([title]);

        // ── headers now include Recd. On ──
        const headers = ["Recd. On"];
        if (showUnitColumn) headers.push("Unit");
        if (showWorkTypeColumn) headers.push("Work Type");
        headers.push("Supplier", "Place", "Items", "Qty (MT)", "Amount", "Avg. Rate");
        wsData.push(headers);

        entries.forEach(entry => {
          const row = [entry.recdOn || ""];
          if (showUnitColumn) row.push(entry.unit);
          if (showWorkTypeColumn) row.push(entry.workType);
          row.push(
            entry.supplier,
            entry.place,
            entry.itemCount,
            entry.qty,
            entry.amount,
            calculateAvgRate(entry.amount, entry.qty)
          );
          wsData.push(row);
        });

        const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
        const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

        // ── total row: show date range in Recd. On cell ──
        const totalRow = [getGroupRecdOnDisplay(entries)];
        if (showUnitColumn) totalRow.push("");
        if (showWorkTypeColumn) totalRow.push("");
        totalRow.push("TOTAL", "", "", totalQty, totalAmount, calculateAvgRate(totalAmount, totalQty));
        wsData.push(totalRow);
        wsData.push([]);
      });
    });

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    const maxCols = Math.max(...wsData.map(row => row.length));
    ws["!cols"] = Array(maxCols).fill({ wch: 15 });

    const range = XLSX.utils.decode_range(ws["!ref"]);
    // +1 offset for the new Recd. On column
    const baseOffset = 1 + (showUnitColumn ? 1 : 0) + (showWorkTypeColumn ? 1 : 0);
    const qtyColIndex = baseOffset + 3;

    for (let R = 0; R <= range.e.r; R++) {
      for (let C = 0; C <= range.e.c; C++) {
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddr]) continue;
        if (typeof ws[cellAddr].v === "number") {
          ws[cellAddr].t = "n";
          ws[cellAddr].z = C === qtyColIndex ? "#,##0.000" : "#,##0";
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Section Report");
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    XLSX.writeFile(wb, `section_report_${timestamp}.xlsx`);
  };

  const exportPDF = () => {
    if (Object.keys(groupedData).length === 0) {
      alert("No data to export");
      return;
    }

    const doc = new jsPDF("l", "pt", "a4");
    let startY = 40;

    doc.setFontSize(16);
    doc.text("Section Wise Report", 14, 20);

    if (selectedUnit !== "Group" || selectedWorkType !== "Group") {
      doc.setFontSize(10);
      let filterText = "";
      if (selectedUnit !== "Group") filterText += selectedUnit;
      if (selectedWorkType !== "Group") {
        if (filterText) filterText += " ";
        filterText += selectedWorkType;
      }
      doc.text(filterText, 14, 35);
      startY = 50;
    }

    Object.keys(groupedData).sort().forEach(section => {
      const groupKeys = groupedData[section];

      Object.keys(groupKeys).sort().forEach(groupKey => {
        const entries = groupKeys[groupKey];
        const title = buildTableTitle(section, groupKey);

        const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
        const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        doc.text(title, 14, startY);
        startY += 20;

        // ── headers now include Recd. On ──
        const headerRow = ["Recd. On"];
        if (showUnitColumn) headerRow.push("Unit");
        if (showWorkTypeColumn) headerRow.push("Work Type");
        headerRow.push("Supplier", "Place", "Items", "Qty (MT)", "Amount", "Avg. Rate");

        const tableData = entries.map(e => {
          const row = [e.recdOn || ""];
          if (showUnitColumn) row.push(e.unit);
          if (showWorkTypeColumn) row.push(e.workType);
          row.push(
            e.supplier,
            e.place,
            e.itemCount.toLocaleString("en-IN"),
            formatNumber(e.qty),
            formatAmount(e.amount),
            formatAmount(calculateAvgRate(e.amount, e.qty))
          );
          return row;
        });

        // ── total row ──
        const totalRow = [getGroupRecdOnDisplay(entries)];
        if (showUnitColumn) totalRow.push("");
        if (showWorkTypeColumn) totalRow.push("");
        totalRow.push(
          "TOTAL", "",
          "",
          formatNumber(totalQty),
          formatAmount(totalAmount),
          formatAmount(calculateAvgRate(totalAmount, totalQty))
        );
        tableData.push(totalRow);

        autoTable(doc, {
          head: [headerRow],
          body: tableData,
          startY: startY,
          margin: { left: 14 },
          styles: { fontSize: 7, cellPadding: 2, halign: "center" },
          headStyles: {
            fillColor: [230, 240, 255],
            textColor: [0, 0, 0],
            fontStyle: "bold"
          },
          didDrawPage: (data) => {
            startY = data.cursor.y + 10;
          }
        });

        startY = doc.lastAutoTable.finalY + 25;
        if (startY > 500) {
          doc.addPage();
          startY = 40;
        }
      });
    });

    doc.save("Section_Wise_Report.pdf");
  };

  const clearFilters = () => {
    setFinancialYear("2025-26");
    setSelectedUnit("Group");
    setSelectedWorkType("Group");
  };

  return (
    <div className="section-wise-container">
      <h1 className="section-wise-heading">Section Wise Report</h1>

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
            {Array.from(new Set(data.map((item) => item.Unit))).map((unit, i) => (
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

      <div className="sections-wrapper">
        {Object.keys(groupedData).length === 0 ? (
          <div className="empty-state">
            <p>No data available. Please add entries first.</p>
          </div>
        ) : (
          Object.keys(groupedData).sort().map(section => (
            <div key={section} className="section-group">
              {Object.keys(groupedData[section]).sort().map(groupKey => {
                const entries = groupedData[section][groupKey];
                const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
                const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);
                const title = buildTableTitle(section, groupKey);

                return (
                  <div key={groupKey} className="size-section">
                    <h2 className="section-size-title">{title}</h2>

                    <div className="table-container">
                      <table className="section-table">
                        <thead>
                          <tr>
                            {/* ── Recd. On column added ── */}
                            <th style={{ whiteSpace: "nowrap" }}>Recd. On</th>
                            {showUnitColumn && <th>Unit</th>}
                            {showWorkTypeColumn && <th>Work Type</th>}
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
                              {showUnitColumn && <td className="text-left">{entry.unit}</td>}
                              {showWorkTypeColumn && <td className="text-left">{entry.workType}</td>}
                              <td className="text-left">{entry.supplier}</td>
                              <td className="text-left">{entry.place}</td>
                              <td className="text-right">{entry.itemCount.toLocaleString("en-IN")}</td>
                              <td className="text-right">{formatNumber(entry.qty)}</td>
                              <td className="text-right">{formatAmount(entry.amount)}</td>
                              <td className="text-right">{formatAmount(calculateAvgRate(entry.amount, entry.qty))}</td>
                            </tr>
                          ))}
                          <tr className="total-row">
                            {/* ── show date range in total row ── */}
                            <td style={{ whiteSpace: "nowrap" }}>{getGroupRecdOnDisplay(entries)}</td>
                            {showUnitColumn && <td></td>}
                            {showWorkTypeColumn && <td></td>}
                            <td className="text-left">TOTAL</td>
                            <td></td>
                            <td></td>
                            <td className="text-right">{formatNumber(totalQty)}</td>
                            <td className="text-right">{formatAmount(totalAmount)}</td>
                            <td className="text-right">{formatAmount(calculateAvgRate(totalAmount, totalQty))}</td>
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          ))
        )}
      </div>
    </div>
  );
}