import { useState, useEffect, useRef } from "react";
import { HiTrash, HiPencil, HiXMark, HiCheck, HiPlus, HiMagnifyingGlass, HiChevronDown, HiChevronUp } from "react-icons/hi2";
import { db } from "../../firebase";
import {
  collection, getDocs, deleteDoc, updateDoc,
  doc, query, orderBy
} from "firebase/firestore";
import "./EnquiryManager.css";

const generateId = () => Date.now() + Math.random();

// ── Inline Editable Cell ──────────────────────────────────────────────────────
function EditableCell({ value, type = "text", onSave, prefix }) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState(value);
  const inputRef = useRef(null);

  useEffect(() => { if (editing && inputRef.current) inputRef.current.focus(); }, [editing]);
  useEffect(() => { setVal(value); }, [value]);

  const commit = () => { onSave(val); setEditing(false); };
  const cancel = () => { setVal(value); setEditing(false); };

  if (!editing) {
    return (
      <span className="em-editable-view" onClick={() => setEditing(true)}>
        {prefix && <span className="em-prefix">{prefix}</span>}
        {value || <span className="em-empty-hint">—</span>}
        <HiPencil className="em-edit-icon" />
      </span>
    );
  }
  return (
    <span className="em-editable-edit">
      {prefix && <span className="em-prefix">{prefix}</span>}
      <input
        ref={inputRef}
        className="em-inline-input"
        type={type}
        value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") cancel(); }}
      />
      <button className="em-inline-btn em-inline-confirm" onClick={commit} title="Save"><HiCheck /></button>
      <button className="em-inline-btn em-inline-cancel" onClick={cancel} title="Cancel"><HiXMark /></button>
    </span>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function EnquiryManager({ onClose }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterFY, setFilterFY] = useState("");
  const [expandedId, setExpandedId] = useState(null);
  const [deletingId, setDeletingId] = useState(null);
  const [saving, setSaving] = useState(false);

  // ── Fetch ────────────────────────────────────────────────────────────────
  const fetchEntries = async () => {
    setLoading(true);
    try {
      const q = query(collection(db, "enquiryEntries"), orderBy("No", "asc"));
      const snap = await getDocs(q);
      setEntries(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error(e);
      alert("Error loading entries.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchEntries(); }, []);

  // ── Delete entry ─────────────────────────────────────────────────────────
  const handleDelete = async (entry) => {
    if (!window.confirm(`Delete Enquiry #${entry.No}? This cannot be undone.`)) return;
    setDeletingId(entry.id);
    try {
      await deleteDoc(doc(db, "enquiryEntries", entry.id));
      setEntries(prev => prev.filter(e => e.id !== entry.id));
      if (expandedId === entry.id) setExpandedId(null);
    } catch (e) {
      console.error(e);
      alert("Error deleting entry.");
    } finally {
      setDeletingId(null);
    }
  };

  // ── Update top-level field (date, FY) ─────────────────────────────────────
  const updateEntryField = async (entryId, field, value) => {
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { [field]: value });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, [field]: value } : e));
    } catch (e) {
      console.error(e);
      alert("Error saving change.");
    } finally {
      setSaving(false);
    }
  };

  // ── Update section fields inside sections[] array ─────────────────────────
  const updateSectionField = async (entryId, sectionIdx, field, value) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = entry.sections.map((sec, i) =>
      i === sectionIdx ? { ...sec, [field]: value } : sec
    );
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev =>
        prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e)
      );
    } catch (e) {
      console.error(e);
      alert("Error saving section change.");
    } finally {
      setSaving(false);
    }
  };

  // ── Update supplier rate inside sections[].supplierRates[] ────────────────
  const updateSupplierRateField = async (entryId, sectionIdx, rateIdx, field, value) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = entry.sections.map((sec, si) => {
      if (si !== sectionIdx) return sec;
      return {
        ...sec,
        supplierRates: sec.supplierRates.map((r, ri) =>
          ri === rateIdx ? { ...r, [field]: field === "rate" ? parseFloat(value) || 0 : value } : r
        ),
      };
    });
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev =>
        prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e)
      );
    } catch (e) {
      console.error(e);
      alert("Error saving rate change.");
    } finally {
      setSaving(false);
    }
  };

  // ── Add / remove supplier rate ─────────────────────────────────────────────
  const addSupplierRate = async (entryId, sectionIdx) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = entry.sections.map((sec, si) =>
      si === sectionIdx
        ? { ...sec, supplierRates: [...sec.supplierRates, { supplier: "", rate: 0 }] }
        : sec
    );
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
    } catch (err) {
      alert("Error adding supplier row.");
    } finally { setSaving(false); }
  };

  const removeSupplierRate = async (entryId, sectionIdx, rateIdx) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = entry.sections.map((sec, si) => {
      if (si !== sectionIdx) return sec;
      return { ...sec, supplierRates: sec.supplierRates.filter((_, ri) => ri !== rateIdx) };
    });
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
    } catch (err) {
      alert("Error removing supplier row.");
    } finally { setSaving(false); }
  };

  // ── Add / remove section ───────────────────────────────────────────────────
  const addSection = async (entryId) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = [...entry.sections, { section: "", size: "", mt: 0, supplierRates: [{ supplier: "", rate: 0 }] }];
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
    } catch (err) {
      alert("Error adding section.");
    } finally { setSaving(false); }
  };

  const removeSection = async (entryId, sectionIdx) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry || entry.sections.length <= 1) return alert("At least one section is required.");
    if (!window.confirm("Remove this section from the entry?")) return;
    const newSections = entry.sections.filter((_, i) => i !== sectionIdx);
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
    } catch (err) {
      alert("Error removing section.");
    } finally { setSaving(false); }
  };

  // ── Filter ─────────────────────────────────────────────────────────────────
  const uniqueFYs = [...new Set(entries.map(e => e.FinancialYear).filter(Boolean))].sort();

  const filtered = entries.filter(e => {
    const matchFY = !filterFY || e.FinancialYear === filterFY;
    const matchSearch = !search ||
      String(e.No).includes(search) ||
      (e.EnquiryDate || "").includes(search) ||
      (e.sections || []).some(s =>
        (s.section || "").toLowerCase().includes(search.toLowerCase()) ||
        (s.size || "").toLowerCase().includes(search.toLowerCase()) ||
        (s.supplierRates || []).some(r =>
          (r.supplier || "").toLowerCase().includes(search.toLowerCase())
        )
      );
    return matchFY && matchSearch;
  });

  return (
    <div className="em-overlay">
      <div className="em-panel">
        {/* ── Panel Header ── */}
        <div className="em-panel-header">
          <div className="em-panel-title-group">
            <div className="em-panel-badge">MANAGE</div>
            <h2 className="em-panel-title">Enquiry Entries</h2>
            <p className="em-panel-sub">Edit or delete individual enquiry records</p>
          </div>
          <button className="em-close-btn" onClick={onClose} title="Close">
            <HiXMark />
          </button>
        </div>

        {/* ── Controls ── */}
        <div className="em-controls">
          <div className="em-search-wrap">
            <HiMagnifyingGlass className="em-search-icon" />
            <input
              className="em-search-input"
              placeholder="Search by #, date, section, supplier…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            {search && (
              <button className="em-search-clear" onClick={() => setSearch("")}>
                <HiXMark />
              </button>
            )}
          </div>
          <select
            className="em-fy-select"
            value={filterFY}
            onChange={e => setFilterFY(e.target.value)}
          >
            <option value="">All Years</option>
            {uniqueFYs.map(fy => <option key={fy} value={fy}>{fy}</option>)}
          </select>
          {saving && <span className="em-saving-pill">Saving…</span>}
        </div>

        {/* ── List ── */}
        <div className="em-list">
          {loading ? (
            <div className="em-state-box">
              <div className="em-spinner" />
              <p>Loading entries…</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="em-state-box">
              <span className="em-state-icon">🔍</span>
              <p>No entries match your search.</p>
            </div>
          ) : (
            filtered.map(entry => {
              const isExpanded = expandedId === entry.id;
              const isDeleting = deletingId === entry.id;

              return (
                <div key={entry.id} className={`em-card${isExpanded ? " em-card--open" : ""}`}>
                  {/* Card Header Row */}
                  <div className="em-card-header" onClick={() => setExpandedId(isExpanded ? null : entry.id)}>
                    <div className="em-card-meta">
                      <span className="em-entry-no">#{entry.No}</span>
                      <span className="em-entry-fy">{entry.FinancialYear}</span>
                      <span className="em-entry-date">{entry.EnquiryDate || "No date"}</span>
                      <span className="em-entry-sections">
                        {(entry.sections || []).length} section{(entry.sections || []).length !== 1 ? "s" : ""}
                      </span>
                    </div>
                    <div className="em-card-actions">
                      <button
                        className="em-delete-btn"
                        onClick={e => { e.stopPropagation(); handleDelete(entry); }}
                        disabled={isDeleting}
                        title="Delete this entry"
                      >
                        {isDeleting ? <span className="em-spinner em-spinner--sm" /> : <HiTrash />}
                        {isDeleting ? "Deleting…" : "Delete"}
                      </button>
                      <button className="em-expand-btn" title={isExpanded ? "Collapse" : "Expand"}>
                        {isExpanded ? <HiChevronUp /> : <HiChevronDown />}
                      </button>
                    </div>
                  </div>

                  {/* Expanded Edit Area */}
                  {isExpanded && (
                    <div className="em-card-body">
                      {/* Top-level fields */}
                      <div className="em-entry-meta-edit">
                        <div className="em-meta-field">
                          <label className="em-meta-label">Financial Year</label>
                          <select
                            className="em-meta-select"
                            value={entry.FinancialYear || ""}
                            onChange={e => updateEntryField(entry.id, "FinancialYear", e.target.value)}
                          >
                            <option value="2024-25">2024-25</option>
                            <option value="2025-26">2025-26</option>
                            <option value="2026-27">2026-27</option>
                            <option value="2027-28">2027-28</option>
                          </select>
                        </div>
                        <div className="em-meta-field">
                          <label className="em-meta-label">Enquiry Date</label>
                          <input
                            className="em-meta-input"
                            type="date"
                            value={entry.EnquiryDate || ""}
                            onChange={e => updateEntryField(entry.id, "EnquiryDate", e.target.value)}
                          />
                        </div>
                      </div>

                      {/* Sections */}
                      <div className="em-sections-label">Sections</div>
                      {(entry.sections || []).map((sec, si) => (
                        <div key={si} className="em-section-edit-block">
                          <div className="em-section-edit-topbar">
                            <span className="em-section-edit-idx">Section {si + 1}</span>
                            {(entry.sections || []).length > 1 && (
                              <button
                                className="em-remove-section-btn"
                                onClick={() => removeSection(entry.id, si)}
                                title="Remove section"
                              ><HiTrash /> Remove</button>
                            )}
                          </div>

                          <div className="em-section-fields-grid">
                            <div className="em-sec-field">
                              <label className="em-sec-label">Section</label>
                              <EditableCell
                                value={sec.section || ""}
                                onSave={v => updateSectionField(entry.id, si, "section", v)}
                              />
                            </div>
                            <div className="em-sec-field">
                              <label className="em-sec-label">Size</label>
                              <EditableCell
                                value={sec.size || ""}
                                onSave={v => updateSectionField(entry.id, si, "size", v)}
                              />
                            </div>
                            <div className="em-sec-field">
                              <label className="em-sec-label">Qty (MT)</label>
                              <EditableCell
                                value={String(sec.mt || "")}
                                type="number"
                                onSave={v => updateSectionField(entry.id, si, "mt", parseFloat(v) || 0)}
                              />
                            </div>
                          </div>

                          {/* Supplier rates */}
                          <div className="em-rates-table">
                            <div className="em-rates-header">
                              <span>#</span>
                              <span>Supplier</span>
                              <span>Rate (₹)</span>
                              <span></span>
                            </div>
                            {(sec.supplierRates || []).map((sr, ri) => (
                              <div key={ri} className="em-rate-row">
                                <span className="em-rate-idx">{ri + 1}</span>
                                <div className="em-rate-supplier">
                                  <EditableCell
                                    value={sr.supplier || ""}
                                    onSave={v => updateSupplierRateField(entry.id, si, ri, "supplier", v)}
                                  />
                                </div>
                                <div className="em-rate-value">
                                  <EditableCell
                                    value={String(sr.rate || "")}
                                    type="number"
                                    prefix="₹"
                                    onSave={v => updateSupplierRateField(entry.id, si, ri, "rate", v)}
                                  />
                                </div>
                                {(sec.supplierRates || []).length > 1 && (
                                  <button
                                    className="em-remove-rate-btn"
                                    onClick={() => removeSupplierRate(entry.id, si, ri)}
                                    title="Remove row"
                                  ><HiTrash /></button>
                                )}
                              </div>
                            ))}
                          </div>
                          <button className="em-add-rate-btn" onClick={() => addSupplierRate(entry.id, si)}>
                            <HiPlus /> Add Supplier Row
                          </button>
                        </div>
                      ))}

                      <button className="em-add-section-btn" onClick={() => addSection(entry.id)}>
                        <HiPlus /> Add Section
                      </button>
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="em-panel-footer">
          <span className="em-count-pill">{filtered.length} of {entries.length} entries</span>
          <button className="em-close-footer-btn" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}
