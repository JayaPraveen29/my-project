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
  const [financialYear, setFinancialYear] = useState("2025-26");
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
        processAbstractData(items, financialYear, selectedUnit, selectedWorkType, fromDate, toDate);
      } catch (error) {
        console.error("Error fetching data:", error);
      }
    }
    fetchData();
  }, []);

  useEffect(() => {
    processAbstractData(data, financialYear, selectedUnit, selectedWorkType, fromDate, toDate);
  }, [financialYear, selectedUnit, selectedWorkType, data, fromDate, toDate]);

  const filterByDateRange = (items, from, to) => {
    if (!from && !to) return items;
    return items.filter(item => {
      const itemDate = item["Received On"] || item["Recd. On"] || item["Recd On"] || item.Date || item.date || "";
      if (!itemDate) return false;
      let itemDateObj;
      try {
        if (typeof itemDate === "string") {
          if (itemDate.includes("-")) {
            const parts = itemDate.split("-");
            if (parts.length === 3) {
              if (parts[0].length === 4) itemDateObj = new Date(itemDate);
              else { const [day, month, year] = parts; itemDateObj = new Date(year, month - 1, day); }
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
        if (fromDateObj && toDateObj) return itemDateObj >= fromDateObj && itemDateObj <= toDateObj;
        else if (fromDateObj) return itemDateObj >= fromDateObj;
        else if (toDateObj) return itemDateObj <= toDateObj;
      } catch { return false; }
      return true;
    });
  };

  const processAbstractData = (items, finYear, unit, workType, from, to) => {
    let filteredItems = items;
    if (finYear) filteredItems = filteredItems.filter(item => item.FinancialYear === finYear);
    filteredItems = filterByDateRange(filteredItems, from, to);
    if (workType !== "Group") filteredItems = filteredItems.filter(item => (item["Work Type"] || "Unknown") === workType);
    if (unit === "Group") processPivotData(filteredItems);
    else processNormalData(filteredItems, unit);
  };

  const processNormalData = (items, unit) => {
    const filteredItems = items.filter(item => (item.Unit || "Unknown") === unit);
    const grouped = {};
    filteredItems.forEach(entry => {
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
      const entryTotalBasic = itemsArray.reduce((sum, i) => sum + (Number(i["Bill Basic Amount"]) || 0), 0);
      const others = Number(entry.charges?.Others || 0);
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        const itemProportion = entryTotalBasic > 0 ? itemBasic / entryTotalBasic : 0;
        const itemLoadingCharges = Number(item["Section Loading Charges"]) || 0;
        const itemFreightLess = Number(item["Section Freight<"]) || 0;
        const itemFreightGreater = Number(item["Section Freight>"]) || 0;
        const itemOthers = itemProportion * others;
        const itemTotalFreight = itemLoadingCharges + itemFreightLess + itemFreightGreater;
        // Key now includes width and itemLength
        const key = `${section}|${size}|${width}|${itemLength}`;
        if (!grouped[key]) {
          grouped[key] = { Unit: entry.Unit || "Unknown", section, size, width, itemLength, totalQty: qty, totalBasic: itemBasic, totalFreight: itemTotalFreight + itemOthers };
        } else {
          grouped[key].totalQty += qty;
          grouped[key].totalBasic += itemBasic;
          grouped[key].totalFreight += itemTotalFreight + itemOthers;
        }
      });
    });
    const array = Object.values(grouped).map(item => ({
      ...item,
      invoiceValue: item.totalBasic,
      totalAmount: item.totalBasic + item.totalFreight,
      ratePerMT: item.totalQty > 0 ? (item.totalBasic + item.totalFreight) / item.totalQty : 0,
    }));
    array.sort((a, b) => {
      const s = a.section.localeCompare(b.section);
      if (s !== 0) return s;
      const sz = a.size.localeCompare(b.size);
      if (sz !== 0) return sz;
      const w = a.width.localeCompare(b.width);
      if (w !== 0) return w;
      return a.itemLength.localeCompare(b.itemLength);
    });
    setAbstractData(array);
    setPivotData([]);
  };

  const processPivotData = (items) => {
    const grouped = {};
    items.forEach(entry => {
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
      const entryTotalBasic = itemsArray.reduce((sum, i) => sum + (Number(i["Bill Basic Amount"]) || 0), 0);
      const others = Number(entry.charges?.Others || 0);
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const width = (item["Width"] || "").toString().trim();
        const itemLength = (item["Item Length"] || "").toString().trim();
        const unit = entry.Unit || "Unknown";
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        const itemProportion = entryTotalBasic > 0 ? itemBasic / entryTotalBasic : 0;
        const itemLoadingCharges = Number(item["Section Loading Charges"]) || 0;
        const itemFreightLess = Number(item["Section Freight<"]) || 0;
        const itemFreightGreater = Number(item["Section Freight>"]) || 0;
        const itemOthers = itemProportion * others;
        const itemTotalFreight = itemLoadingCharges + itemFreightLess + itemFreightGreater;
        // Key now includes width and itemLength
        const key = `${section}|${size}|${width}|${itemLength}`;
        if (!grouped[key]) grouped[key] = { section, size, width, itemLength, units: {} };
        if (!grouped[key].units[unit]) grouped[key].units[unit] = { totalQty: 0, totalBasic: 0, totalFreight: 0 };
        grouped[key].units[unit].totalQty += qty;
        grouped[key].units[unit].totalBasic += itemBasic;
        grouped[key].units[unit].totalFreight += itemTotalFreight + itemOthers;
      });
    });
    const GroupUnits = [...new Set(items.map(item => item.Unit || "Unknown"))];
    const array = Object.values(grouped).map(item => {
      const row = { section: item.section, size: item.size, width: item.width, itemLength: item.itemLength };
      let combinedQty = 0, combinedBasic = 0, combinedFreight = 0;
      GroupUnits.forEach(unit => {
        if (item.units[unit]) {
          const u = item.units[unit];
          const unitTotal = u.totalBasic + u.totalFreight;
          row[`${unit}_qty`] = u.totalQty;
          row[`${unit}_invoiceValue`] = u.totalBasic;
          row[`${unit}_freight`] = u.totalFreight;
          row[`${unit}_total`] = unitTotal;
          row[`${unit}_ratePerMT`] = u.totalQty > 0 ? unitTotal / u.totalQty : 0;
          combinedQty += u.totalQty; combinedBasic += u.totalBasic; combinedFreight += u.totalFreight;
        } else {
          row[`${unit}_qty`] = 0; row[`${unit}_invoiceValue`] = 0; row[`${unit}_freight`] = 0;
          row[`${unit}_total`] = 0; row[`${unit}_ratePerMT`] = 0;
        }
      });
      const combinedTotal = combinedBasic + combinedFreight;
      row.combined_qty = combinedQty;
      row.combined_invoiceValue = combinedBasic;
      row.combined_freight = combinedFreight;
      row.combined_total = combinedTotal;
      row.combined_ratePerMT = combinedQty > 0 ? combinedTotal / combinedQty : 0;
      return row;
    });
    array.sort((a, b) => {
      const s = a.section.localeCompare(b.section);
      if (s !== 0) return s;
      const sz = a.size.localeCompare(b.size);
      if (sz !== 0) return sz;
      const w = a.width.localeCompare(b.width);
      if (w !== 0) return w;
      return a.itemLength.localeCompare(b.itemLength);
    });
    setPivotData(array);
    setAbstractData([]);
  };

  const formatMT = value => Number(value).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const formatAmount = value => Math.ceil(Number(value)).toLocaleString("en-IN");
  const formatRate = value => Math.ceil(Number(value)).toLocaleString("en-IN");

  const grandTotalQty = abstractData.reduce((sum, item) => sum + item.totalQty, 0);
  const grandTotalBasic = abstractData.reduce((sum, item) => sum + item.totalBasic, 0);
  const grandTotalFreight = abstractData.reduce((sum, item) => sum + item.totalFreight, 0);
  const grandTotalAmount = grandTotalBasic + grandTotalFreight;
  const grandInvoiceValue = grandTotalBasic;
  const grandRatePerMT = grandTotalQty > 0 ? grandTotalAmount / grandTotalQty : 0;

  const exportPDF = () => {
    const doc = new jsPDF("l", "pt", "a4");
    doc.setFontSize(12);
    let heading = "Abstract of Raw Material Purchased";
    if (selectedUnit !== "Group") heading += ` - ${selectedUnit}`;
    if (selectedWorkType !== "Group") heading += ` (${selectedWorkType})`;
    doc.text(heading, 40, 30);
    if (fromDate || toDate) { doc.setFontSize(9); doc.text(`Period: ${fromDate || "Start"} to ${toDate || "End"}`, 40, 45); }

    if (selectedUnit === "Group" && pivotData.length > 0) {
      const headRow1 = [
        { content: "S.No.", rowSpan: 2 }, { content: "Section", rowSpan: 2 },
        { content: "Size", rowSpan: 2 }, { content: "Width", rowSpan: 2 }, { content: "Length", rowSpan: 2 }
      ];
      const headRow2 = [];
      units.forEach(unit => {
        headRow1.push({ content: unit, colSpan: 5 });
        headRow2.push({ content: "MT" }, { content: "Invoice Value" }, { content: "Freight" }, { content: "Total" }, { content: "Rate/MT" });
      });
      headRow1.push({ content: "Total", colSpan: 5 });
      headRow2.push({ content: "MT" }, { content: "Invoice Value" }, { content: "Freight" }, { content: "Total" }, { content: "Rate/MT" });

      const body = pivotData.map((item, index) => {
        const row = [index + 1, item.section, item.size, item.width, item.itemLength];
        units.forEach(unit => {
          row.push(formatMT(item[`${unit}_qty`] || 0), formatAmount(item[`${unit}_invoiceValue`] || 0), formatAmount(item[`${unit}_freight`] || 0), formatAmount(item[`${unit}_total`] || 0), formatRate(item[`${unit}_ratePerMT`] || 0));
        });
        row.push(formatMT(item.combined_qty || 0), formatAmount(item.combined_invoiceValue || 0), formatAmount(item.combined_freight || 0), formatAmount(item.combined_total || 0), formatRate(item.combined_ratePerMT || 0));
        return row;
      });

      const totalRow = ["", "TOTAL", "", "", ""];
      units.forEach(unit => {
        const tQty = pivotData.reduce((s, x) => s + (x[`${unit}_qty`] || 0), 0);
        const tInv = pivotData.reduce((s, x) => s + (x[`${unit}_invoiceValue`] || 0), 0);
        const tFrt = pivotData.reduce((s, x) => s + (x[`${unit}_freight`] || 0), 0);
        const tTot = tInv + tFrt;
        totalRow.push(formatMT(tQty), formatAmount(tInv), formatAmount(tFrt), formatAmount(tTot), formatRate(tQty ? tTot / tQty : 0));
      });
      const gQty = pivotData.reduce((s, x) => s + (x.combined_qty || 0), 0);
      const gInv = pivotData.reduce((s, x) => s + (x.combined_invoiceValue || 0), 0);
      const gFrt = pivotData.reduce((s, x) => s + (x.combined_freight || 0), 0);
      const gTot = gInv + gFrt;
      totalRow.push(formatMT(gQty), formatAmount(gInv), formatAmount(gFrt), formatAmount(gTot), formatRate(gQty ? gTot / gQty : 0));
      body.push(totalRow);

      autoTable(doc, {
        startY: fromDate || toDate ? 55 : 45, head: [headRow1, headRow2], body,
        theme: "grid",
        styles: { fontSize: 6, halign: "center", valign: "middle", cellPadding: 1 },
        headStyles: { fillColor: [230, 240, 255], textColor: [0, 0, 0], fontStyle: "bold" }
      });
    } else {
      const headers = ["No.", "Section", "Size", "Width", "Length", "MT", "Invoice Value", "Freight", "Total", "Rate/MT"];
      const body = abstractData.map((item, i) => [
        i + 1, item.section, item.size, item.width, item.itemLength,
        formatMT(item.totalQty), formatAmount(item.invoiceValue), formatAmount(item.totalFreight), formatAmount(item.totalAmount), formatRate(item.ratePerMT)
      ]);
      body.push(["", "TOTAL", "", "", "", formatMT(grandTotalQty), formatAmount(grandInvoiceValue), formatAmount(grandTotalFreight), formatAmount(grandTotalAmount), formatRate(grandRatePerMT)]);
      autoTable(doc, { head: [headers], body, startY: fromDate || toDate ? 55 : 45, styles: { fontSize: 8, cellPadding: 2 }, theme: "grid" });
    }
    doc.save("Abstract_Report.pdf");
  };

  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const fmt0 = "#,##0", fmt3 = "#,##0.000";

    if (selectedUnit === "Group" && pivotData.length > 0) {
      const header1 = ["S.No.", "Section", "Size", "Width", "Length"];
      const header2 = ["", "", "", "", ""];
      units.forEach(u => { header1.push(u, "", "", "", ""); header2.push("MT", "Invoice Value", "Freight", "Total", "Rate/MT"); });
      header1.push("Total", "", "", "", "");
      header2.push("MT", "Invoice Value", "Freight", "Total", "Rate/MT");

      const rows = pivotData.map((item, i) => {
        const r = [i + 1, item.section, item.size, item.width, item.itemLength];
        units.forEach(u => { r.push(item[`${u}_qty`] || 0, item[`${u}_invoiceValue`] || 0, item[`${u}_freight`] || 0, item[`${u}_total`] || 0, item[`${u}_ratePerMT`] || 0); });
        r.push(item.combined_qty || 0, item.combined_invoiceValue || 0, item.combined_freight || 0, item.combined_total || 0, item.combined_ratePerMT || 0);
        return r;
      });

      const totalRow = ["", "TOTAL", "", "", ""];
      units.forEach(u => {
        const tq = pivotData.reduce((s, x) => s + (x[`${u}_qty`] || 0), 0);
        const tinv = pivotData.reduce((s, x) => s + (x[`${u}_invoiceValue`] || 0), 0);
        const tf = pivotData.reduce((s, x) => s + (x[`${u}_freight`] || 0), 0);
        const tt = tinv + tf;
        totalRow.push(tq, tinv, tf, tt, tq ? tt / tq : 0);
      });
      const gq = pivotData.reduce((s, x) => s + (x.combined_qty || 0), 0);
      const ginv = pivotData.reduce((s, x) => s + (x.combined_invoiceValue || 0), 0);
      const gf = pivotData.reduce((s, x) => s + (x.combined_freight || 0), 0);
      const gt = ginv + gf;
      totalRow.push(gq, ginv, gf, gt, gq ? gt / gq : 0);

      const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...rows, totalRow]);

      // Merges: first 5 columns span both header rows, then each unit group spans 5 cols
      const merges = [
        { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
        { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
        { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
        { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
        { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } },
      ];
      let c = 5;
      units.forEach(() => { merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 4 } }); c += 5; });
      merges.push({ s: { r: 0, c }, e: { r: 0, c: c + 4 } });
      ws["!merges"] = merges;

      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let R = 2; R <= range.e.r; R++) {
        for (let C = 5; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (ws[addr] && typeof ws[addr].v !== "string") {
            ws[addr].t = "n";
            ws[addr].z = (C - 5) % 5 === 0 ? fmt3 : fmt0;
          }
        }
      }
      ws["!freeze"] = { ySplit: 2 };
      XLSX.utils.book_append_sheet(wb, ws, "Abstract Report");
    } else {
      const headers = ["No.", "Section", "Size", "Width", "Length", "MT", "Invoice Value", "Freight", "Total", "Rate/MT"];
      const rows = abstractData.map((x, i) => [i + 1, x.section, x.size, x.width, x.itemLength, x.totalQty, x.invoiceValue, x.totalFreight, x.totalAmount, x.ratePerMT]);
      const totalRow = ["", "TOTAL", "", "", "", grandTotalQty, grandInvoiceValue, grandTotalFreight, grandTotalAmount, grandRatePerMT];
      const ws = XLSX.utils.aoa_to_sheet([headers, ...rows, totalRow]);
      const range = XLSX.utils.decode_range(ws["!ref"]);
      for (let R = 1; R <= range.e.r; R++) {
        for (let C = 5; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          if (ws[addr] && typeof ws[addr].v !== "string") {
            ws[addr].t = "n";
            ws[addr].z = C === 5 ? fmt3 : fmt0;
          }
        }
      }
      ws["!freeze"] = { ySplit: 1 };
      XLSX.utils.book_append_sheet(wb, ws, "Abstract Report");
    }
    XLSX.writeFile(wb, "Abstract_Report.xlsx");
  };

  const clearFilters = () => { setFromDate(""); setToDate(""); setFinancialYear("2025-26"); setSelectedUnit("Group"); setSelectedWorkType("Group"); };

  return (
    <div className="abstract-container">
      <h1 className="abstract-heading">Abstract of Raw Material Purchased</h1>

      <div className="filter-container">
        <div className="filter-row">
          <label htmlFor="financialYear">Financial Year:</label>
          <select id="financialYear" value={financialYear} onChange={e => setFinancialYear(e.target.value)} className="filter-select">
            <option value="2024-25">2024-25</option>
            <option value="2025-26">2025-26</option>
            <option value="2026-27">2026-27</option>
            <option value="2027-28">2027-28</option>
          </select>
          <label htmlFor="unit">Select Unit:</label>
          <select id="unit" value={selectedUnit} onChange={e => setSelectedUnit(e.target.value)} className="filter-select">
            <option value="Group">Group</option>
            {units.map((unit, i) => <option key={i} value={unit}>{unit}</option>)}
          </select>
          <label htmlFor="workType">Work Type:</label>
          <select id="workType" value={selectedWorkType} onChange={e => setSelectedWorkType(e.target.value)} className="filter-select">
            <option value="Group">Group</option>
            {workTypes.map((type, i) => <option key={i} value={type}>{type}</option>)}
          </select>
          <label htmlFor="fromDate">From:</label>
          <input type="date" id="fromDate" value={fromDate} onChange={e => setFromDate(e.target.value)} className="filter-date" />
          <label htmlFor="toDate">To:</label>
          <input type="date" id="toDate" value={toDate} onChange={e => setToDate(e.target.value)} className="filter-date" />
        </div>
        <div className="button-row">
          <button onClick={clearFilters} className="btn-clear">Clear Filters</button>
          <button onClick={exportPDF} className="btn-export btn-pdf">Export PDF</button>
          <button onClick={exportExcel} className="btn-export btn-excel">Export Excel</button>
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
                <th rowSpan={2}>Width</th>
                <th rowSpan={2}>Length</th>
                {units.map((unit, i) => <th key={i} colSpan={5}>{unit}</th>)}
                <th colSpan={5} className="total-header">Total</th>
              </tr>
              <tr>
                {units.map((unit, i) => (
                  <React.Fragment key={i}>
                    <th>MT</th><th>Invoice Value</th><th>Freight</th><th>Total</th><th>Rate/MT</th>
                  </React.Fragment>
                ))}
                <th className="total-subheader">MT</th>
                <th className="total-subheader">Invoice Value</th>
                <th className="total-subheader">Freight</th>
                <th className="total-subheader">Total</th>
                <th className="total-subheader">Rate/MT</th>
              </tr>
            </thead>
            <tbody>
              {pivotData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  <td className="text-left">{item.width}</td>
                  <td className="text-left">{item.itemLength}</td>
                  {units.map((unit, i) => (
                    <React.Fragment key={i}>
                      <td>{formatMT(item[`${unit}_qty`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_invoiceValue`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_freight`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_total`] || 0)}</td>
                      <td>{formatRate(item[`${unit}_ratePerMT`] || 0)}</td>
                    </React.Fragment>
                  ))}
                  <td className="total-cell">{formatMT(item.combined_qty || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_invoiceValue || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_freight || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_total || 0)}</td>
                  <td className="total-cell">{formatRate(item.combined_ratePerMT || 0)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={5}>Total</td>
                {units.map((unit, i) => {
                  const tQty = pivotData.reduce((s, x) => s + (x[`${unit}_qty`] || 0), 0);
                  const tInv = pivotData.reduce((s, x) => s + (x[`${unit}_invoiceValue`] || 0), 0);
                  const tFrt = pivotData.reduce((s, x) => s + (x[`${unit}_freight`] || 0), 0);
                  const tAmt = tInv + tFrt;
                  return (
                    <React.Fragment key={i}>
                      <td>{formatMT(tQty)}</td><td>{formatAmount(tInv)}</td><td>{formatAmount(tFrt)}</td>
                      <td>{formatAmount(tAmt)}</td><td>{formatRate(tQty > 0 ? tAmt / tQty : 0)}</td>
                    </React.Fragment>
                  );
                })}
                {(() => {
                  const gQty = pivotData.reduce((s, x) => s + (x.combined_qty || 0), 0);
                  const gInv = pivotData.reduce((s, x) => s + (x.combined_invoiceValue || 0), 0);
                  const gFrt = pivotData.reduce((s, x) => s + (x.combined_freight || 0), 0);
                  const gAmt = gInv + gFrt;
                  return (
                    <>
                      <td>{formatMT(gQty)}</td><td>{formatAmount(gInv)}</td><td>{formatAmount(gFrt)}</td>
                      <td>{formatAmount(gAmt)}</td><td>{formatRate(gQty > 0 ? gAmt / gQty : 0)}</td>
                    </>
                  );
                })()}
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={10} className="table-title">
                  Abstract of Raw Material Purchased
                  {selectedUnit !== "Group" && ` - ${selectedUnit}`}
                  {selectedWorkType !== "Group" && ` (${selectedWorkType})`}
                </th>
              </tr>
              <tr>
                <th>No.</th><th>Section</th><th>Size</th><th>Width</th><th>Length</th>
                <th>MT</th><th>Invoice Value</th><th>Freight</th><th>Total</th><th>Rate/MT</th>
              </tr>
            </thead>
            <tbody>
              {abstractData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  <td className="text-left">{item.width}</td>
                  <td className="text-left">{item.itemLength}</td>
                  <td>{formatMT(item.totalQty)}</td>
                  <td>{formatAmount(item.invoiceValue)}</td>
                  <td>{formatAmount(item.totalFreight)}</td>
                  <td>{formatAmount(item.totalAmount)}</td>
                  <td>{formatRate(item.ratePerMT)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={5}>Total</td>
                <td>{formatMT(grandTotalQty)}</td>
                <td>{formatAmount(grandInvoiceValue)}</td>
                <td>{formatAmount(grandTotalFreight)}</td>
                <td>{formatAmount(grandTotalAmount)}</td>
                <td>{formatRate(grandRatePerMT)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}