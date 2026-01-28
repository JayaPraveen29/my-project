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
  const [selectedUnit, setSelectedUnit] = useState("Group");
  const [selectedWorkType, setSelectedWorkType] = useState("Group");
  const [workTypes, setWorkTypes] = useState([]);

  useEffect(() => {
    async function fetchData() {
      try {
        const querySnapshot = await getDocs(collection(db, "entries"));
        const items = querySnapshot.docs.map(doc => doc.data());
        setData(items);
        
        // Extract unique work types
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
      // Filter by Unit
      if (selectedUnit !== "Group" && entry.Unit !== selectedUnit) return;
      
      // Filter by Work Type
      if (selectedWorkType !== "Group" && (entry["Work Type"] || "Unknown") !== selectedWorkType) return;

      // Check if entry has items array
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];

      // Calculate entry totals for proportional distribution
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);

      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "Unknown").toString().trim();

        const unit = entry["Unit"] || "";
        const workType = entry["Work Type"] || "";
        const supplier = entry["Name of the Supplier"] || "";
        const place = entry["Supplier Place"] || "";
        const itemCount = Number(item["Number of items Supplied"]) || 0;
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        // Calculate proportional amount for this item
        const itemAmount = entryTotalBasic > 0 
          ? (itemBasic / entryTotalBasic) * entryNetAmount 
          : 0;

        if (!grouped[section]) grouped[section] = {};
        if (!grouped[section][size]) grouped[section][size] = [];

        grouped[section][size].push({ unit, workType, supplier, place, itemCount, qty, amount: itemAmount });
      });
    });

    setGroupedData(grouped);
  };

  useEffect(() => {
    processData(data);
  }, [selectedUnit, selectedWorkType, data]);

  const formatNumber = (value) =>
    !value && value !== 0
      ? "0"
      : Number(value).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const formatAmount = (value) =>
    !value && value !== 0
      ? "0"
      : Math.ceil(Number(value)).toLocaleString("en-IN");

  const calculateAvgRate = (amount, qty) => (!qty || qty === 0 ? 0 : amount / qty);

  const showUnitColumn = selectedUnit === "Group";
  const showWorkTypeColumn = selectedWorkType === "Group";

  const exportExcel = () => {
    if (Object.keys(groupedData).length === 0) {
      alert("No data to export");
      return;
    }

    const wsData = [];
    
    // Add title
    wsData.push(["Section Wise Report"]);
    
    // Add filter info if applicable
    if (selectedUnit !== "Group" || selectedWorkType !== "Group") {
      let filterText = "";
      if (selectedUnit !== "Group") filterText += selectedUnit;
      if (selectedWorkType !== "Group") {
        if (filterText) filterText += " ";
        filterText += selectedWorkType;
      }
      wsData.push([filterText]);
    }
    
    wsData.push([]); // Empty row

    // Process each section and size
    Object.keys(groupedData).sort().forEach(section => {
      const sizes = groupedData[section];

      Object.keys(sizes).sort().forEach(size => {
        const entries = sizes[size];

        // Add section-size header
        wsData.push([`${section} - ${size}`]);
        
        // Add table headers
        const headers = [];
        if (showUnitColumn) headers.push("Unit");
        if (showWorkTypeColumn) headers.push("Work Type");
        headers.push("Supplier", "Place", "Items", "Qty (MT)", "Amount", "Avg. Rate");
        wsData.push(headers);

        // Add data rows
        entries.forEach(entry => {
          const row = [];
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

        // Calculate totals
        const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
        const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

        // Add total row
        const totalRow = [];
        if (showUnitColumn) totalRow.push("");
        if (showWorkTypeColumn) totalRow.push("");
        totalRow.push(
          "TOTAL",
          "",
          "",
          totalQty,
          totalAmount,
          calculateAvgRate(totalAmount, totalQty)
        );
        wsData.push(totalRow);
        
        // Add empty row between tables
        wsData.push([]);
      });
    });

    // Create workbook and worksheet
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // Set column widths
    const maxCols = Math.max(...wsData.map(row => row.length));
    const colWidths = Array(maxCols).fill({ wch: 15 });
    colWidths[0] = { wch: 12 };
    if (showUnitColumn || showWorkTypeColumn) {
      colWidths[1] = { wch: 12 };
    }
    ws['!cols'] = colWidths;

    // Format number columns
    const range = XLSX.utils.decode_range(ws['!ref']);
    for (let R = 0; R <= range.e.r; R++) {
      for (let C = 0; C <= range.e.c; C++) {
        const cellAddr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[cellAddr]) continue;
        
        const cellValue = ws[cellAddr].v;
        if (typeof cellValue === 'number') {
          ws[cellAddr].t = 'n';
          // Determine format based on column
          const colHeader = wsData[0] ? wsData[0][C] : '';
          if (colHeader === 'Qty (MT)') {
            ws[cellAddr].z = '#,##0.000';
          } else {
            ws[cellAddr].z = '#,##0';
          }
        }
      }
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(wb, ws, "Section Report");

    // Generate filename with timestamp
    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `section_report_${timestamp}.xlsx`;

    // Save file
    XLSX.writeFile(wb, filename);
  };

  const exportPDF = () => {
    if (Object.keys(groupedData).length === 0) {
      alert("No data to export");
      return;
    }

    const doc = new jsPDF("p", "pt", "a4");
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
      const sizes = groupedData[section];

      Object.keys(sizes).sort().forEach(size => {
        const entries = sizes[size];

        const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
        const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

        doc.setFontSize(11);
        doc.setFont(undefined, "bold");
        doc.text(`${section} - ${size}`, 14, startY);
        startY += 20;

        const tableData = entries.map(e => {
          const row = [
            e.supplier,
            e.place,
            e.itemCount.toLocaleString("en-IN"),
            formatNumber(e.qty),
            formatAmount(e.amount),
            formatAmount(calculateAvgRate(e.amount, e.qty))
          ];
          if (showWorkTypeColumn) row.unshift(e.workType);
          if (showUnitColumn) row.unshift(e.unit);
          return row;
        });

        const totalRow = [
          "TOTAL", 
          "", 
          "",
          formatNumber(totalQty),
          formatAmount(totalAmount), 
          formatAmount(calculateAvgRate(totalAmount, totalQty))
        ];
        if (showWorkTypeColumn) totalRow.unshift("");
        if (showUnitColumn) totalRow.unshift("");

        tableData.push(totalRow);

        const headerRow = ["Supplier", "Place", "Items", "Qty (MT)", "Amount", "Avg. Rate"];
        if (showWorkTypeColumn) headerRow.unshift("Work Type");
        if (showUnitColumn) headerRow.unshift("Unit");

        autoTable(doc, {
          head: [headerRow],
          body: tableData,
          startY: startY,
          margin: { left: 14 },
          styles: { fontSize: 8, cellPadding: 3, halign: "center" },
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
        if (startY > 700) {
          doc.addPage();
          startY = 40;
        }
      });
    });

    doc.save("Section_Wise_Report.pdf");
  };

  const clearFilters = () => {
    setSelectedUnit("Group");
    setSelectedWorkType("Group");
  };

  return (
    <div className="section-wise-container">
      <h1 className="section-wise-heading">Section Wise Report</h1>

      <div className="filter-container">
        <div className="filter-row">
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

          <button onClick={clearFilters} className="btn-clear">
            Clear Filters
          </button>

          <button onClick={exportExcel} className="btn-export btn-excel">
            Export Excel
          </button>
          
          <button onClick={exportPDF} className="btn-export btn-pdf">
            Export PDF
          </button>
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
              {Object.keys(groupedData[section]).sort().map(size => {
                const entries = groupedData[section][size];
                const totalQty = entries.reduce((sum, e) => sum + e.qty, 0);
                const totalAmount = entries.reduce((sum, e) => sum + e.amount, 0);

                return (
                  <div key={size} className="size-section">
                    <h2 className="section-size-title">
                      {section} - {size}
                    </h2>

                    <div className="table-container">
                      <table className="section-table">
                        <thead>
                          <tr>
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