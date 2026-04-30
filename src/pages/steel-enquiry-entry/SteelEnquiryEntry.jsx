import { useState, useEffect, useRef, useCallback } from "react";
import { createPortal } from "react-dom";
import { db } from "../../firebase";
import {
  collection, addDoc, getDocs, deleteDoc, doc, query, orderBy, updateDoc
} from "firebase/firestore";
import "./SteelEnquiryEntry.css";

// ── helpers ──────────────────────────────────────────────────────────────────
const genId = () => `${Date.now()}_${Math.random().toString(36).slice(2)}`;

const emptySupplierRate = (supplier = "") => ({
  id: genId(), supplier, mt: "", rate: "",
});

const emptySection = () => ({
  id: genId(),
  sectionText: "", sectionConfirmed: "",
  sizeText: "",    sizeConfirmed: "",
  widthText: "",   widthConfirmed: "",
  lengthText: "",  lengthConfirmed: "",
  mt: "",
  supplierRates: [],
});

// ── Number format helpers ─────────────────────────────────────────────────────
const formatMT = (val) => {
  if (val === "" || val == null) return "";
  const num = parseFloat(val);
  if (isNaN(num)) return "";
  return num.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

const formatRate = (val) => {
  if (val === "" || val == null) return "";
  const num = parseFloat(val);
  if (isNaN(num)) return "";
  return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatTotalMT = (val) => {
  if (!val && val !== 0) return "—";
  return val.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
};

const formatWeightedRate = (val) => {
  if (!val && val !== 0) return "—";
  return `≈${val.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

// ── Numeric input that shows formatted value when not focused ─────────────────
function NumericInput({ value, onChange, placeholder, formatFn, className }) {
  const [focused, setFocused] = useState(false);
  return (
    <input
      className={className}
      type="text"
      inputMode="decimal"
      placeholder={placeholder}
      value={focused ? value : (value !== "" ? formatFn(value) : "")}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onChange={e => onChange(e.target.value)}
    />
  );
}

// ── Portal-based dropdown — renders at document.body to escape table overflow ──
function CellCombobox({ value, onChange, onConfirm, onAddNew, options, placeholder, disabled }) {
  const [open, setOpen] = useState(false);
  const [dropPos, setDropPos] = useState({ top: 0, left: 0, width: 0 });
  const inputRef = useRef(null);
  const dropRef  = useRef(null);

  const filtered = value.trim()
    ? options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
    : options;
  const isMatch = options.some(o => o.toLowerCase() === value.trim().toLowerCase());

  // Recalculate dropdown position every time it opens or window scrolls/resizes
  const calcPos = useCallback(() => {
    if (!inputRef.current) return;
    const r = inputRef.current.getBoundingClientRect();
    setDropPos({
      top:   r.bottom + window.scrollY + 2,
      left:  r.left   + window.scrollX,
      width: r.width,
    });
  }, []);

  useEffect(() => {
    if (!open) return;
    calcPos();
    window.addEventListener("scroll", calcPos, true);
    window.addEventListener("resize", calcPos);
    return () => {
      window.removeEventListener("scroll", calcPos, true);
      window.removeEventListener("resize", calcPos);
    };
  }, [open, calcPos]);

  // Close on outside click
  useEffect(() => {
    const h = (e) => {
      if (
        inputRef.current && !inputRef.current.contains(e.target) &&
        dropRef.current  && !dropRef.current.contains(e.target)
      ) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    return () => document.removeEventListener("mousedown", h);
  }, []);

  const dropdownEl = open && !disabled ? createPortal(
    <div
      ref={dropRef}
      className="see-cell-dropdown"
      style={{
        position: "absolute",
        top:    dropPos.top,
        left:   dropPos.left,
        width:  Math.max(dropPos.width, 180),
        zIndex: 999999,
      }}
    >
      {filtered.map(opt => (
        <div
          key={opt}
          className={`see-cell-opt${value === opt ? " see-cell-opt--active" : ""}`}
          onMouseDown={() => { onChange(opt); onConfirm(opt); setOpen(false); }}
        >{opt}</div>
      ))}
      {!isMatch && value.trim() && (
        <div
          className="see-cell-opt see-cell-opt--add"
          onMouseDown={async () => {
            if (onAddNew) await onAddNew(value.trim());
            onConfirm(value.trim()); setOpen(false);
          }}
        >＋ Add "{value.trim()}"</div>
      )}
      {filtered.length === 0 && !value.trim() && (
        <div className="see-cell-empty">No options</div>
      )}
    </div>,
    document.body
  ) : null;

  return (
    <div className="see-cell-combo">
      <input
        ref={inputRef}
        className={`see-cell-input${disabled ? " see-cell-input--disabled" : ""}`}
        value={value}
        placeholder={disabled ? "—" : placeholder}
        disabled={disabled}
        autoComplete="off"
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => { if (!disabled) { calcPos(); setOpen(true); } }}
        onBlur={() => setTimeout(() => setOpen(false), 180)}
        onKeyDown={e => {
          if (e.key === "Enter" && filtered.length > 0) {
            onChange(filtered[0]); onConfirm(filtered[0]); setOpen(false);
          }
          if (e.key === "Escape") setOpen(false);
        }}
      />
      {dropdownEl}
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function SteelEnquiryEntry() {
  const [loading, setLoading]   = useState(false);
  const [saving, setSaving]     = useState(false);

  // Header
  const [financialYear, setFinancialYear] = useState("2026-27");
  const [enquiryNo, setEnquiryNo]         = useState("");
  const [enquiryDate, setEnquiryDate]     = useState("");

  // Sections (rows) and global supplier columns
  const [sections, setSections]   = useState([emptySection()]);
  const [suppliers, setSuppliers] = useState([]);

  // Master data
  const [sectionDocs, setSectionDocs]     = useState([]);
  const [supplierDocs, setSupplierDocs]   = useState([]);
  const [allSizeDocs, setAllSizeDocs]     = useState([]);
  const [allWidthDocs, setAllWidthDocs]   = useState([]);
  const [allLengthDocs, setAllLengthDocs] = useState([]);
  const [sectionSizeRels, setSectionSizeRels] = useState([]);
  const [sizeWidthRels, setSizeWidthRels]     = useState([]);
  const [widthLengthRels, setWidthLengthRels] = useState([]);

  // Existing enquiries for "load" dropdown
  const [existingEnquiries, setExistingEnquiries] = useState([]);
  const [showLoadDropdown, setShowLoadDropdown]   = useState(false);
  const [loadedEnquiryId, setLoadedEnquiryId]     = useState(null); // tracks currently-open enquiry

  const allSectionValues  = sectionDocs.map(d => d.value);
  const allSupplierValues = supplierDocs.map(d => d.value);
  const allSizeValues     = allSizeDocs.map(d => d.value);
  const allWidthValues    = allWidthDocs.map(d => d.value);
  const allLengthValues   = allLengthDocs.map(d => d.value);

  // ── Fetch master data ────────────────────────────────────────────────────
  const fetchMaster = useCallback(async () => {
    setLoading(true);
    try {
      const [sectSnap, sizeSnap, widthSnap, lenSnap, suppSnap,
             ssSnap, swSnap, wlSnap, enqSnap] = await Promise.all([
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "sizes")),
        getDocs(collection(db, "widths")),
        getDocs(collection(db, "itemLengths")),
        getDocs(collection(db, "suppliers")),
        getDocs(collection(db, "sectionSizeRelations")),
        getDocs(collection(db, "sizeWidthRelations")),
        getDocs(collection(db, "widthLengthRelations")),
        getDocs(query(collection(db, "enquiryEntries"), orderBy("No", "asc"))),
      ]);
      const mapD = snap => snap.docs
        .map(d => ({ id: d.id, value: d.data().value?.trim() || "" }))
        .filter(i => i.value)
        .sort((a, b) => a.value.localeCompare(b.value));
      setSectionDocs(mapD(sectSnap));
      setAllSizeDocs(mapD(sizeSnap));
      setAllWidthDocs(mapD(widthSnap));
      setAllLengthDocs(mapD(lenSnap));
      setSupplierDocs(mapD(suppSnap));
      setSectionSizeRels(ssSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSizeWidthRels(swSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setWidthLengthRels(wlSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setExistingEnquiries(enqSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchMaster(); }, [fetchMaster]);

  // ── Relation helpers ─────────────────────────────────────────────────────
  const getSizes = (sec) => {
    if (!sec) return allSizeValues;
    const sObj = sectionDocs.find(s => s.value === sec);
    if (!sObj) return allSizeValues;
    const ids = sectionSizeRels.filter(r => r.sectionId === sObj.id).map(r => r.sizeId);
    const f = allSizeDocs.filter(s => ids.includes(s.id)).map(d => d.value);
    return f.length ? f : allSizeValues;
  };

  const getWidths = (sec, size) => {
    if (!sec || !size) return allWidthValues;
    const sObj  = sectionDocs.find(s => s.value === sec);
    const szObj = allSizeDocs.find(s => s.value === size);
    if (!sObj || !szObj) return allWidthValues;
    const ids = sizeWidthRels
      .filter(r => r.sectionId === sObj.id && r.sizeId === szObj.id)
      .map(r => r.widthId);
    const f = allWidthDocs.filter(w => ids.includes(w.id)).map(d => d.value);
    return f.length ? f : allWidthValues;
  };

  const getLengths = (sec, size, width) => {
    if (!sec || !size) return allLengthValues;
    const sObj  = sectionDocs.find(s => s.value === sec);
    const szObj = allSizeDocs.find(s => s.value === size);
    const wObj  = width ? allWidthDocs.find(w => w.value === width) : null;
    if (!sObj || !szObj) return allLengthValues;
    const ids = widthLengthRels
      .filter(r =>
        r.sectionId === sObj.id && r.sizeId === szObj.id &&
        (wObj ? r.widthId === wObj.id : r.widthId === null)
      )
      .map(r => r.lengthId);
    const f = allLengthDocs.filter(l => ids.includes(l.id)).map(d => d.value);
    return f.length ? f : allLengthValues;
  };

  // ── Add-to-master helpers ────────────────────────────────────────────────
  const addSection_master = async (val) => {
    if (allSectionValues.some(s => s.toLowerCase() === val.toLowerCase())) return;
    await addDoc(collection(db, "sections"), { value: val });
    await fetchMaster();
  };

  const addSupplier_master = async (val) => {
    if (allSupplierValues.some(s => s.toLowerCase() === val.toLowerCase())) return;
    await addDoc(collection(db, "suppliers"), { value: val });
    await fetchMaster();
  };

  const addSize_master = async (val, secConfirmed) => {
    const exists = allSizeValues.some(s => s.toLowerCase() === val.toLowerCase());
    let docId;
    if (!exists) {
      const ref = await addDoc(collection(db, "sizes"), { value: val });
      docId = ref.id;
    } else {
      docId = allSizeDocs.find(s => s.value.toLowerCase() === val.toLowerCase())?.id;
    }
    if (secConfirmed && docId) {
      const sObj = sectionDocs.find(s => s.value === secConfirmed);
      if (sObj) {
        const linked = sectionSizeRels.some(r => r.sectionId === sObj.id && r.sizeId === docId);
        if (!linked) await addDoc(collection(db, "sectionSizeRelations"), { sectionId: sObj.id, sizeId: docId });
      }
    }
    await fetchMaster();
  };

  // ── Section field updater ─────────────────────────────────────────────────
  const updateSection = (sid, field, value) => {
    setSections(prev => prev.map(s => {
      if (s.id !== sid) return s;
      const u = { ...s, [field]: value };
      if (field === "sectionConfirmed") { u.sizeText = ""; u.sizeConfirmed = ""; u.widthText = ""; u.widthConfirmed = ""; u.lengthText = ""; u.lengthConfirmed = ""; }
      if (field === "sizeConfirmed")    { u.widthText = ""; u.widthConfirmed = ""; u.lengthText = ""; u.lengthConfirmed = ""; }
      if (field === "widthConfirmed")   { u.lengthText = ""; u.lengthConfirmed = ""; }
      return u;
    }));
  };

  // ── Supplier column management ────────────────────────────────────────────
  const addSupplierColumn = () => {
    const newSup = { id: genId(), name: "", nameText: "", confirmed: false };
    setSuppliers(prev => [...prev, newSup]);
    setSections(prev => prev.map(s => ({
      ...s,
      supplierRates: [...s.supplierRates, emptySupplierRate()],
    })));
  };

  const updateSupplierName = (supId, text) => {
    setSuppliers(prev => prev.map(s => s.id === supId ? { ...s, nameText: text, name: text } : s));
  };

  const confirmSupplierName = (supId, name) => {
    setSuppliers(prev => prev.map(s => s.id === supId ? { ...s, name, nameText: name, confirmed: true } : s));
    const colIdx = suppliers.findIndex(s => s.id === supId);
    if (colIdx >= 0) {
      setSections(prev => prev.map(sec => {
        const rates = [...sec.supplierRates];
        if (rates[colIdx]) rates[colIdx] = { ...rates[colIdx], supplier: name };
        return { ...sec, supplierRates: rates };
      }));
    }
  };

  const removeSupplierColumn = (supId) => {
    const idx = suppliers.findIndex(s => s.id === supId);
    setSuppliers(prev => prev.filter(s => s.id !== supId));
    setSections(prev => prev.map(sec => ({
      ...sec,
      supplierRates: sec.supplierRates.filter((_, i) => i !== idx),
    })));
  };

  // ── Rate cell updater ─────────────────────────────────────────────────────
  const updateRate = (secId, colIdx, field, value) => {
    setSections(prev => prev.map(s => {
      if (s.id !== secId) return s;
      const rates = s.supplierRates.map((r, i) => i === colIdx ? { ...r, [field]: value } : r);
      return { ...s, supplierRates: rates };
    }));
  };

  // ── Add/Remove section rows ───────────────────────────────────────────────
  const addSectionRow = () => {
    const newSec = emptySection();
    newSec.supplierRates = suppliers.map(s => emptySupplierRate(s.name));
    setSections(prev => [...prev, newSec]);
  };

  const removeSectionRow = (id) => {
    if (sections.length === 1) return;
    setSections(prev => prev.filter(s => s.id !== id));
  };

  // ── Clear / New Enquiry ───────────────────────────────────────────────────
  const clearEnquiry = () => {
    if (enquiryNo || sections.some(s => s.sectionText || s.mt) || suppliers.length > 0) {
      if (!window.confirm("Close current enquiry and start a new one? Unsaved changes will be lost.")) return;
    }
    setEnquiryNo("");
    setEnquiryDate("");
    setFinancialYear("2026-27");
    setSections([emptySection()]);
    setSuppliers([]);
    setLoadedEnquiryId(null);
  };

  // ── Close loaded enquiry (just clears form, no confirm if nothing changed) ──
  const closeEnquiry = () => {
    setEnquiryNo("");
    setEnquiryDate("");
    setFinancialYear("2026-27");
    setSections([emptySection()]);
    setSuppliers([]);
    setLoadedEnquiryId(null);
  };

  // ── Delete enquiry from Firestore ─────────────────────────────────────────
  const deleteEnquiry = async (e, enqDoc) => {
    e.stopPropagation(); // don't trigger load
    if (!window.confirm(`Delete Enquiry #${enqDoc.No} (${enqDoc.FinancialYear})? This cannot be undone.`)) return;
    try {
      await deleteDoc(doc(db, "enquiryEntries", enqDoc.id));
      // If the deleted one is currently open, clear the form
      if (loadedEnquiryId === enqDoc.id) closeEnquiry();
      await fetchMaster();
    } catch (err) {
      console.error(err);
      alert("Delete failed. Please try again.");
    }
  };

  // ── Load existing enquiry ────────────────────────────────────────────────
  const loadEnquiry = (enq) => {
    setEnquiryNo(String(enq.No || ""));
    setEnquiryDate(enq.EnquiryDate || "");
    setFinancialYear(enq.FinancialYear || "2026-27");

    const supNames = [];
    (enq.sections || []).forEach(sec => {
      (sec.supplierRates || []).forEach(sr => {
        if (sr.supplier && !supNames.includes(sr.supplier)) supNames.push(sr.supplier);
      });
    });
    const newSuppliers = supNames.map(name => ({ id: genId(), name, nameText: name, confirmed: true }));
    setSuppliers(newSuppliers);

    const newSections = (enq.sections || []).map(sec => ({
      id: genId(),
      sectionText: sec.section || "", sectionConfirmed: sec.section || "",
      sizeText: sec.size || "",       sizeConfirmed: sec.size || "",
      widthText: sec.width || "",     widthConfirmed: sec.width || "",
      lengthText: sec.length || "",   lengthConfirmed: sec.length || "",
      mt: String(sec.mt || ""),
      supplierRates: newSuppliers.map(sup => {
        const found = (sec.supplierRates || []).find(r => r.supplier === sup.name);
        return {
          id: genId(),
          supplier: sup.name,
          mt:   found ? String(found.mt   || "") : "",
          rate: found ? String(found.rate || "") : "",
        };
      }),
    }));
    setSections(newSections);
    setShowLoadDropdown(false);
    setLoadedEnquiryId(enq.id);
  };

  // ── Submit ────────────────────────────────────────────────────────────────
  const handleSave = async () => {
    if (!enquiryNo.trim()) return alert("Please enter an Enquiry No.");
    if (!enquiryDate)      return alert("Please select an Enquiry Date.");
    for (const sec of sections) {
      if (!sec.sectionConfirmed && !sec.sectionText.trim()) return alert("Please fill Section for all rows.");
      if (!sec.mt) return alert("Please enter MT for all section rows.");
    }
    setSaving(true);
    try {
      const payload = {
        No: enquiryNo.trim(),
        FinancialYear: financialYear,
        EnquiryDate: enquiryDate,
        sections: sections.map(s => ({
          section: s.sectionConfirmed || s.sectionText.trim(),
          size:    s.sizeConfirmed    || s.sizeText.trim(),
          width:   s.widthConfirmed   || s.widthText.trim(),
          length:  s.lengthConfirmed  || s.lengthText.trim(),
          mt:      parseFloat(s.mt) || 0,
          supplierRates: s.supplierRates
            .map((r, i) => ({
              supplier: suppliers[i]?.name || r.supplier || "",
              mt:       parseFloat(r.mt)   || 0,
              rate:     parseFloat(r.rate) || 0,
            }))
            .filter(r => r.supplier),
        })),
        createdAt: new Date(),
      };
      const existing = existingEnquiries.find(
        e => String(e.No).trim().toLowerCase() === enquiryNo.trim().toLowerCase()
          && e.FinancialYear === financialYear
      );
      if (existing) {
        await updateDoc(doc(db, "enquiryEntries", existing.id), payload);
        alert("Enquiry Updated Successfully!");
      } else {
        await addDoc(collection(db, "enquiryEntries"), payload);
        alert("Enquiry Saved Successfully!");
      }
      setEnquiryNo(""); setEnquiryDate("");
      setSections([emptySection()]); setSuppliers([]);
      setLoadedEnquiryId(null);
      await fetchMaster();
    } catch (e) {
      console.error(e);
      alert("Save failed. Please try again.");
    } finally {
      setSaving(false);
    }
  };

  // ── Totals ────────────────────────────────────────────────────────────────
  const totalSectionMt = sections.reduce((s, r) => s + (parseFloat(r.mt) || 0), 0);

  const getSupplierTotals = (colIdx) => {
    let totalMt = 0, num = 0, den = 0;
    sections.forEach(r => {
      const m = parseFloat(r.supplierRates[colIdx]?.mt)   || 0;
      const v = parseFloat(r.supplierRates[colIdx]?.rate) || 0;
      totalMt += m;
      num += m * v;
      den += m;
    });
    return { totalMt, weightedRate: den > 0 ? num / den : null };
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="see-root">

      {/* ── Top Header Band ── */}
      <div className="see-header">
        <div className="see-header-left">
          <div className="see-header-icon">📋</div>
          <div>
            <div className="see-header-title">Steel Enquiry Entry</div>
            <div className="see-header-sub">Enter enquiry details section-wise with supplier rates</div>
          </div>
        </div>
        <div className="see-header-right">
          <span className="see-fy-chip">{financialYear}</span>
        </div>
      </div>

      {/* ── Meta Row ── */}
      <div className="see-meta-bar">
        <div className="see-meta-field">
          <label className="see-meta-label">Enquiry No</label>
          <div className="see-enq-no-wrap" style={{ position: "relative" }}>
            <input
              className="see-meta-input"
              placeholder="e.g. 1a, 2b …"
              value={enquiryNo}
              onChange={e => setEnquiryNo(e.target.value)}
            />
            <button
              className="see-load-btn"
              title="Load existing enquiry"
              onClick={() => setShowLoadDropdown(v => !v)}
              type="button"
            >▾ Load</button>
            {showLoadDropdown && existingEnquiries.length > 0 && (
              <div className="see-load-dropdown">
                <div className="see-load-dropdown-title">Select Enquiry to Load</div>
                <div className="see-load-list">
                  {existingEnquiries.map(e => (
                    <div key={e.id} className={`see-load-opt${loadedEnquiryId === e.id ? " see-load-opt--active" : ""}`}>
                      <div className="see-load-opt-info" onClick={() => loadEnquiry(e)}>
                        <span className="see-load-no">#{e.No}</span>
                        <span className="see-load-date">{e.EnquiryDate || "—"}</span>
                        <span className="see-load-fy">{e.FinancialYear}</span>
                        {loadedEnquiryId === e.id && <span className="see-load-open-badge">Open</span>}
                      </div>
                      <button
                        className="see-load-delete-btn"
                        title={`Delete Enquiry #${e.No}`}
                        onMouseDown={(ev) => deleteEnquiry(ev, e)}
                        type="button"
                      >🗑</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="see-meta-field">
          <label className="see-meta-label">Enquiry Date</label>
          <input
            className="see-meta-input"
            type="date"
            value={enquiryDate}
            onChange={e => setEnquiryDate(e.target.value)}
          />
        </div>

        <div className="see-meta-field">
          <label className="see-meta-label">Financial Year</label>
          <select
            className="see-meta-input see-meta-select"
            value={financialYear}
            onChange={e => setFinancialYear(e.target.value)}
          >
            {["2024-25","2025-26","2026-27","2027-28"].map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>

        {/* New Enquiry button + Close button (only when one is open) */}
        <div className="see-meta-field see-meta-field--btn">
          <label className="see-meta-label">&nbsp;</label>
          <div className="see-meta-actions">
            {loadedEnquiryId && (
              <button
                className="see-close-enquiry-btn"
                onClick={closeEnquiry}
                type="button"
                title={`Close Enquiry #${enquiryNo}`}
              >
                ✕ Close #{enquiryNo}
              </button>
            )}
            <button
              className="see-new-enquiry-btn"
              onClick={clearEnquiry}
              type="button"
              title="Close current enquiry and open a new one"
            >
              ✦ New Enquiry
            </button>
          </div>
        </div>
      </div>

      {/* ── Spreadsheet Area ── */}
      <div className="see-sheet-outer">
        {loading ? (
          <div className="see-loading">Loading master data…</div>
        ) : (
          <div className="see-sheet-scroll">
            <table className="see-table">
              <thead>
                <tr className="see-thead-group">
                  <th className="see-th see-th-sno" rowSpan={2}>#</th>
                  <th className="see-th see-th-section" rowSpan={2}>Section</th>
                  <th className="see-th see-th-size" rowSpan={2}>Size</th>
                  <th className="see-th see-th-width" rowSpan={2}>Width</th>
                  <th className="see-th see-th-length" rowSpan={2}>Length</th>
                  <th className="see-th see-th-mt see-th-required" rowSpan={2}>
                    Qty (MT) <span className="see-req-star">*</span>
                  </th>
                  {suppliers.length > 0 && (
                    <th className="see-th see-th-sup-group" colSpan={suppliers.length * 2}>
                      Supplier Rates
                    </th>
                  )}
                  <th className="see-th see-th-actions" rowSpan={2}></th>
                </tr>
                <tr className="see-thead-subs">
                  {suppliers.map((sup, i) => (
                    <th key={sup.id} className="see-th-sup-pair" colSpan={2}>
                      <div className="see-sup-header">
                        {sup.confirmed ? (
                          <span className="see-sup-name">{sup.name}</span>
                        ) : (
                          <CellCombobox
                            value={sup.nameText}
                            options={allSupplierValues}
                            placeholder="Supplier name…"
                            onChange={t => updateSupplierName(sup.id, t)}
                            onConfirm={n => confirmSupplierName(sup.id, n)}
                            onAddNew={addSupplier_master}
                          />
                        )}
                        <button
                          className="see-sup-remove"
                          onClick={() => removeSupplierColumn(sup.id)}
                          title="Remove supplier column"
                          type="button"
                        >✕</button>
                      </div>
                      <div className="see-sup-subheads">
                        <span>Rate (Rs)</span>
                        <span>MT</span>
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>

              <tbody>
                {sections.map((sec, rowIdx) => (
                  <tr key={sec.id} className={`see-row${rowIdx % 2 === 0 ? "" : " see-row--alt"}`}>

                    <td className="see-td see-td-sno">{rowIdx + 1}</td>

                    <td className="see-td see-td-section">
                      <CellCombobox
                        value={sec.sectionText}
                        options={allSectionValues}
                        placeholder="Section…"
                        onChange={v => updateSection(sec.id, "sectionText", v)}
                        onConfirm={v => updateSection(sec.id, "sectionConfirmed", v)}
                        onAddNew={addSection_master}
                      />
                    </td>

                    <td className="see-td see-td-size">
                      <CellCombobox
                        value={sec.sizeText}
                        options={getSizes(sec.sectionConfirmed)}
                        placeholder="Size…"
                        disabled={!sec.sectionConfirmed}
                        onChange={v => updateSection(sec.id, "sizeText", v)}
                        onConfirm={v => updateSection(sec.id, "sizeConfirmed", v)}
                        onAddNew={(v) => addSize_master(v, sec.sectionConfirmed)}
                      />
                    </td>

                    <td className="see-td see-td-width">
                      <CellCombobox
                        value={sec.widthText}
                        options={getWidths(sec.sectionConfirmed, sec.sizeConfirmed)}
                        placeholder="Width…"
                        disabled={!sec.sizeConfirmed}
                        onChange={v => updateSection(sec.id, "widthText", v)}
                        onConfirm={v => updateSection(sec.id, "widthConfirmed", v)}
                        onAddNew={async (v) => { await addDoc(collection(db, "widths"), { value: v }); await fetchMaster(); }}
                      />
                    </td>

                    <td className="see-td see-td-length">
                      <CellCombobox
                        value={sec.lengthText}
                        options={getLengths(sec.sectionConfirmed, sec.sizeConfirmed, sec.widthConfirmed)}
                        placeholder="Length…"
                        disabled={!sec.sizeConfirmed}
                        onChange={v => updateSection(sec.id, "lengthText", v)}
                        onConfirm={v => updateSection(sec.id, "lengthConfirmed", v)}
                        onAddNew={async (v) => { await addDoc(collection(db, "itemLengths"), { value: v }); await fetchMaster(); }}
                      />
                    </td>

                    {/* Section MT — formatted when blurred */}
                    <td className="see-td see-td-mt">
                      <NumericInput
                        className="see-cell-input see-cell-input--num"
                        value={sec.mt}
                        onChange={v => updateSection(sec.id, "mt", v)}
                        placeholder="0.000"
                        formatFn={formatMT}
                      />
                    </td>

                    {/* Per-supplier Rate + MT — Rate first, then MT */}
                    {suppliers.map((sup, colIdx) => {
                      const rateRow = sec.supplierRates[colIdx] || { mt: "", rate: "" };
                      return (
                        <>
                          <td key={`rate-${sup.id}`} className="see-td see-td-sup-rate">
                            <NumericInput
                              className="see-cell-input see-cell-input--num"
                              value={rateRow.rate}
                              onChange={v => updateRate(sec.id, colIdx, "rate", v)}
                              placeholder="0.00"
                              formatFn={formatRate}
                            />
                          </td>
                          <td key={`mt-${sup.id}`} className="see-td see-td-sup-mt">
                            <NumericInput
                              className="see-cell-input see-cell-input--num"
                              value={rateRow.mt}
                              onChange={v => updateRate(sec.id, colIdx, "mt", v)}
                              placeholder="0.000"
                              formatFn={formatMT}
                            />
                          </td>
                        </>
                      );
                    })}

                    <td className="see-td see-td-row-actions">
                      {sections.length > 1 && (
                        <button
                          className="see-row-del-btn"
                          onClick={() => removeSectionRow(sec.id)}
                          title="Remove row"
                          type="button"
                        >✕</button>
                      )}
                    </td>
                  </tr>
                ))}

                {/* ── Totals row ── */}
                {sections.length > 0 && (
                  <tr className="see-totals-row">
                    <td className="see-td see-td-total-label" colSpan={5}>
                      <strong>Total</strong>
                    </td>
                    {/* Section MT total */}
                    <td className="see-td see-td-total-num">
                      {formatTotalMT(totalSectionMt)}
                    </td>
                    {/* Per-supplier totals — Rate first, then MT */}
                    {suppliers.map((sup, ci) => {
                      const { totalMt, weightedRate } = getSupplierTotals(ci);
                      return (
                        <>
                          <td key={`trate-${sup.id}`} className="see-td see-td-total-rate">
                            {weightedRate !== null
                              ? formatWeightedRate(weightedRate)
                              : "—"}
                          </td>
                          <td key={`tmt-${sup.id}`} className="see-td see-td-total-num">
                            {formatTotalMT(totalMt)}
                          </td>
                        </>
                      );
                    })}
                    <td className="see-td"></td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* ── Bottom toolbar ── */}
        <div className="see-sheet-footer">
          <button className="see-add-row-btn" onClick={addSectionRow} type="button">
            + Add Section Row
          </button>
          <button className="see-add-sup-btn" onClick={addSupplierColumn} type="button">
            + Add Supplier Column
          </button>
          <div className="see-footer-spacer" />
          <button
            className="see-save-btn"
            onClick={handleSave}
            disabled={saving}
            type="button"
          >
            {saving ? "Saving…" : `💾 Save Enquiry${enquiryNo ? " #" + enquiryNo : ""}`}
          </button>
        </div>
      </div>

    </div>
  );
}