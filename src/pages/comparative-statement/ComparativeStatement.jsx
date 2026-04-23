import { useState, useEffect } from "react";
import { db } from "../../firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import EnquiryManager from "../EnquiryManager/EnquiryManager";
import "./ComparativeStatement.css";

export default function ComparativeStatement() {
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [purchaseEntries, setPurchaseEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showManager, setShowManager] = useState(false);

  // Filters
  const [filterFY, setFilterFY] = useState("");
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
    if (filterDate) result = result.filter(e => e.EnquiryDate === filterDate);
    setFilteredEntries(result);
  }, [filterFY, filterDate, allEntries]);

  // ── Build purchase rate lookup: { "Section||Size" -> { lowestRate, lastRate, lastDate } }
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
          lookup.set(key, { lowestRate: rate, lastRate: rate, lastDate: billDate, lastNo: entry.No });
        } else {
          const existing = lookup.get(key);
          if (rate < existing.lowestRate) existing.lowestRate = rate;
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
          if (sr.supplier) supplierSet.add(sr.supplier);
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
            lastPurchaseRate: purchaseData ? purchaseData.lastRate : null,
            lastPurchaseDate: purchaseData ? purchaseData.lastDate : null,
            rates: {},
          });
        }

        const row = rowMap.get(key);
        row.sectionMt = sectionMt;

        (sec.supplierRates || []).forEach(sr => {
          if (!sr.supplier) return;
          const rate = parseFloat(sr.rate) || 0;
          const supplierMt = parseFloat(sr.mt) || 0;
          if (!row.rates[sr.supplier] || rate < row.rates[sr.supplier].rate) {
            row.rates[sr.supplier] = {
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
        </div>
      </div>

      {/* ── Filters ── */}
      <div className="cs-filters">
        <div className="cs-filter-group">
          <label className="cs-filter-label">Financial Year</label>
          <select
            className="cs-filter-select"
            value={filterFY}
            onChange={e => setFilterFY(e.target.value)}
          >
            <option value="">All Years</option>
            {uniqueFYs.map(fy => (
              <option key={fy} value={fy}>{fy}</option>
            ))}
          </select>
        </div>

        <div className="cs-filter-group">
          <label className="cs-filter-label">Enquiry Date</label>
          <input
            className="cs-filter-input"
            type="date"
            value={filterDate}
            onChange={e => setFilterDate(e.target.value)}
          />
        </div>

        {(filterFY || filterDate) && (
          <button
            className="cs-clear-btn"
            onClick={() => { setFilterFY(""); setFilterDate(""); }}
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
                        <span className="cs-purchase-rate">
                          ₹ {formatRate(row.lowestPurchaseRate)}
                        </span>
                      ) : (
                        <span className="cs-no-quote">No Data</span>
                      )}
                    </td>

                    {/* Last Purchase Rate */}
                    <td className="cs-td cs-td-purchase">
                      {row.lastPurchaseRate ? (
                        <div className="cs-last-purchase-cell">
                          <span className="cs-purchase-rate">
                            ₹ {formatRate(row.lastPurchaseRate)}
                          </span>
                          {row.lastPurchaseDate && (
                            <span className="cs-purchase-date">{row.lastPurchaseDate}</span>
                          )}
                        </div>
                      ) : (
                        <span className="cs-no-quote">No Data</span>
                      )}
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
                            ) : (
                              <span className="cs-no-quote">—</span>
                            )}
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
                            ) : (
                              <span className="cs-no-quote">No Quote</span>
                            )}
                          </td>
                        </>
                      );
                    })}

                    {/* % Increase vs Lowest Purchase */}
                    <td className={`cs-td cs-td-pct${pctNum !== null ? (pctNum > 0 ? " cs-td-pct--up" : pctNum < 0 ? " cs-td-pct--down" : " cs-td-pct--flat") : ""}`}>
                      {pctNum !== null ? (
                        <span className="cs-pct-value">
                          {pctNum > 0 ? "▲" : pctNum < 0 ? "▼" : "="} {Math.abs(pctNum)}%
                        </span>
                      ) : (
                        <span className="cs-no-quote">—</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
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
