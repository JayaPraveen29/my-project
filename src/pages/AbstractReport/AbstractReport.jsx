import React, { useState, useEffect } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import jsPDF from "jspdf";
import * as XLSX from "xlsx";
import autoTable from "jspdf-autotable";
import "./AbstractReport.css";

export default function AbstractReport() {
  const [data, setData] = useState([]);
  const [abstractData, setAbstractData] = useState([]);
  const [pivotData, setPivotData] = useState([]);
  const [selectedUnit, setSelectedUnit] = useState("Group");
  const [selectedWorkType, setSelectedWorkType] = useState("Group");
  const [units, setUnits] = useState([]);
  const [workTypes, setWorkTypes] = useState([]);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

  useEffect(() => {
    async function fetchData() {
      try {
        const querySnapshot = await getDocs(collection(db, "entries"));
        const items = querySnapshot.docs.map(doc => doc.data());
        setData(items);
        const uniqueUnits = [...new Set(items.map(item => item.Unit || "Unknown"))];
        setUnits(uniqueUnits);
        const uniqueWorkTypes = [...new Set(items.map(item => item["Work Type"] || "Unknown"))];
        setWorkTypes(uniqueWorkTypes);
        processAbstractData(items, selectedUnit, selectedWorkType, fromDate, toDate);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    processAbstractData(data, selectedUnit, selectedWorkType, fromDate, toDate);
  }, [selectedUnit, selectedWorkType, data, fromDate, toDate]);

  const filterByDateRange = (items, from, to) => {
    if (!from && !to) return items;

    const filtered = items.filter(item => {
      const itemDate = item["Received On"] || item["Recd. On"] || item["Recd On"] || item.Date || item.date || "";
      
      if (!itemDate) return false;

      let itemDateObj;
      try {
        if (typeof itemDate === 'string') {
          if (itemDate.includes("-")) {
            const parts = itemDate.split("-");
            if (parts.length === 3) {
              if (parts[0].length === 4) {
                itemDateObj = new Date(itemDate);
              } else {
                const [day, month, year] = parts;
                itemDateObj = new Date(year, month - 1, day);
              }
            }
          }
        } else if (itemDate instanceof Date) {
          itemDateObj = itemDate;
        }

        if (!itemDateObj || isNaN(itemDateObj.getTime())) return false;

        itemDateObj.setHours(0, 0, 0, 0);

        const fromDateObj = from ? new Date(from) : null;
        const toDateObj = to ? new Date(to) : null;

        if (fromDateObj) fromDateObj.setHours(0, 0, 0, 0);
        if (toDateObj) toDateObj.setHours(23, 59, 59, 999);

        if (fromDateObj && toDateObj) {
          return itemDateObj >= fromDateObj && itemDateObj <= toDateObj;
        } else if (fromDateObj) {
          return itemDateObj >= fromDateObj;
        } else if (toDateObj) {
          return itemDateObj <= toDateObj;
        }
      } catch (error) {
        console.error("Error parsing date:", itemDate, error);
        return false;
      }

      return true;
    });

    return filtered;
  };

  const processAbstractData = (items, unit, workType, from, to) => {
    let filteredItems = filterByDateRange(items, from, to);
    
    if (workType !== "Group") {
      filteredItems = filteredItems.filter(item => (item["Work Type"] || "Unknown") === workType);
    }

    if (unit === "Group") {
      processPivotData(filteredItems);
    } else {
      processNormalData(filteredItems, unit);
    }
  };

  const processNormalData = (items, unit) => {
    const filteredItems = items.filter(item => (item.Unit || "Unknown") === unit);
    const grouped = {};

    filteredItems.forEach(entry => {
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
      
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const itemLength = Number(item["Item Length"]) || 0;
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        const itemNetAmount = entryTotalBasic > 0 
          ? (itemBasic / entryTotalBasic) * entryNetAmount 
          : 0;

        const key = `${section}|${size}`;
        if (!grouped[key]) {
          grouped[key] = {
            Unit: entry.Unit || "Unknown",
            section,
            size: size,
            length: size,
            totalMt: itemLength,
            totalQty: qty,
            totalNet: itemNetAmount
          };
        } else {
          grouped[key].totalMt += itemLength;
          grouped[key].totalQty += qty;
          grouped[key].totalNet += itemNetAmount;
        }
      });
    });

    const array = Object.values(grouped).map(item => ({
      ...item,
      avgRate: item.totalQty > 0 ? item.totalNet / item.totalQty : 0
    }));

    array.sort((a, b) => a.section.localeCompare(b.section));
    setAbstractData(array);
    setPivotData([]);
  };

  const processPivotData = (items) => {
    const grouped = {};

    items.forEach(entry => {
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
      
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const unit = entry.Unit || "Unknown";
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        const itemNetAmount = entryTotalBasic > 0 
          ? (itemBasic / entryTotalBasic) * entryNetAmount 
          : 0;

        const key = `${section}|${size}`;
        if (!grouped[key]) {
          grouped[key] = {
            section,
            size,
            units: {}
          };
        }
        if (!grouped[key].units[unit]) {
          grouped[key].units[unit] = {
            totalQty: 0,
            totalNet: 0
          };
        }
        grouped[key].units[unit].totalQty += qty;
        grouped[key].units[unit].totalNet += itemNetAmount;
      });
    });

    const GroupUnits = [...new Set(items.map(item => item.Unit || "Unknown"))];
    const array = Object.values(grouped).map(item => {
      const row = { 
        section: item.section,
        size: item.size
      };
      let combinedQty = 0;
      let combinedNet = 0;
      
      GroupUnits.forEach(unit => {
        if (item.units[unit]) {
          row[`${unit}_qty`] = item.units[unit].totalQty;
          row[`${unit}_net`] = item.units[unit].totalNet;
          row[`${unit}_rate`] = item.units[unit].totalQty > 0 
            ? item.units[unit].totalNet / item.units[unit].totalQty 
            : 0;
          
          combinedQty += item.units[unit].totalQty;
          combinedNet += item.units[unit].totalNet;
        } else {
          row[`${unit}_qty`] = 0;
          row[`${unit}_net`] = 0;
          row[`${unit}_rate`] = 0;
        }
      });
      
      row.combined_qty = combinedQty;
      row.combined_net = combinedNet;
      row.combined_rate = combinedQty > 0 ? combinedNet / combinedQty : 0;
      
      return row;
    });

    array.sort((a, b) => {
      const sectionCompare = a.section.localeCompare(b.section);
      if (sectionCompare !== 0) return sectionCompare;
      return a.size.localeCompare(b.size);
    });
    setPivotData(array);
    setAbstractData([]);
  };

  const formatQty = value => Number(value).toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  const formatMT = value => Number(value).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const formatAmount = value => Math.ceil(Number(value)).toLocaleString("en-IN");
  const formatRate = value => Math.ceil(Number(value)).toLocaleString("en-IN");

  const grandTotalQty = abstractData.reduce((sum, item) => sum + item.totalQty, 0);
  const grandTotalNet = abstractData.reduce((sum, item) => sum + item.totalNet, 0);
  const grandAvgRate = grandTotalQty > 0 ? grandTotalNet / grandTotalQty : 0;

  const showLengthColumn = selectedUnit === "Group";

  const exportPDF = () => {
    const doc = new jsPDF("p", "pt", "a4");
    doc.setFontSize(15);
  
    let heading = "Abstract of Raw Material Purchased";
    if (selectedUnit !== "Group") heading += ` - ${selectedUnit}`;
    if (selectedWorkType !== "Group") heading += ` (${selectedWorkType})`;
  
    doc.text(heading, 40, 40);
  
    if (fromDate || toDate) {
      doc.setFontSize(10);
      doc.text(`Period: ${fromDate || "Start"} to ${toDate || "End"}`, 40, 55);
    }
  
    if (selectedUnit === "Group" && pivotData.length > 0) {
      const headRow1 = [
        { content: "S.No.", rowSpan: 2 },
        { content: "Section", rowSpan: 2 },
        { content: "Size", rowSpan: 2 }
      ];
  
      const headRow2 = [];
  
      units.forEach(unit => {
        headRow1.push({ content: unit, colSpan: 3 });
        headRow2.push(
          { content: "Mt." },
          { content: "Value Rs." },
          { content: "Avg Rate" }
        );
      });
  
      headRow1.push({ content: "Total", colSpan: 3 });
      headRow2.push(
        { content: "Mt." },
        { content: "Value Rs." },
        { content: "Avg Rate" }
      );
  
      const body = pivotData.map((item, index) => {
        const row = [index + 1, item.section, item.size];
  
        units.forEach(unit => {
          row.push(
            formatMT(item[`${unit}_qty`] || 0),
            formatAmount(item[`${unit}_net`] || 0),
            formatRate(item[`${unit}_rate`] || 0)
          );
        });
  
        row.push(
          formatMT(item.total_qty || item.combined_qty || 0),
          formatAmount(item.total_net || item.combined_net || 0),
          formatRate(item.total_rate || item.combined_rate || 0)
        );
  
        return row;
      });
  
      const totalRow = ["", "TOTAL", ""];
  
      units.forEach(unit => {
        const tQty = pivotData.reduce((s, x) => s + (x[`${unit}_qty`] || 0), 0);
        const tNet = pivotData.reduce((s, x) => s + (x[`${unit}_net`] || 0), 0);
        const tRate = tQty ? tNet / tQty : 0;
  
        totalRow.push(formatMT(tQty), formatAmount(tNet), formatRate(tRate));
      });
  
      const gQty = pivotData.reduce((s, x) => s + (x.total_qty || x.combined_qty || 0), 0);
      const gNet = pivotData.reduce((s, x) => s + (x.total_net || x.combined_net || 0), 0);
      const gRate = gQty ? gNet / gQty : 0;
  
      totalRow.push(formatMT(gQty), formatAmount(gNet), formatRate(gRate));
      body.push(totalRow);
  
      autoTable(doc, {
        startY: fromDate || toDate ? 70 : 60,
        head: [headRow1, headRow2],
        body: body,
        theme: "grid",
        styles: { fontSize: 7, halign: "center", valign: "middle", cellPadding: 2 },
        headStyles: { 
          fillColor: [230, 240, 255],
          textColor: [0, 0, 0],
          fontStyle: "bold"
        }
      });
  
    } else {
      const headers = selectedUnit === "Group"
        ? ["No.", "Unit", "Section", "Size", "Length", "Total Mt.", "Net Amount", "Avg Rate"]
        : ["No.", "Section", "Size", "Total Mt.", "Net Amount", "Avg Rate"];
  
      const body = abstractData.map((item, i) =>
        selectedUnit === "Group"
          ? [i + 1, item.Unit, item.section, item.size, formatQty(item.totalMt), formatMT(item.totalQty), formatAmount(item.totalNet), formatRate(item.avgRate)]
          : [i + 1, item.section, item.size, formatMT(item.totalQty), formatAmount(item.totalNet), formatRate(item.avgRate)]
      );
  
      body.push(
        selectedUnit === "Group"
          ? ["", "", "TOTAL", "", "", formatMT(grandTotalQty), formatAmount(grandTotalNet), formatRate(grandAvgRate)]
          : ["", "TOTAL", "", formatMT(grandTotalQty), formatAmount(grandTotalNet), formatRate(grandAvgRate)]
      );
  
      autoTable(doc, {
        head: [headers],
        body: body,
        startY: fromDate || toDate ? 70 : 60,
        styles: { fontSize: 10, cellPadding: 4 },
        theme: "grid"
      });
    }
  
    doc.save("Abstract_Report.pdf");
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
  
    const fmt0 = '#,##0';
    const fmt3 = '#,##0.000';
  
    if (selectedUnit === "Group" && pivotData.length > 0) {
      const header1 = ["S.No.", "Section", "Size"];
      const header2 = ["", "", ""];
  
      units.forEach(u => {
        header1.push(u, "", "");
        header2.push("Mt.", "Value Rs.", "Avg Rate");
      });
  
      header1.push("Total", "", "");
      header2.push("Mt.", "Value Rs.", "Avg Rate");
  
      const rows = pivotData.map((item, i) => {
        const r = [i+1, item.section, item.size];
        units.forEach(u => {
          r.push(
            item[`${u}_qty`] || 0,
            item[`${u}_net`] || 0,
            item[`${u}_rate`] || 0
          );
        });
        r.push(item.combined_qty||0, item.combined_net||0, item.combined_rate||0);
        return r;
      });
  
      const totalRow = ["", "TOTAL", ""];
      units.forEach(u => {
        const tq = pivotData.reduce((s,x)=>s+(x[`${u}_qty`]||0),0);
        const tn = pivotData.reduce((s,x)=>s+(x[`${u}_net`]||0),0);
        totalRow.push(tq, tn, tq?tn/tq:0);
      });
      const gq = pivotData.reduce((s,x)=>s+(x.combined_qty||0),0);
      const gn = pivotData.reduce((s,x)=>s+(x.combined_net||0),0);
      totalRow.push(gq, gn, gq?gn/gq:0);
  
      const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...rows, totalRow]);
  
      const merges = [
        {s:{r:0,c:0}, e:{r:1,c:0}},
        {s:{r:0,c:1}, e:{r:1,c:1}},
        {s:{r:0,c:2}, e:{r:1,c:2}},
      ];
      let c = 3;
      units.forEach(()=>{ merges.push({s:{r:0,c}, e:{r:0,c:c+2}}); c+=3; });
      merges.push({s:{r:0,c}, e:{r:0,c:c+2}});
      ws['!merges'] = merges;
  
      const range = XLSX.utils.decode_range(ws['!ref']);
      for(let R=2; R<=range.e.r; R++){
        for(let C=3; C<=range.e.c; C++){
          const addr = XLSX.utils.encode_cell({r:R,c:C});
          if(ws[addr]){
            ws[addr].t='n';
            const pos=(C-3)%3;
            ws[addr].z = pos===0?fmt3:fmt0;
          }
        }
      }
  
      ws['!freeze']={ySplit:2};
      XLSX.utils.book_append_sheet(wb,ws,"Abstract Report");
  
    } else {
      const headers = selectedUnit==="Group"
        ?["No.","Unit","Section","Size","Length","Total Mt.","Net Amount","Avg Rate"]
        :["No.","Section","Size","Total Mt.","Net Amount","Avg Rate"];
  
      const rows = abstractData.map((x,i)=>
        selectedUnit==="Group"
        ?[i+1,x.Unit,x.section,x.size,x.totalMt,x.totalQty,x.totalNet,x.avgRate]
        :[i+1,x.section,x.size,x.totalQty,x.totalNet,x.avgRate]
      );
  
      const totalRow = selectedUnit==="Group"
        ?["","","TOTAL","","",grandTotalQty,grandTotalNet,grandAvgRate]
        :["","TOTAL","",grandTotalQty,grandTotalNet,grandAvgRate];
  
      const ws = XLSX.utils.aoa_to_sheet([headers,...rows,totalRow]);
  
      const range=XLSX.utils.decode_range(ws['!ref']);
      for(let R=1;R<=range.e.r;R++){
        for(let C=(selectedUnit==="Group"?5:3);C<=range.e.c;C++){
          const addr=XLSX.utils.encode_cell({r:R,c:C});
          if(ws[addr]){
            ws[addr].t='n';
            ws[addr].z = (C===(selectedUnit==="Group"?5:3))?fmt3:fmt0;
          }
        }
      }
  
      ws['!freeze']={ySplit:1};
      XLSX.utils.book_append_sheet(wb,ws,"Abstract Report");
    }
  
    XLSX.writeFile(wb,"Abstract_Report.xlsx");
  };

  const clearFilters = () => {
    setFromDate("");
    setToDate("");
    setSelectedUnit("Group");
    setSelectedWorkType("Group");
  };

  return (
    <div className="abstract-container">
      <h1 className="abstract-heading">Abstract of Raw Material Purchased</h1>

      <div className="filter-container">
        <div className="filter-row">
          <label htmlFor="unit">Select Unit:</label>
          <select 
            id="unit" 
            value={selectedUnit} 
            onChange={(e) => setSelectedUnit(e.target.value)}
            className="filter-select"
          >
            <option value="Group">Group</option>
            {units.map((unit, i) => (
              <option key={i} value={unit}>{unit}</option>
            ))}
          </select>

          <label htmlFor="workType">Work Type:</label>
          <select 
            id="workType" 
            value={selectedWorkType} 
            onChange={(e) => setSelectedWorkType(e.target.value)}
            className="filter-select"
          >
            <option value="Group">Group</option>
            {workTypes.map((type, i) => (
              <option key={i} value={type}>{type}</option>
            ))}
          </select>

          <label htmlFor="fromDate">From:</label>
          <input
            type="date"
            id="fromDate"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="filter-date"
          />

          <label htmlFor="toDate">To:</label>
          <input
            type="date"
            id="toDate"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="filter-date"
          />
        </div>

        <div className="button-row">
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

      <div className="table-wrapper">
        {selectedUnit === "Group" && pivotData.length > 0 ? (
          <table className="abstract-table">
            <thead>
              <tr>
                <th rowSpan={2}>S.No.</th>
                <th rowSpan={2}>Section</th>
                <th rowSpan={2}>Size</th>
                {units.map((unit, i) => (
                  <th key={i} colSpan={3}>{unit}</th>
                ))}
                <th colSpan={3} className="total-header">Total</th>
              </tr>
              <tr>
                {units.map((unit, i) => (
                  <React.Fragment key={i}>
                    <th>Mt.</th>
                    <th>Value Rs.</th>
                    <th>Avg Rate</th>
                  </React.Fragment>
                ))}
                <th className="total-subheader">Mt.</th>
                <th className="total-subheader">Value Rs.</th>
                <th className="total-subheader">Avg Rate</th>
              </tr>
            </thead>
            <tbody>
              {pivotData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  {units.map((unit, i) => (
                    <React.Fragment key={i}>
                      <td>{formatMT(item[`${unit}_qty`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_net`] || 0)}</td>
                      <td>{formatRate(item[`${unit}_rate`] || 0)}</td>
                    </React.Fragment>
                  ))}
                  <td className="total-cell">{formatMT(item.combined_qty || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_net || 0)}</td>
                  <td className="total-cell">{formatRate(item.combined_rate || 0)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>Total</td>
                {units.map((unit, i) => {
                  const totalQty = pivotData.reduce((sum, item) => sum + (item[`${unit}_qty`] || 0), 0);
                  const totalNet = pivotData.reduce((sum, item) => sum + (item[`${unit}_net`] || 0), 0);
                  const avgRate = totalQty > 0 ? totalNet / totalQty : 0;
                  return (
                    <React.Fragment key={i}>
                      <td>{formatMT(totalQty)}</td>
                      <td>{formatAmount(totalNet)}</td>
                      <td>{formatRate(avgRate)}</td>
                    </React.Fragment>
                  );
                })}
                <td>{formatMT(pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_net || 0), 0))}</td>
                <td>{formatRate(
                  (() => {
                    const totalQty = pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0);
                    const totalNet = pivotData.reduce((sum, item) => sum + (item.combined_net || 0), 0);
                    return totalQty > 0 ? totalNet / totalQty : 0;
                  })()
                )}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={showLengthColumn ? 8 : 7} className="table-title">
                  Abstract of Raw Material Purchased
                  {selectedUnit !== "Group" && ` - ${selectedUnit}`}
                  {selectedWorkType !== "Group" && ` (${selectedWorkType})`}
                </th>
              </tr>
              <tr>
                <th>No.</th>
                {selectedUnit === "Group" && <th>Unit</th>}
                <th>Section</th>
                <th>Size</th>
                {showLengthColumn && <th>Length</th>}
                <th>Total Mt.</th>
                <th>Net Amount</th>
                <th>Avg Rate</th>
              </tr>
            </thead>
            <tbody>
              {abstractData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  {selectedUnit === "Group" && <td>{item.Unit}</td>}
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  {showLengthColumn && <td>{formatQty(item.totalMt)}</td>}
                  <td>{formatMT(item.totalQty)}</td>
                  <td>{formatAmount(item.totalNet)}</td>
                  <td>{formatRate(item.avgRate)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={showLengthColumn ? (selectedUnit === "Group" ? 5 : 4) : (selectedUnit === "Group" ? 4 : 3)}>Total</td>
                <td>{formatMT(grandTotalQty)}</td>
                <td>{formatAmount(grandTotalNet)}</td>
                <td>{formatRate(grandAvgRate)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}