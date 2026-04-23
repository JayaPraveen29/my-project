import { useState, useEffect } from "react";
import { db } from "../../firebase";
import { collection, getDocs, query, orderBy } from "firebase/firestore";
import EnquiryManager from "../EnquiryManager/EnquiryManager";
import "./ComparativeStatement.css";

export default function ComparativeStatement() {
  const [allEntries, setAllEntries] = useState([]);
  const [filteredEntries, setFilteredEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showManager, setShowManager] = useState(false);

  // Filters
  const [filterFY, setFilterFY] = useState("");
  const [filterDate, setFilterDate] = useState("");

  // ── Fetch all enquiry entries ──────────────────────────────────────────────
  const fetchEntries = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "enquiryEntries"), orderBy("No", "asc"));
      const snap = await getDocs(q);
      const data = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setAllEntries(data);
      setFilteredEntries(data);
    } catch (e) {
      console.error("Error fetching enquiry entries:", e);
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

    const rowMap = new Map();

    filteredEntries.forEach(entry => {
      (entry.sections || []).forEach(sec => {
        const section = sec.section || "";
        const size = sec.size || "";
        const mt = sec.mt || 0;
        const key = `${section}||${size}`;

        if (!rowMap.has(key)) {
          rowMap.set(key, { section, size, mt, rates: {} });
        }

        const row = rowMap.get(key);
        row.mt = mt;

        (sec.supplierRates || []).forEach(sr => {
          if (!sr.supplier) return;
          const rate = parseFloat(sr.rate) || 0;
          if (!row.rates[sr.supplier] || rate < row.rates[sr.supplier].rate) {
            row.rates[sr.supplier] = {
              rate,
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

  const formatRate = (rate) =>
    rate != null && rate > 0
      ? rate.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      : "—";

  const formatMT = (mt) =>
    parseFloat(mt)
      ? parseFloat(mt).toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 })
      : "—";

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
              <tr className="cs-thead-row">
                <th className="cs-th cs-th-sticky cs-th-sno">S.No</th>
                <th className="cs-th cs-th-sticky cs-th-section">Section</th>
                <th className="cs-th cs-th-sticky cs-th-size">Size</th>
                <th className="cs-th cs-th-sticky cs-th-mt">Qty (MT)</th>
                {suppliers.map(sup => (
                  <th key={sup} className="cs-th cs-th-supplier">
                    <div className="cs-supplier-name">{sup}</div>
                    <div className="cs-supplier-sub">Rate (₹/MT)</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, idx) => (
                <tr key={`${row.section}-${row.size}-${idx}`} className="cs-tr">
                  <td className="cs-td cs-td-sticky cs-td-sno">{idx + 1}</td>
                  <td className="cs-td cs-td-sticky cs-td-section">
                    <span className="cs-section-tag">{row.section || "—"}</span>
                  </td>
                  <td className="cs-td cs-td-sticky cs-td-size">
                    {row.size || <span className="cs-na">—</span>}
                  </td>
                  <td className="cs-td cs-td-sticky cs-td-mt">
                    {formatMT(row.mt)}
                  </td>
                  {suppliers.map(sup => {
                    const rateObj = row.rates[sup];
                    const rate = rateObj ? rateObj.rate : null;
                    const isLowest = rate != null && rate > 0 && rate === row.minRate;

                    return (
                      <td
                        key={sup}
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
                    );
                  })}
                </tr>
              ))}
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
