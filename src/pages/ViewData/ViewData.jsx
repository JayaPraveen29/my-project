import React, { useEffect, useState, useMemo } from "react";
import { db } from "../../firebase";
import { collection, getDocs, doc, deleteDoc } from "firebase/firestore";
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
  const [unitFilter, setUnitFilter] = useState("Group");
  const [workTypeFilter, setWorkTypeFilter] = useState("Group");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  const baseFields = [
    "PO", "Received On", "Bill Number", "Bill Date", "Name of the Supplier",
    "Supplier Place", "Section", "Size", "Item Length", "Width", "Number of items Supplied",
    "Quantity in Metric Tons", "Item Per Rate", "Bill Basic Amount", 
    "Section Loading Charges", "Section Freight<", "Section Subtotal",
    "Loading Charges", "Freight<", "Others", "CGST", "SGST", "IGST", 
    "Total", "Freight>", "G. Total", "Net", "Landed Cost",
  ];

  const fields = useMemo(() => {
    const dynamicFields = [];
    
    if (unitFilter === "Group") {
      dynamicFields.push("Unit");
    }
    
    if (workTypeFilter === "Group") {
      dynamicFields.push("Work Type");
    }
    
    return [...dynamicFields, ...baseFields];
  }, [unitFilter, workTypeFilter]);

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
    "Item Length": "Length", 
    "Width": "Width", 
    "Number of items Supplied": "Items",
    "Quantity in Metric Tons": "MT", 
    "Item Per Rate": "Rate",
    "Bill Basic Amount": "Amount",
    "Section Loading Charges": "Sec Loading",
    "Section Freight<": "Sec Freight<",
    "Section Subtotal": "Sec Subtotal",
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

  useEffect(() => {
    async function fetchData() {
      try {
        const querySnapshot = await getDocs(collection(db, "entries"));
        const items = [];
        
        querySnapshot.docs.forEach((d) => {
          const data = d.data();
          
          // Check if this is the new multi-item format
          if (data.items && Array.isArray(data.items)) {
            // Calculate total basic amount for proportional distribution
            const entryTotalBasic = data.items.reduce((sum, item) => {
              return sum + (Number(item["Bill Basic Amount"]) || 0);
            }, 0);
            
            // Create a separate row for each item in the items array
            data.items.forEach((item, index) => {
              const itemBasic = Number(item["Bill Basic Amount"]) || 0;
              
              // Calculate proportional share for this item
              const itemProportion = entryTotalBasic > 0 ? itemBasic / entryTotalBasic : 0;
              
              // Calculate GST values proportionally
              let cgst = 0, sgst = 0, igst = 0;
              let total = 0, gTotal = 0, net = 0;
              let loadingCharges = 0, freightLess = 0, others = 0, freightGreater = 0;
              
              if (data.gst) {
                const totalGst = data.gst.totalGst || 0;
                if (data.gst.type === "AP") {
                  cgst = (totalGst / 2) * itemProportion;
                  sgst = (totalGst / 2) * itemProportion;
                } else {
                  igst = totalGst * itemProportion;
                }
              }
              
              // Distribute charges proportionally
              if (data.charges) {
                loadingCharges = (Number(data.charges["Loading Charges"]) || 0) * itemProportion;
                freightLess = (Number(data.charges["Freight<"]) || 0) * itemProportion;
                others = (Number(data.charges.Others) || 0) * itemProportion;
                freightGreater = (Number(data.charges["Freight>"]) || 0) * itemProportion;
              }
              
              // Distribute totals proportionally
              if (data.finalTotals) {
                total = (data.finalTotals.total || 0) * itemProportion;
                gTotal = (data.finalTotals.gTotal || 0) * itemProportion;
                net = (data.finalTotals.net || 0) * itemProportion;
              }
              
              items.push({
                firestoreId: `${d.id}-${index}`,
                originalFirestoreId: d.id,
                "PO": data.PO,
                "Received On": data["Received On"],
                "Bill Number": data["Bill Number"],
                "Bill Date": data["Bill Date"],
                "Name of the Supplier": data["Name of the Supplier"],
                "Supplier Place": data["Supplier Place"],
                "Unit": data.Unit,
                "Work Type": data["Work Type"],
                "Section": item.Section,
                "Size": item.Size,
                "Item Length": item["Item Length"],
                "Width": item.Width,
                "Number of items Supplied": item["Number of items Supplied"],
                "Quantity in Metric Tons": item["Quantity in Metric Tons"],
                "Item Per Rate": item["Item Per Rate"],
                "Bill Basic Amount": item["Bill Basic Amount"],
                // Section-specific charges from the item itself
                "Section Loading Charges": item["Section Loading Charges"] || 0,
                "Section Freight<": item["Section Freight<"] || 0,
                "Section Subtotal": item["Section Subtotal"] || 0,
                // Entry-level proportional charges
                "Loading Charges": loadingCharges,
                "Freight<": freightLess,
                "Others": others,
                "Freight>": freightGreater,
                "CGST": cgst,
                "SGST": sgst,
                "IGST": igst,
                "Total": total,
                "G. Total": gTotal,
                "Net": net,
                "Landed Cost": item["Quantity in Metric Tons"] 
                  ? net / (item["Quantity in Metric Tons"] || 1)
                  : 0,
                "No": data.No,
              });
            });
          } else {
            // Old format - single item per entry
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
            
            items.push({
              firestoreId: d.id,
              originalFirestoreId: d.id,
              ...data,
              "CGST": cgst,
              "SGST": sgst,
              "IGST": igst,
              "Landed Cost": data["Quantity in Metric Tons"]
                ? (data.finalTotals?.net || data.Net || 0) / (data["Quantity in Metric Tons"] || 1)
                : 0,
            });
          }
        });
        
        setData(items);
      } catch (error) {
        alert("Error loading data!");
        console.error(error);
      }
    }
    fetchData();
  }, []);

  const unitOptions = useMemo(() => {
    const setUnits = new Set();
    data.forEach(d => {
      if (d["Unit"]) setUnits.add(d["Unit"]);
    });
    return ["Group", ...Array.from(setUnits)];
  }, [data]);

  const workTypeOptions = useMemo(() => {
    const setWorkTypes = new Set();
    data.forEach(d => {
      if (d["Work Type"]) setWorkTypes.add(d["Work Type"]);
    });
    return ["Group", ...Array.from(setWorkTypes)];
  }, [data]);

  const parseDateSafe = (v) => {
    if (!v) return null;
    try {
      if (typeof v.toDate === "function") return v.toDate();
    } catch (e) {}
    const dt = new Date(v);
    if (!isNaN(dt)) return dt;
    const parts = v.toString().split(/[\/\-\s\.]/).map(p => p.trim());
    if (parts.length >= 3) {
      const [d, m, y] = parts;
      const maybe = new Date(`${y}-${m}-${d}`);
      if (!isNaN(maybe)) return maybe;
    }
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

        const from = fromDate ? new Date(fromDate) : null;
        const to = toDate ? new Date(toDate) : null;

        if (from) from.setHours(0, 0, 0, 0);
        if (to) to.setHours(23, 59, 59, 999);

        if (from && to) {
          return itemDate >= from && itemDate <= to;
        } else if (from) {
          return itemDate >= from;
        } else if (to) {
          return itemDate <= to;
        }
        return true;
      });
    }

    result.sort((a, b) => {
      const da = parseDateSafe(a["Received On"]);
      const db = parseDateSafe(b["Received On"]);
      if (da && db) return da - db;
      if (da && !db) return -1;
      if (!da && db) return 1;
      const sa = (a["Received On"] || "").toString();
      const sb = (b["Received On"] || "").toString();
      return sa.localeCompare(sb);
    });

    setFilteredData(result);
  }, [data, search, unitFilter, workTypeFilter, fromDate, toDate]);

  const formatQtyRowValue = (value) => {
    if (value === null || value === undefined) return "";
    if (typeof value === "string") return value;
    const n = Number(value);
    if (isNaN(n)) return value;
    let s = n.toString();
    if (s.includes("e")) {
      s = n.toFixed(10).replace(/(?:\.0+|(\.\d+?)0+)$/, "$1");
    }
    return s;
  };

  const formatQtyTotal = (value) => {
    const n = Number(value || 0);
    if (isNaN(n)) return "";
    return n.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  };

  const handleDelete = async (rowData) => {
    const documentId = rowData.originalFirestoreId || rowData.firestoreId;
    
    if (!documentId) return;
    
    const isMultiItem = rowData.originalFirestoreId && rowData.firestoreId !== documentId;
    const confirmMessage = isMultiItem 
      ? `This will delete the ENTIRE entry with all its items. Are you sure?`
      : `Are you sure you want to delete this entry?`;
    
    if (!window.confirm(confirmMessage)) return;
    
    try {
      await deleteDoc(doc(db, "entries", documentId));
      const updated = data.filter(item => 
        (item.originalFirestoreId || item.firestoreId) !== documentId
      );
      setData(updated);
      alert("Entry deleted successfully!");
    } catch (err) {
      console.error(err);
      alert("Failed to delete entry.");
    }
  };

  const handleEdit = (rowData) => {
    const documentId = rowData.originalFirestoreId || rowData.firestoreId;
    
    if (!documentId) {
      alert("Error: No document ID found for this entry");
      console.error("Missing document ID in rowData:", rowData);
      return;
    }
    
    console.log("Navigating to edit page with Document ID:", documentId);
    try {
      navigate(`/update-data/${documentId}`); // Changed from /UpdateData/ to /update-data/
    } catch (error) {
      console.error("Navigation error:", error);
      alert("Failed to navigate to edit page");
    }
  };

  // Fields that should NOT be totaled
  const noTotalFields = new Set([
    "Unit", "Work Type", "PO", "Received On", "Bill Number", "Bill Date", 
    "Name of the Supplier", "Supplier Place", "Section", "Size", 
    "Item Length", "Width", "Number of items Supplied", "Item Per Rate"
  ]);

  const totals = useMemo(() => {
    const t = {};
    fields.forEach(f => (t[f] = 0));
  
    filteredData.forEach(row => {
      fields.forEach(f => {
        if (!noTotalFields.has(f)) {
          const num = Number(row[f]);
          if (!isNaN(num)) {
            t[f] += num;
          }
        }
      });
    });
  
    return t;
  }, [filteredData, fields]);

  const totalMT = totals["Quantity in Metric Tons"] || 0;
  const totalNet = totals["Net"] || 0;
  const landedCostTotal = totalMT ? (totalNet / totalMT) : 0;

  const exportExcel = () => {
    if (!filteredData.length) {
      alert("No data to export");
      return;
    }

    let heading = "";
    
    if (unitFilter === "Group" && workTypeFilter === "Group") {
      heading = "Group Data";
    } else if (unitFilter === "Group" && workTypeFilter !== "Group") {
      heading = `Group - MATERIAL PURCHASE - ${workTypeFilter}`;
    } else if (unitFilter !== "Group" && workTypeFilter === "Group") {
      heading = `${unitFilter} Data`;
    } else {
      heading = `${unitFilter} - MATERIAL PURCHASE - ${workTypeFilter}`;
    }

    const wsData = [];
    
    wsData.push([heading]);
    wsData.push([]);

    const headers = ["S.No", ...fields.map(f => fieldLabels[f] || f)];
    wsData.push(headers);

    filteredData.forEach((row, idx) => {
      const rowData = [
        idx + 1,
        ...fields.map(f => {
          if (noTotalFields.has(f)) {
            return row[f] ?? "";
          }
          
          if (f === "Quantity in Metric Tons") {
            return formatQtyRowValue(row[f]);
          }
          
          if (row[f] === undefined || row[f] === null) return "";
          const num = Number(row[f]);
          if (!isNaN(num)) {
            return Math.round(num).toLocaleString("en-IN");
          }
          return row[f].toString();
        })
      ];
      wsData.push(rowData);
    });

    const totalRow = [
      "TOTAL",
      ...fields.map((f) => {
        if (noTotalFields.has(f)) return "";

        if (f === "Quantity in Metric Tons") {
          return formatQtyTotal(totalMT);
        }

        if (f === "Landed Cost") {
          return Math.round(Number(landedCostTotal || 0)).toLocaleString("en-IN");
        }

        const num = Number(totals[f] || 0);
        if (!num) return "";
        return Math.round(num).toLocaleString("en-IN");
      })
    ];
    wsData.push(totalRow);

    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet(wsData);

    const colWidths = headers.map(() => ({ wch: 12 }));
    ws['!cols'] = colWidths;

    ws['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: headers.length - 1 } }];

    XLSX.utils.book_append_sheet(wb, ws, "View Data");

    const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const filename = `viewdata_export_${timestamp}.xlsx`;

    XLSX.writeFile(wb, filename);
  };

  const exportPDF = () => {
    if (!filteredData.length) {
      alert("No data to export");
      return;
    }

    const pdf = new jsPDF({
      orientation: "landscape",
      unit: "pt",
      format: "a3", 
    });

    let heading = "";
    
    if (unitFilter === "Group" && workTypeFilter === "Group") {
      heading = "Group Data";
    } else if (unitFilter === "Group" && workTypeFilter !== "Group") {
      heading = `Group - MATERIAL PURCHASE - ${workTypeFilter}`;
    } else if (unitFilter !== "Group" && workTypeFilter === "Group") {
      heading = `${unitFilter} Data`;
    } else {
      heading = `${unitFilter} - MATERIAL PURCHASE - ${workTypeFilter}`;
    }

    pdf.setFontSize(16);
    pdf.setFont(undefined, 'bold');
    pdf.text(heading, 40, 40);
    pdf.setFont(undefined, 'normal');

    const tableColumns = ["S.No", ...fields.map(f => fieldLabels[f] || f)];

    const tableRows = filteredData.map((row, idx) => {
      return [
        idx + 1,
        ...fields.map((f) => {
          let value = row[f] ?? "";

          if (noTotalFields.has(f)) {
            return String(value);
          }

          if (f === "Quantity in Metric Tons") {
            return formatQtyRowValue(value);
          }

          if (!isNaN(value) && value !== "") {
            return Math.round(Number(value)).toLocaleString("en-IN");
          }

          return String(value);
        })
      ];
    });

    const totalRow = [
      "TOTAL",
      ...fields.map((f) => {
        if (noTotalFields.has(f)) return "";

        if (f === "Quantity in Metric Tons") {
          return formatQtyTotal(totalMT);
        }

        if (f === "Landed Cost") {
          return Math.round(Number(landedCostTotal || 0)).toLocaleString("en-IN");
        }

        const num = Number(totals[f] || 0);
        if (!num) return "";
        return Math.round(num).toLocaleString("en-IN");
      })
    ];

    tableRows.push(totalRow);

    autoTable(pdf, {
      startY: 60,
      head: [tableColumns],
      body: tableRows,
      styles: {
        fontSize: 8,
        cellPadding: 4,
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [230, 230, 230],
        textColor: 20,
        fontStyle: "bold",
      },
      bodyStyles: {
        fontStyle: "normal",
      },
      didParseCell: function (data) {
        if (data.row.index === tableRows.length - 1) {
          data.cell.styles.fontStyle = "bold";
        }
      },
      margin: { top: 60, bottom: 40 },
      tableWidth: "auto", 
      pageBreak: "auto",
      theme: "grid",
    });

    pdf.save("ViewData.pdf");
  };

  const clearDateFilters = () => {
    setFromDate("");
    setToDate("");
  };

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
            <button onClick={() => { }} className="btn-search">
              Search
            </button>
          </div>

          <div className="date-Group">
            <label className="filter-label">From:</label>
            <input
              type="date"
              className="date-input"
              value={fromDate}
              onChange={e => setFromDate(e.target.value)}
            />
            <label className="filter-label">To:</label>
            <input
              type="date"
              className="date-input"
              value={toDate}
              onChange={e => setToDate(e.target.value)}
            />
            {(fromDate || toDate) && (
              <button onClick={clearDateFilters} className="btn-clear">
                Clear
              </button>
            )}
          </div>

          <div className="actions-Group">
            <label className="filter-label">Unit:</label>
            <select className="unit-select" value={unitFilter} onChange={e => setUnitFilter(e.target.value)}>
              {unitOptions.map((u) => <option key={u} value={u}>{u}</option>)}
            </select>

            <label className="filter-label">Work Type:</label>
            <select className="unit-select" value={workTypeFilter} onChange={e => setWorkTypeFilter(e.target.value)}>
              {workTypeOptions.map((wt) => <option key={wt} value={wt}>{wt}</option>)}
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
              {fields.map((f) => {
                const multiLineFields = ["Freight>", "Freight<"];
                const needsMultiLine = multiLineFields.includes(f);
                
                return (
                  <th 
                    key={f} 
                    style={{
                      ...(f === "PO" ? { minWidth: "50px", maxWidth: "70px" } : {}),
                      ...(needsMultiLine ? { whiteSpace: "pre-line" } : {})
                    }}
                  >
                    {fieldLabels[f]}
                  </th>
                );
              })}
              <th>Actions</th>
            </tr>
          </thead>

          <tbody>
            {filteredData.map((row, idx) => (
              <tr key={row.firestoreId || idx}>
                <td>{idx + 1}</td>

                {fields.map((f) => (
                  <td key={f} style={f === "PO" ? { whiteSpace: "nowrap", minWidth: "50px", maxWidth: "70px" } : { whiteSpace: "nowrap" }}>
                    {noTotalFields.has(f)
                      ? (row[f] ?? "")
                      : f === "Quantity in Metric Tons"
                        ? formatQtyRowValue(row[f])
                        : (!isNaN(Number(row[f])) && row[f] !== "" && row[f] !== null && row[f] !== undefined
                            ? Math.round(Number(row[f])).toLocaleString("en-IN")
                            : (row[f] ?? ""))
                    }
                  </td>
                ))}

                <td>
                  <button 
                    className="edit-btn" 
                    onClick={() => handleEdit(row)}
                  >
                    ✏️
                  </button>
                  <button className="delete-btn" onClick={() => handleDelete(row)}>🗑️</button>
                </td>
              </tr>
            ))}

            <tr className="total-row">
              <td style={{ fontWeight: "bold" }}>TOTAL</td>
              {fields.map((f) => {
                if (noTotalFields.has(f)) return <td key={f}></td>;

                if (f === "Quantity in Metric Tons") {
                  return <td key={f} style={{ fontWeight: "bold" }}>{formatQtyTotal(totalMT)}</td>;
                }

                if (f === "Landed Cost") {
                  return <td key={f} style={{ fontWeight: "bold" }}>{Math.round(Number(landedCostTotal || 0)).toLocaleString("en-IN")}</td>;
                }

                const num = Number(totals[f] || 0);
                if (!num) return <td key={f}></td>;
                return <td key={f} style={{ fontWeight: "bold" }}>{Math.round(num).toLocaleString("en-IN")}</td>;
              })}
              <td></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}