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
  
  const [suppliers, setSuppliers] = useState([]);
  const [sections, setSections] = useState([]);
  const [sizes, setSizes] = useState([]);
  
  const [selectedSupplier, setSelectedSupplier] = useState("All");
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
        
        console.log("Sample entry:", entries[0]);
        
        const flattenedData = [];
        entries.forEach(entry => {
          const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
          
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
            
            flattenedData.push({
              Unit: entry.Unit || entry.unit || "Unknown",
              "Name of the Supplier": supplier,
              "Supplier Place": place,
              Section: item.Section || item.section || "Unknown",
              Size: item.Size || item.size || "Unknown",
              "Number of items Supplied": Number(item["Number of items Supplied"]) || 0,
              "Quantity in Metric Tons": Number(item["Quantity in Metric Tons"]) || 0,
              Net: Number(entry.finalTotals?.net) || Number(entry["Net"]) || 0,
            });
          });
        });
        
        console.log("Flattened data sample:", flattenedData[0]);
        
        setData(flattenedData);
        
        const uniqueSuppliers = [...new Set(flattenedData.map(item => item["Name of the Supplier"]))].sort();
        const uniqueSections = [...new Set(flattenedData.map(item => {
          let section = (item.Section || "Unknown").toString().trim();
          const lower = section.toLowerCase();
          return sectionMap[lower] || section;
        }))].sort();
        const uniqueSizes = [...new Set(flattenedData.map(item => item.Size || "Unknown"))].sort();
        
        setSuppliers(uniqueSuppliers);
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
    let filtered = [...data];

    if (selectedSupplier !== "All") {
      filtered = filtered.filter(item => 
        item["Name of the Supplier"] === selectedSupplier
      );
    }

    if (selectedSection !== "All") {
      filtered = filtered.filter(item => {
        let section = (item.Section || "Unknown").toString().trim();
        const lower = section.toLowerCase();
        section = sectionMap[lower] || section;
        return section === selectedSection;
      });
    }

    if (selectedSize !== "All") {
      filtered = filtered.filter(item => 
        item.Size === selectedSize
      );
    }

    filtered.sort((a, b) => {
      const supplierA = a["Name of the Supplier"].toLowerCase();
      const supplierB = b["Name of the Supplier"].toLowerCase();
      return supplierA.localeCompare(supplierB);
    });

    setFilteredData(filtered);
  }, [selectedSupplier, selectedSection, selectedSize, data]);

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
    setSelectedSupplier("All");
    setSelectedSection("All");
    setSelectedSize("All");
  };

  const hideSupplierCol = selectedSupplier !== "All";
  const hideSectionCol = selectedSection !== "All";
  const hidePlaceCol = selectedSupplier !== "All" || selectedSection !== "All";

  const exportPDF = () => {
    const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
    doc.setFontSize(16);
    doc.text("Supplier Report", 14, 20);

    doc.setFontSize(10);
    let filterParts = [];
    
    if (selectedSupplier !== "All") {
      filterParts.push(`${selectedSupplier}`);
    }
    if (selectedSection !== "All") {
      filterParts.push(`${selectedSection}`);
    }
    if (selectedSize !== "All") {
      filterParts.push(`Size: ${selectedSize}`);
    }
    
    if (filterParts.length > 0) {
      const filterText = filterParts.join(" | ");
      doc.text(filterText, 14, 35);
    }

    const headers = ["No.", "Unit"];
    if (!hideSupplierCol) headers.push("Supplier");
    if (!hidePlaceCol) headers.push("Place");
    if (!hideSectionCol) headers.push("Section");
    headers.push("Size", "Items", "Qty (MT)", "Amount", "Avg. Rate");

    const tableData = filteredData.map((item, index) => {
      let section = (item.Section || "Unknown").toString().trim();
      const lower = section.toLowerCase();
      section = sectionMap[lower] || section;

      const qty = Number(item["Quantity in Metric Tons"]) || 0;
      const amount = Number(item.Net) || 0;

      const row = [
        index + 1,
        item.Unit || "Unknown"
      ];
      
      if (!hideSupplierCol) row.push(item["Name of the Supplier"] || "Unknown");
      if (!hidePlaceCol) row.push(item["Supplier Place"] || "Unknown");
      if (!hideSectionCol) row.push(section);
      row.push(
        item.Size || "Unknown",
        (item["Number of items Supplied"] || 0).toLocaleString("en-IN"),
        formatNumber(qty),
        formatAmount(amount),
        formatAmount(calculateAvgRate(amount, qty))
      );

      return row;
    });

    const totalItems = filteredData.reduce((sum, item) => sum + (Number(item["Number of items Supplied"]) || 0), 0);
    const totalQty = filteredData.reduce((sum, item) => sum + (Number(item["Quantity in Metric Tons"]) || 0), 0);
    const totalAmount = filteredData.reduce((sum, item) => sum + (Number(item.Net) || 0), 0);

    const totalRow = ["", ""];
    if (!hideSupplierCol) totalRow.push("");
    if (!hidePlaceCol) totalRow.push("TOTAL");
    else totalRow.push("TOTAL");
    if (!hideSectionCol) totalRow.push("");
    totalRow.push(
      "",
      totalItems.toLocaleString("en-IN"),
      formatNumber(totalQty),
      formatAmount(totalAmount),
      formatAmount(calculateAvgRate(totalAmount, totalQty))
    );

    tableData.push(totalRow);

    autoTable(doc, {
      head: [headers],
      body: tableData,
      startY: filterParts.length > 0 ? 50 : 35,
      styles: { fontSize: 8, cellPadding: 3 },
      headStyles: {
        fillColor: [230, 240, 255],
        textColor: [40, 40, 40],
        fontStyle: "bold"
      },
      theme: "grid",
      margin: { left: 20, right: 20 },
      tableWidth: "auto",
    });
    
    doc.save("Supplier_Report.pdf");
  };

  const exportExcel = () => {
    const excelData = filteredData.map((item, index) => {
      let section = (item.Section || "Unknown").toString().trim();
      const lower = section.toLowerCase();
      section = sectionMap[lower] || section;

      const qty = Number(item["Quantity in Metric Tons"]) || 0;
      const amount = Number(item.Net) || 0;

      const row = {
        "No.": index + 1,
        "Unit": item.Unit || "Unknown"
      };

      if (!hideSupplierCol) row["Supplier"] = item["Name of the Supplier"] || "Unknown";
      if (!hidePlaceCol) row["Place"] = item["Supplier Place"] || "Unknown";
      if (!hideSectionCol) row["Section"] = section;
      
      row["Size"] = item.Size || "Unknown";
      row["Items"] = (item["Number of items Supplied"] || 0).toLocaleString("en-IN");
      row["Qty (MT)"] = formatNumber(qty);
      row["Amount"] = formatAmount(amount);
      row["Avg. Rate"] = formatAmount(calculateAvgRate(amount, qty));

      return row;
    });

    const totalItems = filteredData.reduce((sum, item) => sum + (Number(item["Number of items Supplied"]) || 0), 0);
    const totalQty = filteredData.reduce((sum, item) => sum + (Number(item["Quantity in Metric Tons"]) || 0), 0);
    const totalAmount = filteredData.reduce((sum, item) => sum + (Number(item.Net) || 0), 0);

    const totalRow = {
      "No.": "",
      "Unit": ""
    };
    
    if (!hideSupplierCol) totalRow["Supplier"] = "";
    if (!hidePlaceCol) totalRow["Place"] = "TOTAL";
    else totalRow["Unit"] = "TOTAL";
    if (!hideSectionCol) totalRow["Section"] = "";
    
    totalRow["Size"] = "";
    totalRow["Items"] = totalItems.toLocaleString("en-IN");
    totalRow["Qty (MT)"] = formatNumber(totalQty);
    totalRow["Amount"] = formatAmount(totalAmount);
    totalRow["Avg. Rate"] = formatAmount(calculateAvgRate(totalAmount, totalQty));

    excelData.push(totalRow);

    const ws = XLSX.utils.json_to_sheet(excelData);

    const colWidths = [
      { wch: 5 },
      { wch: 10 }
    ];
    
    if (!hideSupplierCol) colWidths.push({ wch: 25 });
    if (!hidePlaceCol) colWidths.push({ wch: 15 });
    if (!hideSectionCol) colWidths.push({ wch: 15 });
    colWidths.push(
      { wch: 12 },
      { wch: 12 },
      { wch: 15 },
      { wch: 15 },
      { wch: 12 }
    );

    ws['!cols'] = colWidths;

    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Supplier Report");

    let filename = "Supplier_Report";
    if (selectedSupplier !== "All") filename += `_${selectedSupplier}`;
    if (selectedSection !== "All") filename += `_${selectedSection}`;
    if (selectedSize !== "All") filename += `_${selectedSize}`;
    filename += ".xlsx";

    XLSX.writeFile(wb, filename);
  };

  const totalItems = filteredData.reduce((sum, item) => sum + (Number(item["Number of items Supplied"]) || 0), 0);
  const totalQty = filteredData.reduce((sum, item) => sum + (Number(item["Quantity in Metric Tons"]) || 0), 0);
  const totalAmount = filteredData.reduce((sum, item) => sum + (Number(item.Net) || 0), 0);

  return (
    <div className="entry-layout">
      
      <div className="supplier-report-container">
        <h1 className="supplier-report-heading">Supplier Report</h1>

        <div className="filter-container">
          <div className="filter-row">
            <label htmlFor="supplier">Supplier:</label>
            <select 
              id="supplier" 
              className="filter-select"
              value={selectedSupplier} 
              onChange={(e) => setSelectedSupplier(e.target.value)}
            >
              <option value="All">All Suppliers</option>
              {suppliers.map((supplier, i) => (
                <option key={i} value={supplier}>{supplier}</option>
              ))}
            </select>

            <label htmlFor="section">Section:</label>
            <select 
              id="section" 
              className="filter-select"
              value={selectedSection} 
              onChange={(e) => setSelectedSection(e.target.value)}
            >
              <option value="All">All Sections</option>
              {sections.map((section, i) => (
                <option key={i} value={section}>{section}</option>
              ))}
            </select>

            <label htmlFor="size">Size:</label>
            <select 
              id="size" 
              className="filter-select"
              value={selectedSize} 
              onChange={(e) => setSelectedSize(e.target.value)}
            >
              <option value="All">All Sizes</option>
              {sizes.map((size, i) => (
                <option key={i} value={size}>{size}</option>
              ))}
            </select>

            <button onClick={clearFilters} className="btn-clear">
              Clear Filters
            </button>
            <button onClick={exportPDF} className="btn-export btn-pdf">
              Export PDF
            </button>
            <button onClick={exportExcel} className="btn-export btn-excel">
              Export Excel
            </button>
          </div>
        </div>

        <div className="table-container">
          <table className="supplier-table">
            <thead>
              <tr>
                <th style={{ width: "5%" }}>No.</th>
                <th style={{ width: "8%" }}>Unit</th>
                {!hideSupplierCol && <th style={{ width: "6%" }}>Supplier</th>}
                {!hidePlaceCol && <th style={{ width: "8%" }}>Place</th>}
                {!hideSectionCol && <th style={{ width: "8%" }}>Section</th>}
                <th style={{ width: "8%" }}>Size</th>
                <th style={{ width: "8%" }}>Items</th>
                <th style={{ width: "10%" }}>Qty (MT)</th>
                <th style={{ width: "10%" }}>Amount</th>
                <th style={{ width: "8%" }}>Avg. Rate</th>
              </tr>
            </thead>
            <tbody>
              {filteredData.length > 0 ? (
                <>
                  {filteredData.map((item, index) => {
                    let section = (item.Section || "Unknown").toString().trim();
                    const lower = section.toLowerCase();
                    section = sectionMap[lower] || section;

                    const qty = Number(item["Quantity in Metric Tons"]) || 0;
                    const amount = Number(item.Net) || 0;

                    return (
                      <tr key={index}>
                        <td className="text-center">{index + 1}</td>
                        <td className="text-left">{item.Unit || "Unknown"}</td>
                        {!hideSupplierCol && <td className="text-left">{item["Name of the Supplier"] || "Unknown"}</td>}
                        {!hidePlaceCol && <td className="text-left">{item["Supplier Place"] || "Unknown"}</td>}
                        {!hideSectionCol && <td className="text-left">{section}</td>}
                        <td className="text-left">{item.Size || "Unknown"}</td>
                        <td className="text-right">{(item["Number of items Supplied"] || 0).toLocaleString("en-IN")}</td>
                        <td className="text-right">{formatNumber(qty)}</td>
                        <td className="text-right">{formatAmount(amount)}</td>
                        <td className="text-right">{formatAmount(calculateAvgRate(amount, qty))}</td>
                      </tr>
                    );
                  })}
                  <tr className="total-row">
                    <td colSpan={2} className="text-left">TOTAL</td>
                    {!hideSupplierCol && <td></td>}
                    {!hidePlaceCol && <td></td>}
                    {!hideSectionCol && <td></td>}
                    <td></td>
                    <td className="text-right">{totalItems.toLocaleString("en-IN")}</td>
                    <td className="text-right">{formatNumber(totalQty)}</td>
                    <td className="text-right">{formatAmount(totalAmount)}</td>
                    <td className="text-right">{formatAmount(calculateAvgRate(totalAmount, totalQty))}</td>
                  </tr>
                </>
              ) : (
                <tr>
                  <td colSpan={10 - (hideSupplierCol ? 1 : 0) - (hidePlaceCol ? 1 : 0) - (hideSectionCol ? 1 : 0)} className="empty-state">
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