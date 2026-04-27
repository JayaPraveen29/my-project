import { useState, useEffect } from "react";
import { db } from "../../firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import EnquiryManager from "../EnquiryManager/EnquiryManager";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";
import "./ComparativeStatement.css";

export default function ComparativeStatement() {
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [purchaseEntries, setPurchaseEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showManager, setShowManager] = useState(false);

  // Filters
  const [filterFY, setFilterFY] = useState("");
  const [filterEnquiryNo, setFilterEnquiryNo] = useState("");
  const [filterDate, setFilterDate] = useState("");

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

  useEffect(() => {
    fetchEntries();
  }, []);

  // ── Apply filters ──────────────────────────────────────────────────────────
  useEffect(() => {
    let result = [...allEntries];
    if (filterFY) result = result.filter(e => e.FinancialYear === filterFY);
    if (filterEnquiryNo) result = result.filter(e => String(e.No) === String(filterEnquiryNo));
    if (filterDate) result = result.filter(e => e.EnquiryDate === filterDate);
    setFilteredEntries(result);
  }, [filterFY, filterEnquiryNo, filterDate, allEntries]);

  // ── Build purchase rate lookup: { "Section||Size" -> { lowestRate, lowestDate, lastRate, lastDate } }
  const buildPurchaseLookup = () => {
    const lookup = new Map();

    purchaseEntries.forEach(entry => {
      const billDate = entry["Bill Date"] || entry["Received On"] || "";
      (entry.items || []).forEach(item => {
        const section = item.Section || "";
        const size = item.Size || "";
        const rate = parseFloat(item["Item Per Rate"]) || 0;
        if (!section || !rate) return;
        const key = `${section}||${size}`;

        if (!lookup.has(key)) {
          lookup.set(key, { lowestRate: rate, lowestDate: billDate, lastRate: rate, lastDate: billDate, lastNo: entry.No });
        } else {
          const existing = lookup.get(key);
          if (rate < existing.lowestRate) {
            existing.lowestRate = rate;
            existing.lowestDate = billDate;
          }
          if (entry.No > existing.lastNo) {
            existing.lastRate = rate;
            existing.lastDate = billDate;
            existing.lastNo = entry.No;
          }
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
            section,
            size,
            width,
            length,
            sectionMt,
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
            row.rates[supplierKey] = {
              rate,
              mt: supplierMt,
              entryNo: entry.No,
              enquiryDate: entry.EnquiryDate || "",
            };
          }
        });
      });
    });

    const rows = Array.from(rowMap.values()).map(row => {
      const quotedRates = Object.values(row.rates)
        .map(r => r.rate)
        .filter(r => r > 0);
      const minRate = quotedRates.length ? Math.min(...quotedRates) : null;
      return { ...row, minRate };
    });

    return { suppliers, rows };
  };

  const { suppliers, rows } = buildTableData();

  // ── L1 Summary (outside table) ─────────────────────────────────────────────
  // For each row: L1 rate = minRate, L1 qty = MT of the supplier who quoted L1
  // L1 Amount = L1 Rate × L1 Qty
  // Totals: Sum(L1 Amount) / Sum(L1 Qty) = Weighted Avg L1 Rate
  const buildL1Summary = () => {
    const rowDetails = rows.map((row, idx) => {
      // Find the supplier entry whose rate === minRate
      const l1Rate = row.minRate;
      let l1Qty = 0;
      let l1Supplier = "";
      if (l1Rate) {
        for (const [sup, rateObj] of Object.entries(row.rates)) {
          if (rateObj.rate === l1Rate) {
            l1Qty = rateObj.mt || 0;
            l1Supplier = sup;
            break;
          }
        }
      }
      const l1Amount = l1Rate && l1Qty ? l1Rate * l1Qty : 0;
      return { idx, section: row.section, size: row.size, width: row.width, length: row.length, l1Rate, l1Qty, l1Amount, l1Supplier };
    });

    const totalL1Qty    = rowDetails.reduce((s, r) => s + r.l1Qty, 0);
    const totalL1Amount = rowDetails.reduce((s, r) => s + r.l1Amount, 0);
    const weightedAvgL1 = totalL1Qty > 0 ? totalL1Amount / totalL1Qty : null;

    return { rowDetails, totalL1Qty, totalL1Amount, weightedAvgL1 };
  };

  const l1Summary = buildL1Summary();

  // Display with Indian comma formatting, decimals only if present in the value
  const formatNum = (val) => {
    if (val == null || val === "" || val === 0) return "—";
    const num = parseFloat(val);
    if (isNaN(num) || num === 0) return "—";
    const str = num.toString();
    const decimalPlaces = str.includes(".") ? str.split(".")[1].length : 0;
    return num.toLocaleString("en-IN", {
      minimumFractionDigits: 0,
      maximumFractionDigits: decimalPlaces,
    });
  };

  const formatRate = formatNum;
  const formatMT = formatNum;

  const formatPercent = (newRate, baseRate) => {
    if (!newRate || !baseRate || baseRate === 0) return null;
    return (((newRate - baseRate) / baseRate) * 100).toFixed(2);
  };

  const uniqueFYs = [...new Set(allEntries.map(e => e.FinancialYear).filter(Boolean))].sort();
  const uniqueEnquiryNos = [...new Set(allEntries.map(e => e.No).filter(v => v != null))].sort((a, b) => a - b);
  const uniqueDates = [...new Set(allEntries.map(e => e.EnquiryDate).filter(Boolean))].sort();

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF("l", "pt", "a4");

    // Title
    doc.setFontSize(13);
    doc.setFont(undefined, "bold");
    doc.text("Comparative Statement", 40, 30);
    doc.setFont(undefined, "normal");
    doc.setFontSize(9);

    let filterLine = [];
    if (filterFY) filterLine.push(`FY: ${filterFY}`);
    if (filterDate) filterLine.push(`Date: ${filterDate}`);
    if (filterLine.length) {
      doc.text(`Filters - ${filterLine.join("  |  ")}`, 40, 44);
    }

    const startY = filterLine.length ? 54 : 44;

    // Build header rows — no currency symbols, plain text only
    const headRow1 = [
      { content: "S.No", rowSpan: 2 },
      { content: "Section", rowSpan: 2 },
      { content: "Size", rowSpan: 2 },
      { content: "Width", rowSpan: 2 },
      { content: "Length", rowSpan: 2 },
      { content: "Qty (MT)", rowSpan: 2 },
      { content: "Purchase Reference", colSpan: 2 },
      ...suppliers.map(sup => ({ content: sup, colSpan: 2 })),
      { content: "%  vs Lowest Purchase", rowSpan: 2 },
      { content: "%  vs Last Purchase", rowSpan: 2 },
    ];

    const headRow2 = [
      { content: "Lowest Purchase" },
      { content: "Last Purchase" },
      ...suppliers.flatMap(() => [
        { content: "MT" },
        { content: "Rate/MT" },
      ]),
    ];

    // Column index mapping for columnStyles
    // 0=SNo,1=Section,2=Size,3=Width,4=Length,5=Qty,6=LowestPurch,7=LastPurch,
    // then pairs of (MT,Rate) for each supplier, last col = %
    const fixedCols = 8;
    const lastCol = fixedCols + suppliers.length * 2;      // % vs Lowest
    const lastCol2 = lastCol + 1;                           // % vs Last

    // Build columnStyles: right-align all numeric cols
    const columnStyles = {
      0: { halign: "center" },
      1: { halign: "left" },
      2: { halign: "left" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right" },
      7: { halign: "right" },
      [lastCol]: { halign: "center", cellWidth: 28 },
      [lastCol2]: { halign: "center", cellWidth: 28 },
    };
    for (let i = 0; i < suppliers.length; i++) {
      const mtCol = fixedCols + i * 2;
      const rateCol = mtCol + 1;
      columnStyles[mtCol] = { halign: "right" };
      columnStyles[rateCol] = { halign: "right" };
    }

    // Build body rows — plain numbers only, no currency prefix
    const body = rows.map((row, idx) => {
      const pct = formatPercent(row.minRate, row.lowestPurchaseRate);
      const pctNum = pct !== null ? parseFloat(pct) : null;
      const pctText = pctNum !== null
        ? `${pctNum > 0 ? "+" : ""}${Math.abs(pctNum)}%`
        : "";

      const pctLast = formatPercent(row.minRate, row.lastPurchaseRate);
      const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;
      const pctLastText = pctLastNum !== null
        ? `${pctLastNum > 0 ? "+" : ""}${Math.abs(pctLastNum)}%`
        : "";

      // Replace diameter/phi symbol with plain "dia." for PDF compatibility
      const cleanText = (text) => {
        if (!text) return "";
        return String(text)
          .replace(/[φΦ⌀∅Ø]/g, "dia.")
          .replace(/[^\x00-\x7F]/g, (c) => {
            // keep ₹ as Rs., keep common chars
            if (c === "₹") return "Rs.";
            return "";
          });
      };

      const bodyRow = [
        idx + 1,
        cleanText(row.section) || "-",
        cleanText(row.size) || "-",
        cleanText(row.width) || "-",
        cleanText(row.length) || "-",
        formatMT(row.sectionMt),
        row.lowestPurchaseRate
          ? `${row.lowestPurchaseDate ? row.lowestPurchaseDate + "  " : ""}${formatRate(row.lowestPurchaseRate)}`
          : "",
        row.lastPurchaseRate
          ? `${row.lastPurchaseDate ? row.lastPurchaseDate + "  " : ""}${formatRate(row.lastPurchaseRate)}`
          : "",
        ...suppliers.flatMap(sup => {
          const rateObj = row.rates[sup];
          const rate = rateObj ? rateObj.rate : null;
          const supplierMt = rateObj ? rateObj.mt : null;
          const isLowest = rate != null && rate > 0 && rate === row.minRate;
          return [
            {
              content: rate > 0 ? formatMT(supplierMt) : "",
              styles: { fillColor: isLowest ? [220, 252, 231] : undefined },
            },
            {
              content: rate > 0 ? `${formatRate(rate)}${isLowest ? " *" : ""}` : "",
              styles: {
                fillColor: isLowest ? [220, 252, 231] : undefined,
                fontStyle: isLowest ? "bold" : "normal",
              },
            },
          ];
        }),
        {
          content: pctText,
          styles: {
            textColor:
              pctNum !== null
                ? pctNum > 0
                  ? [220, 38, 38]
                  : pctNum < 0
                  ? [22, 163, 74]
                  : [100, 100, 100]
                : [150, 150, 150],
          },
        },
        {
          content: pctLastText,
          styles: {
            textColor:
              pctLastNum !== null
                ? pctLastNum > 0
                  ? [234, 88, 12]
                  : pctLastNum < 0
                  ? [22, 163, 74]
                  : [100, 100, 100]
                : [150, 150, 150],
          },
        },
      ];
      return bodyRow;
    });

    // ── Average Rate row ───────────────────────────────────────────────────────
    // Formula: Weighted Average Rate = Sum(Rate × MT) / Sum(MT)  — same as reference file
    const avgRow = [
      { content: "", styles: { fontStyle: "bold" } },
      { content: "Weighted Avg Rate", colSpan: 5, styles: { fontStyle: "bold", halign: "right", fillColor: [241, 245, 249] } },
      { content: "", styles: { fillColor: [241, 245, 249] } }, // Lowest Purchase
      { content: "", styles: { fillColor: [241, 245, 249] } }, // Last Purchase
      ...suppliers.flatMap(sup => {
        let totalAmount = 0;
        let totalMt = 0;
        rows.forEach(row => {
          const rateObj = row.rates[sup];
          if (rateObj && rateObj.rate > 0 && rateObj.mt > 0) {
            totalAmount += rateObj.rate * rateObj.mt;
            totalMt += rateObj.mt;
          }
        });
        const weightedAvg = totalMt > 0 ? totalAmount / totalMt : null;
        return [
          { content: totalMt > 0 ? formatMT(totalMt) : "", styles: { fillColor: [241, 245, 249], fontStyle: "bold", textColor: [100, 116, 139] } },
          {
            content: weightedAvg !== null ? formatRate(Math.round(weightedAvg)) : "",
            styles: {
              fillColor: [241, 245, 249],
              fontStyle: "bold",
              textColor: [30, 64, 175],
            },
          },
        ];
      }),
      { content: "", styles: { fillColor: [241, 245, 249] } }, // % vs Lowest col
      { content: "", styles: { fillColor: [241, 245, 249] } }, // % vs Last col
    ];

    autoTable(doc, {
      startY,
      head: [headRow1, headRow2],
      body: [...body, avgRow],
      theme: "grid",
      styles: { fontSize: 6, halign: "center", valign: "middle", cellPadding: 1.5 },
      headStyles: {
        fillColor: [99, 102, 241],
        textColor: [255, 255, 255],
        fontStyle: "bold",
        fontSize: 6,
      },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles,
    });

    // ── L1 Summary section (below the table) ──────────────────────────────────
    const l1Y = doc.lastAutoTable.finalY + 18;
    doc.setFontSize(9);
    doc.setFont(undefined, "bold");
    doc.setTextColor(30, 64, 175);
    doc.text("L1 Rate Summary", 40, l1Y);
    doc.setFont(undefined, "normal");
    doc.setTextColor(0, 0, 0);

    const l1Head = [["S.No", "Section", "Size", "Width", "Length", "L1 Supplier", "L1 Qty (MT)", "L1 Rate (Rs./MT)", "L1 Amount (Rs.)"]];
    const l1Body = l1Summary.rowDetails.map((r, i) => [
      i + 1,
      r.section || "-",
      r.size || "-",
      r.width || "-",
      r.length || "-",
      r.l1Supplier || "-",
      r.l1Qty > 0 ? formatMT(r.l1Qty) : "-",
      r.l1Rate  > 0 ? formatRate(r.l1Rate)  : "-",
      r.l1Amount > 0 ? formatRate(Math.round(r.l1Amount)) : "-",
    ]);

    // Totals row
    l1Body.push([
      { content: "", styles: { fontStyle: "bold" } },
      { content: "Total / Wtd Avg", colSpan: 5, styles: { fontStyle: "bold", halign: "right", fillColor: [239, 246, 255] } },
      {
        content: l1Summary.totalL1Qty > 0 ? formatMT(l1Summary.totalL1Qty) : "-",
        styles: { fontStyle: "bold", fillColor: [239, 246, 255] },
      },
      {
        content: l1Summary.weightedAvgL1 !== null ? formatRate(Math.round(l1Summary.weightedAvgL1)) : "-",
        styles: { fontStyle: "bold", fillColor: [239, 246, 255], textColor: [30, 64, 175] },
      },
      {
        content: l1Summary.totalL1Amount > 0 ? formatRate(Math.round(l1Summary.totalL1Amount)) : "-",
        styles: { fontStyle: "bold", fillColor: [239, 246, 255], textColor: [30, 64, 175] },
      },
    ]);

    autoTable(doc, {
      startY: l1Y + 6,
      head: l1Head,
      body: l1Body,
      theme: "grid",
      styles: { fontSize: 7, halign: "right", valign: "middle", cellPadding: 2 },
      headStyles: { fillColor: [30, 64, 175], textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7 },
      alternateRowStyles: { fillColor: [248, 250, 252] },
      columnStyles: {
        0: { halign: "center", cellWidth: 22 },
        1: { halign: "left" },
        2: { halign: "left" },
        3: { halign: "right" },
        4: { halign: "right" },
        5: { halign: "left" },
        6: { halign: "right" },
        7: { halign: "right" },
        8: { halign: "right" },
      },
    });

    const filterSuffix = filterFY ? `_${filterFY}` : filterDate ? `_${filterDate}` : "";
    doc.save(`Comparative_Statement${filterSuffix}.pdf`);
  };

  // ── Export Excel ───────────────────────────────────────────────────────────
  const exportExcel = () => {
    const wb = XLSX.utils.book_new();

    // Build header rows
    const header1 = ["S.No", "Section", "Size", "Width", "Length", "Qty (MT)", "Lowest Purchase (Rs./MT)", "Last Purchase (Rs./MT)"];
    const header2 = ["", "", "", "", "", "", "", "Date | Rate"];

    suppliers.forEach(sup => {
      header1.push(sup, "");
      header2.push("MT", "Rate (Rs./MT)");
    });
    header1.push("% vs Lowest Purchase", "% vs Last Purchase");
    header2.push("", "");

    // Build data rows — all values pushed as formatted strings to match PDF output exactly
    const dataRows = rows.map((row, idx) => {
      const pct = formatPercent(row.minRate, row.lowestPurchaseRate);
      const pctNum = pct !== null ? parseFloat(pct) : null;
      const pctLast = formatPercent(row.minRate, row.lastPurchaseRate);
      const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;

      const dataRow = [
        idx + 1,
        row.section || "",
        row.size || "",
        row.width || "",
        row.length || "",
        row.sectionMt ? formatMT(row.sectionMt) : "",
        row.lowestPurchaseRate
          ? `${row.lowestPurchaseDate ? row.lowestPurchaseDate + "  " : ""}${formatRate(row.lowestPurchaseRate)}`
          : "",
        row.lastPurchaseRate
          ? `${row.lastPurchaseDate ? row.lastPurchaseDate + "  " : ""}${formatRate(row.lastPurchaseRate)}`
          : "",
      ];

      suppliers.forEach(sup => {
        const rateObj = row.rates[sup];
        dataRow.push(
          rateObj && rateObj.rate > 0 ? formatMT(rateObj.mt) : "",
          rateObj && rateObj.rate > 0 ? formatRate(rateObj.rate) : ""
        );
      });

      dataRow.push(
        pctNum !== null ? `${pctNum > 0 ? "+" : ""}${Math.abs(pctNum)}%` : "",
        pctLastNum !== null ? `${pctLastNum > 0 ? "+" : ""}${Math.abs(pctLastNum)}%` : ""
      );
      return dataRow;
    });

    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...dataRows]);

    // Merges for supplier column pairs in header row 1
    const merges = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },  // S.No
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },  // Section
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },  // Size
      { s: { r: 0, c: 3 }, e: { r: 1, c: 3 } },  // Width
      { s: { r: 0, c: 4 }, e: { r: 1, c: 4 } },  // Length
      { s: { r: 0, c: 5 }, e: { r: 1, c: 5 } },  // Qty (MT)
      { s: { r: 0, c: 6 }, e: { r: 1, c: 6 } },  // Lowest Purchase
      { s: { r: 0, c: 7 }, e: { r: 1, c: 7 } },  // Last Purchase
    ];

    let col = 8;
    suppliers.forEach(() => {
      merges.push({ s: { r: 0, c: col }, e: { r: 0, c: col + 1 } });
      col += 2;
    });
    // % Increase columns (both merge across row 0 and 1)
    merges.push({ s: { r: 0, c: col }, e: { r: 1, c: col } });       // % vs Lowest
    merges.push({ s: { r: 0, c: col + 1 }, e: { r: 1, c: col + 1 } }); // % vs Last

    ws["!merges"] = merges;
    ws["!freeze"] = { ySplit: 2 };

    // Column widths
    const colWidths = [6, 16, 12, 10, 10, 10, 18, 24];
    suppliers.forEach(() => { colWidths.push(10, 16); });
    colWidths.push(16, 16); // both % columns
    ws["!cols"] = colWidths.map(w => ({ wch: w }));

    // Apply alignment to data cells (all values are strings — no number format needed)
    const range = XLSX.utils.decode_range(ws["!ref"]);
    for (let R = 2; R <= range.e.r; R++) {
      for (let C = 0; C <= range.e.c; C++) {
        const addr = XLSX.utils.encode_cell({ r: R, c: C });
        if (!ws[addr]) ws[addr] = { t: "z" };
        if (C === 0 || C === 1 || C === 2) {
          ws[addr].s = { ...(ws[addr].s || {}), alignment: { horizontal: "left" } };
        } else {
          ws[addr].s = { ...(ws[addr].s || {}), alignment: { horizontal: "right" } };
        }
      }
    }

    XLSX.utils.book_append_sheet(wb, ws, "Comparative Statement");

    // ── L1 Summary sheet ──────────────────────────────────────────────────────
    const l1Header = ["S.No", "Section", "Size", "Width", "Length", "L1 Supplier", "L1 Qty (MT)", "L1 Rate (Rs./MT)", "L1 Amount (Rs.)"];
    const l1Rows = l1Summary.rowDetails.map((r, i) => [
      i + 1,
      r.section || "",
      r.size || "",
      r.width || "",
      r.length || "",
      r.l1Supplier || "",
      r.l1Qty > 0 ? formatMT(r.l1Qty) : "",
      r.l1Rate > 0 ? formatRate(r.l1Rate) : "",
      r.l1Amount > 0 ? formatRate(Math.round(r.l1Amount)) : "",
    ]);
    // Totals row
    l1Rows.push([
      "",
      "Total / Wtd Avg", "", "", "", "",
      l1Summary.totalL1Qty > 0 ? formatMT(l1Summary.totalL1Qty) : "",
      l1Summary.weightedAvgL1 !== null ? formatRate(Math.round(l1Summary.weightedAvgL1)) : "",
      l1Summary.totalL1Amount > 0 ? formatRate(Math.round(l1Summary.totalL1Amount)) : "",
    ]);

    const wsL1 = XLSX.utils.aoa_to_sheet([l1Header, ...l1Rows]);
    wsL1["!cols"] = [6, 16, 12, 10, 10, 18, 12, 16, 16].map(w => ({ wch: w }));
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
          <p className="cs-subtitle">
            Supplier rate comparison across enquiry entries
          </p>
        </div>
        <div className="cs-header-right">
          <button
            className="cs-manage-btn"
            onClick={() => setShowManager(true)}
          >
            ✏️ Manage Entries
          </button>
          <button
            className="btn-export btn-pdf"
            onClick={exportPDF}
            disabled={rows.length === 0}
          >
            Export PDF
          </button>
          <button
            className="btn-export btn-excel"
            onClick={exportExcel}
            disabled={rows.length === 0}
          >
            Export Excel
          </button>
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="cs-filters">
        <div className="cs-filter-group">
          <label className="cs-filter-label">Financial Year</label>
          <select
            className="cs-filter-select"
            value={filterFY}
            onChange={e => { setFilterFY(e.target.value); setFilterEnquiryNo(""); setFilterDate(""); }}
          >
            <option value="">All Years</option>
            {uniqueFYs.map(fy => (
              <option key={fy} value={fy}>{fy}</option>
            ))}
          </select>
        </div>

        <div className="cs-filter-group">
          <label className="cs-filter-label">Enquiry No</label>
          <select
            className="cs-filter-select"
            value={filterEnquiryNo}
            onChange={e => { setFilterEnquiryNo(e.target.value); setFilterDate(""); }}
          >
            <option value="">All Enquiries</option>
            {uniqueEnquiryNos.map(no => (
              <option key={no} value={no}>Enquiry #{no}</option>
            ))}
          </select>
        </div>

        <div className="cs-filter-group">
          <label className="cs-filter-label">Enquiry Date</label>
          <select
            className="cs-filter-select"
            value={filterDate}
            onChange={e => { setFilterDate(e.target.value); setFilterEnquiryNo(""); }}
          >
            <option value="">All Dates</option>
            {uniqueDates.map(d => (
              <option key={d} value={d}>{d}</option>
            ))}
          </select>
        </div>

        {(filterFY || filterEnquiryNo || filterDate) && (
          <button
            className="cs-clear-btn"
            onClick={() => { setFilterFY(""); setFilterEnquiryNo(""); setFilterDate(""); }}
          >
            ✕ Clear Filters
          </button>
        )}
      </div>

      {/* ── Table ── */}
      {loading ? (
        <div className="cs-loading">
          <div className="cs-spinner" />
          <p>Loading enquiry data…</p>
        </div>
      ) : rows.length === 0 ? (
        <div className="cs-empty">
          <div className="cs-empty-icon">📋</div>
          <p>No enquiry entries found for the selected filters.</p>
        </div>
      ) : (
        <div className="cs-table-wrapper">
          <table className="cs-table">
            <thead>
              {/* ── Row 1: group headers ── */}
              <tr className="cs-thead-row">
                <th className="cs-th cs-th-sticky cs-th-sno" rowSpan={2}>S.No</th>
                <th className="cs-th cs-th-sticky cs-th-section" rowSpan={2}>Section</th>
                <th className="cs-th cs-th-sticky cs-th-size" rowSpan={2}>Size</th>
                <th className="cs-th cs-th-sticky cs-th-size" rowSpan={2}>Width</th>
                <th className="cs-th cs-th-sticky cs-th-size" rowSpan={2}>Length</th>
                <th className="cs-th cs-th-sticky cs-th-mt" rowSpan={2}>Qty (MT)</th>

                {/* Purchase reference columns */}
                <th className="cs-th cs-th-purchase" colSpan={2}>
                  Purchase Reference
                </th>

                {/* Supplier columns — each spans 2 (MT + Rate) */}
                {suppliers.map(sup => (
                  <th key={sup} className="cs-th cs-th-supplier" colSpan={2}>
                    <div className="cs-supplier-name">{sup}</div>
                  </th>
                ))}

                {/* % Increase column */}
                <th className="cs-th cs-th-pct" rowSpan={2}>
                  % Increase<br />
                  <span className="cs-th-pct-sub">vs Lowest Purchase</span>
                </th>
                <th className="cs-th cs-th-pct-last" rowSpan={2}>
                  % Increase<br />
                  <span className="cs-th-pct-sub">vs Last Purchase</span>
                </th>
              </tr>

              {/* ── Row 2: sub-headers ── */}
              <tr className="cs-thead-subrow">
                <th className="cs-th cs-th-purchase-sub">Lowest Purchase<br /><span className="cs-th-sub-label">(₹/MT)</span></th>
                <th className="cs-th cs-th-purchase-sub">Last Purchase<br /><span className="cs-th-sub-label">(₹/MT)</span></th>
                {suppliers.map(sup => (
                  <>
                    <th key={`${sup}-mt`} className="cs-th cs-th-supplier-sub">MT</th>
                    <th key={`${sup}-rate`} className="cs-th cs-th-supplier-sub">Rate (₹/MT)</th>
                  </>
                ))}
              </tr>
            </thead>

            <tbody>
              {rows.map((row, idx) => {
                const pct = formatPercent(row.minRate, row.lowestPurchaseRate);
                const pctNum = pct !== null ? parseFloat(pct) : null;
                const pctLast = formatPercent(row.minRate, row.lastPurchaseRate);
                const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;

                return (
                  <tr key={`${row.section}-${row.size}-${row.width}-${row.length}-${idx}`} className="cs-tr">
                    <td className="cs-td cs-td-sticky cs-td-sno">{idx + 1}</td>
                    <td className="cs-td cs-td-sticky cs-td-section">
                      <span className="cs-section-tag">{row.section || "—"}</span>
                    </td>
                    <td className="cs-td cs-td-sticky cs-td-size">
                      {row.size || <span className="cs-na">—</span>}
                    </td>
                    <td className="cs-td cs-td-sticky cs-td-size">
                      {row.width || <span className="cs-na">—</span>}
                    </td>
                    <td className="cs-td cs-td-sticky cs-td-size">
                      {row.length || <span className="cs-na">—</span>}
                    </td>
                    <td className="cs-td cs-td-sticky cs-td-mt">
                      {formatMT(row.sectionMt)}
                    </td>

                    {/* Lowest Purchase Rate */}
                    <td className="cs-td cs-td-purchase">
                      {row.lowestPurchaseRate ? (
                        <div className="cs-last-purchase-cell">
                          {row.lowestPurchaseDate && (
                            <span className="cs-purchase-date">{row.lowestPurchaseDate}</span>
                          )}
                          <span className="cs-purchase-rate">
                            ₹ {formatRate(row.lowestPurchaseRate)}
                          </span>
                        </div>
                      ) : null}
                    </td>

                    {/* Last Purchase Rate */}
                    <td className="cs-td cs-td-purchase">
                      {row.lastPurchaseRate ? (
                        <div className="cs-last-purchase-cell">
                          {row.lastPurchaseDate && (
                            <span className="cs-purchase-date">{row.lastPurchaseDate}</span>
                          )}
                          <span className="cs-purchase-rate">
                            ₹ {formatRate(row.lastPurchaseRate)}
                          </span>
                        </div>
                      ) : null}
                    </td>

                    {/* Supplier rate columns */}
                    {suppliers.map(sup => {
                      const rateObj = row.rates[sup];
                      const rate = rateObj ? rateObj.rate : null;
                      const supplierMt = rateObj ? rateObj.mt : null;
                      const isLowest = rate != null && rate > 0 && rate === row.minRate;

                      return (
                        <>
                          {/* MT cell */}
                          <td
                            key={`${sup}-mt`}
                            className={`cs-td cs-td-supplier-mt${isLowest ? " cs-td-lowest" : ""}${!rate ? " cs-td-empty" : ""}`}
                          >
                            {rate > 0 ? (
                              <span className="cs-rate-mt">{formatMT(supplierMt)}</span>
                            ) : null}
                          </td>

                          {/* Rate cell */}
                          <td
                            key={`${sup}-rate`}
                            className={`cs-td cs-td-rate${isLowest ? " cs-td-lowest" : ""}${!rate ? " cs-td-empty" : ""}`}
                          >
                            {rate > 0 ? (
                              <div className="cs-rate-cell">
                                <span className="cs-rate-value">
                                  ₹ {formatRate(rate)}
                                </span>
                                {isLowest && (
                                  <span className="cs-lowest-badge">Lowest</span>
                                )}
                              </div>
                            ) : null}
                          </td>
                        </>
                      );
                    })}

                    {/* % Increase vs Lowest Purchase */}
                    <td className={`cs-td cs-td-pct${pctNum !== null ? (pctNum > 0 ? " cs-td-pct--up" : pctNum < 0 ? " cs-td-pct--down" : " cs-td-pct--flat") : ""}`}>
                      {pctNum !== null ? (
                        <span className="cs-pct-value">
                          {pctNum > 0 ? "+" : ""}{Math.abs(pctNum)}%
                        </span>
                      ) : (
                        <span className="cs-no-quote">—</span>
                      )}
                    </td>

                    {/* % Increase vs Last Purchase */}
                    <td className={`cs-td cs-td-pct-last${pctLastNum !== null ? (pctLastNum > 0 ? " cs-td-pct-last--up" : pctLastNum < 0 ? " cs-td-pct-last--down" : " cs-td-pct-last--flat") : ""}`}>
                      {pctLastNum !== null ? (
                        <span className="cs-pct-value">
                          {pctLastNum > 0 ? "+" : ""}{Math.abs(pctLastNum)}%
                        </span>
                      ) : (
                        <span className="cs-no-quote">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>

            {/* ── Average Rate Footer Row ── */}
            <tfoot>
              <tr className="cs-tr cs-tr-avg">
                <td className="cs-td cs-td-sticky cs-td-sno" />
                <td className="cs-td cs-td-sticky cs-td-section cs-avg-label" colSpan={5}>
                  Weighted Avg Rate
                </td>
                <td className="cs-td cs-td-purchase" />
                <td className="cs-td cs-td-purchase" />
                {suppliers.map(sup => {
                  let totalAmount = 0;
                  let totalMt = 0;
                  rows.forEach(row => {
                    const rateObj = row.rates[sup];
                    if (rateObj && rateObj.rate > 0 && rateObj.mt > 0) {
                      totalAmount += rateObj.rate * rateObj.mt;
                      totalMt += rateObj.mt;
                    }
                  });
                  const weightedAvg = totalMt > 0 ? totalAmount / totalMt : null;
                  return (
                    <>
                      <td key={`${sup}-avg-mt`} className="cs-td cs-td-supplier-mt">
                        {totalMt > 0 ? (
                          <span className="cs-rate-mt">{formatMT(totalMt)}</span>
                        ) : null}
                      </td>
                      <td key={`${sup}-avg-rate`} className="cs-td cs-td-rate cs-td-avg-rate">
                        {weightedAvg !== null ? (
                          <span className="cs-avg-value">₹ {formatRate(Math.round(weightedAvg))}</span>
                        ) : null}
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

      {/* ── L1 Summary (outside table) ── */}
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
                  <th>S.No</th>
                  <th>Section</th>
                  <th>Size</th>
                  <th>Width</th>
                  <th>Length</th>
                  <th>L1 Supplier</th>
                  <th>L1 Qty (MT)</th>
                  <th>L1 Rate (₹/MT)</th>
                  <th>L1 Amount (₹)</th>
                </tr>
              </thead>
              <tbody>
                {l1Summary.rowDetails.map((r, i) => (
                  <tr key={i} className={!r.l1Rate ? "cs-l1-tr--nodata" : ""}>
                    <td className="cs-l1-sno">{i + 1}</td>
                    <td className="cs-l1-left"><span className="cs-section-tag">{r.section || "—"}</span></td>
                    <td className="cs-l1-left">{r.size || <span className="cs-na">—</span>}</td>
                    <td>{r.width || <span className="cs-na">—</span>}</td>
                    <td>{r.length || <span className="cs-na">—</span>}</td>
                    <td className="cs-l1-supplier">{r.l1Supplier || <span className="cs-na">—</span>}</td>
                    <td className="cs-l1-num">{r.l1Qty > 0 ? formatMT(r.l1Qty) : <span className="cs-na">—</span>}</td>
                    <td className="cs-l1-num cs-l1-rate">
                      {r.l1Rate > 0 ? <>₹ {formatRate(r.l1Rate)}</> : <span className="cs-na">—</span>}
                    </td>
                    <td className="cs-l1-num cs-l1-amount">
                      {r.l1Amount > 0 ? <>₹ {formatRate(Math.round(r.l1Amount))}</> : <span className="cs-na">—</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="cs-l1-totals">
                  <td />
                  <td colSpan={5} className="cs-l1-totals-label">Total / Weighted Avg L1</td>
                  <td className="cs-l1-num cs-l1-totals-val">
                    {l1Summary.totalL1Qty > 0 ? formatMT(l1Summary.totalL1Qty) : "—"}
                  </td>
                  <td className="cs-l1-num cs-l1-totals-avg">
                    {l1Summary.weightedAvgL1 !== null
                      ? <>₹ {formatRate(Math.round(l1Summary.weightedAvgL1))}</>
                      : "—"}
                  </td>
                  <td className="cs-l1-num cs-l1-totals-amt">
                    {l1Summary.totalL1Amount > 0
                      ? <>₹ {formatRate(Math.round(l1Summary.totalL1Amount))}</>
                      : "—"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Enquiry Manager Modal ── */}
      {showManager && (
        <EnquiryManager
          onClose={() => {
            setShowManager(false);
            fetchEntries();
          }}
        />
      )}

    </div>
  );
}