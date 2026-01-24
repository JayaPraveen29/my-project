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
      
      const entryFreight = Number(entry.finalTotals?.freight || entry["Freight"] || 0);
      const entryCGST = Number(entry.finalTotals?.cgst || entry["CGST"] || 0);
      const entrySGST = Number(entry.finalTotals?.sgst || entry["SGST"] || 0);
      const entryIGST = Number(entry.finalTotals?.igst || entry["IGST"] || 0);
      const entryTCS = Number(entry.finalTotals?.tcs || entry["TCS"] || 0);
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const itemLength = Number(item["Item Length"]) || 0;
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        const itemProportion = entryTotalBasic > 0 ? (itemBasic / entryTotalBasic) : 0;
        const itemFreight = itemProportion * entryFreight;
        const itemTotal = itemBasic + itemFreight;
        const itemCGST = itemProportion * entryCGST;
        const itemSGST = itemProportion * entrySGST;
        const itemIGST = itemProportion * entryIGST;
        const itemTCS = itemProportion * entryTCS;
        const itemNetAmount = itemProportion * entryNetAmount;

        const key = `${section}|${size}`;
        if (!grouped[key]) {
          grouped[key] = {
            Unit: entry.Unit || "Unknown",
            section,
            size: size,
            length: size,
            totalMt: itemLength,
            totalQty: qty,
            totalBasic: itemBasic,
            totalFreight: itemFreight,
            totalAmount: itemTotal,
            totalCGST: itemCGST,
            totalSGST: itemSGST,
            totalIGST: itemIGST,
            totalTCS: itemTCS,
            totalNet: itemNetAmount
          };
        } else {
          grouped[key].totalMt += itemLength;
          grouped[key].totalQty += qty;
          grouped[key].totalBasic += itemBasic;
          grouped[key].totalFreight += itemFreight;
          grouped[key].totalAmount += itemTotal;
          grouped[key].totalCGST += itemCGST;
          grouped[key].totalSGST += itemSGST;
          grouped[key].totalIGST += itemIGST;
          grouped[key].totalTCS += itemTCS;
          grouped[key].totalNet += itemNetAmount;
        }
      });
    });

    const array = Object.values(grouped).map(item => ({
      ...item,
      invoiceValuePerMT: item.totalQty > 0 ? item.totalBasic / item.totalQty : 0,
      ratePerMT: item.totalQty > 0 ? item.totalAmount / item.totalQty : 0,
      netRatePerMT: item.totalQty > 0 ? item.totalNet / item.totalQty : 0
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
      
      const entryFreight = Number(entry.finalTotals?.freight || entry["Freight"] || 0);
      const entryCGST = Number(entry.finalTotals?.cgst || entry["CGST"] || 0);
      const entrySGST = Number(entry.finalTotals?.sgst || entry["SGST"] || 0);
      const entryIGST = Number(entry.finalTotals?.igst || entry["IGST"] || 0);
      const entryTCS = Number(entry.finalTotals?.tcs || entry["TCS"] || 0);
      const entryNetAmount = Number(entry.finalTotals?.net || entry["Net"] || 0);
      
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const unit = entry.Unit || "Unknown";
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        const itemProportion = entryTotalBasic > 0 ? (itemBasic / entryTotalBasic) : 0;
        const itemFreight = itemProportion * entryFreight;
        const itemTotal = itemBasic + itemFreight;
        const itemCGST = itemProportion * entryCGST;
        const itemSGST = itemProportion * entrySGST;
        const itemIGST = itemProportion * entryIGST;
        const itemTCS = itemProportion * entryTCS;
        const itemNetAmount = itemProportion * entryNetAmount;

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
            totalBasic: 0,
            totalFreight: 0,
            totalAmount: 0,
            totalCGST: 0,
            totalSGST: 0,
            totalIGST: 0,
            totalTCS: 0,
            totalNet: 0
          };
        }
        grouped[key].units[unit].totalQty += qty;
        grouped[key].units[unit].totalBasic += itemBasic;
        grouped[key].units[unit].totalFreight += itemFreight;
        grouped[key].units[unit].totalAmount += itemTotal;
        grouped[key].units[unit].totalCGST += itemCGST;
        grouped[key].units[unit].totalSGST += itemSGST;
        grouped[key].units[unit].totalIGST += itemIGST;
        grouped[key].units[unit].totalTCS += itemTCS;
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
      let combinedBasic = 0;
      let combinedFreight = 0;
      let combinedAmount = 0;
      let combinedCGST = 0;
      let combinedSGST = 0;
      let combinedIGST = 0;
      let combinedTCS = 0;
      let combinedNet = 0;
      
      GroupUnits.forEach(unit => {
        if (item.units[unit]) {
          const u = item.units[unit];
          row[`${unit}_qty`] = u.totalQty;
          row[`${unit}_basic`] = u.totalBasic;
          row[`${unit}_invoicePerMT`] = u.totalQty > 0 ? u.totalBasic / u.totalQty : 0;
          row[`${unit}_freight`] = u.totalFreight;
          row[`${unit}_total`] = u.totalAmount;
          row[`${unit}_ratePerMT`] = u.totalQty > 0 ? u.totalAmount / u.totalQty : 0;
          row[`${unit}_cgst`] = u.totalCGST;
          row[`${unit}_sgst`] = u.totalSGST;
          row[`${unit}_igst`] = u.totalIGST;
          row[`${unit}_tcs`] = u.totalTCS;
          row[`${unit}_net`] = u.totalNet;
          row[`${unit}_netRatePerMT`] = u.totalQty > 0 ? u.totalNet / u.totalQty : 0;
          
          combinedQty += u.totalQty;
          combinedBasic += u.totalBasic;
          combinedFreight += u.totalFreight;
          combinedAmount += u.totalAmount;
          combinedCGST += u.totalCGST;
          combinedSGST += u.totalSGST;
          combinedIGST += u.totalIGST;
          combinedTCS += u.totalTCS;
          combinedNet += u.totalNet;
        } else {
          row[`${unit}_qty`] = 0;
          row[`${unit}_basic`] = 0;
          row[`${unit}_invoicePerMT`] = 0;
          row[`${unit}_freight`] = 0;
          row[`${unit}_total`] = 0;
          row[`${unit}_ratePerMT`] = 0;
          row[`${unit}_cgst`] = 0;
          row[`${unit}_sgst`] = 0;
          row[`${unit}_igst`] = 0;
          row[`${unit}_tcs`] = 0;
          row[`${unit}_net`] = 0;
          row[`${unit}_netRatePerMT`] = 0;
        }
      });
      
      row.combined_qty = combinedQty;
      row.combined_basic = combinedBasic;
      row.combined_invoicePerMT = combinedQty > 0 ? combinedBasic / combinedQty : 0;
      row.combined_freight = combinedFreight;
      row.combined_total = combinedAmount;
      row.combined_ratePerMT = combinedQty > 0 ? combinedAmount / combinedQty : 0;
      row.combined_cgst = combinedCGST;
      row.combined_sgst = combinedSGST;
      row.combined_igst = combinedIGST;
      row.combined_tcs = combinedTCS;
      row.combined_net = combinedNet;
      row.combined_netRatePerMT = combinedQty > 0 ? combinedNet / combinedQty : 0;
      
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
  const grandTotalBasic = abstractData.reduce((sum, item) => sum + item.totalBasic, 0);
  const grandTotalFreight = abstractData.reduce((sum, item) => sum + item.totalFreight, 0);
  const grandTotalAmount = abstractData.reduce((sum, item) => sum + item.totalAmount, 0);
  const grandTotalCGST = abstractData.reduce((sum, item) => sum + item.totalCGST, 0);
  const grandTotalSGST = abstractData.reduce((sum, item) => sum + item.totalSGST, 0);
  const grandTotalIGST = abstractData.reduce((sum, item) => sum + item.totalIGST, 0);
  const grandTotalTCS = abstractData.reduce((sum, item) => sum + item.totalTCS, 0);
  const grandTotalNet = abstractData.reduce((sum, item) => sum + item.totalNet, 0);
  const grandInvoicePerMT = grandTotalQty > 0 ? grandTotalBasic / grandTotalQty : 0;
  const grandRatePerMT = grandTotalQty > 0 ? grandTotalAmount / grandTotalQty : 0;
  const grandNetRatePerMT = grandTotalQty > 0 ? grandTotalNet / grandTotalQty : 0;

  const showLengthColumn = selectedUnit === "Group";

  const exportPDF = () => {
    const doc = new jsPDF("l", "pt", "a4");
    doc.setFontSize(12);
  
    let heading = "Abstract of Raw Material Purchased";
    if (selectedUnit !== "Group") heading += ` - ${selectedUnit}`;
    if (selectedWorkType !== "Group") heading += ` (${selectedWorkType})`;
  
    doc.text(heading, 40, 30);
  
    if (fromDate || toDate) {
      doc.setFontSize(9);
      doc.text(`Period: ${fromDate || "Start"} to ${toDate || "End"}`, 40, 45);
    }
  
    if (selectedUnit === "Group" && pivotData.length > 0) {
      const headRow1 = [
        { content: "S.No.", rowSpan: 2 },
        { content: "Section", rowSpan: 2 },
        { content: "Size", rowSpan: 2 }
      ];
  
      const headRow2 = [];
  
      units.forEach(unit => {
        headRow1.push({ content: unit, colSpan: 12 });
        headRow2.push(
          { content: "MT" },
          { content: "Inv Value/MT" },
          { content: "Freight" },
          { content: "Total" },
          { content: "Rate/MT" },
          { content: "CGST" },
          { content: "SGST" },
          { content: "IGST" },
          { content: "TCS" },
          { content: "Net Value" },
          { content: "Net Rate/MT" }
        );
      });
  
      headRow1.push({ content: "Total", colSpan: 12 });
      headRow2.push(
        { content: "MT" },
        { content: "Inv Value/MT" },
        { content: "Freight" },
        { content: "Total" },
        { content: "Rate/MT" },
        { content: "CGST" },
        { content: "SGST" },
        { content: "IGST" },
        { content: "TCS" },
        { content: "Net Value" },
        { content: "Net Rate/MT" }
      );
  
      const body = pivotData.map((item, index) => {
        const row = [index + 1, item.section, item.size];
  
        units.forEach(unit => {
          row.push(
            formatMT(item[`${unit}_qty`] || 0),
            formatRate(item[`${unit}_invoicePerMT`] || 0),
            formatAmount(item[`${unit}_freight`] || 0),
            formatAmount(item[`${unit}_total`] || 0),
            formatRate(item[`${unit}_ratePerMT`] || 0),
            formatAmount(item[`${unit}_cgst`] || 0),
            formatAmount(item[`${unit}_sgst`] || 0),
            formatAmount(item[`${unit}_igst`] || 0),
            formatAmount(item[`${unit}_tcs`] || 0),
            formatAmount(item[`${unit}_net`] || 0),
            formatRate(item[`${unit}_netRatePerMT`] || 0)
          );
        });
  
        row.push(
          formatMT(item.combined_qty || 0),
          formatRate(item.combined_invoicePerMT || 0),
          formatAmount(item.combined_freight || 0),
          formatAmount(item.combined_total || 0),
          formatRate(item.combined_ratePerMT || 0),
          formatAmount(item.combined_cgst || 0),
          formatAmount(item.combined_sgst || 0),
          formatAmount(item.combined_igst || 0),
          formatAmount(item.combined_tcs || 0),
          formatAmount(item.combined_net || 0),
          formatRate(item.combined_netRatePerMT || 0)
        );
  
        return row;
      });
  
      const totalRow = ["", "TOTAL", ""];
  
      units.forEach(unit => {
        const tQty = pivotData.reduce((s, x) => s + (x[`${unit}_qty`] || 0), 0);
        const tBasic = pivotData.reduce((s, x) => s + (x[`${unit}_basic`] || 0), 0);
        const tFreight = pivotData.reduce((s, x) => s + (x[`${unit}_freight`] || 0), 0);
        const tTotal = pivotData.reduce((s, x) => s + (x[`${unit}_total`] || 0), 0);
        const tCGST = pivotData.reduce((s, x) => s + (x[`${unit}_cgst`] || 0), 0);
        const tSGST = pivotData.reduce((s, x) => s + (x[`${unit}_sgst`] || 0), 0);
        const tIGST = pivotData.reduce((s, x) => s + (x[`${unit}_igst`] || 0), 0);
        const tTCS = pivotData.reduce((s, x) => s + (x[`${unit}_tcs`] || 0), 0);
        const tNet = pivotData.reduce((s, x) => s + (x[`${unit}_net`] || 0), 0);
        const tInvPerMT = tQty ? tBasic / tQty : 0;
        const tRatePerMT = tQty ? tTotal / tQty : 0;
        const tNetRatePerMT = tQty ? tNet / tQty : 0;
  
        totalRow.push(formatMT(tQty), formatRate(tInvPerMT), formatAmount(tFreight), formatAmount(tTotal), formatRate(tRatePerMT), formatAmount(tCGST), formatAmount(tSGST), formatAmount(tIGST), formatAmount(tTCS), formatAmount(tNet), formatRate(tNetRatePerMT));
      });
  
      const gQty = pivotData.reduce((s, x) => s + (x.combined_qty || 0), 0);
      const gBasic = pivotData.reduce((s, x) => s + (x.combined_basic || 0), 0);
      const gFreight = pivotData.reduce((s, x) => s + (x.combined_freight || 0), 0);
      const gTotal = pivotData.reduce((s, x) => s + (x.combined_total || 0), 0);
      const gCGST = pivotData.reduce((s, x) => s + (x.combined_cgst || 0), 0);
      const gSGST = pivotData.reduce((s, x) => s + (x.combined_sgst || 0), 0);
      const gIGST = pivotData.reduce((s, x) => s + (x.combined_igst || 0), 0);
      const gTCS = pivotData.reduce((s, x) => s + (x.combined_tcs || 0), 0);
      const gNet = pivotData.reduce((s, x) => s + (x.combined_net || 0), 0);
      const gInvPerMT = gQty ? gBasic / gQty : 0;
      const gRatePerMT = gQty ? gTotal / gQty : 0;
      const gNetRatePerMT = gQty ? gNet / gQty : 0;
  
      totalRow.push(formatMT(gQty), formatRate(gInvPerMT), formatAmount(gFreight), formatAmount(gTotal), formatRate(gRatePerMT), formatAmount(gCGST), formatAmount(gSGST), formatAmount(gIGST), formatAmount(gTCS), formatAmount(gNet), formatRate(gNetRatePerMT));
      body.push(totalRow);
  
      autoTable(doc, {
        startY: fromDate || toDate ? 55 : 45,
        head: [headRow1, headRow2],
        body: body,
        theme: "grid",
        styles: { fontSize: 6, halign: "center", valign: "middle", cellPadding: 1 },
        headStyles: { 
          fillColor: [230, 240, 255],
          textColor: [0, 0, 0],
          fontStyle: "bold"
        }
      });
  
    } else {
      const headers = ["No.", "Section", "Size", "MT", "Invoice Value/MT", "Freight", "Total", "Rate/MT", "CGST", "SGST", "IGST", "TCS", "Net Value", "Net Rate/MT"];
  
      const body = abstractData.map((item, i) =>
        [i + 1, item.section, item.size, formatMT(item.totalQty), formatRate(item.invoiceValuePerMT), formatAmount(item.totalFreight), formatAmount(item.totalAmount), formatRate(item.ratePerMT), formatAmount(item.totalCGST), formatAmount(item.totalSGST), formatAmount(item.totalIGST), formatAmount(item.totalTCS), formatAmount(item.totalNet), formatRate(item.netRatePerMT)]
      );
  
      body.push(
        ["", "TOTAL", "", formatMT(grandTotalQty), formatRate(grandInvoicePerMT), formatAmount(grandTotalFreight), formatAmount(grandTotalAmount), formatRate(grandRatePerMT), formatAmount(grandTotalCGST), formatAmount(grandTotalSGST), formatAmount(grandTotalIGST), formatAmount(grandTotalTCS), formatAmount(grandTotalNet), formatRate(grandNetRatePerMT)]
      );
  
      autoTable(doc, {
        head: [headers],
        body: body,
        startY: fromDate || toDate ? 55 : 45,
        styles: { fontSize: 7, cellPadding: 2 },
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
        header1.push(u, "", "", "", "", "", "", "", "", "", "", "");
        header2.push("MT", "Inv Value/MT", "Freight", "Total", "Rate/MT", "CGST", "SGST", "IGST", "TCS", "Net Value", "Net Rate/MT");
      });
  
      header1.push("Total", "", "", "", "", "", "", "", "", "", "", "");
      header2.push("MT", "Inv Value/MT", "Freight", "Total", "Rate/MT", "CGST", "SGST", "IGST", "TCS", "Net Value", "Net Rate/MT");
  
      const rows = pivotData.map((item, i) => {
        const r = [i+1, item.section, item.size];
        units.forEach(u => {
          r.push(
            item[`${u}_qty`] || 0,
            item[`${u}_invoicePerMT`] || 0,
            item[`${u}_freight`] || 0,
            item[`${u}_total`] || 0,
            item[`${u}_ratePerMT`] || 0,
            item[`${u}_cgst`] || 0,
            item[`${u}_sgst`] || 0,
            item[`${u}_igst`] || 0,
            item[`${u}_tcs`] || 0,
            item[`${u}_net`] || 0,
            item[`${u}_netRatePerMT`] || 0
          );
        });
        r.push(item.combined_qty||0, item.combined_invoicePerMT||0, item.combined_freight||0, item.combined_total||0, item.combined_ratePerMT||0, item.combined_cgst||0, item.combined_sgst||0, item.combined_igst||0, item.combined_tcs||0, item.combined_net||0, item.combined_netRatePerMT||0);
        return r;
      });
  
      const totalRow = ["", "TOTAL", ""];
      units.forEach(u => {
        const tq = pivotData.reduce((s,x)=>s+(x[`${u}_qty`]||0),0);
        const tb = pivotData.reduce((s,x)=>s+(x[`${u}_basic`]||0),0);
        const tf = pivotData.reduce((s,x)=>s+(x[`${u}_freight`]||0),0);
        const tt = pivotData.reduce((s,x)=>s+(x[`${u}_total`]||0),0);
        const tc = pivotData.reduce((s,x)=>s+(x[`${u}_cgst`]||0),0);
        const ts = pivotData.reduce((s,x)=>s+(x[`${u}_sgst`]||0),0);
        const ti = pivotData.reduce((s,x)=>s+(x[`${u}_igst`]||0),0);
        const ttcs = pivotData.reduce((s,x)=>s+(x[`${u}_tcs`]||0),0);
        const tn = pivotData.reduce((s,x)=>s+(x[`${u}_net`]||0),0);
        totalRow.push(tq, tq?tb/tq:0, tf, tt, tq?tt/tq:0, tc, ts, ti, ttcs, tn, tq?tn/tq:0);
      });
      const gq = pivotData.reduce((s,x)=>s+(x.combined_qty||0),0);
      const gb = pivotData.reduce((s,x)=>s+(x.combined_basic||0),0);
      const gf = pivotData.reduce((s,x)=>s+(x.combined_freight||0),0);
      const gt = pivotData.reduce((s,x)=>s+(x.combined_total||0),0);
      const gc = pivotData.reduce((s,x)=>s+(x.combined_cgst||0),0);
      const gs = pivotData.reduce((s,x)=>s+(x.combined_sgst||0),0);
      const gi = pivotData.reduce((s,x)=>s+(x.combined_igst||0),0);
      const gtcs = pivotData.reduce((s,x)=>s+(x.combined_tcs||0),0);
      const gn = pivotData.reduce((s,x)=>s+(x.combined_net||0),0);
      totalRow.push(gq, gq?gb/gq:0, gf, gt, gq?gt/gq:0, gc, gs, gi, gtcs, gn, gq?gn/gq:0);
  
      const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...rows, totalRow]);
  
      const merges = [
        {s:{r:0,c:0}, e:{r:1,c:0}},
        {s:{r:0,c:1}, e:{r:1,c:1}},
        {s:{r:0,c:2}, e:{r:1,c:2}},
      ];
      let c = 3;
      units.forEach(()=>{ merges.push({s:{r:0,c}, e:{r:0,c:c+10}}); c+=11; });
      merges.push({s:{r:0,c}, e:{r:0,c:c+10}});
      ws['!merges'] = merges;
  
      const range = XLSX.utils.decode_range(ws['!ref']);
      for(let R=2; R<=range.e.r; R++){
        for(let C=3; C<=range.e.c; C++){
          const addr = XLSX.utils.encode_cell({r:R,c:C});
          if(ws[addr]){
            ws[addr].t='n';
            const pos=(C-3)%11;
            ws[addr].z = pos===0?fmt3:fmt0;
          }
        }
      }
  
      ws['!freeze']={ySplit:2};
      XLSX.utils.book_append_sheet(wb,ws,"Abstract Report");
  
    } else {
      const headers = ["No.","Section","Size","MT","Invoice Value/MT","Freight","Total","Rate/MT","CGST","SGST","IGST","TCS","Net Value","Net Rate/MT"];
  
      const rows = abstractData.map((x,i)=>
        [i+1,x.section,x.size,x.totalQty,x.invoiceValuePerMT,x.totalFreight,x.totalAmount,x.ratePerMT,x.totalCGST,x.totalSGST,x.totalIGST,x.totalTCS,x.totalNet,x.netRatePerMT]
      );
  
      const totalRow = ["","TOTAL","",grandTotalQty,grandInvoicePerMT,grandTotalFreight,grandTotalAmount,grandRatePerMT,grandTotalCGST,grandTotalSGST,grandTotalIGST,grandTotalTCS,grandTotalNet,grandNetRatePerMT];
  
      const ws = XLSX.utils.aoa_to_sheet([headers,...rows,totalRow]);
  
      const range=XLSX.utils.decode_range(ws['!ref']);
      for(let R=1;R<=range.e.r;R++){
        for(let C=3;C<=range.e.c;C++){
          const addr=XLSX.utils.encode_cell({r:R,c:C});
          if(ws[addr]){
            ws[addr].t='n';
            ws[addr].z = (C===3)?fmt3:fmt0;
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
                  <th key={i} colSpan={11}>{unit}</th>
                ))}
                <th colSpan={11} className="total-header">Total</th>
              </tr>
              <tr>
                {units.map((unit, i) => (
                  <React.Fragment key={i}>
                    <th>MT</th>
                    <th>Inv Value/MT</th>
                    <th>Freight</th>
                    <th>Total</th>
                    <th>Rate/MT</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>IGST</th>
                    <th>TCS</th>
                    <th>Net Value</th>
                    <th>Net Rate/MT</th>
                  </React.Fragment>
                ))}
                <th className="total-subheader">MT</th>
                <th className="total-subheader">Inv Value/MT</th>
                <th className="total-subheader">Freight</th>
                <th className="total-subheader">Total</th>
                <th className="total-subheader">Rate/MT</th>
                <th className="total-subheader">CGST</th>
                <th className="total-subheader">SGST</th>
                <th className="total-subheader">IGST</th>
                <th className="total-subheader">TCS</th>
                <th className="total-subheader">Net Value</th>
                <th className="total-subheader">Net Rate/MT</th>
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
                      <td>{formatRate(item[`${unit}_invoicePerMT`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_freight`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_total`] || 0)}</td>
                      <td>{formatRate(item[`${unit}_ratePerMT`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_cgst`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_sgst`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_igst`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_tcs`] || 0)}</td>
                      <td>{formatAmount(item[`${unit}_net`] || 0)}</td>
                      <td>{formatRate(item[`${unit}_netRatePerMT`] || 0)}</td>
                    </React.Fragment>
                  ))}
                  <td className="total-cell">{formatMT(item.combined_qty || 0)}</td>
                  <td className="total-cell">{formatRate(item.combined_invoicePerMT || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_freight || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_total || 0)}</td>
                  <td className="total-cell">{formatRate(item.combined_ratePerMT || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_cgst || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_sgst || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_igst || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_tcs || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_net || 0)}</td>
                  <td className="total-cell">{formatRate(item.combined_netRatePerMT || 0)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>Total</td>
                {units.map((unit, i) => {
                  const totalQty = pivotData.reduce((sum, item) => sum + (item[`${unit}_qty`] || 0), 0);
                  const totalBasic = pivotData.reduce((sum, item) => sum + (item[`${unit}_basic`] || 0), 0);
                  const totalFreight = pivotData.reduce((sum, item) => sum + (item[`${unit}_freight`] || 0), 0);
                  const totalAmount = pivotData.reduce((sum, item) => sum + (item[`${unit}_total`] || 0), 0);
                  const totalCGST = pivotData.reduce((sum, item) => sum + (item[`${unit}_cgst`] || 0), 0);
                  const totalSGST = pivotData.reduce((sum, item) => sum + (item[`${unit}_sgst`] || 0), 0);
                  const totalIGST = pivotData.reduce((sum, item) => sum + (item[`${unit}_igst`] || 0), 0);
                  const totalTCS = pivotData.reduce((sum, item) => sum + (item[`${unit}_tcs`] || 0), 0);
                  const totalNet = pivotData.reduce((sum, item) => sum + (item[`${unit}_net`] || 0), 0);
                  const invPerMT = totalQty > 0 ? totalBasic / totalQty : 0;
                  const ratePerMT = totalQty > 0 ? totalAmount / totalQty : 0;
                  const netRatePerMT = totalQty > 0 ? totalNet / totalQty : 0;
                  return (
                    <React.Fragment key={i}>
                      <td>{formatMT(totalQty)}</td>
                      <td>{formatRate(invPerMT)}</td>
                      <td>{formatAmount(totalFreight)}</td>
                      <td>{formatAmount(totalAmount)}</td>
                      <td>{formatRate(ratePerMT)}</td>
                      <td>{formatAmount(totalCGST)}</td>
                      <td>{formatAmount(totalSGST)}</td>
                      <td>{formatAmount(totalIGST)}</td>
                      <td>{formatAmount(totalTCS)}</td>
                      <td>{formatAmount(totalNet)}</td>
                      <td>{formatRate(netRatePerMT)}</td>
                    </React.Fragment>
                  );
                })}
                <td>{formatMT(pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0))}</td>
                <td>{formatRate(
                  (() => {
                    const totalQty = pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0);
                    const totalBasic = pivotData.reduce((sum, item) => sum + (item.combined_basic || 0), 0);
                    return totalQty > 0 ? totalBasic / totalQty : 0;
                  })()
                )}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_freight || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_total || 0), 0))}</td>
                <td>{formatRate(
                  (() => {
                    const totalQty = pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0);
                    const totalAmount = pivotData.reduce((sum, item) => sum + (item.combined_total || 0), 0);
                    return totalQty > 0 ? totalAmount / totalQty : 0;
                  })()
                )}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_cgst || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_sgst || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_igst || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_tcs || 0), 0))}</td>
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
                <th colSpan={14} className="table-title">
                  Abstract of Raw Material Purchased
                  {selectedUnit !== "Group" && ` - ${selectedUnit}`}
                  {selectedWorkType !== "Group" && ` (${selectedWorkType})`}
                </th>
              </tr>
              <tr>
                <th>No.</th>
                <th>Section</th>
                <th>Size</th>
                <th>MT</th>
                <th>Invoice Value/MT</th>
                <th>Freight</th>
                <th>Total</th>
                <th>Rate/MT</th>
                <th>CGST</th>
                <th>SGST</th>
                <th>IGST</th>
                <th>TCS</th>
                <th>Net Value</th>
                <th>Net Rate/MT</th>
              </tr>
            </thead>
            <tbody>
              {abstractData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  <td>{formatMT(item.totalQty)}</td>
                  <td>{formatRate(item.invoiceValuePerMT)}</td>
                  <td>{formatAmount(item.totalFreight)}</td>
                  <td>{formatAmount(item.totalAmount)}</td>
                  <td>{formatRate(item.ratePerMT)}</td>
                  <td>{formatAmount(item.totalCGST)}</td>
                  <td>{formatAmount(item.totalSGST)}</td>
                  <td>{formatAmount(item.totalIGST)}</td>
                  <td>{formatAmount(item.totalTCS)}</td>
                  <td>{formatAmount(item.totalNet)}</td>
                  <td>{formatRate(item.netRatePerMT)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>Total</td>
                <td>{formatMT(grandTotalQty)}</td>
                <td>{formatRate(grandInvoicePerMT)}</td>
                <td>{formatAmount(grandTotalFreight)}</td>
                <td>{formatAmount(grandTotalAmount)}</td>
                <td>{formatRate(grandRatePerMT)}</td>
                <td>{formatAmount(grandTotalCGST)}</td>
                <td>{formatAmount(grandTotalSGST)}</td>
                <td>{formatAmount(grandTotalIGST)}</td>
                <td>{formatAmount(grandTotalTCS)}</td>
                <td>{formatAmount(grandTotalNet)}</td>
                <td>{formatRate(grandNetRatePerMT)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}