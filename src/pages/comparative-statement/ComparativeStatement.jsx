import { useState, useEffect } from "react";
import { db } from "../../firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./ComparativeStatement.css";

export default function ComparativeStatement() {
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [purchaseEntries, setPurchaseEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [filterFY, setFilterFY] = useState("");
  const [filterEnquiryNo, setFilterEnquiryNo] = useState("");
  const [filterDate, setFilterDate] = useState("");
  const [filterEndDate, setFilterEndDate] = useState("");

  // ── Fetch enquiry entries + purchase entries ────────────────────────────────
  const fetchEntries = async () => {
    setLoading(true);
    try {
      const [enquirySnap, purchaseSnap] = await Promise.all([
        getDocs(query(collection(db, "enquiryEntries"), orderBy("No", "asc"))),
        getDocs(query(collection(db, "entries"), orderBy("No", "asc"))),
      ]);
      const enquiryData = enquirySnap.docs.map(d => ({ id: d.id, ...d.data() }));
      const purchaseData = purchaseSnap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllEntries(enquiryData);
      setFilteredEntries(enquiryData);
      setPurchaseEntries(purchaseData);
    } catch (e) {
      console.error("Error fetching entries:", e);
      alert("Error loading data from Firebase.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntries(); }, []);

  // ── Apply filters ──────────────────────────────────────────────────────────
  useEffect(() => {
    let result = [...allEntries];
    if (filterFY) result = result.filter(e => e.FinancialYear === filterFY);
    if (filterEnquiryNo) result = result.filter(e => String(e.No) === String(filterEnquiryNo));
    if (filterDate) result = result.filter(e => e.EnquiryDate >= filterDate);
    if (filterEndDate) result = result.filter(e => e.EnquiryDate <= filterEndDate);
    setFilteredEntries(result);
  }, [filterFY, filterEnquiryNo, filterDate, filterEndDate, allEntries]);

  // ── Build purchase rate lookup ─────────────────────────────────────────────
  const buildPurchaseLookup = () => {
    const lookup = new Map();
    purchaseEntries.forEach(entry => {
      const billDate = entry["Bill Date"] || entry["Received On"] || "";
      if (filterEndDate && billDate && billDate > filterEndDate) return;
      (entry.items || []).forEach(item => {
        const section = item.Section || "";
        const size = item.Size || "";
        const mt = parseFloat(item["Quantity in Metric Tons"]) || 0;
        const sectionSubtotal = parseFloat(item["Section Subtotal"]) || 0;
        const rate = mt > 0 ? sectionSubtotal / mt : 0;
        if (!section || !rate) return;
        const key = `${section}||${size}`;
        if (!lookup.has(key)) {
          lookup.set(key, { lowestRate: rate, lowestDate: billDate, lastRate: rate, lastDate: billDate, lastNo: entry.No });
        } else {
          const existing = lookup.get(key);
          if (rate < existing.lowestRate) { existing.lowestRate = rate; existing.lowestDate = billDate; }
          if (entry.No > existing.lastNo) { existing.lastRate = rate; existing.lastDate = billDate; existing.lastNo = entry.No; }
        }
      });
    });
    return lookup;
  };

  // ── Build pivot table data ─────────────────────────────────────────────────
  const buildTableData = () => {
    if (!filteredEntries.length) return { suppliers: [], rows: [] };
    const supplierSet = new Set();
    filteredEntries.forEach(entry => {
      (entry.sections || []).forEach(sec => {
        (sec.supplierRates || []).forEach(sr => {
          if (sr.supplier) supplierSet.add(sr.supplier.trim());
        });
      });
    });
    const suppliers = Array.from(supplierSet).sort();
    const purchaseLookup = buildPurchaseLookup();
    const rowMap = new Map();
    filteredEntries.forEach(entry => {
      (entry.sections || []).forEach(sec => {
        const section = sec.section || "";
        const size = sec.size || "";
        const width = sec.width || "";
        const length = sec.length || "";
        const sectionMt = sec.mt || 0;
        const key = `${section}||${size}||${width}||${length}`;
        const purchaseKey = `${section}||${size}`;
        if (!rowMap.has(key)) {
          const purchaseData = purchaseLookup.get(purchaseKey) || null;
          rowMap.set(key, {
            section, size, width, length, sectionMt,
            lowestPurchaseRate: purchaseData ? purchaseData.lowestRate : null,
            lowestPurchaseDate: purchaseData ? purchaseData.lowestDate : null,
            lastPurchaseRate: purchaseData ? purchaseData.lastRate : null,
            lastPurchaseDate: purchaseData ? purchaseData.lastDate : null,
            rates: {},
          });
        }
        const row = rowMap.get(key);
        row.sectionMt = sectionMt;
        (sec.supplierRates || []).forEach(sr => {
          if (!sr.supplier) return;
          const supplierKey = sr.supplier.trim();
          const rate = parseFloat(sr.rate) || 0;
          const supplierMt = parseFloat(sr.mt) || 0;
          if (!row.rates[supplierKey] || rate < row.rates[supplierKey].rate) {
            row.rates[supplierKey] = { rate, mt: supplierMt, entryNo: entry.No, enquiryDate: entry.EnquiryDate || "" };
          }
        });
      });
    });
    const rows = Array.from(rowMap.values()).map(row => {
      const quotedRates = Object.values(row.rates).map(r => r.rate).filter(r => r > 0);
      const minRate = quotedRates.length ? Math.min(...quotedRates) : null;
      return { ...row, minRate };
    });
    return { suppliers, rows };
  };

  const { suppliers, rows } = buildTableData();

  // ── Build L1 Summary ──────────────────────────────────────────────────────
  const buildL1Summary = () => {
    const rowDetails = rows.map((row, idx) => {
      const dims = [row.size, row.width, row.length].filter(Boolean).join(" x ");
      const description = [row.section, dims].filter(Boolean).join(" - ");

      const l1Rate = row.minRate || null;
      const l1Suppliers = new Set();
      if (l1Rate) {
        for (const [sup, rateObj] of Object.entries(row.rates)) {
          if (rateObj.rate === l1Rate) l1Suppliers.add(sup);
        }
      }
      const supplierData = {};
      suppliers.forEach(sup => {
        const rateObj = row.rates[sup];
        if (l1Suppliers.has(sup) && l1Rate && rateObj) {
          const mt = rateObj.mt || 0;
          supplierData[sup] = { mt, rate: l1Rate, amount: l1Rate * mt };
        } else {
          supplierData[sup] = { mt: null, rate: null, amount: null };
        }
      });
      return {
        idx,
        description,
        totalMt: row.sectionMt || 0,
        l1Suppliers: Array.from(l1Suppliers),
        l1Rate,
        supplierData,
      };
    });

    const supplierTotals = {};
    suppliers.forEach(sup => {
      let totalMt = 0, totalAmount = 0;
      rowDetails.forEach(r => {
        const d = r.supplierData[sup];
        if (d && d.mt) totalMt += d.mt;
        if (d && d.amount) totalAmount += d.amount;
      });
      supplierTotals[sup] = {
        totalMt,
        totalAmount,
        weightedAvgRate: totalMt > 0 ? totalAmount / totalMt : null,
      };
    });
    const grandTotalMt = rowDetails.reduce((s, r) => s + r.totalMt, 0);
    return { rowDetails, supplierTotals, grandTotalMt };
  };

  const l1Summary = buildL1Summary();

  // ── Footer summary calculations ────────────────────────────────────────────
  const buildQtyMtSummary = () => {
    const totalSectionMt = rows.reduce((s, r) => s + (r.sectionMt || 0), 0);
    let lowestNum = 0, lowestDen = 0, lastNum = 0, lastDen = 0;
    rows.forEach(row => {
      if (row.lowestPurchaseRate && row.sectionMt) { lowestNum += row.sectionMt * row.lowestPurchaseRate; lowestDen += row.sectionMt; }
      if (row.lastPurchaseRate && row.sectionMt) { lastNum += row.sectionMt * row.lastPurchaseRate; lastDen += row.sectionMt; }
    });
    const supplierL1Data = {};
    suppliers.forEach(sup => {
      let l1Mt = 0, l1Num = 0;
      rows.forEach(row => {
        const rateObj = row.rates[sup];
        if (rateObj && rateObj.rate > 0 && rateObj.rate === row.minRate) {
          l1Mt += row.sectionMt || 0;
          l1Num += (row.sectionMt || 0) * rateObj.rate;
        }
      });
      supplierL1Data[sup] = { l1Mt, l1WeightedAvgRate: l1Mt > 0 ? l1Num / l1Mt : null };
    });
    return {
      totalSectionMt,
      lowestPurchaseWeightedAvg: lowestDen > 0 ? lowestNum / lowestDen : null,
      lastPurchaseWeightedAvg: lastDen > 0 ? lastNum / lastDen : null,
      supplierL1Data,
    };
  };

  const qtyMtSummary = buildQtyMtSummary();

  // ── Format helpers ─────────────────────────────────────────────────────────
  const formatNum = (val) => {
    if (val == null || val === "" || val === 0) return "—";
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return "—";
    const str = num.toString();
    const dec = str.includes(".") ? str.split(".")[1].length : 0;
    return num.toLocaleString("en-IN", { minimumFractionDigits: 0, maximumFractionDigits: dec });
  };
  const formatRate = formatNum;

  const formatMT = (val) => {
    if (val == null || val === "") return "—";
    const num = parseFloat(val);
    if (isNaN(num)) return "—";
    const str = num.toString();
    const existingDec = str.includes(".") ? str.split(".")[1].length : 0;
    const decPlaces = Math.max(existingDec, 2);
    return num.toLocaleString("en-IN", { minimumFractionDigits: decPlaces, maximumFractionDigits: decPlaces });
  };

  const formatAmount = (val) => {
    if (!val) return "—";
    const n = Math.round(val);
    return n.toLocaleString("en-IN");
  };

  const formatPercent = (newRate, baseRate) => {
    if (!newRate || !baseRate || baseRate === 0) return null;
    return (((newRate - baseRate) / baseRate) * 100).toFixed(2);
  };

  const uniqueFYs = [...new Set(allEntries.map(e => e.FinancialYear).filter(Boolean))].sort();
  const uniqueEnquiryNos = [...new Set(allEntries.map(e => e.No).filter(v => v != null))].sort((a, b) => a - b);

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF("P", "pt", "a4");
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("Comparative Statement", 40, 30);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);
    let filterLine = [];
    if (filterFY) filterLine.push(`FY: ${filterFY}`);
    if (filterDate) filterLine.push(`Date: ${filterDate}`);
    if (filterLine.length) doc.text(`Filters - ${filterLine.join("  |  ")}`, 40, 44);
    const startY = filterLine.length ? 54 : 44;

    const headRow1 = [
      { content: "S.No",    rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Section", rowSpan: 2, styles: { halign: "left",   valign: "middle" } },
      { content: "Size",    rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Width",   rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Length",  rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Qty\n(MT)", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Purchase Reference", colSpan: 2, styles: { halign: "center", valign: "middle" } },
      ...suppliers.map(sup => ({
        content: sup,
        colSpan: 2,
        styles: { halign: "center", valign: "middle", fontStyle: "bold" },
      })),
      { content: "% vs\nLowest\nPurchase", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "% vs\nLast\nPurchase",   rowSpan: 2, styles: { halign: "center", valign: "middle" } },
    ];

    const headRow2 = [
      { content: "Lowest\nPurchase", styles: { halign: "center", valign: "middle" } },
      { content: "Last\nPurchase",   styles: { halign: "center", valign: "middle" } },
      ...suppliers.flatMap(() => [
        { content: "MT",      styles: { halign: "center", valign: "middle" } },
        { content: "Rate/MT", styles: { halign: "center", valign: "middle" } },
      ]),
    ];

    const fixedCols = 8;
    const lastCol  = fixedCols + suppliers.length * 2;
    const lastCol2 = lastCol + 1;

    const columnStyles = {
      0: { halign: "center", cellWidth: 18 },
      1: { halign: "left",   cellWidth: 34 },
      2: { halign: "center", cellWidth: 42 },
      3: { halign: "center", cellWidth: 26 },
      4: { halign: "center", cellWidth: 26 },
      5: { halign: "center", cellWidth: 22 },
      6: { halign: "center", cellWidth: 54 },
      7: { halign: "center", cellWidth: 54 },
      [lastCol]:  { halign: "center", cellWidth: 30 },
      [lastCol2]: { halign: "center", cellWidth: 30 },
    };
    for (let i = 0; i < suppliers.length; i++) {
      columnStyles[fixedCols + i * 2]     = { halign: "center", cellWidth: 22 };
      columnStyles[fixedCols + i * 2 + 1] = { halign: "center", cellWidth: 32 };
    }

    const cleanText = (text) => {
      if (!text) return "";
      return String(text)
        .replace(/[φΦ⌀∅Ø]/g, "dia.")
        .replace(/[^\x00-\x7F]/g, c => c === "₹" ? "Rs." : "");
    };

    const body = rows.map((row, idx) => {
      const pct        = formatPercent(row.minRate, row.lowestPurchaseRate);
      const pctNum     = pct     !== null ? parseFloat(pct)     : null;
      const pctLast    = formatPercent(row.minRate, row.lastPurchaseRate);
      const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;

      return [
        { content: idx + 1,                          styles: { halign: "center" } },
        { content: cleanText(row.section) || "-",    styles: { halign: "left"   } },
        { content: cleanText(row.size) || "-",       styles: { halign: "center", overflow: "visible", cellWidth: 42 } },
        { content: cleanText(row.width)  || "-",     styles: { halign: "center" } },
        { content: cleanText(row.length) || "-",     styles: { halign: "center" } },
        { content: formatMT(row.sectionMt),          styles: { halign: "center" } },
        {
          content: row.lowestPurchaseRate
            ? `${row.lowestPurchaseDate ? row.lowestPurchaseDate + "\n" : ""}${formatRate(Math.round(row.lowestPurchaseRate))}`
            : "",
          styles: { halign: "center" },
        },
        {
          content: row.lastPurchaseRate
            ? `${row.lastPurchaseDate ? row.lastPurchaseDate + "\n" : ""}${formatRate(Math.round(row.lastPurchaseRate))}`
            : "",
          styles: { halign: "center" },
        },
        ...suppliers.flatMap(sup => {
          const rateObj  = row.rates[sup];
          const rate     = rateObj ? rateObj.rate : null;
          const isLowest = rate != null && rate > 0 && rate === row.minRate;
          return [
            { content: rate > 0 ? formatMT(rateObj.mt) : "", styles: { halign: "center" } },
            {
              content: rate > 0 ? `${formatRate(rate)}${isLowest ? " *" : ""}` : "",
              styles: { halign: "center", fontStyle: isLowest ? "bold" : "normal" },
            },
          ];
        }),
        {
          content: pctNum !== null ? `${pctNum > 0 ? "+" : ""}${Math.abs(pctNum)}%` : "",
          styles: {
            halign: "center",
            textColor: pctNum !== null
              ? pctNum > 0 ? [220, 38, 38] : pctNum < 0 ? [22, 163, 74] : [100, 100, 100]
              : [150, 150, 150],
          },
        },
        {
          content: pctLastNum !== null ? `${pctLastNum > 0 ? "+" : ""}${Math.abs(pctLastNum)}%` : "",
          styles: {
            halign: "center",
            textColor: pctLastNum !== null
              ? pctLastNum > 0 ? [234, 88, 12] : pctLastNum < 0 ? [22, 163, 74] : [100, 100, 100]
              : [150, 150, 150],
          },
        },
      ];
    });

    const summaryRow = [
      { content: "", styles: { halign: "center" } },
      { content: "Total MT / Avg Rate", colSpan: 4, styles: { fontStyle: "bold", halign: "left" } },
      { content: qtyMtSummary.totalSectionMt > 0 ? formatMT(qtyMtSummary.totalSectionMt) : "", styles: { fontStyle: "bold", halign: "center" } },
      { content: qtyMtSummary.lowestPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg)) : "", styles: { fontStyle: "bold", halign: "center" } },
      { content: qtyMtSummary.lastPurchaseWeightedAvg   !== null ? formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg))   : "", styles: { fontStyle: "bold", halign: "center" } },
      ...suppliers.flatMap(sup => {
        let amt = 0, mt = 0;
        rows.forEach(r => {
          const o = r.rates[sup];
          if (o && o.rate > 0 && o.mt > 0) { amt += o.rate * o.mt; mt += o.mt; }
        });
        return [
          { content: mt > 0 ? formatMT(mt)                        : "", styles: { fontStyle: "bold", halign: "center" } },
          { content: mt > 0 ? formatRate(Math.round(amt / mt))    : "", styles: { fontStyle: "bold", halign: "center" } },
        ];
      }),
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
    ];

    autoTable(doc, {
      startY,
      head: [headRow1, headRow2],
      body: [...body, summaryRow],
      theme: "grid",
      styles: {
        fontSize: 6,
        halign: "center",
        valign: "middle",
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 6.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        halign: "center",
        valign: "middle",
        minCellHeight: 18,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles,
    });

    // ── L1 Summary PDF ─────────────────────────────────────────────────────────
    const l1Y = doc.lastAutoTable.finalY + 18;
    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    doc.setTextColor(0, 0, 0);
    doc.text("L1 Rate Summary", 40, l1Y);
    doc.setFont(undefined, "normal");

    const l1Head1 = [
      { content: "No.",                 rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Description of Item", rowSpan: 2, styles: { halign: "left",   valign: "middle" } },
      { content: "Mt.",                 rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      ...suppliers.map(sup => ({
        content: sup,
        colSpan: 3,
        styles: { halign: "center", valign: "middle", fontStyle: "bold" },
      })),
    ];

    const l1Head2 = [
      ...suppliers.flatMap(() => [
        { content: "Mt",     styles: { halign: "center", valign: "middle" } },
        { content: "Rate",   styles: { halign: "center", valign: "middle" } },
        { content: "Amount", styles: { halign: "center", valign: "middle" } },
      ]),
    ];

    const l1Body = l1Summary.rowDetails.map((r, i) => [
      { content: i + 1,                                        styles: { halign: "center" } },
      { content: cleanText(r.description) || "-",              styles: { halign: "left"   } },
      { content: r.totalMt > 0 ? formatMT(r.totalMt) : "-",   styles: { halign: "center" } },
      ...suppliers.flatMap(sup => {
        const d = r.supplierData[sup];
        const hasData = d && d.rate;
        return [
          { content: hasData ? formatMT(d.mt)        : "", styles: { halign: "center" } },
          { content: hasData ? formatRate(d.rate)     : "", styles: { halign: "center", fontStyle: hasData ? "bold" : "normal" } },
          { content: hasData ? formatAmount(d.amount) : "", styles: { halign: "center" } },
        ];
      }),
    ]);

    l1Body.push([
      { content: "",                    styles: { fontStyle: "bold", halign: "center" } },
      { content: "Total MT / Avg Rate", styles: { fontStyle: "bold", halign: "left"   } },
      {
        content: l1Summary.grandTotalMt > 0 ? formatMT(l1Summary.grandTotalMt) : "",
        styles: { fontStyle: "bold", halign: "center" },
      },
      ...suppliers.flatMap(sup => {
        const t = l1Summary.supplierTotals[sup];
        return [
          { content: t.totalMt > 0           ? formatMT(t.totalMt)                          : "", styles: { fontStyle: "bold", halign: "center" } },
          { content: t.weightedAvgRate != null ? formatRate(Math.round(t.weightedAvgRate))   : "", styles: { fontStyle: "bold", halign: "center" } },
          { content: t.totalAmount > 0        ? formatAmount(t.totalAmount)                  : "", styles: { fontStyle: "bold", halign: "center" } },
        ];
      }),
    ]);

    const l1ColStyles = {
      0: { halign: "center", cellWidth: 16 },
      1: { halign: "left",   cellWidth: 90 },
      2: { halign: "center", cellWidth: 24 },
    };
    suppliers.forEach((_, i) => {
      const base = 3 + i * 3;
      l1ColStyles[base]     = { halign: "center", cellWidth: 22 };
      l1ColStyles[base + 1] = { halign: "center", cellWidth: 30 };
      l1ColStyles[base + 2] = { halign: "center", cellWidth: 38 };
    });

    autoTable(doc, {
      startY: l1Y + 6,
      head: [l1Head1, l1Head2],
      body: l1Body,
      theme: "grid",
      styles: {
        fontSize: 6.5,
        halign: "center",
        valign: "middle",
        cellPadding: 1.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        overflow: "linebreak",
      },
      headStyles: {
        fillColor: [255, 255, 255],
        textColor: [0, 0, 0],
        fontStyle: "bold",
        fontSize: 6.5,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        halign: "center",
        valign: "middle",
        minCellHeight: 18,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles: l1ColStyles,
    });

    const filterSuffix = filterFY ? `_${filterFY}` : filterDate ? `_${filterDate}` : "";
    doc.save(`Comparative_Statement${filterSuffix}.pdf`);
  };

  // ── Export Excel ───────────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();
    const header1 = ["S.No", "Section", "Size", "Width", "Length", "Qty (MT)", "Lowest Purchase (Rs./MT)", "Last Purchase (Rs./MT)"];
    const header2 = ["", "", "", "", "", "", "", "Date | Rate"];
    suppliers.forEach(sup => { header1.push(sup, "", ""); header2.push("MT", "Rate (Rs./MT)", "Amount"); });
    header1.push("% vs Lowest Purchase", "% vs Last Purchase");
    header2.push("", "");

    const dataRows = rows.map((row, idx) => {
      const pct        = formatPercent(row.minRate, row.lowestPurchaseRate);
      const pctNum     = pct     !== null ? parseFloat(pct)     : null;
      const pctLast    = formatPercent(row.minRate, row.lastPurchaseRate);
      const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;
      const dr = [
        idx + 1, row.section || "", row.size || "", row.width || "", row.length || "",
        row.sectionMt ? formatMT(row.sectionMt) : "",
        row.lowestPurchaseRate ? `${row.lowestPurchaseDate ? row.lowestPurchaseDate + "  " : ""}${formatRate(Math.round(row.lowestPurchaseRate))}` : "",
        row.lastPurchaseRate   ? `${row.lastPurchaseDate   ? row.lastPurchaseDate   + "  " : ""}${formatRate(Math.round(row.lastPurchaseRate))}`   : "",
      ];
      suppliers.forEach(sup => {
        const rateObj = row.rates[sup];
        dr.push(
          rateObj && rateObj.rate > 0 ? formatMT(rateObj.mt)               : "",
          rateObj && rateObj.rate > 0 ? formatRate(rateObj.rate)            : "",
          rateObj && rateObj.rate > 0 ? formatAmount(rateObj.rate * rateObj.mt) : ""
        );
      });
      dr.push(
        pctNum     !== null ? `${pctNum     > 0 ? "+" : ""}${Math.abs(pctNum)}%`     : "",
        pctLastNum !== null ? `${pctLastNum > 0 ? "+" : ""}${Math.abs(pctLastNum)}%` : ""
      );
      return dr;
    });

    const summaryRow = [
      "", "Total MT / Avg Rate", "", "", "",
      qtyMtSummary.totalSectionMt > 0           ? formatMT(qtyMtSummary.totalSectionMt)                              : "",
      qtyMtSummary.lowestPurchaseWeightedAvg != null ? formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg)) : "",
      qtyMtSummary.lastPurchaseWeightedAvg   != null ? formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg))   : "",
    ];
    suppliers.forEach(sup => {
      let amt = 0, mt = 0;
      rows.forEach(r => { const o = r.rates[sup]; if (o && o.rate > 0 && o.mt > 0) { amt += o.rate * o.mt; mt += o.mt; } });
      summaryRow.push(mt > 0 ? formatMT(mt) : "", mt > 0 ? formatRate(Math.round(amt / mt)) : "", "");
    });
    summaryRow.push("", "");

    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...dataRows, summaryRow]);
    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } }, { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } }, { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },
      { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } }, { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },
      { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } }, { s: { r: 0, c: 7 }, e: { r: 1, c: 7 } },
    ];
    let col = 8;
    suppliers.forEach(() => { merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 2 } }); col += 3; });
    merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });
    merges.push({ s: { r: 0, c: col + 1 }, e: { r: 1, c: col + 1 } });
    ws["!merges"] = merges;
    ws["!freeze"] = { ySplit: 2 };
    const colWidths = [6, 16, 12, 10, 10, 10, 18, 24];
    suppliers.forEach(() => { colWidths.push(10, 16, 14); });
    colWidths.push(16, 16);
    ws["!cols"] = colWidths.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, ws, "Comparative Statement");

    // ── L1 Summary Excel sheet ─────────────────────────────────────────────────
    const l1H1 = ["No.", "Description of Item", "Mt."];
    const l1H2 = ["", "", ""];
    suppliers.forEach(sup => { l1H1.push(sup, "", ""); l1H2.push("Mt", "Rate", "Amount"); });

    const l1DataRows = l1Summary.rowDetails.map((r, i) => {
      const dr = [i + 1, r.description || "", r.totalMt > 0 ? formatMT(r.totalMt) : ""];
      suppliers.forEach(sup => {
        const d = r.supplierData[sup];
        const hasData = d && d.rate;
        dr.push(hasData ? formatMT(d.mt) : "", hasData ? formatRate(d.rate) : "", hasData ? formatAmount(d.amount) : "");
      });
      return dr;
    });

    const l1TotRow = ["", "Total MT / Avg Rate", l1Summary.grandTotalMt > 0 ? formatMT(l1Summary.grandTotalMt) : ""];
    suppliers.forEach(sup => {
      const t = l1Summary.supplierTotals[sup];
      l1TotRow.push(
        t.totalMt > 0           ? formatMT(t.totalMt)                          : "",
        t.weightedAvgRate != null ? formatRate(Math.round(t.weightedAvgRate))   : "",
        t.totalAmount > 0        ? formatAmount(t.totalAmount)                  : ""
      );
    });

    const wsL1 = XLSX.utils.aoa_to_sheet([l1H1, l1H2, ...l1DataRows, l1TotRow]);
    const l1Merges = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
    ];
    let lc = 3;
    suppliers.forEach(() => { l1Merges.push({ s: { r: 0, c: lc }, e: { r: 0, c: lc + 2 } }); lc += 3; });
    wsL1["!merges"] = l1Merges;
    wsL1["!freeze"] = { ySplit: 2 };
    const l1ColW = [6, 32, 10];
    suppliers.forEach(() => { l1ColW.push(10, 14, 16); });
    wsL1["!cols"] = l1ColW.map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsL1, "L1 Summary");

    const filterSuffix = filterFY ? `_${filterFY}` : filterDate ? `_${filterDate}` : "";
    XLSX.writeFile(wb, `Comparative_Statement${filterSuffix}.xlsx`);
  };

  return (
    <div className="cs-page">
      {/* ── Header ── */}
      <div className="cs-header">
        <div className="cs-header-left">
          <h1 className="cs-title">Comparative Statement</h1>
          <p className="cs-subtitle">Supplier rate comparison across enquiry entries</p>
        </div>
        <div className="cs-header-right">
          <button className="btn-export btn-pdf"   onClick={exportPDF}   disabled={rows.length === 0}>Export PDF</button>
          <button className="btn-export btn-excel" onClick={exportExcel} disabled={rows.length === 0}>Export Excel</button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="cs-filters">
        <div className="cs-filter-group">
          <label className="cs-filter-label">Financial Year</label>
          <select className="cs-filter-select" value={filterFY}
            onChange={e => { setFilterFY(e.target.value); setFilterEnquiryNo(""); setFilterDate(""); }}>
            <option value="">All Years</option>
            {uniqueFYs.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
        </div>
        <div className="cs-filter-group">
          <label className="cs-filter-label">Enquiry No</label>
          <select className="cs-filter-select" value={filterEnquiryNo}
            onChange={e => { setFilterEnquiryNo(e.target.value); setFilterDate(""); }}>
            <option value="">All Enquiries</option>
            {uniqueEnquiryNos.map(no => <option key={no} value={no}>Enquiry #{no}</option>)}
          </select>
        </div>
        <div className="cs-filter-group">
          <label className="cs-filter-label">Start Date</label>
          <input
            type="date"
            className="cs-filter-select"
            value={filterDate}
            onChange={e => { setFilterDate(e.target.value); setFilterEnquiryNo(""); }}
          />
        </div>
        <div className="cs-filter-group">
          <label className="cs-filter-label">End Date</label>
          <input
            type="date"
            className="cs-filter-select"
            value={filterEndDate}
            onChange={e => { setFilterEndDate(e.target.value); setFilterEnquiryNo(""); }}
          />
        </div>
        {(filterFY || filterEnquiryNo || filterDate || filterEndDate) && (
          <button className="cs-clear-btn" onClick={() => { setFilterFY(""); setFilterEnquiryNo(""); setFilterDate(""); setFilterEndDate(""); }}>
            ✕ Clear Filters
          </button>
        )}
      </div>

      {/* ── Main Comparative Table ── */}
      {loading ? (
        <div className="cs-loading"><div className="cs-spinner" /><p>Loading enquiry data…</p></div>
      ) : rows.length === 0 ? (
        <div className="cs-empty"><div className="cs-empty-icon">📋</div><p>No enquiry entries found for the selected filters.</p></div>
      ) : (
        <div className="cs-table-wrapper">
          <table className="cs-table">
            <thead>
              <tr className="cs-thead-row">
                <th className="cs-th cs-th-sticky cs-th-sno"     rowSpan={2}>S.No</th>
                <th className="cs-th cs-th-sticky cs-th-section" rowSpan={2}>Section</th>
                <th className="cs-th cs-th-sticky cs-th-size"    rowSpan={2}>Size</th>
                <th className="cs-th cs-th-sticky cs-th-size"    rowSpan={2}>Width</th>
                <th className="cs-th cs-th-sticky cs-th-size"    rowSpan={2}>Length</th>
                <th className="cs-th cs-th-sticky cs-th-mt"      rowSpan={2}>Qty (MT)</th>
                <th className="cs-th cs-th-purchase" colSpan={2}>Purchase Reference</th>
                {suppliers.map(sup => (
                  <th key={sup} className="cs-th cs-th-supplier" colSpan={2}>
                    <div className="cs-supplier-name">{sup}</div>
                  </th>
                ))}
                <th className="cs-th cs-th-pct" rowSpan={2}>% Increase<br /><span className="cs-th-pct-sub">vs Lowest Purchase</span></th>
                <th className="cs-th cs-th-pct-last" rowSpan={2}>% Increase<br /><span className="cs-th-pct-sub">vs Last Purchase</span></th>
              </tr>
              <tr className="cs-thead-subrow">
                <th className="cs-th cs-th-purchase-sub">Lowest Purchase<br /><span className="cs-th-sub-label">(₹/MT)</span></th>
                <th className="cs-th cs-th-purchase-sub">Last Purchase<br /><span className="cs-th-sub-label">(₹/MT)</span></th>
                {suppliers.map(sup => (
                  <>
                    <th key={`${sup}-mt`}   className="cs-th cs-th-supplier-sub">MT</th>
                    <th key={`${sup}-rate`} className="cs-th cs-th-supplier-sub">Rate (₹/MT)</th>
                  </>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => {
                const pct        = formatPercent(row.minRate, row.lowestPurchaseRate);
                const pctNum     = pct     !== null ? parseFloat(pct)     : null;
                const pctLast    = formatPercent(row.minRate, row.lastPurchaseRate);
                const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;
                return (
                  <tr key={`${row.section}-${row.size}-${row.width}-${row.length}-${idx}`} className="cs-tr">
                    <td className="cs-td cs-td-sticky cs-td-sno">{idx + 1}</td>
                    <td className="cs-td cs-td-sticky cs-td-section">
                      <span className="cs-section-tag">{row.section || "—"}</span>
                    </td>
                    <td className="cs-td cs-td-sticky cs-td-size">{row.size   || <span className="cs-na">—</span>}</td>
                    <td className="cs-td cs-td-sticky cs-td-size">{row.width  || <span className="cs-na">—</span>}</td>
                    <td className="cs-td cs-td-sticky cs-td-size">{row.length || <span className="cs-na">—</span>}</td>
                    <td className="cs-td cs-td-sticky cs-td-mt">{formatMT(row.sectionMt)}</td>
                    <td className="cs-td cs-td-purchase">
                      {row.lowestPurchaseRate ? (
                        <div className="cs-last-purchase-cell">
                          {row.lowestPurchaseDate && <span className="cs-purchase-date">{row.lowestPurchaseDate}</span>}
                          <span className="cs-purchase-rate">₹ {formatRate(Math.round(row.lowestPurchaseRate))}</span>
                        </div>
                      ) : null}
                    </td>
                    <td className="cs-td cs-td-purchase">
                      {row.lastPurchaseRate ? (
                        <div className="cs-last-purchase-cell">
                          {row.lastPurchaseDate && <span className="cs-purchase-date">{row.lastPurchaseDate}</span>}
                          <span className="cs-purchase-rate">₹ {formatRate(Math.round(row.lastPurchaseRate))}</span>
                        </div>
                      ) : null}
                    </td>
                    {suppliers.map(sup => {
                      const rateObj    = row.rates[sup];
                      const rate       = rateObj ? rateObj.rate : null;
                      const supplierMt = rateObj ? rateObj.mt   : null;
                      const isLowest   = rate != null && rate > 0 && rate === row.minRate;
                      return (
                        <>
                          <td key={`${sup}-mt`}
                            className={`cs-td cs-td-supplier-mt${isLowest ? " cs-td-lowest" : ""}${!rate ? " cs-td-empty" : ""}`}>
                            {rate > 0 ? <span className="cs-rate-mt">{formatMT(supplierMt)}</span> : null}
                          </td>
                          <td key={`${sup}-rate`}
                            className={`cs-td cs-td-rate${isLowest ? " cs-td-lowest" : ""}${!rate ? " cs-td-empty" : ""}`}>
                            {rate > 0 ? (
                              <div className="cs-rate-cell">
                                <span className="cs-rate-value">₹ {formatRate(rate)}</span>
                                {isLowest && <span className="cs-lowest-badge">Lowest</span>}
                              </div>
                            ) : null}
                          </td>
                        </>
                      );
                    })}
                    <td className={`cs-td cs-td-pct${pctNum !== null ? (pctNum > 0 ? " cs-td-pct--up" : pctNum < 0 ? " cs-td-pct--down" : " cs-td-pct--flat") : ""}`}>
                      {pctNum !== null
                        ? <span className="cs-pct-value">{pctNum > 0 ? "+" : ""}{Math.abs(pctNum)}%</span>
                        : <span className="cs-no-quote">—</span>}
                    </td>
                    <td className={`cs-td cs-td-pct-last${pctLastNum !== null ? (pctLastNum > 0 ? " cs-td-pct-last--up" : pctLastNum < 0 ? " cs-td-pct-last--down" : " cs-td-pct-last--flat") : ""}`}>
                      {pctLastNum !== null
                        ? <span className="cs-pct-value">{pctLastNum > 0 ? "+" : ""}{Math.abs(pctLastNum)}%</span>
                        : <span className="cs-no-quote">—</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="cs-tr cs-tr-summary">
                <td className="cs-td cs-td-sticky cs-td-sno" />
                <td className="cs-td cs-td-sticky cs-td-section cs-summary-label" colSpan={4}>
                  Total MT / Avg Rate
                </td>
                <td className="cs-td cs-td-sticky cs-td-mt cs-summary-total-mt">
                  <span className="cs-avg-value">{qtyMtSummary.totalSectionMt > 0 ? formatMT(qtyMtSummary.totalSectionMt) : "—"}</span>
                </td>
                <td className="cs-td cs-td-purchase cs-qty-mt-purchase">
                  {qtyMtSummary.lowestPurchaseWeightedAvg !== null
                    ? <span className="cs-avg-value">₹ {formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg))}</span>
                    : null}
                </td>
                <td className="cs-td cs-td-purchase cs-qty-mt-purchase">
                  {qtyMtSummary.lastPurchaseWeightedAvg !== null
                    ? <span className="cs-avg-value">₹ {formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg))}</span>
                    : null}
                </td>
                {suppliers.map(sup => {
                  let amt = 0, mt = 0;
                  rows.forEach(r => { const o = r.rates[sup]; if (o && o.rate > 0 && o.mt > 0) { amt += o.rate * o.mt; mt += o.mt; } });
                  return (
                    <>
                      <td key={`${sup}-sum-mt`} className="cs-td cs-td-supplier-mt">
                        {mt > 0 ? <span className="cs-rate-mt">{formatMT(mt)}</span> : null}
                      </td>
                      <td key={`${sup}-sum-rate`} className="cs-td cs-td-rate cs-td-avg-rate">
                        {mt > 0 ? <span className="cs-avg-value">₹ {formatRate(Math.round(amt / mt))}</span> : null}
                      </td>
                    </>
                  );
                })}
                <td className="cs-td cs-td-pct" />
                <td className="cs-td cs-td-pct-last" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* ── L1 Rate Summary ── */}
      {!loading && rows.length > 0 && (
        <div className="cs-l1-section">
          <div className="cs-l1-header">
            <span className="cs-l1-badge">L1</span>
            <h2 className="cs-l1-title">L1 Rate Summary</h2>
          </div>
          <div className="cs-l1-table-wrap">
            <table className="cs-l1-table">
              <thead>
                <tr>
                  <th className="cs-l1-th cs-l1-th-no"   rowSpan={2}>No.</th>
                  <th className="cs-l1-th cs-l1-th-desc" rowSpan={2}>Description of Item</th>
                  <th className="cs-l1-th cs-l1-th-mt"   rowSpan={2}>Mt.</th>
                  {suppliers.map(sup => (
                    <th key={sup} className="cs-l1-th cs-l1-th-supplier" colSpan={3} style={{ textAlign: "center" }}>{sup}</th>
                  ))}
                </tr>
                <tr>
                  {suppliers.map(sup => (
                    <>
                      <th key={`${sup}-mt`}  className="cs-l1-th cs-l1-th-sub">Mt</th>
                      <th key={`${sup}-rate`} className="cs-l1-th cs-l1-th-sub">Rate</th>
                      <th key={`${sup}-amt`}  className="cs-l1-th cs-l1-th-sub">Amount</th>
                    </>
                  ))}
                </tr>
              </thead>
              <tbody>
                {l1Summary.rowDetails.map((r, i) => (
                  <tr key={i} className="cs-l1-tr">
                    <td className="cs-l1-sno">{i + 1}</td>
                    <td className="cs-l1-desc">{r.description || "—"}</td>
                    <td className="cs-l1-num">{r.totalMt > 0 ? formatMT(r.totalMt) : "—"}</td>
                    {suppliers.map(sup => {
                      const d = r.supplierData[sup];
                      const hasData = d && d.rate;
                      return (
                        <>
                          <td key={`${sup}-mt`}
                            className={`cs-l1-num${hasData ? " cs-l1-cell-active" : " cs-l1-cell-empty"}`}>
                            {hasData ? formatMT(d.mt) : ""}
                          </td>
                          <td key={`${sup}-rate`}
                            className={`cs-l1-num cs-l1-rate-col${hasData ? " cs-l1-cell-active cs-l1-cell-bold" : " cs-l1-cell-empty"}`}>
                            {hasData ? formatRate(d.rate) : ""}
                          </td>
                          <td key={`${sup}-amt`}
                            className={`cs-l1-num cs-l1-amount-col${hasData ? " cs-l1-cell-active" : " cs-l1-cell-empty"}`}>
                            {hasData ? formatAmount(d.amount) : ""}
                          </td>
                        </>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="cs-l1-totals">
                  <td className="cs-l1-sno" />
                  <td className="cs-l1-totals-label">Total MT / Avg Rate</td>
                  <td className="cs-l1-num cs-l1-totals-grand-mt">
                    {l1Summary.grandTotalMt > 0 ? formatMT(l1Summary.grandTotalMt) : "—"}
                  </td>
                  {suppliers.map(sup => {
                    const t = l1Summary.supplierTotals[sup];
                    return (
                      <>
                        <td key={`${sup}-tot-mt`}   className="cs-l1-num cs-l1-totals-val">
                          {t.totalMt > 0 ? formatMT(t.totalMt) : "—"}
                        </td>
                        <td key={`${sup}-tot-rate`} className="cs-l1-num cs-l1-totals-avg">
                          {t.weightedAvgRate != null ? formatRate(Math.round(t.weightedAvgRate)) : "—"}
                        </td>
                        <td key={`${sup}-tot-amt`}  className="cs-l1-num cs-l1-totals-amt">
                          {t.totalAmount > 0 ? formatAmount(t.totalAmount) : "—"}
                        </td>
                      </>
                    );
                  })}
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
