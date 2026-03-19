import React, { useEffect, useState } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

import "./SupplierReport.css";

export default function SupplierReport() {
  const navigate = useNavigate();

  const [theme, setTheme] = useState("light");
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);

  const [financialYear, setFinancialYear] = useState("All");
  const [units, setUnits] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [billNumbers, setBillNumbers] = useState([]);
  const [sections, setSections] = useState([]);
  const [sizes, setSizes] = useState([]);

  const [selectedFinancialYear, setSelectedFinancialYear] = useState("All");
  const [selectedUnit, setSelectedUnit] = useState("All");
  const [selectedWorkType, setSelectedWorkType] = useState("All");
  const [selectedSupplier, setSelectedSupplier] = useState("All");
  const [selectedBillNumber, setSelectedBillNumber] = useState("All");
  const [selectedSection, setSelectedSection] = useState("All");
  const [selectedSize, setSelectedSize] = useState("All");

  const sectionMap = {
    "ms flat": "MS Flat",
    "msflat": "MS Flat",
    "ms-flat": "MS Flat",
    "ms rounds": "MS Round",
    "msrounds": "MS Round",
    "ms-rounds": "MS Round",
    "ms round": "MS Round",
    "ms wire coil": "MS Wire Coil",
    "ms angle": "MS Angle",
    "ms channel": "MS Channel",
    "drawbar flat": "Drawbar Flat",
    "hr sheet": "HR Sheet",
  };

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

  const compareDatesChronological = (a, b) => {
    const da = parseDateSafe(a);
    const db2 = parseDateSafe(b);
    if (!da && !db2) return 0;
    if (!da) return 1;
    if (!db2) return -1;
    if (da.getFullYear() !== db2.getFullYear()) return da.getFullYear() - db2.getFullYear();
    if (da.getMonth() !== db2.getMonth()) return da.getMonth() - db2.getMonth();
    return da.getDate() - db2.getDate();
  };

  useEffect(() => {
    const savedTheme = localStorage.getItem("appTheme") || "light";
    setTheme(savedTheme);
    document.body.setAttribute("data-theme", savedTheme);
  }, []);

  useEffect(() => {
    async function fetchData() {
      try {
        const querySnapshot = await getDocs(collection(db, "entries"));
        const entries = querySnapshot.docs.map(doc => doc.data());

        const flattenedData = [];
        entries.forEach(entry => {
          const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
          const recdOn = entry["Received On"] || entry["Recd. On"] || "";

          itemsArray.forEach(item => {
            const supplier = entry["Name of the Supplier"] ||
              entry["Supplier Name"] ||
              entry.supplier ||
              item["Name of the Supplier"] ||
              "Unknown";

            const place = entry["Supplier Place"] ||
              entry.place ||
              entry["Place"] ||
              item["Supplier Place"] ||
              "Unknown";

            const billNumber = entry["Bill Number"] ||
              entry["Bill No"] ||
              entry.billNumber ||
              item["Bill Number"] ||
              "Unknown";

            const financialYear = entry.FinancialYear ||
              entry["Financial Year"] ||
              "Unknown";

            const unit = entry.Unit || entry.unit || "Unknown";
            const workType = entry["Work Type"] || entry.workType || "Unknown";
            const sectionSubtotal = Number(item["Section Subtotal"]) || 0;

            flattenedData.push({
              "Financial Year": financialYear,
              Unit: unit,
              "Work Type": workType,
              "Name of the Supplier": supplier,
              "Supplier Place": place,
              "Bill Number": billNumber,
              Section: item.Section || item.section || "Unknown",
              Size: item.Size || item.size || "Unknown",
              "Number of items Supplied": Number(item["Number of items Supplied"]) || 0,
              "Quantity in Metric Tons": Number(item["Quantity in Metric Tons"]) || 0,
              Amount: sectionSubtotal,
              "Recd. On": recdOn,
            });
          });
        });

        setData(flattenedData);

        const uniqueFinancialYears = [...new Set(flattenedData.map(item => item["Financial Year"]))].sort();
        const uniqueUnits = [...new Set(flattenedData.map(item => item.Unit))].sort();
        const uniqueWorkTypes = [...new Set(flattenedData.map(item => item["Work Type"]))].sort();
        const uniqueSuppliers = [...new Set(flattenedData.map(item => item["Name of the Supplier"]))].sort();
        const uniqueBillNumbers = [...new Set(flattenedData.map(item => item["Bill Number"]))].sort();
        const uniqueSections = [...new Set(flattenedData.map(item => {
          let section = (item.Section || "Unknown").toString().trim();
          const lower = section.toLowerCase();
          return sectionMap[lower] || section;
        }))].sort();
        const uniqueSizes = [...new Set(flattenedData.map(item => item.Size || "Unknown"))].sort();

        setUnits(uniqueUnits);
        setWorkTypes(uniqueWorkTypes);
        setSuppliers(uniqueSuppliers);
        setBillNumbers(uniqueBillNumbers);
        setSections(uniqueSections);
        setSizes(uniqueSizes);
        setFilteredData(flattenedData);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    const sourceData = selectedSupplier !== "All"
      ? data.filter(item => item["Name of the Supplier"] === selectedSupplier)
      : data;

    const uniqueBillNumbers = [...new Set(sourceData.map(item => item["Bill Number"]))].sort();
    setBillNumbers(uniqueBillNumbers);

    if (selectedSupplier !== "All" && selectedBillNumber !== "All" && !uniqueBillNumbers.includes(selectedBillNumber)) {
      setSelectedBillNumber("All");
    }
  }, [selectedSupplier, data]);

  useEffect(() => {
    let filtered = [...data];

    if (selectedFinancialYear !== "All")
      filtered = filtered.filter(item => item["Financial Year"] === selectedFinancialYear);
    if (selectedUnit !== "All")
      filtered = filtered.filter(item => item.Unit === selectedUnit);
    if (selectedWorkType !== "All")
      filtered = filtered.filter(item => item["Work Type"] === selectedWorkType);
    if (selectedSupplier !== "All")
      filtered = filtered.filter(item => item["Name of the Supplier"] === selectedSupplier);
    if (selectedBillNumber !== "All")
      filtered = filtered.filter(item => item["Bill Number"] === selectedBillNumber);
    if (selectedSection !== "All") {
      filtered = filtered.filter(item => {
        let section = (item.Section || "Unknown").toString().trim();
        const lower = section.toLowerCase();
        section = sectionMap[lower] || section;
        return section === selectedSection;
      });
    }
    if (selectedSize !== "All")
      filtered = filtered.filter(item => item.Size === selectedSize);

    filtered.sort((a, b) =>
      compareDatesChronological(a["Recd. On"], b["Recd. On"])
    );

    setFilteredData(filtered);
  }, [selectedFinancialYear, selectedUnit, selectedWorkType, selectedSupplier, selectedBillNumber, selectedSection, selectedSize, data]);

  const formatNumber = (value) =>
    !value && value !== 0
      ? "0"
      : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const formatAmount = (value) =>
    !value && value !== 0
      ? "0"
      : Math.ceil(Number(value)).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });

  const calculateAvgRate = (amount, qty) => (!qty || qty === 0 ? 0 : amount / qty);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.body.setAttribute("data-theme", newTheme);
    localStorage.setItem("appTheme", newTheme);
  };

  const clearFilters = () => {
    setSelectedFinancialYear("All");
    setSelectedUnit("All");
    setSelectedWorkType("All");
    setSelectedSupplier("All");
    setSelectedBillNumber("All");
    setSelectedSection("All");
    setSelectedSize("All");
  };

  const hideFinancialYearCol = selectedFinancialYear !== "All";
  const hideUnitCol = selectedUnit !== "All";
  const hideWorkTypeCol = selectedWorkType !== "All";
  const hideSupplierCol = selectedSupplier !== "All";
  const hideBillNumberCol = selectedBillNumber !== "All";
  const hideSectionCol = selectedSection !== "All";
  const hideSizeCol = selectedSize !== "All";
  const hidePlaceCol = selectedSupplier !== "All" || selectedSection !== "All";

  // ─── PDF EXPORT ───────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });

    // Derive FY string from filtered data (actual years present)
    const fyInData = [...new Set(filteredData.map(item => item["Financial Year"]).filter(Boolean))].sort();
    const fyLabel = fyInData.length > 0 ? fyInData.join(", ") : "Unknown";

    // Main heading with FY embedded
    doc.setFontSize(16);
    doc.text(`Supplier Report – FY ${fyLabel}`, 14, 20);

    // Filter summary line — FY intentionally excluded here
    doc.setFontSize(10);
    const filterParts = [];
    if (selectedUnit !== "All") filterParts.push(`Unit: ${selectedUnit}`);
    if (selectedWorkType !== "All") filterParts.push(`Work Type: ${selectedWorkType}`);
    if (selectedSupplier !== "All") filterParts.push(`${selectedSupplier}`);
    if (selectedBillNumber !== "All") filterParts.push(`Bill: ${selectedBillNumber}`);
    if (selectedSection !== "All") filterParts.push(`${selectedSection}`);
    if (selectedSize !== "All") filterParts.push(`Size: ${selectedSize}`);
    if (filterParts.length > 0) doc.text(filterParts.join(" | "), 14, 35);

    // Build headers — FY column completely excluded from PDF table
    const headers = ["No.", "Recd. On"];
    if (!hideUnitCol) headers.push("Unit");
    if (!hideWorkTypeCol) headers.push("Work Type");
    if (!hideSupplierCol) headers.push("Supplier");
    if (!hideBillNumberCol) headers.push("Bill No.");
    if (!hidePlaceCol) headers.push("Place");
    if (!hideSectionCol) headers.push("Section");
    if (!hideSizeCol) headers.push("Size");
    headers.push("Items", "Qty (MT)", "Amount", "Avg. Rate");

    const sizeColIndex = hideSizeCol
      ? headers.indexOf("Items")
      : headers.indexOf("Size");

    const columnStyles = {};
    for (let i = sizeColIndex; i < headers.length; i++) {
      columnStyles[i] = { halign: "right" };
    }

    const tableData = filteredData.map((item, index) => {
      let section = (item.Section || "Unknown").toString().trim();
      section = sectionMap[section.toLowerCase()] || section;

      const qty = Number(item["Quantity in Metric Tons"]) || 0;
      const amount = Number(item.Amount) || 0;

      // No FY field pushed into row
      const row = [index + 1, item["Recd. On"] || ""];
      if (!hideUnitCol) row.push(item.Unit || "Unknown");
      if (!hideWorkTypeCol) row.push(item["Work Type"] || "Unknown");
      if (!hideSupplierCol) row.push(item["Name of the Supplier"] || "Unknown");
      if (!hideBillNumberCol) row.push(item["Bill Number"] || "Unknown");
      if (!hidePlaceCol) row.push(item["Supplier Place"] || "Unknown");
      if (!hideSectionCol) row.push(section);
      if (!hideSizeCol) row.push(item.Size || "Unknown");
      row.push(
        (item["Number of items Supplied"] || 0).toLocaleString("en-IN"),
        formatNumber(qty),
        formatAmount(amount),
        formatAmount(calculateAvgRate(amount, qty))
      );
      return row;
    });

    const totalQty = filteredData.reduce((sum, item) => sum + (Number(item["Quantity in Metric Tons"]) || 0), 0);
    const totalAmount = filteredData.reduce((sum, item) => sum + (Number(item.Amount) || 0), 0);

    // Total row — no FY cell
    const totalRow = ["TOTAL", ""];
    if (!hideUnitCol) totalRow.push("");
    if (!hideWorkTypeCol) totalRow.push("");
    if (!hideSupplierCol) totalRow.push("");
    if (!hideBillNumberCol) totalRow.push("");
    if (!hidePlaceCol) totalRow.push("");
    if (!hideSectionCol) totalRow.push("");
    if (!hideSizeCol) totalRow.push("");
    totalRow.push("", formatNumber(totalQty), formatAmount(totalAmount), formatAmount(calculateAvgRate(totalAmount, totalQty)));
    tableData.push(totalRow);

    autoTable(doc, {
      head: [headers],
      body: tableData,
      startY: filterParts.length > 0 ? 50 : 35,
      styles: { fontSize: 7, cellPadding: 2 },
      headStyles: { fillColor: [230, 240, 255], textColor: [40, 40, 40], fontStyle: "bold" },
      columnStyles,
      didParseCell: function (data) {
        if (data.row.index === tableData.length - 1) data.cell.styles.fontStyle = "bold";
      },
      theme: "grid",
      margin: { left: 14, right: 14 },
      tableWidth: "auto",
    });

    doc.save("Supplier_Report.pdf");
  };

  // ─── EXCEL EXPORT ─────────────────────────────────────────────────────────
  const exportExcel = () => {
    const excelData = filteredData.map((item, index) => {
      let section = (item.Section || "Unknown").toString().trim();
      section = sectionMap[section.toLowerCase()] || section;

      const qty = Number(item["Quantity in Metric Tons"]) || 0;
      const amount = Number(item.Amount) || 0;

      const row = { "No.": index + 1, "Recd. On": item["Recd. On"] || "" };

      if (!hideFinancialYearCol) row["FY"] = item["Financial Year"] || "Unknown";
      if (!hideUnitCol) row["Unit"] = item.Unit || "Unknown";
      if (!hideWorkTypeCol) row["Work Type"] = item["Work Type"] || "Unknown";
      if (!hideSupplierCol) row["Supplier"] = item["Name of the Supplier"] || "Unknown";
      if (!hideBillNumberCol) row["Bill No."] = item["Bill Number"] || "Unknown";
      if (!hidePlaceCol) row["Place"] = item["Supplier Place"] || "Unknown";
      if (!hideSectionCol) row["Section"] = section;
      if (!hideSizeCol) row["Size"] = item.Size || "Unknown";

      row["Items"] = (item["Number of items Supplied"] || 0).toLocaleString("en-IN");
      row["Qty (MT)"] = formatNumber(qty);
      row["Amount"] = formatAmount(amount);
      row["Avg. Rate"] = formatAmount(calculateAvgRate(amount, qty));

      return row;
    });

    const totalQty = filteredData.reduce((sum, item) => sum + (Number(item["Quantity in Metric Tons"]) || 0), 0);
    const totalAmount = filteredData.reduce((sum, item) => sum + (Number(item.Amount) || 0), 0);

    const totalRow = { "No.": "TOTAL", "Recd. On": "" };
    if (!hideFinancialYearCol) totalRow["FY"] = "";
    if (!hideUnitCol) totalRow["Unit"] = "";
    if (!hideWorkTypeCol) totalRow["Work Type"] = "";
    if (!hideSupplierCol) totalRow["Supplier"] = "";
    if (!hideBillNumberCol) totalRow["Bill No."] = "";
    if (!hidePlaceCol) totalRow["Place"] = "";
    if (!hideSectionCol) totalRow["Section"] = "";
    if (!hideSizeCol) totalRow["Size"] = "";
    totalRow["Items"] = "";
    totalRow["Qty (MT)"] = formatNumber(totalQty);
    totalRow["Amount"] = formatAmount(totalAmount);
    totalRow["Avg. Rate"] = formatAmount(calculateAvgRate(totalAmount, totalQty));

    excelData.push(totalRow);

    const ws = XLSX.utils.json_to_sheet(excelData);

    const colWidths = [{ wch: 5 }, { wch: 22 }];
    if (!hideFinancialYearCol) colWidths.push({ wch: 10 });
    if (!hideUnitCol) colWidths.push({ wch: 10 });
    if (!hideWorkTypeCol) colWidths.push({ wch: 12 });
    if (!hideSupplierCol) colWidths.push({ wch: 25 });
    if (!hideBillNumberCol) colWidths.push({ wch: 15 });
    if (!hidePlaceCol) colWidths.push({ wch: 15 });
    if (!hideSectionCol) colWidths.push({ wch: 15 });
    if (!hideSizeCol) colWidths.push({ wch: 12 });
    colWidths.push({ wch: 12 }, { wch: 15 }, { wch: 15 }, { wch: 12 });

    ws["!cols"] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Supplier Report");

    let filename = "Supplier_Report";
    if (selectedFinancialYear !== "All") filename += `_FY${selectedFinancialYear}`;
    if (selectedUnit !== "All") filename += `_${selectedUnit}`;
    if (selectedWorkType !== "All") filename += `_${selectedWorkType}`;
    if (selectedSupplier !== "All") filename += `_${selectedSupplier}`;
    if (selectedBillNumber !== "All") filename += `_Bill${selectedBillNumber}`;
    if (selectedSection !== "All") filename += `_${selectedSection}`;
    if (selectedSize !== "All") filename += `_${selectedSize}`;
    filename += ".xlsx";

    XLSX.writeFile(wb, filename);
  };

  const totalQty = filteredData.reduce((sum, item) => sum + (Number(item["Quantity in Metric Tons"]) || 0), 0);
  const totalAmount = filteredData.reduce((sum, item) => sum + (Number(item.Amount) || 0), 0);

  const financialYears = [...new Set(data.map(item => item["Financial Year"]))].sort();

  const visibleColCount =
    2 +
    (hideFinancialYearCol ? 0 : 1) +
    (hideUnitCol ? 0 : 1) +
    (hideWorkTypeCol ? 0 : 1) +
    (hideSupplierCol ? 0 : 1) +
    (hideBillNumberCol ? 0 : 1) +
    (hidePlaceCol ? 0 : 1) +
    (hideSectionCol ? 0 : 1) +
    (hideSizeCol ? 0 : 1) +
    4;

  return (
    <div className="entry-layout">
      <div className="supplier-report-container">
        <h1 className="supplier-report-heading">Supplier Report</h1>

        <div className="filter-container">
          <div className="filter-row">
            <label htmlFor="financialYear">Financial Year:</label>
            <select id="financialYear" className="filter-select" value={selectedFinancialYear} onChange={(e) => setSelectedFinancialYear(e.target.value)}>
              <option value="All">All Years</option>
              {financialYears.map((fy, i) => <option key={i} value={fy}>{fy}</option>)}
            </select>

            <label htmlFor="unit">Unit:</label>
            <select id="unit" className="filter-select" value={selectedUnit} onChange={(e) => setSelectedUnit(e.target.value)}>
              <option value="All">All Units</option>
              {units.map((unit, i) => <option key={i} value={unit}>{unit}</option>)}
            </select>

            <label htmlFor="workType">Work Type:</label>
            <select id="workType" className="filter-select" value={selectedWorkType} onChange={(e) => setSelectedWorkType(e.target.value)}>
              <option value="All">All Work Types</option>
              {workTypes.map((wt, i) => <option key={i} value={wt}>{wt}</option>)}
            </select>

            <label htmlFor="supplier">Supplier:</label>
            <select id="supplier" className="filter-select" value={selectedSupplier} onChange={(e) => setSelectedSupplier(e.target.value)}>
              <option value="All">All Suppliers</option>
              {suppliers.map((supplier, i) => <option key={i} value={supplier}>{supplier}</option>)}
            </select>

            <label htmlFor="billNumber">Bill No:</label>
            <select id="billNumber" className="filter-select" value={selectedBillNumber} onChange={(e) => setSelectedBillNumber(e.target.value)}>
              <option value="All">All Bills</option>
              {billNumbers.map((billNo, i) => <option key={i} value={billNo}>{billNo}</option>)}
            </select>

            <label htmlFor="section">Section:</label>
            <select id="section" className="filter-select" value={selectedSection} onChange={(e) => setSelectedSection(e.target.value)}>
              <option value="All">All Sections</option>
              {sections.map((section, i) => <option key={i} value={section}>{section}</option>)}
            </select>

            <label htmlFor="size">Size:</label>
            <select id="size" className="filter-select" value={selectedSize} onChange={(e) => setSelectedSize(e.target.value)}>
              <option value="All">All Sizes</option>
              {sizes.map((size, i) => <option key={i} value={size}>{size}</option>)}
            </select>

            <button onClick={clearFilters} className="btn-clear">Clear Filters</button>
            <button onClick={exportPDF} className="btn-export btn-pdf">Export PDF</button>
            <button onClick={exportExcel} className="btn-export btn-excel">Export Excel</button>
          </div>
        </div>

        <div className="table-container">
          <table className="supplier-table">
            <thead>
              <tr>
                <th style={{ width: "3%" }}>No.</th>
                <th style={{ width: "9%", whiteSpace: "nowrap" }}>Recd. On</th>
                {!hideFinancialYearCol && <th style={{ width: "6%" }}>FY</th>}
                {!hideUnitCol && <th style={{ width: "5%" }}>Unit</th>}
                {!hideWorkTypeCol && <th style={{ width: "6%" }}>Work Type</th>}
                {!hideSupplierCol && <th style={{ width: "10%" }}>Supplier</th>}
                {!hideBillNumberCol && <th style={{ width: "8%" }}>Bill No.</th>}
                {!hidePlaceCol && <th style={{ width: "8%" }}>Place</th>}
                {!hideSectionCol && <th style={{ width: "8%" }}>Section</th>}
                {!hideSizeCol && <th style={{ width: "8%" }}>Size</th>}
                <th style={{ width: "6%" }}>Items</th>
                <th style={{ width: "8%" }}>Qty (MT)</th>
                <th style={{ width: "10%" }}>Amount</th>
                <th style={{ width: "8%" }}>Avg. Rate</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length > 0 ? (
                <>
                  {filteredData.map((item, index) => {
                    let section = (item.Section || "Unknown").toString().trim();
                    section = sectionMap[section.toLowerCase()] || section;
                    const qty = Number(item["Quantity in Metric Tons"]) || 0;
                    const amount = Number(item.Amount) || 0;

                    return (
                      <tr key={index}>
                        <td className="text-center">{index + 1}</td>
                        <td className="text-center" style={{ whiteSpace: "nowrap" }}>{item["Recd. On"] || ""}</td>
                        {!hideFinancialYearCol && <td className="text-left">{item["Financial Year"] || "Unknown"}</td>}
                        {!hideUnitCol && <td className="text-left">{item.Unit || "Unknown"}</td>}
                        {!hideWorkTypeCol && <td className="text-left">{item["Work Type"] || "Unknown"}</td>}
                        {!hideSupplierCol && <td className="text-left">{item["Name of the Supplier"] || "Unknown"}</td>}
                        {!hideBillNumberCol && <td className="text-left">{item["Bill Number"] || "Unknown"}</td>}
                        {!hidePlaceCol && <td className="text-left">{item["Supplier Place"] || "Unknown"}</td>}
                        {!hideSectionCol && <td className="text-left">{section}</td>}
                        {!hideSizeCol && <td className="text-left">{item.Size || "Unknown"}</td>}
                        <td className="text-right">{(item["Number of items Supplied"] || 0).toLocaleString("en-IN")}</td>
                        <td className="text-right">{formatNumber(qty)}</td>
                        <td className="text-right">{formatAmount(amount)}</td>
                        <td className="text-right">{formatAmount(calculateAvgRate(amount, qty))}</td>
                      </tr>
                    );
                  })}
                  <tr className="total-row">
                    <td className="text-left">TOTAL</td>
                    <td></td>
                    {!hideFinancialYearCol && <td></td>}
                    {!hideUnitCol && <td></td>}
                    {!hideWorkTypeCol && <td></td>}
                    {!hideSupplierCol && <td></td>}
                    {!hideBillNumberCol && <td></td>}
                    {!hidePlaceCol && <td></td>}
                    {!hideSectionCol && <td></td>}
                    {!hideSizeCol && <td></td>}
                    <td></td>
                    <td className="text-right">{formatNumber(totalQty)}</td>
                    <td className="text-right">{formatAmount(totalAmount)}</td>
                    <td className="text-right">{formatAmount(calculateAvgRate(totalAmount, totalQty))}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={visibleColCount} className="empty-state">
                    No data found for the selected filters
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}