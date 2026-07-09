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
  const [filterCategory, setFilterCategory] = useState("All");
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
    if (filterCategory !== "All") result = result.filter(e => (e.Category || "All") === filterCategory);
    if (filterDate) result = result.filter(e => e.EnquiryDate >= filterDate);
    if (filterEndDate) result = result.filter(e => e.EnquiryDate <= filterEndDate);
    setFilteredEntries(result);
  }, [filterFY, filterEnquiryNo, filterCategory, filterDate, filterEndDate, allEntries]);

  // ── Build purchase rate lookup ─────────────────────────────────────────────
  const buildPurchaseLookup = () => {
    const sectionSet = new Set();
    const dateMap = new Map();

    const scopedPurchaseEntries = filterCategory === "All"
      ? purchaseEntries
      : purchaseEntries.filter(e => (e.Category || "All") === filterCategory);

    scopedPurchaseEntries.forEach(entry => {
      const billDate = entry["Bill Date"] || entry["Received On"] || "";
      if (filterEndDate && billDate && billDate > filterEndDate) return;
      (entry.items || []).forEach(item => {
        const section = item.Section        || "";
        const size    = item.Size           || "";
        const width   = item.Width          || "";
        const length  = item["Item Length"] || "";
        const mt = parseFloat(item["Quantity in Metric Tons"]) || 0;
        const sectionSubtotal = parseFloat(item["Section Subtotal"]) || 0;
        const rate = mt > 0 ? sectionSubtotal / mt : 0;
        if (!section || !rate) return;
        sectionSet.add(section);

        const key = `${section}||${size}||${width}||${length}`;
        if (!dateMap.has(key)) dateMap.set(key, new Map());
        const byDate = dateMap.get(key);

        if (!byDate.has(billDate)) {
          byDate.set(billDate, { rate, entryNo: entry.No });
        } else {
          const existing = byDate.get(billDate);
          if (rate > existing.rate) {
            existing.rate = rate;
            existing.entryNo = entry.No;
          }
        }
      });
    });

    const lookup = new Map();
    dateMap.forEach((byDate, key) => {
      byDate.forEach(({ rate, entryNo }, billDate) => {
        if (!lookup.has(key)) {
          lookup.set(key, { lowestRate: rate, lowestDate: billDate, lastRate: rate, lastDate: billDate, lastNo: entryNo });
        } else {
          const existing = lookup.get(key);
          if (rate < existing.lowestRate) { existing.lowestRate = rate; existing.lowestDate = billDate; }
          if (entryNo > existing.lastNo)  { existing.lastRate = rate;   existing.lastDate = billDate; existing.lastNo = entryNo; }
        }
      });
    });

    // ── partialMap: keyed by section||size||width → array of {lengthNum, lengthVal, lookupData}
    const partialMap = new Map();
    // ── sizeMap: keyed by section||size → array of {widthNum, widthVal, lengthNum, lengthVal, lookupData}
    const sizeMap = new Map();

    lookup.forEach((data, key) => {
      const parts = key.split("||");
      if (parts.length === 4) {
        const [sec, sz, wd, ln] = parts;
        const lengthNum = parseFloat(ln) || 0;
        const widthNum  = parseFloat(wd) || 0;

        // partialMap (section||size||width level)
        const partialKey = `${sec}||${sz}||${wd}`;
        if (!partialMap.has(partialKey)) partialMap.set(partialKey, []);
        partialMap.get(partialKey).push({
          lengthNum,
          lengthVal: ln,
          section: sec,
          size: sz,
          width: wd,
          lookupData: data,
        });

        // sizeMap (section||size level)
        const sizeKey = `${sec}||${sz}`;
        if (!sizeMap.has(sizeKey)) sizeMap.set(sizeKey, []);
        sizeMap.get(sizeKey).push({
          widthNum,
          widthVal: wd,
          lengthNum,
          lengthVal: ln,
          section: sec,
          size: sz,
          lookupData: data,
        });
      }
    });

    return { lookup, sectionSet, partialMap, sizeMap };
  };

  // ── Helper: get purchase data for a row ────────────────────────────────────
  const getPurchaseData = (lookup, sectionSet, partialMap, sizeMap, section, size, width, length) => {
    const enquiryLen = parseFloat(length) || 0;
    const enquiryWid = parseFloat(width)  || 0;

    // ── Step 1: Exact match ──────────────────────────────────────────────────
    const exactKey = `${section}||${size}||${width}||${length}`;
    if (lookup.has(exactKey)) {
      return {
        ...lookup.get(exactKey),
        isAlternative: false,
        altSection: section,
        altSize: size,
        altWidth: width,
        altLength: length,
      };
    }

    // ── Step 2: Near higher length (same section + size + width) ────────────
    const partialKey = `${section}||${size}||${width}`;
    if (partialMap.has(partialKey)) {
      const candidates = partialMap.get(partialKey).filter(c => c.lengthNum >= enquiryLen);
      if (candidates.length > 0) {
        candidates.sort((a, b) => a.lengthNum - b.lengthNum);
        const best = candidates[0];
        return {
          ...best.lookupData,
          isAlternative: true,
          altSection: best.section,
          altSize: best.size,
          altWidth: best.width,
          altLength: best.lengthVal,
        };
      }
    }

    // ── Step 3: Near higher width (same section + size) ──────────────────────
    const sizeKey = `${section}||${size}`;
    if (sizeMap.has(sizeKey)) {
      const widthCandidates = sizeMap.get(sizeKey).filter(c => c.widthNum > enquiryWid);

      if (widthCandidates.length > 0) {
        const minWidth = Math.min(...widthCandidates.map(c => c.widthNum));
        const sameWidthGroup = widthCandidates.filter(c => c.widthNum === minWidth);

        const lengthMatch = sameWidthGroup.filter(c => c.lengthNum >= enquiryLen);
        let best;
        if (lengthMatch.length > 0) {
          lengthMatch.sort((a, b) => a.lengthNum - b.lengthNum);
          best = lengthMatch[0];
        } else {
          sameWidthGroup.sort((a, b) => b.lengthNum - a.lengthNum);
          best = sameWidthGroup[0];
        }

        return {
          ...best.lookupData,
          isAlternative: true,
          altSection: best.section,
          altSize: best.size,
          altWidth: best.widthVal,
          altLength: best.lengthVal,
        };
      }
    }

    // ── Step 4: Section exists in purchase data but no dimension match ───────
    if (sectionSet.has(section)) return null;

    // ── Section not in purchase data at all ──────────────────────────────────
    return undefined;
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
    const { lookup: purchaseLookup, sectionSet, partialMap, sizeMap } = buildPurchaseLookup();
    const rowMap = new Map();
    filteredEntries.forEach(entry => {
      (entry.sections || []).forEach(sec => {
        const section = sec.section || "";
        const size = sec.size || "";
        const width = sec.width || "";
        const length = sec.length || "";
        const sectionMt = sec.mt || 0;
        const key = `${section}||${size}||${width}||${length}`;
        if (!rowMap.has(key)) {
          const purchaseData = getPurchaseData(purchaseLookup, sectionSet, partialMap, sizeMap, section, size, width, length);
          const sectionExists = sectionSet.has(section);

          rowMap.set(key, {
            section, size, width, length, sectionMt,
            lowestPurchaseRate: purchaseData ? purchaseData.lowestRate : (sectionExists ? 0 : null),
            lowestPurchaseDate: purchaseData ? purchaseData.lowestDate : null,
            lastPurchaseRate:   purchaseData ? purchaseData.lastRate   : (sectionExists ? 0 : null),
            lastPurchaseDate:   purchaseData ? purchaseData.lastDate   : null,
            isAlternative: purchaseData ? purchaseData.isAlternative : false,
            altSection: purchaseData ? purchaseData.altSection : section,
            altSize:    purchaseData ? purchaseData.altSize    : size,
            altWidth:   purchaseData ? purchaseData.altWidth   : width,
            altLength:  purchaseData ? purchaseData.altLength  : length,
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

    // ── Sort rows alphabetically by section, then size, width, length ────────
    const rows = Array.from(rowMap.values())
      .sort((a, b) => {
        const secCmp = (a.section || "").localeCompare(b.section || "", undefined, { sensitivity: "base" });
        if (secCmp !== 0) return secCmp;
        const sizeCmp = (a.size || "").localeCompare(b.size || "", undefined, { sensitivity: "base" });
        if (sizeCmp !== 0) return sizeCmp;
        const widCmp = (parseFloat(a.width) || 0) - (parseFloat(b.width) || 0);
        if (widCmp !== 0) return widCmp;
        return (parseFloat(a.length) || 0) - (parseFloat(b.length) || 0);
      })
      .map(row => {
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

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const isoMatch = String(dateStr).match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[3]}-${isoMatch[2]}-${isoMatch[1].slice(2)}`;
    const dmyMatch = String(dateStr).match(/^(\d{2})-(\d{2})-(\d{4})$/);
    if (dmyMatch) return `${dmyMatch[1]}-${dmyMatch[2]}-${dmyMatch[3].slice(2)}`;
    return dateStr;
  };

  // ── Build alternative item label ───────────────────────────────────────────
  const buildAltLabel = (row) => {
    if (!row.isAlternative) return null;
    const dims = [row.altSize, row.altWidth, row.altLength].filter(Boolean).join(" x ");
    return [row.altSection, dims].filter(Boolean).join(" - ") + " - Alt";
  };

  const uniqueFYs = [...new Set(allEntries.map(e => e.FinancialYear).filter(Boolean))].sort();
  const uniqueEnquiryNos = [...new Set(allEntries.map(e => e.No).filter(v => v != null))].sort((a, b) => a - b);

  // ── Helper: build PDF heading info string ──────────────────────────────────
  const buildPdfHeadingInfo = () => {
    const parts = [];
    if (filterFY) parts.push(`FY: ${filterFY}`);
    if (filterCategory !== "All") parts.push(`Category: ${filterCategory}`);
    if (filterEnquiryNo) {
      const enquiryEntry = allEntries.find(e => String(e.No) === String(filterEnquiryNo));
      const dateStr = enquiryEntry?.EnquiryDate ? `  Date: ${formatDate(enquiryEntry.EnquiryDate)}` : "";
      parts.push(`Enquiry No: ${filterEnquiryNo}${dateStr}`);
    }
    if (filterDate) parts.push(`From: ${filterDate}`);
    if (filterEndDate) parts.push(`To: ${filterEndDate}`);
    return parts.join("   |   ");
  };

  // ── PCT cell styles helper ─────────────────────────────────────────────────
  // "vs Lowest Purchase" column → up=red, down=green — text color only, NO fillColor
  const pctLowestStyles = (pctNum) => ({
    halign: "center",
    fontStyle: pctNum !== null && pctNum !== 0 ? "bold" : "normal",
    textColor:
      pctNum === null  ? [0, 0, 0]      :
      pctNum  >  0     ? [220, 38, 38]  :   // #dc2626
      pctNum  <  0     ? [22, 163, 74]  :   // #16a34a
                         [100, 116, 139],   // #64748b
  });

  // "vs Last Purchase" column → up=orange, down=green — text color only, NO fillColor
  const pctLastStyles = (pctNum) => ({
    halign: "center",
    fontStyle: pctNum !== null && pctNum !== 0 ? "bold" : "normal",
    textColor:
      pctNum === null  ? [0, 0, 0]      :
      pctNum  >  0     ? [234, 88, 12]  :   // #ea580c
      pctNum  <  0     ? [22, 163, 74]  :   // #16a34a
                         [100, 116, 139],   // #64748b
  });

  // ── Export PDF ─────────────────────────────────────────────────────────────
  const exportPDF = () => {
    const doc = new jsPDF("l", "pt", "a4");
    const cleanText = (text) => {
      if (!text) return "";
      return String(text)
        .replace(/[φΦ⌀∅Ø]/g, "dia.")
        .replace(/[^\x00-\x7F]/g, c => c === "₹" ? "Rs." : "");
    };

    const headingInfo = buildPdfHeadingInfo();
    const fullTitle = headingInfo
      ? `Comparative Statement - ${headingInfo}`
      : "Comparative Statement";

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.text(fullTitle, 40, 28);
    doc.setFont(undefined, "normal");

    const startY = 38;

    const headRow1 = [
      { content: "S.No",       rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Description",rowSpan: 2, styles: { halign: "left",   valign: "middle" } },
      { content: "Qty\n(MT)",  rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Lowest Purchase", colSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Last Purchase",   colSpan: 2, styles: { halign: "center", valign: "middle" } },
      ...suppliers.map(sup => ({
        content: sup,
        colSpan: 2,
        styles: { halign: "center", valign: "middle", fontStyle: "bold" },
      })),
      { content: "% vs\nLowest Purchase", rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "% vs\nLast Purchase",   rowSpan: 2, styles: { halign: "center", valign: "middle" } },
    ];

    const headRow2 = [
      { content: "Date",   styles: { halign: "center", valign: "middle" } },
      { content: "Amount", styles: { halign: "center", valign: "middle" } },
      { content: "Date",   styles: { halign: "center", valign: "middle" } },
      { content: "Amount", styles: { halign: "center", valign: "middle" } },
      ...suppliers.flatMap(() => [
        { content: "MT",      styles: { halign: "center", valign: "middle" } },
        { content: "Rate/MT", styles: { halign: "center", valign: "middle" } },
      ]),
    ];

    const csCharWidth = 4.5;
    const totalCSCols = 7 + suppliers.length * 2 + 2;
    const csColMaxChars = new Array(totalCSCols).fill(0);

    const csHeaderFlat = [
      "S.No", "Description", "Qty\n(MT)",
      "Date", "Amount", "Date", "Amount",
      ...suppliers.flatMap(sup => [sup, "Rate/MT"]),
      "% vs\nLowest\nPurchase", "% vs\nLast\nPurchase",
    ];
    csHeaderFlat.forEach((t, i) => {
      if (i < totalCSCols) {
        const lines = t.split("\n");
        const maxLen = Math.max(...lines.map(l => l.length));
        csColMaxChars[i] = Math.max(csColMaxChars[i], maxLen);
      }
    });

    const allCSBodyRows = [...rows.map((row, idx) => {
      const dims = [row.size, row.width, row.length].filter(Boolean).join(" x ");
      let description = cleanText([row.section, dims].filter(Boolean).join(" - ")) || "-";
      const altLabel = buildAltLabel(row);
      if (altLabel) description += `\n${cleanText(altLabel)}`;

      const pct     = formatPercent(row.minRate, row.lowestPurchaseRate);
      const pctNum  = pct  !== null ? parseFloat(pct)  : null;
      const pctLast = formatPercent(row.minRate, row.lastPurchaseRate);
      const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;

      const lowestDateStr = row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0 && row.lowestPurchaseDate
        ? formatDate(row.lowestPurchaseDate) : "";
      const lowestAmtStr = row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0
        ? formatRate(Math.round(row.lowestPurchaseRate)) : "";
      const lastDateStr = row.lastPurchaseRate != null && row.lastPurchaseRate !== 0 && row.lastPurchaseDate
        ? formatDate(row.lastPurchaseDate) : "";
      const lastAmtStr = row.lastPurchaseRate != null && row.lastPurchaseRate !== 0
        ? formatRate(Math.round(row.lastPurchaseRate)) : "";

      const cells = [
        String(idx + 1),
        description,
        formatMT(row.sectionMt),
        lowestDateStr,
        lowestAmtStr,
        lastDateStr,
        lastAmtStr,
        ...suppliers.flatMap(sup => {
          const rateObj = row.rates[sup];
          const rate = rateObj ? rateObj.rate : null;
          return [
            rate > 0 ? formatMT(rateObj.mt) : "",
            rate > 0 ? formatRate(rate) : "",
          ];
        }),
        pctNum !== null ? `${pctNum > 0 ? "+" : pctNum < 0 ? "-" : ""}${Math.abs(pctNum)}%` : "",
        pctLastNum !== null ? `${pctLastNum > 0 ? "+" : pctLastNum < 0 ? "-" : ""}${Math.abs(pctLastNum)}%` : "",
      ];
      return cells;
    }),
    ["", "Total MT / Avg Rate",
      qtyMtSummary.totalSectionMt > 0 ? parseFloat(qtyMtSummary.totalSectionMt).toFixed(2) : "",
      "", qtyMtSummary.lowestPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg)) : "",
      "", qtyMtSummary.lastPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg)) : "",
      ...suppliers.flatMap(sup => {
        let amt = 0, mt = 0;
        rows.forEach(r => { const o = r.rates[sup]; if (o && o.rate > 0 && o.mt > 0) { amt += o.rate * o.mt; mt += o.mt; } });
        return [mt > 0 ? parseFloat(mt).toFixed(2) : "", mt > 0 ? formatRate(Math.round(amt / mt)) : ""];
      }),
      "", "",
    ],
    ["", "Avg of Quoted (L1)", "", "", "", "", "",
      ...suppliers.flatMap(sup => {
        const avgRate = l1Summary.supplierTotals[sup]?.weightedAvgRate;
        return ["", avgRate != null ? formatRate(Math.round(avgRate)) : ""];
      }),
      "", "",
    ],
    ];

    allCSBodyRows.forEach(cells => {
      cells.forEach((txt, i) => {
        if (i < totalCSCols) {
          const lines = String(txt).split("\n");
          const maxLen = Math.max(...lines.map(l => l.length));
          csColMaxChars[i] = Math.max(csColMaxChars[i], maxLen);
        }
      });
    });

    const csMinWidths = [26,120, 18, 26, 30, 26, 30];
    suppliers.forEach(() => { csMinWidths.push(18, 26); });
    csMinWidths.push(22, 22);

    const csMaxWidths = [32, 130, 24, 38, 44, 38, 44];
    suppliers.forEach(() => { csMaxWidths.push(30, 40); });
    csMaxWidths.push(32, 32);

    const columnStyles = {};
    csColMaxChars.forEach((chars, i) => {
      const computed = Math.ceil(chars * csCharWidth) + 6;
      const minW = csMinWidths[i] || 18;
      const maxW = csMaxWidths[i] || 50;
      const cellWidth = Math.min(maxW, Math.max(minW, computed));
      columnStyles[i] = {
        halign: i === 0 ? "center" : i === 1 ? "left" : "center",
        cellWidth,
      };
    });

    const body = rows.map((row, idx) => {
      const dims = [row.size, row.width, row.length].filter(Boolean).join(" x ");
      let description = cleanText([row.section, dims].filter(Boolean).join(" - ")) || "-";
      const altLabel = buildAltLabel(row);
      if (altLabel) description += `\n${cleanText(altLabel)}`;

      const pct        = formatPercent(row.minRate, row.lowestPurchaseRate);
      const pctNum     = pct     !== null ? parseFloat(pct)     : null;
      const pctLast    = formatPercent(row.minRate, row.lastPurchaseRate);
      const pctLastNum = pctLast !== null ? parseFloat(pctLast) : null;

      return [
        { content: idx + 1,     styles: { halign: "center" } },
        { content: description, styles: { halign: "left"   } },
        { content: formatMT(row.sectionMt), styles: { halign: "center" } },
        {
          content: row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0 && row.lowestPurchaseDate
            ? formatDate(row.lowestPurchaseDate) : "",
          styles: { halign: "center", textColor: [80, 80, 80] },
        },
        {
          content: row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0
            ? formatRate(Math.round(row.lowestPurchaseRate)) : "",
          styles: { halign: "center" },
        },
        {
          content: row.lastPurchaseRate != null && row.lastPurchaseRate !== 0 && row.lastPurchaseDate
            ? formatDate(row.lastPurchaseDate) : "",
          styles: { halign: "center", textColor: [80, 80, 80] },
        },
        {
          content: row.lastPurchaseRate != null && row.lastPurchaseRate !== 0
            ? formatRate(Math.round(row.lastPurchaseRate)) : "",
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
        // ── % vs Lowest Purchase ── text color only, NO background fill
        {
          content: pctNum !== null ? `${pctNum > 0 ? "+" : pctNum < 0 ? "-" : ""}${Math.abs(pctNum)}%` : "",
          styles: pctLowestStyles(pctNum),
        },
        // ── % vs Last Purchase ── text color only, NO background fill
        {
          content: pctLastNum !== null ? `${pctLastNum > 0 ? "+" : pctLastNum < 0 ? "-" : ""}${Math.abs(pctLastNum)}%` : "",
          styles: pctLastStyles(pctLastNum),
        },
      ];
    });

    const summaryRow = [
      { content: "", styles: { halign: "center" } },
      { content: "Total MT / Avg Rate", styles: { fontStyle: "bold", halign: "left" } },
      { content: qtyMtSummary.totalSectionMt > 0 ? parseFloat(qtyMtSummary.totalSectionMt).toFixed(2) : "", styles: { fontStyle: "bold", halign: "center" } },
      { content: "", styles: { halign: "center" } },
      { content: qtyMtSummary.lowestPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg)) : "", styles: { fontStyle: "bold", halign: "center" } },
      { content: "", styles: { halign: "center" } },
      { content: qtyMtSummary.lastPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg)) : "", styles: { fontStyle: "bold", halign: "center" } },
      ...suppliers.flatMap(sup => {
        let amt = 0, mt = 0;
        rows.forEach(r => {
          const o = r.rates[sup];
          if (o && o.rate > 0 && o.mt > 0) { amt += o.rate * o.mt; mt += o.mt; }
        });
        return [
          { content: mt > 0 ? parseFloat(mt).toFixed(2) : "", styles: { fontStyle: "bold", halign: "center" } },
          { content: mt > 0 ? formatRate(Math.round(amt / mt)) : "", styles: { fontStyle: "bold", halign: "center" } },
        ];
      }),
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
    ];

    const avgQuotedRow = [
      { content: "", styles: { halign: "center" } },
      { content: "Avg of Quoted (L1)", styles: { fontStyle: "bold", halign: "left" } },
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
      ...suppliers.flatMap(sup => {
        const avgRate = l1Summary.supplierTotals[sup]?.weightedAvgRate;
        return [
          { content: "", styles: { halign: "center" } },
          {
            content: avgRate != null ? formatRate(Math.round(avgRate)) : "",
            styles: { fontStyle: "bold", halign: "center" },
          },
        ];
      }),
      { content: "", styles: { halign: "center" } },
      { content: "", styles: { halign: "center" } },
    ];

    autoTable(doc, {
      startY,
      head: [headRow1, headRow2],
      body: [...body, summaryRow, avgQuotedRow],
      theme: "grid",
      styles: {
        fontSize: 6.5,
        halign: "center",
        valign: "middle",
        cellPadding: 2,
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
        fontSize: 7,
        lineColor: [0, 0, 0],
        lineWidth: 0.3,
        halign: "center",
        valign: "middle",
        minCellHeight: 18,
      },
      alternateRowStyles: { fillColor: [255, 255, 255] },
      columnStyles,
      margin: { left: 40, right: 40 },
      tableWidth: "wrap",
    });

    // ── Page 2: L1 Rate Summary ────────────────────────────────────────────────
    doc.addPage();
    const l1Y = 28;

    const l1FullTitle = headingInfo
      ? `L1 Rate Summary - ${headingInfo}`
      : "L1 Rate Summary";

    doc.setFontSize(11);
    doc.setFont(undefined, "bold");
    doc.setTextColor(0, 0, 0);
    doc.text(l1FullTitle, 40, l1Y);
    doc.setFont(undefined, "normal");

    const l1Head1 = [
      { content: "No.",                 rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Description of Item", rowSpan: 2, styles: { halign: "left",   valign: "middle" } },
      { content: "Mt.",                 rowSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Lowest Purchase", colSpan: 2, styles: { halign: "center", valign: "middle" } },
      { content: "Last Purchase",   colSpan: 2, styles: { halign: "center", valign: "middle" } },
      ...suppliers.map(sup => ({
        content: sup,
        colSpan: 3,
        styles: { halign: "center", valign: "middle", fontStyle: "bold" },
      })),
      { content: "% Increase", colSpan: 2, styles: { halign: "center", valign: "middle" } },
    ];

    const l1Head2 = [
      { content: "Date",   styles: { halign: "center", valign: "middle" } },
      { content: "Amount", styles: { halign: "center", valign: "middle" } },
      { content: "Date",   styles: { halign: "center", valign: "middle" } },
      { content: "Amount", styles: { halign: "center", valign: "middle" } },
      ...suppliers.flatMap(() => [
        { content: "Mt",     styles: { halign: "center", valign: "middle" } },
        { content: "Rate",   styles: { halign: "center", valign: "middle" } },
        { content: "Amount", styles: { halign: "center", valign: "middle" } },
      ]),
      { content: "vs Lowest\nPurchase", styles: { halign: "center", valign: "middle" } },
      { content: "vs Last\nPurchase",   styles: { halign: "center", valign: "middle" } },
    ];

    const l1Body = l1Summary.rowDetails.map((r, i) => {
      const origRow = rows[r.idx] || rows[i];
      const l1Rate       = r.l1Rate;
      const pctLowest    = origRow ? formatPercent(l1Rate, origRow.lowestPurchaseRate) : null;
      const pctLowestNum = pctLowest !== null ? parseFloat(pctLowest) : null;
      const pctLast      = origRow ? formatPercent(l1Rate, origRow.lastPurchaseRate)   : null;
      const pctLastNum   = pctLast  !== null ? parseFloat(pctLast)  : null;

      let descContent = cleanText(r.description) || "-";
      if (origRow && origRow.isAlternative) {
        const altLabel = buildAltLabel(origRow);
        if (altLabel) descContent += `\n${cleanText(altLabel)}`;
      }

      return [
        { content: i + 1,          styles: { halign: "center" } },
        { content: descContent,    styles: { halign: "left"   } },
        { content: r.totalMt > 0 ? parseFloat(r.totalMt).toFixed(2) : "-", styles: { halign: "center" } },
        {
          content: origRow && origRow.lowestPurchaseRate != null && origRow.lowestPurchaseRate !== 0 && origRow.lowestPurchaseDate
            ? formatDate(origRow.lowestPurchaseDate) : "",
          styles: { halign: "center", textColor: [80, 80, 80] },
        },
        {
          content: origRow && origRow.lowestPurchaseRate != null && origRow.lowestPurchaseRate !== 0
            ? formatRate(Math.round(origRow.lowestPurchaseRate)) : "",
          styles: { halign: "center" },
        },
        {
          content: origRow && origRow.lastPurchaseRate != null && origRow.lastPurchaseRate !== 0 && origRow.lastPurchaseDate
            ? formatDate(origRow.lastPurchaseDate) : "",
          styles: { halign: "center", textColor: [80, 80, 80] },
        },
        {
          content: origRow && origRow.lastPurchaseRate != null && origRow.lastPurchaseRate !== 0
            ? formatRate(Math.round(origRow.lastPurchaseRate)) : "",
          styles: { halign: "center" },
        },
        ...suppliers.flatMap(sup => {
          const d = r.supplierData[sup];
          const hasData = d && d.rate;
          return [
            { content: hasData ? parseFloat(d.mt).toFixed(2) : "", styles: { halign: "center" } },
            { content: hasData ? formatRate(d.rate)           : "", styles: { halign: "center", fontStyle: hasData ? "bold" : "normal" } },
            { content: hasData ? formatAmount(d.amount)       : "", styles: { halign: "center" } },
          ];
        }),
        // ── % vs Lowest Purchase ── text color only, NO background fill
        {
          content: pctLowestNum !== null ? `${pctLowestNum > 0 ? "+" : pctLowestNum < 0 ? "-" : ""}${Math.abs(pctLowestNum)}%` : "",
          styles: pctLowestStyles(pctLowestNum),
        },
        // ── % vs Last Purchase ── text color only, NO background fill
        {
          content: pctLastNum !== null ? `${pctLastNum > 0 ? "+" : pctLastNum < 0 ? "-" : ""}${Math.abs(pctLastNum)}%` : "",
          styles: pctLastStyles(pctLastNum),
        },
      ];
    });

    l1Body.push([
      { content: "",                    styles: { fontStyle: "bold", halign: "center" } },
      { content: "Total MT / Avg Rate", styles: { fontStyle: "bold", halign: "left"   } },
      { content: l1Summary.grandTotalMt > 0 ? parseFloat(l1Summary.grandTotalMt).toFixed(2) : "", styles: { fontStyle: "bold", halign: "center" } },
      { content: "", styles: { fontStyle: "bold", halign: "center" } },
      { content: qtyMtSummary.lowestPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg)) : "", styles: { fontStyle: "bold", halign: "center" } },
      { content: "", styles: { fontStyle: "bold", halign: "center" } },
      { content: qtyMtSummary.lastPurchaseWeightedAvg   !== null ? formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg))   : "", styles: { fontStyle: "bold", halign: "center" } },
      ...suppliers.flatMap(sup => {
        const t = l1Summary.supplierTotals[sup];
        return [
          { content: t.totalMt > 0            ? parseFloat(t.totalMt).toFixed(2)            : "", styles: { fontStyle: "bold", halign: "center" } },
          { content: t.weightedAvgRate != null ? formatRate(Math.round(t.weightedAvgRate))   : "", styles: { fontStyle: "bold", halign: "center" } },
          { content: t.totalAmount > 0         ? formatAmount(t.totalAmount)                 : "", styles: { fontStyle: "bold", halign: "center" } },
        ];
      }),
      { content: "", styles: { fontStyle: "bold", halign: "center" } },
      { content: "", styles: { fontStyle: "bold", halign: "center" } },
    ]);

    const charWidth = 4.5;
    const totalL1Cols = 7 + suppliers.length * 3 + 2;
    const colMaxChars = new Array(totalL1Cols).fill(0);

    const headerTexts = [
      "No.", "Description of Item", "Mt.",
      "Date", "Amount", "Date", "Amount",
      ...suppliers.flatMap(sup => [sup.substring(0, 8), "Mt", "Rate", "Amount"]),
      "vs Lowest\nPurchase", "vs Last\nPurchase",
    ];
    headerTexts.forEach((t, i) => {
      if (i < totalL1Cols) {
        const lines = t.split("\n");
        const maxLen = Math.max(...lines.map(l => l.length));
        colMaxChars[i] = Math.max(colMaxChars[i], maxLen);
      }
    });

    l1Body.forEach(rowArr => {
      let colIdx = 0;
      rowArr.forEach(cell => {
        const txt = String(cell.content || "");
        const lines = txt.split("\n");
        const maxLen = Math.max(...lines.map(l => l.length));
        if (colIdx < totalL1Cols) colMaxChars[colIdx] = Math.max(colMaxChars[colIdx], maxLen);
        colIdx++;
      });
    });

    const minWidths = [20, 120, 16, 28, 32, 28, 32];
    suppliers.forEach(() => { minWidths.push(16, 22, 28); });
    minWidths.push(24, 24);

    const maxWidths = [28, 130, 26, 40, 46, 40, 46];
    suppliers.forEach(() => { maxWidths.push(28, 34, 42); });
    maxWidths.push(34, 34);

    const l1ColStyles = {};
    colMaxChars.forEach((chars, i) => {
      const computed = Math.ceil(chars * charWidth) + 6;
      const minW = minWidths[i] || 20;
      const maxW = maxWidths[i] || 60;
      const cellWidth = Math.min(maxW, Math.max(minW, computed));
      l1ColStyles[i] = {
        halign: i === 0 ? "center" : i === 1 ? "left" : "center",
        cellWidth,
      };
    });

    const l1StartY = l1Y + 10;

    autoTable(doc, {
      startY: l1StartY,
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
      margin: { left: 40, right: 40 },
      tableWidth: "wrap",
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

      let descStr = row.section || "";
      const altLabel = buildAltLabel(row);
      if (altLabel) descStr += `\n${altLabel}`;

      const dr = [
        idx + 1, descStr, row.size || "", row.width || "", row.length || "",
        row.sectionMt ? formatMT(row.sectionMt) : "",
        row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0
          ? `${row.lowestPurchaseDate ? formatDate(row.lowestPurchaseDate) + "  " : ""}${formatRate(Math.round(row.lowestPurchaseRate))}`
          : "",
        row.lastPurchaseRate != null && row.lastPurchaseRate !== 0
          ? `${row.lastPurchaseDate ? formatDate(row.lastPurchaseDate) + "  " : ""}${formatRate(Math.round(row.lastPurchaseRate))}`
          : "",
      ];
      suppliers.forEach(sup => {
        const rateObj = row.rates[sup];
        dr.push(
          rateObj && rateObj.rate > 0 ? formatMT(rateObj.mt)                   : "",
          rateObj && rateObj.rate > 0 ? formatRate(rateObj.rate)               : "",
          rateObj && rateObj.rate > 0 ? formatAmount(rateObj.rate * rateObj.mt) : ""
        );
      });
      dr.push(
        pctNum     !== null ? `${pctNum     > 0 ? "+" : pctNum     < 0 ? "-" : ""}${Math.abs(pctNum)}%`     : "",
        pctLastNum !== null ? `${pctLastNum > 0 ? "+" : pctLastNum < 0 ? "-" : ""}${Math.abs(pctLastNum)}%` : ""
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

    const avgQuotedRowExcel = ["", "Avg of Quoted (L1)", "", "", "", "", "", ""];
    suppliers.forEach(sup => {
      const avgRate = l1Summary.supplierTotals[sup]?.weightedAvgRate;
      avgQuotedRowExcel.push("", avgRate != null ? formatRate(Math.round(avgRate)) : "", "");
    });
    avgQuotedRowExcel.push("", "");

    const ws = XLSX.utils.aoa_to_sheet([header1, header2, ...dataRows, summaryRow, avgQuotedRowExcel]);
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
    const l1H1 = ["No.", "Description of Item", "Mt.", "Lowest Purchase", "", "Last Purchase", ""];
    const l1H2 = ["", "", "", "Date", "Amount", "Date", "Amount"];
    suppliers.forEach(sup => { l1H1.push(sup, "", ""); l1H2.push("Mt", "Rate", "Amount"); });
    l1H1.push("% Increase", "");
    l1H2.push("vs Lowest Purchase", "vs Last Purchase");

    const l1DataRows = l1Summary.rowDetails.map((r, i) => {
      const origRow = rows[r.idx] !== undefined ? rows[r.idx] : rows[i];
      const l1Rate       = r.l1Rate;
      const pctLowest    = origRow ? formatPercent(l1Rate, origRow.lowestPurchaseRate) : null;
      const pctLowestNum = pctLowest !== null ? parseFloat(pctLowest) : null;
      const pctLast      = origRow ? formatPercent(l1Rate, origRow.lastPurchaseRate)   : null;
      const pctLastNum   = pctLast  !== null ? parseFloat(pctLast)  : null;

      let descStr = r.description || "";
      if (origRow && origRow.isAlternative) {
        const altLabel = buildAltLabel(origRow);
        if (altLabel) descStr += `\n${altLabel}`;
      }

      const dr = [
        i + 1,
        descStr,
        r.totalMt > 0 ? parseFloat(r.totalMt).toFixed(2) : "",
        origRow && origRow.lowestPurchaseRate != null && origRow.lowestPurchaseRate !== 0
          ? `${origRow.lowestPurchaseDate ? formatDate(origRow.lowestPurchaseDate) + "  " : ""}${formatRate(Math.round(origRow.lowestPurchaseRate))}`
          : "",
        origRow && origRow.lastPurchaseRate != null && origRow.lastPurchaseRate !== 0
          ? `${origRow.lastPurchaseDate ? formatDate(origRow.lastPurchaseDate) + "  " : ""}${formatRate(Math.round(origRow.lastPurchaseRate))}`
          : "",
      ];
      suppliers.forEach(sup => {
        const d = r.supplierData[sup];
        const hasData = d && d.rate;
        dr.push(
          hasData ? parseFloat(d.mt).toFixed(2) : "",
          hasData ? formatRate(d.rate)           : "",
          hasData ? formatAmount(d.amount)       : ""
        );
      });
      dr.push(
        pctLowestNum !== null ? `${pctLowestNum > 0 ? "+" : pctLowestNum < 0 ? "-" : ""}${Math.abs(pctLowestNum)}%` : "",
        pctLastNum   !== null ? `${pctLastNum   > 0 ? "+" : pctLastNum   < 0 ? "-" : ""}${Math.abs(pctLastNum)}%`   : ""
      );
      return dr;
    });

    const l1TotRow = ["", "Total MT / Avg Rate", l1Summary.grandTotalMt > 0 ? parseFloat(l1Summary.grandTotalMt).toFixed(2) : ""];
    l1TotRow.push(
      qtyMtSummary.lowestPurchaseWeightedAvg !== null ? formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg)) : "",
      qtyMtSummary.lastPurchaseWeightedAvg   !== null ? formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg))   : ""
    );
    suppliers.forEach(sup => {
      const t = l1Summary.supplierTotals[sup];
      l1TotRow.push(
        t.totalMt > 0            ? parseFloat(t.totalMt).toFixed(2)            : "",
        t.weightedAvgRate != null ? formatRate(Math.round(t.weightedAvgRate))   : "",
        t.totalAmount > 0         ? formatAmount(t.totalAmount)                 : ""
      );
    });
    l1TotRow.push("", "");

    const l1AvgRow = ["", "Avg of Quoted (L1)", "", "", ""];
    suppliers.forEach(sup => {
      const avgRate = l1Summary.supplierTotals[sup]?.weightedAvgRate;
      l1AvgRow.push("", avgRate != null ? formatRate(Math.round(avgRate)) : "", "");
    });
    l1AvgRow.push("", "");

    const wsL1 = XLSX.utils.aoa_to_sheet([l1H1, l1H2, ...l1DataRows, l1TotRow, l1AvgRow]);
    const l1Merges = [
      { s: { r: 0, c: 0 }, e: { r: 1, c: 0 } },
      { s: { r: 0, c: 1 }, e: { r: 1, c: 1 } },
      { s: { r: 0, c: 2 }, e: { r: 1, c: 2 } },
      { s: { r: 0, c: 3 }, e: { r: 0, c: 4 } },
      { s: { r: 0, c: 5 }, e: { r: 0, c: 6 } },
    ];
    let lc = 5;
    suppliers.forEach(() => { l1Merges.push({ s: { r: 0, c: lc }, e: { r: 0, c: lc + 2 } }); lc += 3; });
    l1Merges.push({ s: { r: 0, c: lc }, e: { r: 0, c: lc + 1 } });
    wsL1["!merges"] = l1Merges;
    wsL1["!freeze"] = { ySplit: 2 };
    const l1ColW = [6, 32, 10, 20, 20];
    suppliers.forEach(() => { l1ColW.push(10, 14, 16); });
    l1ColW.push(18, 18);
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
            {uniqueEnquiryNos.map(no => <option key={no} value={no}>{no}</option>)}
          </select>
        </div>
        <div className="cs-filter-group">
          <label className="cs-filter-label">Category</label>
          <select className="cs-filter-select" value={filterCategory}
            onChange={e => setFilterCategory(e.target.value)}>
            <option value="All">All</option>
            <option value="CT">CT</option>
            <option value="STRL">STRL</option>
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
        {(filterFY || filterEnquiryNo || filterCategory !== "All" || filterDate || filterEndDate) && (
          <button className="cs-clear-btn" onClick={() => { setFilterFY(""); setFilterEnquiryNo(""); setFilterCategory("All"); setFilterDate(""); setFilterEndDate(""); }}>
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
                <th className="cs-th cs-th-purchase" colSpan={2}>Lowest Purchase</th>
                <th className="cs-th cs-th-purchase" colSpan={2}>Last Purchase</th>
                {suppliers.map(sup => (
                  <th key={sup} className="cs-th cs-th-supplier" colSpan={2}>
                    <div className="cs-supplier-name">{sup}</div>
                  </th>
                ))}
                <th className="cs-th cs-th-pct" rowSpan={2}>% Increase<br /><span className="cs-th-pct-sub">vs Lowest Purchase</span></th>
                <th className="cs-th cs-th-pct-last" rowSpan={2}>% Increase<br /><span className="cs-th-pct-sub">vs Last Purchase</span></th>
              </tr>
              <tr className="cs-thead-subrow">
                <th className="cs-th cs-th-purchase-sub">Date</th>
                <th className="cs-th cs-th-purchase-sub">Amount</th>
                <th className="cs-th cs-th-purchase-sub">Date</th>
                <th className="cs-th cs-th-purchase-sub">Amount</th>
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
                const altLabel   = buildAltLabel(row);
                return (
                  <tr key={`${row.section}-${row.size}-${row.width}-${row.length}-${idx}`} className="cs-tr">
                    <td className="cs-td cs-td-sticky cs-td-sno">{idx + 1}</td>
                    <td className="cs-td cs-td-sticky cs-td-section">
                      <span className="cs-section-tag">{row.section || "—"}</span>
                      {altLabel && (
                        <div className="cs-alt-item-label">
                          {altLabel}
                        </div>
                      )}
                    </td>
                    <td className="cs-td cs-td-sticky cs-td-size">{row.size   || <span className="cs-na">—</span>}</td>
                    <td className="cs-td cs-td-sticky cs-td-size">{row.width  || <span className="cs-na">—</span>}</td>
                    <td className="cs-td cs-td-sticky cs-td-size">{row.length || <span className="cs-na">—</span>}</td>
                    <td className="cs-td cs-td-sticky cs-td-mt">{formatMT(row.sectionMt)}</td>
                    <td className="cs-td cs-td-purchase">
                      {row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0
                        ? (row.lowestPurchaseDate ? formatDate(row.lowestPurchaseDate) : "")
                        : null}
                    </td>
                    <td className="cs-td cs-td-purchase">
                      {row.lowestPurchaseRate != null && row.lowestPurchaseRate !== 0
                        ? <span className="cs-purchase-rate">₹ {formatRate(Math.round(row.lowestPurchaseRate))}</span>
                        : null}
                    </td>
                    <td className="cs-td cs-td-purchase">
                      {row.lastPurchaseRate != null && row.lastPurchaseRate !== 0
                        ? (row.lastPurchaseDate ? formatDate(row.lastPurchaseDate) : "")
                        : null}
                    </td>
                    <td className="cs-td cs-td-purchase">
                      {row.lastPurchaseRate != null && row.lastPurchaseRate !== 0
                        ? <span className="cs-purchase-rate">₹ {formatRate(Math.round(row.lastPurchaseRate))}</span>
                        : null}
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
                        ? <span className="cs-pct-value">{pctNum > 0 ? "+" : pctNum < 0 ? "-" : ""}{Math.abs(pctNum)}%</span>
                        : <span className="cs-no-quote">—</span>}
                    </td>
                    <td className={`cs-td cs-td-pct-last${pctLastNum !== null ? (pctLastNum > 0 ? " cs-td-pct-last--up" : pctLastNum < 0 ? " cs-td-pct-last--down" : " cs-td-pct-last--flat") : ""}`}>
                      {pctLastNum !== null
                        ? <span className="cs-pct-value">{pctLastNum > 0 ? "+" : pctLastNum < 0 ? "-" : ""}{Math.abs(pctLastNum)}%</span>
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
                  <span className="cs-avg-value">{qtyMtSummary.totalSectionMt > 0 ? parseFloat(qtyMtSummary.totalSectionMt).toFixed(2) : "—"}</span>
                </td>
                <td className="cs-td cs-td-purchase cs-qty-mt-purchase" />
                <td className="cs-td cs-td-purchase cs-qty-mt-purchase">
                  {qtyMtSummary.lowestPurchaseWeightedAvg !== null
                    ? <span className="cs-avg-value">₹ {formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg))}</span>
                    : null}
                </td>
                <td className="cs-td cs-td-purchase cs-qty-mt-purchase" />
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
                        {mt > 0 ? <span className="cs-rate-mt">{parseFloat(mt).toFixed(2)}</span> : null}
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
              <tr className="cs-tr cs-tr-avg-quoted">
                <td className="cs-td cs-td-sticky cs-td-sno" />
                <td className="cs-td cs-td-sticky cs-td-section cs-summary-label" colSpan={4}>
                  Avg of Quoted (L1)
                </td>
                <td className="cs-td cs-td-sticky cs-td-mt" />
                <td className="cs-td cs-td-purchase" />
                <td className="cs-td cs-td-purchase" />
                <td className="cs-td cs-td-purchase" />
                <td className="cs-td cs-td-purchase" />
                {suppliers.map(sup => {
                  const avgRate = l1Summary.supplierTotals[sup]?.weightedAvgRate;
                  return (
                    <>
                      <td key={`${sup}-avg-mt`} className="cs-td cs-td-supplier-mt" />
                      <td key={`${sup}-avg-rate`} className="cs-td cs-td-rate cs-td-avg-rate">
                        {avgRate != null
                          ? <span className="cs-avg-value">₹ {formatRate(Math.round(avgRate))}</span>
                          : null}
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
                  <th className="cs-l1-th cs-l1-th-supplier" colSpan={2} style={{ textAlign: "center" }}>Lowest Purchase</th>
                  <th className="cs-l1-th cs-l1-th-supplier" colSpan={2} style={{ textAlign: "center" }}>Last Purchase</th>
                  {suppliers.map(sup => (
                    <th key={sup} className="cs-l1-th cs-l1-th-supplier" colSpan={3} style={{ textAlign: "center" }}>{sup}</th>
                  ))}
                  <th className="cs-l1-th cs-l1-th-pct" colSpan={2} style={{ textAlign: "center" }}>% Increase</th>
                </tr>
                <tr>
                  <th className="cs-l1-th cs-l1-th-sub">Date</th>
                  <th className="cs-l1-th cs-l1-th-sub">Amount</th>
                  <th className="cs-l1-th cs-l1-th-sub">Date</th>
                  <th className="cs-l1-th cs-l1-th-sub">Amount</th>
                  {suppliers.map(sup => (
                    <>
                      <th key={`${sup}-mt`}   className="cs-l1-th cs-l1-th-sub">Mt</th>
                      <th key={`${sup}-rate`} className="cs-l1-th cs-l1-th-sub">Rate</th>
                      <th key={`${sup}-amt`}  className="cs-l1-th cs-l1-th-sub">Amount</th>
                    </>
                  ))}
                  <th className="cs-l1-th cs-l1-th-sub">vs Lowest Purchase</th>
                  <th className="cs-l1-th cs-l1-th-sub">vs Last Purchase</th>
                </tr>
              </thead>
              <tbody>
                {l1Summary.rowDetails.map((r, i) => {
                  const origRow = rows[r.idx] !== undefined ? rows[r.idx] : rows[i];
                  const l1Rate = r.l1Rate;
                  const pctLowest    = origRow ? formatPercent(l1Rate, origRow.lowestPurchaseRate) : null;
                  const pctLowestNum = pctLowest    !== null ? parseFloat(pctLowest)    : null;
                  const pctLast      = origRow ? formatPercent(l1Rate, origRow.lastPurchaseRate)   : null;
                  const pctLastNum   = pctLast      !== null ? parseFloat(pctLast)      : null;
                  const altLabel     = origRow ? buildAltLabel(origRow) : null;
                  return (
                    <tr key={i} className="cs-l1-tr">
                      <td className="cs-l1-sno">{i + 1}</td>
                      <td className="cs-l1-desc">
                        {r.description || "—"}
                        {altLabel && (
                          <div className="cs-alt-item-label">
                            {altLabel}
                          </div>
                        )}
                      </td>
                      <td className="cs-l1-num">{r.totalMt > 0 ? parseFloat(r.totalMt).toFixed(2) : "—"}</td>
                      <td className="cs-l1-num cs-td-purchase">
                        {origRow && origRow.lowestPurchaseRate != null && origRow.lowestPurchaseRate !== 0
                          ? (origRow.lowestPurchaseDate ? formatDate(origRow.lowestPurchaseDate) : "")
                          : null}
                      </td>
                      <td className="cs-l1-num cs-td-purchase">
                        {origRow && origRow.lowestPurchaseRate != null && origRow.lowestPurchaseRate !== 0
                          ? <span className="cs-purchase-rate">₹ {formatRate(Math.round(origRow.lowestPurchaseRate))}</span>
                          : null}
                      </td>
                      <td className="cs-l1-num cs-td-purchase">
                        {origRow && origRow.lastPurchaseRate != null && origRow.lastPurchaseRate !== 0
                          ? (origRow.lastPurchaseDate ? formatDate(origRow.lastPurchaseDate) : "")
                          : null}
                      </td>
                      <td className="cs-l1-num cs-td-purchase">
                        {origRow && origRow.lastPurchaseRate != null && origRow.lastPurchaseRate !== 0
                          ? <span className="cs-purchase-rate">₹ {formatRate(Math.round(origRow.lastPurchaseRate))}</span>
                          : null}
                      </td>
                      {suppliers.map(sup => {
                        const d = r.supplierData[sup];
                        const hasData = d && d.rate;
                        return (
                          <>
                            <td key={`${sup}-mt`}
                              className={`cs-l1-num${hasData ? " cs-l1-cell-active" : " cs-l1-cell-empty"}`}>
                              {hasData ? parseFloat(d.mt).toFixed(2) : ""}
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
                      <td className={`cs-l1-num${pctLowestNum !== null ? (pctLowestNum > 0 ? " cs-td-pct--up" : pctLowestNum < 0 ? " cs-td-pct--down" : " cs-td-pct--flat") : ""}`}>
                        {pctLowestNum !== null
                          ? <span className="cs-pct-value">{pctLowestNum > 0 ? "+" : pctLowestNum < 0 ? "-" : ""}{Math.abs(pctLowestNum)}%</span>
                          : <span className="cs-no-quote">—</span>}
                      </td>
                      <td className={`cs-l1-num${pctLastNum !== null ? (pctLastNum > 0 ? " cs-td-pct-last--up" : pctLastNum < 0 ? " cs-td-pct-last--down" : " cs-td-pct-last--flat") : ""}`}>
                        {pctLastNum !== null
                          ? <span className="cs-pct-value">{pctLastNum > 0 ? "+" : pctLastNum < 0 ? "-" : ""}{Math.abs(pctLastNum)}%</span>
                          : <span className="cs-no-quote">—</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="cs-l1-totals">
                  <td className="cs-l1-sno" />
                  <td className="cs-l1-totals-label">Total MT / Avg Rate</td>
                  <td className="cs-l1-num cs-l1-totals-grand-mt">
                    {l1Summary.grandTotalMt > 0 ? parseFloat(l1Summary.grandTotalMt).toFixed(2) : "—"}
                  </td>
                  <td className="cs-l1-num cs-l1-totals-val" />
                  <td className="cs-l1-num cs-l1-totals-val">
                    {qtyMtSummary.lowestPurchaseWeightedAvg !== null
                      ? <span className="cs-avg-value">₹ {formatRate(Math.round(qtyMtSummary.lowestPurchaseWeightedAvg))}</span>
                      : "—"}
                  </td>
                  <td className="cs-l1-num cs-l1-totals-val" />
                  <td className="cs-l1-num cs-l1-totals-val">
                    {qtyMtSummary.lastPurchaseWeightedAvg !== null
                      ? <span className="cs-avg-value">₹ {formatRate(Math.round(qtyMtSummary.lastPurchaseWeightedAvg))}</span>
                      : "—"}
                  </td>
                  {suppliers.map(sup => {
                    const t = l1Summary.supplierTotals[sup];
                    return (
                      <>
                        <td key={`${sup}-tot-mt`}   className="cs-l1-num cs-l1-totals-val">
                          {t.totalMt > 0 ? parseFloat(t.totalMt).toFixed(2) : "—"}
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
                  <td className="cs-l1-num" />
                  <td className="cs-l1-num" />
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}