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
      
      // Get GST data from entry
      const gstData = entry.gst || {};
      const gstType = gstData.type || "AP";
      
      // Calculate total GST amount from entry
      const totalGST = Number(entry.finalTotals?.gst || gstData.totalGst || 0);
      
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      
      // Get others value
      const others = Number(entry.charges?.Others || 0);
      
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        // Calculate item's share of charges (proportional to basic amount)
        const itemProportion = entryTotalBasic > 0 ? (itemBasic / entryTotalBasic) : 0;
        
        // Get section-specific freight charges from the item
        const itemLoadingCharges = Number(item["Section Loading Charges"]) || 0;
        const itemFreightLess = Number(item["Section Freight<"]) || 0;
        const itemFreightGreater = Number(item["Section Freight>"]) || 0;
        
        // Proportional Others charge for this item
        const itemOthers = itemProportion * others;
        
        // Total freight is now: Loading Charges + Freight< + Freight>
        const itemTotalFreight = itemLoadingCharges + itemFreightLess + itemFreightGreater;
        
        // Total amount includes: Basic + Freight (Loading + Freight< + Freight>) + Others
        const itemTotal = itemBasic + itemTotalFreight + itemOthers;
        
        // GST is calculated proportionally
        const itemGST = itemProportion * totalGST;
        
        // Calculate CGST, SGST, IGST based on GST type
        let itemCGST = 0;
        let itemSGST = 0;
        let itemIGST = 0;
        
        if (gstType === "AP") {
          // For AP type, split GST equally between CGST and SGST
          itemCGST = itemGST / 2;
          itemSGST = itemGST / 2;
          itemIGST = 0;
        } else {
          // For OTHER type, entire GST is IGST
          itemCGST = 0;
          itemSGST = 0;
          itemIGST = itemGST;
        }

        const key = `${section}|${size}`;
        if (!grouped[key]) {
          grouped[key] = {
            Unit: entry.Unit || "Unknown",
            section,
            size: size,
            totalQty: qty,
            totalBasic: itemBasic,
            totalFreight: itemTotalFreight + itemOthers,
            totalCGST: itemCGST,
            totalSGST: itemSGST,
            totalIGST: itemIGST
          };
        } else {
          grouped[key].totalQty += qty;
          grouped[key].totalBasic += itemBasic;
          grouped[key].totalFreight += (itemTotalFreight + itemOthers);
          grouped[key].totalCGST += itemCGST;
          grouped[key].totalSGST += itemSGST;
          grouped[key].totalIGST += itemIGST;
        }
      });
    });

    const array = Object.values(grouped).map(item => ({
      ...item,
      invoiceValue: item.totalBasic,
      totalAmount: item.totalBasic + item.totalFreight,
      ratePerMT: item.totalQty > 0 ? (item.totalBasic + item.totalFreight) / item.totalQty : 0
    }));

    array.sort((a, b) => a.section.localeCompare(b.section));
    setAbstractData(array);
    setPivotData([]);
  };

  const processPivotData = (items) => {
    const grouped = {};

    items.forEach(entry => {
      const itemsArray = entry.items && Array.isArray(entry.items) ? entry.items : [entry];
      
      // Get GST data from entry
      const gstData = entry.gst || {};
      const gstType = gstData.type || "AP";
      
      // Calculate total GST amount from entry
      const totalGST = Number(entry.finalTotals?.gst || gstData.totalGst || 0);
      
      const entryTotalBasic = itemsArray.reduce((sum, item) => {
        return sum + (Number(item["Bill Basic Amount"]) || 0);
      }, 0);
      
      // Get others value
      const others = Number(entry.charges?.Others || 0);
      
      itemsArray.forEach(item => {
        const section = (item["Section"] || "Unknown").toString().trim();
        const size = (item["Size"] || "").toString().trim();
        const unit = entry.Unit || "Unknown";
        const qty = Number(item["Quantity in Metric Tons"]) || 0;
        const itemBasic = Number(item["Bill Basic Amount"]) || 0;
        
        const itemProportion = entryTotalBasic > 0 ? (itemBasic / entryTotalBasic) : 0;
        
        // Get section-specific freight charges from the item
        const itemLoadingCharges = Number(item["Section Loading Charges"]) || 0;
        const itemFreightLess = Number(item["Section Freight<"]) || 0;
        const itemFreightGreater = Number(item["Section Freight>"]) || 0;
        
        // Proportional Others charge for this item
        const itemOthers = itemProportion * others;
        
        // Total freight is now: Loading Charges + Freight< + Freight>
        const itemTotalFreight = itemLoadingCharges + itemFreightLess + itemFreightGreater;
        
        const itemTotal = itemBasic + itemTotalFreight + itemOthers;
        const itemGST = itemProportion * totalGST;
        
        // Calculate CGST, SGST, IGST based on GST type
        let itemCGST = 0;
        let itemSGST = 0;
        let itemIGST = 0;
        
        if (gstType === "AP") {
          itemCGST = itemGST / 2;
          itemSGST = itemGST / 2;
          itemIGST = 0;
        } else {
          itemCGST = 0;
          itemSGST = 0;
          itemIGST = itemGST;
        }

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
            totalCGST: 0,
            totalSGST: 0,
            totalIGST: 0
          };
        }
        grouped[key].units[unit].totalQty += qty;
        grouped[key].units[unit].totalBasic += itemBasic;
        grouped[key].units[unit].totalFreight += (itemTotalFreight + itemOthers);
        grouped[key].units[unit].totalCGST += itemCGST;
        grouped[key].units[unit].totalSGST += itemSGST;
        grouped[key].units[unit].totalIGST += itemIGST;
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
      let combinedCGST = 0;
      let combinedSGST = 0;
      let combinedIGST = 0;
      
      GroupUnits.forEach(unit => {
        if (item.units[unit]) {
          const u = item.units[unit];
          const unitTotal = u.totalBasic + u.totalFreight;
          const unitRatePerMT = u.totalQty > 0 ? unitTotal / u.totalQty : 0;
          
          row[`${unit}_qty`] = u.totalQty;
          row[`${unit}_invoiceValue`] = u.totalBasic;
          row[`${unit}_freight`] = u.totalFreight;
          row[`${unit}_total`] = unitTotal;
          row[`${unit}_ratePerMT`] = unitRatePerMT;
          row[`${unit}_cgst`] = u.totalCGST;
          row[`${unit}_sgst`] = u.totalSGST;
          row[`${unit}_igst`] = u.totalIGST;
          
          combinedQty += u.totalQty;
          combinedBasic += u.totalBasic;
          combinedFreight += u.totalFreight;
          combinedCGST += u.totalCGST;
          combinedSGST += u.totalSGST;
          combinedIGST += u.totalIGST;
        } else {
          row[`${unit}_qty`] = 0;
          row[`${unit}_invoiceValue`] = 0;
          row[`${unit}_freight`] = 0;
          row[`${unit}_total`] = 0;
          row[`${unit}_ratePerMT`] = 0;
          row[`${unit}_cgst`] = 0;
          row[`${unit}_sgst`] = 0;
          row[`${unit}_igst`] = 0;
        }
      });
      
      const combinedTotal = combinedBasic + combinedFreight;
      const combinedRatePerMT = combinedQty > 0 ? combinedTotal / combinedQty : 0;
      
      row.combined_qty = combinedQty;
      row.combined_invoiceValue = combinedBasic;
      row.combined_freight = combinedFreight;
      row.combined_total = combinedTotal;
      row.combined_ratePerMT = combinedRatePerMT;
      row.combined_cgst = combinedCGST;
      row.combined_sgst = combinedSGST;
      row.combined_igst = combinedIGST;
      
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
  const grandTotalAmount = grandTotalBasic + grandTotalFreight;
  const grandTotalCGST = abstractData.reduce((sum, item) => sum + item.totalCGST, 0);
  const grandTotalSGST = abstractData.reduce((sum, item) => sum + item.totalSGST, 0);
  const grandTotalIGST = abstractData.reduce((sum, item) => sum + item.totalIGST, 0);
  const grandInvoiceValue = grandTotalBasic;
  const grandRatePerMT = grandTotalQty > 0 ? grandTotalAmount / grandTotalQty : 0;

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
        headRow1.push({ content: unit, colSpan: 8 });
        headRow2.push(
          { content: "MT" },
          { content: "Invoice Value" },
          { content: "Freight" },
          { content: "Total" },
          { content: "Rate/MT" },
          { content: "CGST" },
          { content: "SGST" },
          { content: "IGST" }
        );
      });
  
      headRow1.push({ content: "Total", colSpan: 8 });
      headRow2.push(
        { content: "MT" },
        { content: "Invoice Value" },
        { content: "Freight" },
        { content: "Total" },
        { content: "Rate/MT" },
        { content: "CGST" },
        { content: "SGST" },
        { content: "IGST" }
      );
  
      const body = pivotData.map((item, index) => {
        const row = [index + 1, item.section, item.size];
  
        units.forEach(unit => {
          row.push(
            formatMT(item[`${unit}_qty`] || 0),
            formatAmount(item[`${unit}_invoiceValue`] || 0),
            formatAmount(item[`${unit}_freight`] || 0),
            formatAmount(item[`${unit}_total`] || 0),
            formatRate(item[`${unit}_ratePerMT`] || 0),
            formatAmount(item[`${unit}_cgst`] || 0),
            formatAmount(item[`${unit}_sgst`] || 0),
            formatAmount(item[`${unit}_igst`] || 0)
          );
        });
  
        row.push(
          formatMT(item.combined_qty || 0),
          formatAmount(item.combined_invoiceValue || 0),
          formatAmount(item.combined_freight || 0),
          formatAmount(item.combined_total || 0),
          formatRate(item.combined_ratePerMT || 0),
          formatAmount(item.combined_cgst || 0),
          formatAmount(item.combined_sgst || 0),
          formatAmount(item.combined_igst || 0)
        );
  
        return row;
      });
  
      const totalRow = ["", "TOTAL", ""];
  
      units.forEach(unit => {
        const tQty = pivotData.reduce((s, x) => s + (x[`${unit}_qty`] || 0), 0);
        const tInvoiceValue = pivotData.reduce((s, x) => s + (x[`${unit}_invoiceValue`] || 0), 0);
        const tFreight = pivotData.reduce((s, x) => s + (x[`${unit}_freight`] || 0), 0);
        const tTotal = tInvoiceValue + tFreight;
        const tCGST = pivotData.reduce((s, x) => s + (x[`${unit}_cgst`] || 0), 0);
        const tSGST = pivotData.reduce((s, x) => s + (x[`${unit}_sgst`] || 0), 0);
        const tIGST = pivotData.reduce((s, x) => s + (x[`${unit}_igst`] || 0), 0);
        const tRatePerMT = tQty ? tTotal / tQty : 0;
  
        totalRow.push(formatMT(tQty), formatAmount(tInvoiceValue), formatAmount(tFreight), formatAmount(tTotal), formatRate(tRatePerMT), formatAmount(tCGST), formatAmount(tSGST), formatAmount(tIGST));
      });
  
      const gQty = pivotData.reduce((s, x) => s + (x.combined_qty || 0), 0);
      const gInvoiceValue = pivotData.reduce((s, x) => s + (x.combined_invoiceValue || 0), 0);
      const gFreight = pivotData.reduce((s, x) => s + (x.combined_freight || 0), 0);
      const gTotal = gInvoiceValue + gFreight;
      const gCGST = pivotData.reduce((s, x) => s + (x.combined_cgst || 0), 0);
      const gSGST = pivotData.reduce((s, x) => s + (x.combined_sgst || 0), 0);
      const gIGST = pivotData.reduce((s, x) => s + (x.combined_igst || 0), 0);
      const gRatePerMT = gQty ? gTotal / gQty : 0;
  
      totalRow.push(formatMT(gQty), formatAmount(gInvoiceValue), formatAmount(gFreight), formatAmount(gTotal), formatRate(gRatePerMT), formatAmount(gCGST), formatAmount(gSGST), formatAmount(gIGST));
      body.push(totalRow);
  
      autoTable(doc, {
        startY: fromDate || toDate ? 55 : 45,
        head: [headRow1, headRow2],
        body: body,
        theme: "grid",
        styles: { fontSize: 7, halign: "center", valign: "middle", cellPadding: 1 },
        headStyles: { 
          fillColor: [230, 240, 255],
          textColor: [0, 0, 0],
          fontStyle: "bold"
        }
      });
  
    } else {
      const headers = ["No.", "Section", "Size", "MT", "Invoice Value", "Freight", "Total", "Rate/MT", "CGST", "SGST", "IGST"];
  
      const body = abstractData.map((item, i) =>
        [i + 1, item.section, item.size, formatMT(item.totalQty), formatAmount(item.invoiceValue), formatAmount(item.totalFreight), formatAmount(item.totalAmount), formatRate(item.ratePerMT), formatAmount(item.totalCGST), formatAmount(item.totalSGST), formatAmount(item.totalIGST)]
      );
  
      body.push(
        ["", "TOTAL", "", formatMT(grandTotalQty), formatAmount(grandInvoiceValue), formatAmount(grandTotalFreight), formatAmount(grandTotalAmount), formatRate(grandRatePerMT), formatAmount(grandTotalCGST), formatAmount(grandTotalSGST), formatAmount(grandTotalIGST)]
      );
  
      autoTable(doc, {
        head: [headers],
        body: body,
        startY: fromDate || toDate ? 55 : 45,
        styles: { fontSize: 8, cellPadding: 2 },
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
        header1.push(u, "", "", "", "", "", "", "");
        header2.push("MT", "Invoice Value", "Freight", "Total", "Rate/MT", "CGST", "SGST", "IGST");
      });
  
      header1.push("Total", "", "", "", "", "", "", "");
      header2.push("MT", "Invoice Value", "Freight", "Total", "Rate/MT", "CGST", "SGST", "IGST");
  
      const rows = pivotData.map((item, i) => {
        const r = [i+1, item.section, item.size];
        units.forEach(u => {
          r.push(
            item[`${u}_qty`] || 0,
            item[`${u}_invoiceValue`] || 0,
            item[`${u}_freight`] || 0,
            item[`${u}_total`] || 0,
            item[`${u}_ratePerMT`] || 0,
            item[`${u}_cgst`] || 0,
            item[`${u}_sgst`] || 0,
            item[`${u}_igst`] || 0
          );
        });
        r.push(item.combined_qty||0, item.combined_invoiceValue||0, item.combined_freight||0, item.combined_total||0, item.combined_ratePerMT||0, item.combined_cgst||0, item.combined_sgst||0, item.combined_igst||0);
        return r;
      });
  
      const totalRow = ["", "TOTAL", ""];
      units.forEach(u => {
        const tq = pivotData.reduce((s,x)=>s+(x[`${u}_qty`]||0),0);
        const tinv = pivotData.reduce((s,x)=>s+(x[`${u}_invoiceValue`]||0),0);
        const tf = pivotData.reduce((s,x)=>s+(x[`${u}_freight`]||0),0);
        const tt = tinv + tf;
        const tc = pivotData.reduce((s,x)=>s+(x[`${u}_cgst`]||0),0);
        const ts = pivotData.reduce((s,x)=>s+(x[`${u}_sgst`]||0),0);
        const ti = pivotData.reduce((s,x)=>s+(x[`${u}_igst`]||0),0);
        totalRow.push(tq, tinv, tf, tt, tq?tt/tq:0, tc, ts, ti);
      });
      const gq = pivotData.reduce((s,x)=>s+(x.combined_qty||0),0);
      const ginv = pivotData.reduce((s,x)=>s+(x.combined_invoiceValue||0),0);
      const gf = pivotData.reduce((s,x)=>s+(x.combined_freight||0),0);
      const gt = ginv + gf;
      const gc = pivotData.reduce((s,x)=>s+(x.combined_cgst||0),0);
      const gs = pivotData.reduce((s,x)=>s+(x.combined_sgst||0),0);
      const gi = pivotData.reduce((s,x)=>s+(x.combined_igst||0),0);
      totalRow.push(gq, ginv, gf, gt, gq?gt/gq:0, gc, gs, gi);
  
      const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...rows, totalRow]);
  
      const merges = [
        {s:{r:0,c:0}, e:{r:1,c:0}},
        {s:{r:0,c:1}, e:{r:1,c:1}},
        {s:{r:0,c:2}, e:{r:1,c:2}},
      ];
      let c = 3;
      units.forEach(()=>{ merges.push({s:{r:0,c}, e:{r:0,c:c+7}}); c+=8; });
      merges.push({s:{r:0,c}, e:{r:0,c:c+7}});
      ws['!merges'] = merges;
  
      const range = XLSX.utils.decode_range(ws['!ref']);
      for(let R=2; R<=range.e.r; R++){
        for(let C=3; C<=range.e.c; C++){
          const addr = XLSX.utils.encode_cell({r:R,c:C});
          if(ws[addr] && typeof ws[addr].v !== 'string'){
            ws[addr].t='n';
            const pos=(C-3)%8;
            ws[addr].z = pos===0?fmt3:fmt0;
          }
        }
      }
  
      ws['!freeze']={ySplit:2};
      XLSX.utils.book_append_sheet(wb,ws,"Abstract Report");
  
    } else {
      const headers = ["No.","Section","Size","MT","Invoice Value","Freight","Total","Rate/MT","CGST","SGST","IGST"];
  
      const rows = abstractData.map((x,i) =>
        [i+1,x.section,x.size,x.totalQty,x.invoiceValue,x.totalFreight,x.totalAmount,x.ratePerMT,x.totalCGST,x.totalSGST,x.totalIGST]
      );
  
      const totalRow = ["","TOTAL","",grandTotalQty,grandInvoiceValue,grandTotalFreight,grandTotalAmount,grandRatePerMT,grandTotalCGST,grandTotalSGST,grandTotalIGST];
  
      const ws = XLSX.utils.aoa_to_sheet([headers,...rows,totalRow]);
  
      const range=XLSX.utils.decode_range(ws['!ref']);
      for(let R=1;R<=range.e.r;R++){
        for(let C=3;C<=range.e.c;C++){
          const addr=XLSX.utils.encode_cell({r:R,c:C});
          if(ws[addr] && typeof ws[addr].v !== 'string'){
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
                  <th key={i} colSpan={8}>{unit}</th>
                ))}
                <th colSpan={8} className="total-header">Total</th>
              </tr>
              <tr>
                {units.map((unit, i) => (
                  <React.Fragment key={i}>
                    <th>MT</th>
                    <th>Invoice Value</th>
                    <th>Freight</th>
                    <th>Total</th>
                    <th>Rate/MT</th>
                    <th>CGST</th>
                    <th>SGST</th>
                    <th>IGST</th>
                  </React.Fragment>
                ))}
                <th className="total-subheader">MT</th>
                <th className="total-subheader">Invoice Value</th>
                <th className="total-subheader">Freight</th>
                <th className="total-subheader">Total</th>
                <th className="total-subheader">Rate/MT</th>
                <th className="total-subheader">CGST</th>
                <th className="total-subheader">SGST</th>
                <th className="total-subheader">IGST</th>
              </tr>
            </thead>
            <tbody>
              {pivotData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  {units.map((unit, i) => {
                    return (
                      <React.Fragment key={i}>
                        <td>{formatMT(item[`${unit}_qty`] || 0)}</td>
                        <td>{formatAmount(item[`${unit}_invoiceValue`] || 0)}</td>
                        <td>{formatAmount(item[`${unit}_freight`] || 0)}</td>
                        <td>{formatAmount(item[`${unit}_total`] || 0)}</td>
                        <td>{formatRate(item[`${unit}_ratePerMT`] || 0)}</td>
                        <td>{formatAmount(item[`${unit}_cgst`] || 0)}</td>
                        <td>{formatAmount(item[`${unit}_sgst`] || 0)}</td>
                        <td>{formatAmount(item[`${unit}_igst`] || 0)}</td>
                      </React.Fragment>
                    );
                  })}
                  <td className="total-cell">{formatMT(item.combined_qty || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_invoiceValue || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_freight || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_total || 0)}</td>
                  <td className="total-cell">{formatRate(item.combined_ratePerMT || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_cgst || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_sgst || 0)}</td>
                  <td className="total-cell">{formatAmount(item.combined_igst || 0)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>Total</td>
                {units.map((unit, i) => {
                  const totalQty = pivotData.reduce((sum, item) => sum + (item[`${unit}_qty`] || 0), 0);
                  const totalInvoiceValue = pivotData.reduce((sum, item) => sum + (item[`${unit}_invoiceValue`] || 0), 0);
                  const totalFreight = pivotData.reduce((sum, item) => sum + (item[`${unit}_freight`] || 0), 0);
                  const totalAmount = totalInvoiceValue + totalFreight;
                  const totalCGST = pivotData.reduce((sum, item) => sum + (item[`${unit}_cgst`] || 0), 0);
                  const totalSGST = pivotData.reduce((sum, item) => sum + (item[`${unit}_sgst`] || 0), 0);
                  const totalIGST = pivotData.reduce((sum, item) => sum + (item[`${unit}_igst`] || 0), 0);
                  const ratePerMT = totalQty > 0 ? totalAmount / totalQty : 0;
                  return (
                    <React.Fragment key={i}>
                      <td>{formatMT(totalQty)}</td>
                      <td>{formatAmount(totalInvoiceValue)}</td>
                      <td>{formatAmount(totalFreight)}</td>
                      <td>{formatAmount(totalAmount)}</td>
                      <td>{formatRate(ratePerMT)}</td>
                      <td>{formatAmount(totalCGST)}</td>
                      <td>{formatAmount(totalSGST)}</td>
                      <td>{formatAmount(totalIGST)}</td>
                    </React.Fragment>
                  );
                })}
                <td>{formatMT(pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_invoiceValue || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_freight || 0), 0))}</td>
                <td>{formatAmount(
                  (() => {
                    const totalInv = pivotData.reduce((sum, item) => sum + (item.combined_invoiceValue || 0), 0);
                    const totalFrt = pivotData.reduce((sum, item) => sum + (item.combined_freight || 0), 0);
                    return totalInv + totalFrt;
                  })()
                )}</td>
                <td>{formatRate(
                  (() => {
                    const totalQty = pivotData.reduce((sum, item) => sum + (item.combined_qty || 0), 0);
                    const totalInv = pivotData.reduce((sum, item) => sum + (item.combined_invoiceValue || 0), 0);
                    const totalFrt = pivotData.reduce((sum, item) => sum + (item.combined_freight || 0), 0);
                    const totalAmt = totalInv + totalFrt;
                    return totalQty > 0 ? totalAmt / totalQty : 0;
                  })()
                )}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_cgst || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_sgst || 0), 0))}</td>
                <td>{formatAmount(pivotData.reduce((sum, item) => sum + (item.combined_igst || 0), 0))}</td>
              </tr>
            </tbody>
          </table>
        ) : (
          <table className="abstract-table">
            <thead>
              <tr>
                <th colSpan={11} className="table-title">
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
                <th>Invoice Value</th>
                <th>Freight</th>
                <th>Total</th>
                <th>Rate/MT</th>
                <th>CGST</th>
                <th>SGST</th>
                <th>IGST</th>
              </tr>
            </thead>
            <tbody>
              {abstractData.map((item, index) => (
                <tr key={index}>
                  <td>{index + 1}</td>
                  <td className="text-left">{item.section}</td>
                  <td className="text-left">{item.size}</td>
                  <td>{formatMT(item.totalQty)}</td>
                  <td>{formatAmount(item.invoiceValue)}</td>
                  <td>{formatAmount(item.totalFreight)}</td>
                  <td>{formatAmount(item.totalAmount)}</td>
                  <td>{formatRate(item.ratePerMT)}</td>
                  <td>{formatAmount(item.totalCGST)}</td>
                  <td>{formatAmount(item.totalSGST)}</td>
                  <td>{formatAmount(item.totalIGST)}</td>
                </tr>
              ))}
              <tr className="total-row">
                <td colSpan={3}>Total</td>
                <td>{formatMT(grandTotalQty)}</td>
                <td>{formatAmount(grandInvoiceValue)}</td>
                <td>{formatAmount(grandTotalFreight)}</td>
                <td>{formatAmount(grandTotalAmount)}</td>
                <td>{formatRate(grandRatePerMT)}</td>
                <td>{formatAmount(grandTotalCGST)}</td>
                <td>{formatAmount(grandTotalSGST)}</td>
                <td>{formatAmount(grandTotalIGST)}</td>
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}