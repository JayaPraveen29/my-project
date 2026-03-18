import React, { useEffect, useState, useMemo } from "react";
import { db } from "../../firebase";
import { collection, getDocs, doc, deleteDoc, getDoc, updateDoc } from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import "./ViewData.css";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export default function ViewData() {
  const navigate = useNavigate();
  const [data, setData] = useState([]);
  const [filteredData, setFilteredData] = useState([]);
  const [search, setSearch] = useState("");
  const [financialYear, setFinancialYear] = useState("2025-26");
  const [unitFilter, setUnitFilter] = useState("Group");
  const [workTypeFilter, setWorkTypeFilter] = useState("Group");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const baseFields = useMemo(() => [
    "PO", "Received On", "Bill Number", "Bill Date", "Name of the Supplier",
    "Supplier Place", "Section", "Size", "Width", "Item Length", "Number of items Supplied",
    "Quantity in Metric Tons", "Item Per Rate", "Bill Basic Amount",
    "Loading Charges", "Freight<", "Others", "CGST", "SGST", "IGST",
    "Total", "Freight>", "G. Total", "Net", "Landed Cost",
  ], []);

  const fields = useMemo(() => {
    const dynamicFields = [];
    if (unitFilter === "Group") dynamicFields.push("Unit");
    if (workTypeFilter === "Group") dynamicFields.push("Work Type");
    return [...dynamicFields, ...baseFields];
  }, [unitFilter, workTypeFilter, baseFields]);

  const fieldLabels = {
    "Unit": "Unit",
    "Work Type": "Work Type",
    "PO": "PO",
    "Received On": "Recd. On",
    "Bill Number": "Bill No",
    "Bill Date": "Bill Date",
    "Name of the Supplier": "Supplier",
    "Supplier Place": "Place",
    "Section": "Section",
    "Size": "Size",
    "Width": "Width",
    "Item Length": "Length",
    "Number of items Supplied": "Items",
    "Quantity in Metric Tons": "MT",
    "Item Per Rate": "Rate",
    "Bill Basic Amount": "Amount",
    "Loading Charges": "Loading",
    "Freight<": "Freight\n<\n(GST)",
    "Others": "Others",
    "CGST": "CGST",
    "SGST": "SGST",
    "IGST": "IGST",
    "Total": "Total",
    "Freight>": "Freight\n>\n(GST)",
    "G. Total": "G. Total",
    "Net": "Net",
    "Landed Cost": "Landed Cost"
  };

  // Columns from "Width" onwards that should be right-aligned in exports
  const rightAlignFromWidth = new Set([
    "Width", "Item Length", "Number of items Supplied",
    "Quantity in Metric Tons", "Item Per Rate", "Bill Basic Amount",
    "Loading Charges", "Freight<", "Others", "CGST", "SGST", "IGST",
    "Total", "Freight>", "G. Total", "Net", "Landed Cost",
  ]);

  const fetchData = async () => {
    try {
      const querySnapshot = await getDocs(collection(db, "entries"));
      const items = [];

      querySnapshot.docs.forEach((d) => {
        const data = d.data();

        if (data.items && Array.isArray(data.items)) {
          const entryTotalBasic = data.items.reduce((sum, item) => {
            return sum + (Number(item["Bill Basic Amount"]) || 0);
          }, 0);

          data.items.forEach((item, index) => {
            const itemBasic = Number(item["Bill Basic Amount"]) || 0;
            const itemProportion = entryTotalBasic > 0 ? itemBasic / entryTotalBasic : 0;

            let cgst = 0, sgst = 0, igst = 0;
            let total = 0, gTotal = 0, net = 0;
            let others = 0;

            if (data.gst) {
              const totalGst = data.gst.totalGst || 0;
              if (data.gst.type === "AP") {
                cgst = (totalGst / 2) * itemProportion;
                sgst = (totalGst / 2) * itemProportion;
              } else {
                igst = totalGst * itemProportion;
              }
            }

            if (data.charges) {
              others = (Number(data.charges.Others) || 0) * itemProportion;
            }

            const sectionLoading = Number(item["Section Loading Charges"]) || 0;
            const sectionFreightLess = Number(item["Section Freight<"]) || 0;
            const sectionFreightGreater = Number(item["Section Freight>"]) || 0;

            if (data.finalTotals) {
              total = (data.finalTotals.total || 0) * itemProportion;
              gTotal = (data.finalTotals.gTotal || 0) * itemProportion;
              net = (data.finalTotals.net || 0) * itemProportion;
            }

            const itemTotalFreight = sectionLoading + sectionFreightLess + sectionFreightGreater;

            items.push({
              firestoreId: `${d.id}-${index}`,
              originalFirestoreId: d.id,
              itemIndex: index,
              "PO": data.PO,
              "Received On": data["Received On"],
              "Bill Number": data["Bill Number"],
              "Bill Date": data["Bill Date"],
              "Name of the Supplier": data["Name of the Supplier"],
              "Supplier Place": data["Supplier Place"],
              "Unit": data.Unit,
              "Work Type": data["Work Type"],
              "Financial Year": data.FinancialYear,
              "Section": item.Section,
              "Size": item.Size,
              "Width": item.Width,
              "Item Length": item["Item Length"],
              "Number of items Supplied": item["Number of items Supplied"],
              "Quantity in Metric Tons": item["Quantity in Metric Tons"],
              "Item Per Rate": item["Item Per Rate"],
              "Bill Basic Amount": item["Bill Basic Amount"],
              "Loading Charges": sectionLoading,
              "Freight<": sectionFreightLess,
              "Freight>": sectionFreightGreater,
              "Others": others,
              "CGST": cgst,
              "SGST": sgst,
              "IGST": igst,
              "Total": total,
              "G. Total": gTotal,
              "Net": net,
              "Landed Cost": item["Quantity in Metric Tons"]
                ? (itemBasic + itemTotalFreight + others) / (item["Quantity in Metric Tons"] || 1)
                : 0,
              "No": data.No,
            });
          });
        } else {
          let cgst = 0, sgst = 0, igst = 0;

          if (data.gst) {
            if (data.gst.type === "AP") {
              const totalGst = data.gst.totalGst || 0;
              cgst = totalGst / 2;
              sgst = totalGst / 2;
            } else {
              igst = data.gst.totalGst || 0;
            }
          }

          const totalFreight = (Number(data["Loading Charges"]) || 0) +
            (Number(data["Freight<"]) || 0) +
            (Number(data["Freight>"]) || 0) +
            (Number(data.charges?.Others) || 0);

          items.push({
            firestoreId: d.id,
            originalFirestoreId: d.id,
            ...data,
            "Financial Year": data.FinancialYear,
            "CGST": cgst,
            "SGST": sgst,
            "IGST": igst,
            "Landed Cost": data["Quantity in Metric Tons"]
              ? ((Number(data["Bill Basic Amount"]) || 0) + totalFreight) / (data["Quantity in Metric Tons"] || 1)
              : 0,
          });
        }
      });

      setData(items);
    } catch (error) {
      alert("Error loading data!");
      console.error(error);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const unitOptions = useMemo(() => {
    const setUnits = new Set();
    data.forEach(d => { if (d["Unit"]) setUnits.add(d["Unit"]); });
    return ["Group", ...Array.from(setUnits)];
  }, [data]);

  const workTypeOptions = useMemo(() => {
    const setWorkTypes = new Set();
    data.forEach(d => { if (d["Work Type"]) setWorkTypes.add(d["Work Type"]); });
    return ["Group", ...Array.from(setWorkTypes)];
  }, [data]);

  const parseDateSafe = (v) => {
    if (!v) return null;

    try {
      if (typeof v.toDate === "function") return v.toDate();
    } catch (e) {}

    if (typeof v === "string") {
      const ddmmyyyy = v.match(/^(\d{2})-(\d{2})-(\d{4})$/);
      if (ddmmyyyy) {
        const [, day, month, year] = ddmmyyyy;
        const dt = new Date(`${year}-${month}-${day}`);
        if (!isNaN(dt)) return dt;
      }

      const ddmmyyyySlash = v.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
      if (ddmmyyyySlash) {
        const [, day, month, year] = ddmmyyyySlash;
        const dt = new Date(`${year}-${month}-${day}`);
        if (!isNaN(dt)) return dt;
      }

      const ddmmyyyyDot = v.match(/^(\d{2})\.(\d{2})\.(\d{4})$/);
      if (ddmmyyyyDot) {
        const [, day, month, year] = ddmmyyyyDot;
        const dt = new Date(`${year}-${month}-${day}`);
        if (!isNaN(dt)) return dt;
      }
    }

    const dt = new Date(v);
    if (!isNaN(dt)) return dt;

    return null;
  };

  useEffect(() => {
    let result = [...data];

    if (search && search.trim()) {
      const s = search.toLowerCase();
      result = result.filter(item =>
        (item["Bill Number"] || "").toString().toLowerCase().includes(s) ||
        (item["Bill Date"] || "").toString().toLowerCase().includes(s) ||
        (item["Name of the Supplier"] || "").toString().toLowerCase().includes(s) ||
        (item["Section"] || "").toString().toLowerCase().includes(s)
      );
    }

    if (financialYear) {
      result = result.filter(item => item["Financial Year"] === financialYear);
    }

    if (unitFilter && unitFilter !== "Group") {
      result = result.filter(item => item["Unit"] === unitFilter);
    }

    if (workTypeFilter && workTypeFilter !== "Group") {
      result = result.filter(item => item["Work Type"] === workTypeFilter);
    }

    if (fromDate || toDate) {
      result = result.filter(item => {
        const itemDate = parseDateSafe(item["Received On"]);
        if (!itemDate) return false;

        const itemDateOnly = new Date(itemDate.getFullYear(), itemDate.getMonth(), itemDate.getDate());

        const parseLocalDate = (str) => {
          if (!str) return null;
          const [y, m, d] = str.split("-").map(Number);
          return new Date(y, m - 1, d);
        };

        const from = parseLocalDate(fromDate);
        const to = parseLocalDate(toDate);
        const toEndOfDay = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999) : null;

        if (from && toEndOfDay) return itemDateOnly >= from && itemDateOnly <= toEndOfDay;
        if (from) return itemDateOnly >= from;
        if (toEndOfDay) return itemDateOnly <= toEndOfDay;
        return true;
      });
    }

    result.sort((a, b) => {
      const da = parseDateSafe(a["Received On"]);
      const db2 = parseDateSafe(b["Received On"]);

      if (da && db2) {
        if (da.getFullYear() !== db2.getFullYear()) return da.getFullYear() - db2.getFullYear();
        if (da.getMonth() !== db2.getMonth()) return da.getMonth() - db2.getMonth();
        return da.getDate() - db2.getDate();
      }
      if (da && !db2) return -1;
      if (!da && db2) return 1;
      return 0;
    });

    setFilteredData(result);
  }, [data, search, financialYear, unitFilter, workTypeFilter, fromDate, toDate]);

  const formatQtyRowValue = (value) => {
    if (value === null || value === undefined) return "";
    const n = Number(value);
    if (isNaN(n)) return value;
    return n.toFixed(3);
  };

  const formatQtyTotal = (value) => {
    const n = Number(value || 0);
    if (isNaN(n)) return "";
    return n.toFixed(3);
  };

  const formatRate = (value) => {
    if (value === null || value === undefined || value === "") return "";
    const num = Number(value);
    if (isNaN(num)) return value;
    return Math.round(num).toLocaleString("en-IN");
  };

  const handleDelete = async (rowData) => {
    const documentId = rowData.originalFirestoreId || rowData.firestoreId;
    if (!documentId) return;

    const isMultiItem = rowData.originalFirestoreId && rowData.firestoreId !== documentId;

    try {
      if (isMultiItem) {
        const docRef = doc(db, "entries", documentId);
        const docSnap = await getDoc(docRef);
        if (!docSnap.exists()) { alert("Entry not found!"); return; }

        const entryData = docSnap.data();
        const itemIndex = rowData.itemIndex;

        if (entryData.items && entryData.items.length === 1) {
          if (!window.confirm("This is the last section in the bill. Deleting it will remove the entire entry. Continue?")) return;
          await deleteDoc(docRef);
          alert("Entry deleted successfully!");
          await fetchData();
        } else {
          if (!window.confirm(`Are you sure you want to delete this section?\n\nSection: ${rowData.Section}\nSize: ${rowData.Size}`)) return;

          const updatedItems = entryData.items.filter((_, idx) => idx !== itemIndex);
          const newTotalBasic = updatedItems.reduce((sum, item) => sum + (Number(item["Bill Basic Amount"]) || 0), 0);

          const baseAmount = newTotalBasic +
            (Number(entryData.charges?.["Loading Charges"]) || 0) +
            (Number(entryData.charges?.["Freight<"]) || 0) +
            (Number(entryData.charges?.Others) || 0);

          let totalGst = 0;
          if (entryData.gst) {
            if (entryData.gst.type === "AP") {
              totalGst = baseAmount * ((Number(entryData.gst.cgstP) || 0) + (Number(entryData.gst.sgstP) || 0)) / 100;
            } else {
              totalGst = baseAmount * (Number(entryData.gst.igstP) || 0) / 100;
            }
          }

          const total = baseAmount + totalGst;
          const gTotal = total + (Number(entryData.charges?.["Freight>"]) || 0);
          const net = gTotal - totalGst;

          await updateDoc(docRef, {
            items: updatedItems,
            "gst.totalGst": totalGst,
            finalTotals: { basicTotal: newTotalBasic, gst: totalGst, total, gTotal, net }
          });

          alert("Section deleted successfully!");
          await fetchData();
        }
      } else {
        if (!window.confirm("Are you sure you want to delete this entry?")) return;
        await deleteDoc(doc(db, "entries", documentId));
        alert("Entry deleted successfully!");
        await fetchData();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete: " + err.message);
    }
  };

  const handleEdit = (rowData) => {
    const documentId = rowData.originalFirestoreId || rowData.firestoreId;
    if (!documentId) { alert("Error: No document ID found for this entry"); return; }
    navigate(`/update-data/${documentId}`);
  };

  const noTotalFields = useMemo(() => new Set([
    "Unit", "Work Type", "PO", "Received On", "Bill Number", "Bill Date",
    "Name of the Supplier", "Supplier Place", "Section", "Size",
    "Width", "Item Length", "Number of items Supplied", "Item Per Rate"
  ]), []);

  const totals = useMemo(() => {
    const t = {};
    fields.forEach(f => (t[f] = 0));
    filteredData.forEach(row => {
      fields.forEach(f => {
        if (!noTotalFields.has(f)) {
          const num = Number(row[f]);
          if (!isNaN(num)) t[f] += num;
        }
      });
    });
    return t;
  }, [filteredData, fields, noTotalFields]);

  const totalMT = totals["Quantity in Metric Tons"] || 0;
  const totalBasic = totals["Bill Basic Amount"] || 0;
  const totalFreight = (totals["Loading Charges"] || 0) +
    (totals["Freight<"] || 0) +
    (totals["Freight>"] || 0) +
    (totals["Others"] || 0);
  const landedCostTotal = totalMT ? (totalBasic + totalFreight) / totalMT : 0;

  // ─── EXCEL EXPORT ────────────────────────────────────────────────────────────
  const exportExcel = () => {
    if (!filteredData.length) { alert("No data to export"); return; }

    let heading = "";
    if (unitFilter === "Group" && workTypeFilter === "Group") heading = "Group Data";
    else if (unitFilter === "Group" && workTypeFilter !== "Group") heading = `Group - MATERIAL PURCHASE - ${workTypeFilter}`;
    else if (unitFilter !== "Group" && workTypeFilter === "Group") heading = `${unitFilter} Data`;
    else heading = `${unitFilter} - MATERIAL PURCHASE - ${workTypeFilter}`;

    const wsData = [];
    wsData.push([heading]);
    wsData.push([]);
    const headers = ["S.No", ...fields.map(f => fieldLabels[f] || f)];
    wsData.push(headers);

    filteredData.forEach((row, idx) => {
      wsData.push([
        idx + 1,
        ...fields.map(f => {
          if (f === "Item Per Rate") return formatRate(row[f]);
          if (noTotalFields.has(f)) return row[f] ?? "";
          if (f === "Quantity in Metric Tons") return formatQtyRowValue(row[f]);
          if (row[f] === undefined || row[f] === null) return "";
          const num = Number(row[f]);
          if (!isNaN(num)) return Math.round(num).toLocaleString("en-IN");
          return row[f].toString();
        })
      ]);
    });

    wsData.push([
      "TOTAL",
      ...fields.map(f => {
        if (noTotalFields.has(f)) return "";
        if (f === "Quantity in Metric Tons") return formatQtyTotal(totalMT);
        if (f === "Landed Cost") return Math.round(Number(landedCostTotal || 0)).toLocaleString("en-IN");
        const num = Number(totals[f] || 0);
        if (!num) return "";
        return Math.round(num).toLocaleString("en-IN");
      })
    ]);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    // ── Right-align cells from "Width" column onwards (data rows + total row) ──
    const headerRowIndex = 2; // 0-based: row 0=heading, 1=blank, 2=headers
    const dataStartRow = 3;   // data rows start here
    const totalRowIndex = dataStartRow + filteredData.length;

    headers.forEach((label, colIdx) => {
      // Find the field key for this header label
      const fieldKey = colIdx === 0
        ? null // S.No column
        : fields[colIdx - 1];

      if (fieldKey && rightAlignFromWidth.has(fieldKey)) {
        // Apply right alignment to every row in this column (header + data + total)
        const allRows = [headerRowIndex, ...Array.from({ length: filteredData.length + 1 }, (_, i) => dataStartRow + i)];
        allRows.forEach(rowIdx => {
          const cellAddress = XLSX.utils.encode_cell({ r: rowIdx, c: colIdx });
          if (!ws[cellAddress]) ws[cellAddress] = { v: "", t: "s" };
          ws[cellAddress].s = {
            ...(ws[cellAddress].s || {}),
            alignment: { horizontal: "right" }
          };
        });
      }
    });

    ws['!cols'] = headers.map(() => ({ wch: 12 }));
    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];
    XLSX.utils.book_append_sheet(wb, ws, "View Data");
    XLSX.writeFile(wb, `viewdata_export_${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.xlsx`);
  };

  // ─── PDF EXPORT ──────────────────────────────────────────────────────────────
  const exportPDF = () => {
    if (!filteredData.length) { alert("No data to export"); return; }

    const pdf = new jsPDF({ orientation: "landscape", unit: "pt", format: "a3" });

    let heading = "";
    if (unitFilter === "Group" && workTypeFilter === "Group") heading = "Group Data";
    else if (unitFilter === "Group" && workTypeFilter !== "Group") heading = `Group - MATERIAL PURCHASE - ${workTypeFilter}`;
    else if (unitFilter !== "Group" && workTypeFilter === "Group") heading = `${unitFilter} Data`;
    else heading = `${unitFilter} - MATERIAL PURCHASE - ${workTypeFilter}`;

    pdf.setFontSize(16);
    pdf.setFont(undefined, 'bold');
    pdf.text(heading, 40, 40);
    pdf.setFont(undefined, 'normal');

    const tableColumns = ["S.No", ...fields.map(f => fieldLabels[f] || f)];

    const tableRows = filteredData.map((row, idx) => [
      idx + 1,
      ...fields.map(f => {
        if (f === "Item Per Rate") return formatRate(row[f]);
        let value = row[f] ?? "";
        if (noTotalFields.has(f)) return String(value);
        if (f === "Quantity in Metric Tons") return formatQtyRowValue(value);
        if (!isNaN(value) && value !== "") return Math.round(Number(value)).toLocaleString("en-IN");
        return String(value);
      })
    ]);

    tableRows.push([
      "TOTAL",
      ...fields.map(f => {
        if (noTotalFields.has(f)) return "";
        if (f === "Quantity in Metric Tons") return formatQtyTotal(totalMT);
        if (f === "Landed Cost") return Math.round(Number(landedCostTotal || 0)).toLocaleString("en-IN");
        const num = Number(totals[f] || 0);
        if (!num) return "";
        return Math.round(num).toLocaleString("en-IN");
      })
    ]);

    // ── Build columnStyles: right-align from "Width" column onwards ──
    // Column 0 = "S.No", columns 1..n map to fields[0..n-1]
    const columnStyles = {};
    fields.forEach((f, idx) => {
      if (rightAlignFromWidth.has(f)) {
        columnStyles[idx + 1] = { halign: "right" }; // +1 for S.No offset
      }
    });

    autoTable(pdf, {
      startY: 60,
      head: [tableColumns],
      body: tableRows,
      styles: { fontSize: 8, cellPadding: 4, overflow: "linebreak" },
      headStyles: { fillColor: [230, 230, 230], textColor: 20, fontStyle: "bold" },
      columnStyles,
      didParseCell: function (data) {
        if (data.row.index === tableRows.length - 1) data.cell.styles.fontStyle = "bold";
      },
      margin: { top: 60, bottom: 40 },
      tableWidth: "auto",
      pageBreak: "auto",
      theme: "grid",
    });

    pdf.save("ViewData.pdf");
  };

  const clearDateFilters = () => { setFromDate(""); setToDate(""); };

  return (
    <div className="entry-container">
      <h1 className="entry-heading">View Data</h1>

      <div className="controls-wrapper">
        <div className="controls-row">
          <div className="search-Group">
            <input
              type="text"
              className="search-input"
              placeholder="Search by Bill No / Bill Date / Supplier / Section"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <button onClick={() => {}} className="btn-search">Search</button>
          </div>

          <div className="filter-group">
            <label className="filter-label">Financial Year:</label>
            <select className="unit-select" value={financialYear} onChange={e => setFinancialYear(e.target.value)}>
              <option value="2024-25">2024-25</option>
              <option value="2025-26">2025-26</option>
              <option value="2026-27">2026-27</option>
              <option value="2027-28">2027-28</option>
            </select>
          </div>

          <div className="date-Group">
            <label className="filter-label">From:</label>
            <input type="date" className="date-input" value={fromDate} onChange={e => setFromDate(e.target.value)} />
            <label className="filter-label">To:</label>
            <input type="date" className="date-input" value={toDate} onChange={e => setToDate(e.target.value)} />
            {(fromDate || toDate) && (
              <button onClick={clearDateFilters} className="btn-clear">Clear</button>
            )}
          </div>

          <div className="actions-Group">
            <label className="filter-label">Unit:</label>
            <select className="unit-select" value={unitFilter} onChange={e => setUnitFilter(e.target.value)}>
              {unitOptions.map(u => <option key={u} value={u}>{u}</option>)}
            </select>

            <label className="filter-label">Work Type:</label>
            <select className="unit-select" value={workTypeFilter} onChange={e => setWorkTypeFilter(e.target.value)}>
              {workTypeOptions.map(wt => <option key={wt} value={wt}>{wt}</option>)}
            </select>

            <button onClick={exportExcel} className="btn-export" style={{ marginRight: "10px" }}>Export Excel</button>
            <button onClick={exportPDF} className="btn-export">Export PDF</button>
          </div>
        </div>
      </div>

      <div className="table-wrapper">
        <table className="view-table">
          <thead>
            <tr>
              <th>S.No</th>
              {fields.map(f => (
                <th
                  key={f}
                  style={{
                    ...(f === "PO" ? { minWidth: "50px", maxWidth: "70px" } : {}),
                    ...(["Freight>", "Freight<"].includes(f) ? { whiteSpace: "pre-line" } : {})
                  }}
                >
                  {fieldLabels[f]}
                </th>
              ))}
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredData.map((row, idx) => (
              <tr key={row.firestoreId || idx}>
                <td>{idx + 1}</td>

                {fields.map(f => {
                  const isNumeric = !noTotalFields.has(f);
                  let displayValue;
                  let cellIsNumeric = isNumeric;

                  if (f === "Item Per Rate") {
                    displayValue = formatRate(row[f]);
                    cellIsNumeric = true;
                  } else if (!isNumeric) {
                    displayValue = row[f] ?? "";
                  } else if (f === "Quantity in Metric Tons") {
                    displayValue = formatQtyRowValue(row[f]);
                  } else if (!isNaN(Number(row[f])) && row[f] !== "" && row[f] !== null && row[f] !== undefined) {
                    displayValue = Math.round(Number(row[f])).toLocaleString("en-IN");
                  } else {
                    displayValue = row[f] ?? "";
                  }

                  return (
                    <td
                      key={f}
                      className={cellIsNumeric ? "numeric-cell" : ""}
                      style={f === "PO" ? { whiteSpace: "nowrap", minWidth: "50px", maxWidth: "70px" } : { whiteSpace: "nowrap" }}
                    >
                      {displayValue}
                    </td>
                  );
                })}

                <td>
                  <button className="edit-btn" onClick={() => handleEdit(row)}>✏️</button>
                  <button className="delete-btn" onClick={() => handleDelete(row)}>🗑️</button>
                </td>
              </tr>
            ))}

            <tr className="total-row">
              <td style={{ fontWeight: "bold" }}>TOTAL</td>
              {fields.map(f => {
                if (noTotalFields.has(f)) return <td key={f}></td>;

                if (f === "Quantity in Metric Tons") {
                  return <td key={f} className="numeric-cell" style={{ fontWeight: "bold" }}>{formatQtyTotal(totalMT)}</td>;
                }
                if (f === "Landed Cost") {
                  return <td key={f} className="numeric-cell" style={{ fontWeight: "bold" }}>{Math.round(Number(landedCostTotal || 0)).toLocaleString("en-IN")}</td>;
                }

                const num = Number(totals[f] || 0);
                if (!num) return <td key={f} className="numeric-cell"></td>;
                return <td key={f} className="numeric-cell" style={{ fontWeight: "bold" }}>{Math.round(num).toLocaleString("en-IN")}</td>;
              })}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}