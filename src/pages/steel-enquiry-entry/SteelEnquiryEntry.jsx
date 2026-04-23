import { useState, useEffect, useRef } from "react";
import { HiPlus, HiTrash } from "react-icons/hi2";
import { db } from "../../firebase";
import {
  collection, addDoc, getDocs, deleteDoc,
  doc, query, orderBy, limit
} from "firebase/firestore";
import "./SteelEnquiryEntry.css";

const generateId = () => Date.now() + Math.random();

const createEmptySupplierRate = () => ({
  id: generateId(),
  supplierText: "",
  supplierConfirmed: "",
  rate: "",
});

const createEmptySection = () => ({
  id: generateId(),
  sectionText: "",
  sectionConfirmed: "",
  sizeText: "",
  sizeConfirmed: "",
  mt: "",
  supplierRates: [createEmptySupplierRate()],
});

// ── Reusable Combobox ─────────────────────────────────────────────────────────
function Combobox({
  value, onChange, onConfirm,
  onAddNew, onDelete,
  options, deletableIds,
  placeholder, label
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef(null);

  const filtered = value.trim()
    ? options.filter(o => o.toLowerCase().includes(value.toLowerCase()))
    : options;

  const isExactMatch = options.some(
    o => o.toLowerCase() === value.trim().toLowerCase()
  );
  const showAddNew = value.trim() && !isExactMatch;

  useEffect(() => {
    const handler = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target))
        setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <div className="enq-combobox-wrapper" ref={wrapperRef}>
      <div className="enq-combobox-input-row">
        <input
          className="enq-input enq-combobox-input"
          type="text"
          placeholder={placeholder}
          value={value}
          autoComplete="off"
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
        />
        {value && (
          <button
            className="enq-combobox-clear"
            type="button"
            onClick={() => { onChange(""); onConfirm(""); setOpen(false); }}
          >
            ×
          </button>
        )}
      </div>
      {open && (
        <div className="enq-combobox-dropdown">
          {filtered.length > 0 && (
            <ul className="enq-combobox-list">
              {filtered.map(opt => {
                const isDeletable = deletableIds && deletableIds.has(opt);
                return (
                  <li
                    key={opt}
                    className={
                      "enq-combobox-item" +
                      (value === opt ? " enq-combobox-item--active" : "")
                    }
                  >
                    <span
                      className="enq-combobox-item-label"
                      onMouseDown={() => {
                        onChange(opt);
                        onConfirm(opt);
                        setOpen(false);
                      }}
                    >
                      {opt}
                    </span>
                    {isDeletable && (
                      <button
                        className="enq-combobox-item-delete"
                        type="button"
                        title={"Delete " + opt}
                        onMouseDown={async (e) => {
                          e.stopPropagation();
                          if (
                            !window.confirm(
                              'Delete "' + opt + '" from the list? This cannot be undone.'
                            )
                          )
                            return;
                          await onDelete(opt, deletableIds.get(opt));
                          if (value === opt) {
                            onChange("");
                            onConfirm("");
                          }
                          setOpen(false);
                        }}
                      >
                        <HiTrash />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
          {showAddNew && (
            <button
              className="enq-combobox-add-new"
              type="button"
              onMouseDown={async () => {
                const newVal = value.trim();
                await onAddNew(newVal);
                onConfirm(newVal);
                setOpen(false);
              }}
            >
              <HiPlus /> Add "{value.trim()}" as new {label}
            </button>
          )}
          {filtered.length === 0 && !showAddNew && (
            <div className="enq-combobox-empty">No matches found</div>
          )}
        </div>
      )}
    </div>
  );
}
// ─────────────────────────────────────────────────────────────────────────────

export default function SteelEnquiryEntry() {
  const [loading, setLoading] = useState(false);
  const [entryNo, setEntryNo] = useState(1);
  const [financialYear, setFinancialYear] = useState("2026-27");
  const [enquiryDate, setEnquiryDate] = useState("");
  const [sections, setSections] = useState([createEmptySection()]);
  const [sectionDocs, setSectionDocs] = useState([]);
  const [supplierDocs, setSupplierDocs] = useState([]);
  const [allSizeDocs, setAllSizeDocs] = useState([]);
  const [sectionSizeRelations, setSectionSizeRelations] = useState([]);

  // Derived string arrays for combobox options
  const allSectionValues = sectionDocs.map(d => d.value);
  const allSupplierValues = supplierDocs.map(d => d.value);
  const allSizeValues = allSizeDocs.map(d => d.value);

  // All docs as deletable Maps
  const allSectionDeletableIds = new Map(sectionDocs.map(d => [d.value, d.id]));
  const allSupplierDeletableIds = new Map(supplierDocs.map(d => [d.value, d.id]));
  const allSizeDeletableIds = new Map(allSizeDocs.map(d => [d.value, d.id]));

  // ── Fetch master data ───────────────────────────────────────────────────────
  const fetchData = async () => {
    try {
      const [sectSnap, sizeSnap, suppSnap, relSnap] = await Promise.all([
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "sizes")),
        getDocs(collection(db, "suppliers")),
        getDocs(collection(db, "sectionSizeRelations")),
      ]);
      setSectionDocs(
        sectSnap.docs
          .map(d => ({ id: d.id, value: d.data().value?.trim() || "" }))
          .filter(i => i.value)
          .sort((a, b) => a.value.localeCompare(b.value))
      );
      setAllSizeDocs(
        sizeSnap.docs
          .map(d => ({ id: d.id, value: d.data().value?.trim() || "" }))
          .filter(i => i.value)
          .sort((a, b) => a.value.localeCompare(b.value))
      );
      setSupplierDocs(
        suppSnap.docs
          .map(d => ({ id: d.id, value: d.data().value?.trim() || "" }))
          .filter(i => i.value)
          .sort((a, b) => a.value.localeCompare(b.value))
      );
      setSectionSizeRelations(relSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error fetching master data:", e);
    }
  };

  useEffect(() => {
    fetchData();
    const fetchEntryNo = async () => {
      try {
        const q = query(
          collection(db, "enquiryEntries"),
          orderBy("No", "desc"),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!snap.empty) setEntryNo(snap.docs[0].data().No + 1);
      } catch (e) {
        console.error("Error fetching entry number:", e);
      }
    };
    fetchEntryNo();
  }, []);

  // ── Add / Delete Section ────────────────────────────────────────────────────
  const handleAddNewSection = async (newVal) => {
    const exists = allSectionValues.some(
      s => s.toLowerCase() === newVal.toLowerCase()
    );
    if (exists) return;
    try {
      await addDoc(collection(db, "sections"), { value: newVal });
      await fetchData();
    } catch (e) {
      console.error("Error adding section:", e);
      alert("Error adding new section.");
    }
  };

  const handleDeleteSection = async (val, docId) => {
    try {
      await deleteDoc(doc(db, "sections", docId));
      setSections(prev =>
        prev.map(s =>
          s.sectionConfirmed === val
            ? { ...s, sectionText: "", sectionConfirmed: "", sizeText: "", sizeConfirmed: "" }
            : s
        )
      );
      await fetchData();
    } catch (e) {
      console.error("Error deleting section:", e);
      alert("Error deleting section.");
    }
  };

  // ── Add / Delete Size ───────────────────────────────────────────────────────
  const handleAddNewSize = async (newVal) => {
    const exists = allSizeValues.some(
      s => s.toLowerCase() === newVal.toLowerCase()
    );
    if (exists) return;
    try {
      await addDoc(collection(db, "sizes"), { value: newVal });
      await fetchData();
    } catch (e) {
      console.error("Error adding size:", e);
      alert("Error adding new size.");
    }
  };

  const handleDeleteSize = async (val, docId) => {
    try {
      await deleteDoc(doc(db, "sizes", docId));
      setSections(prev =>
        prev.map(s =>
          s.sizeConfirmed === val
            ? { ...s, sizeText: "", sizeConfirmed: "" }
            : s
        )
      );
      await fetchData();
    } catch (e) {
      console.error("Error deleting size:", e);
      alert("Error deleting size.");
    }
  };

  // ── Add / Delete Supplier ───────────────────────────────────────────────────
  const handleAddNewSupplier = async (newVal) => {
    const exists = allSupplierValues.some(
      s => s.toLowerCase() === newVal.toLowerCase()
    );
    if (exists) return;
    try {
      await addDoc(collection(db, "suppliers"), { value: newVal });
      await fetchData();
    } catch (e) {
      console.error("Error adding supplier:", e);
      alert("Error adding new supplier.");
    }
  };

  const handleDeleteSupplier = async (val, docId) => {
    try {
      await deleteDoc(doc(db, "suppliers", docId));
      setSections(prev =>
        prev.map(s => ({
          ...s,
          supplierRates: s.supplierRates.map(r =>
            r.supplierConfirmed === val
              ? { ...r, supplierText: "", supplierConfirmed: "" }
              : r
          ),
        }))
      );
      await fetchData();
    } catch (e) {
      console.error("Error deleting supplier:", e);
      alert("Error deleting supplier.");
    }
  };

  // ── Size options filtered by selected section ───────────────────────────────
  const getAvailableSizeValues = (selectedSection) => {
    if (!selectedSection) return allSizeValues;
    const sectionObj = sectionDocs.find(s => s.value === selectedSection);
    if (!sectionObj) return allSizeValues;
    const relatedSizeIds = sectionSizeRelations
      .filter(rel => rel.sectionId === sectionObj.id)
      .map(rel => rel.sizeId);
    const filtered = allSizeDocs
      .filter(size => relatedSizeIds.includes(size.id))
      .map(d => d.value);
    return filtered.length > 0 ? filtered : allSizeValues;
  };

  // ── Section row handlers ────────────────────────────────────────────────────
  const handleSectionField = (sectionId, field, value) => {
    setSections(prev =>
      prev.map(s => {
        if (s.id !== sectionId) return s;
        const updated = { ...s, [field]: value };
        if (field === "sectionConfirmed") {
          updated.sizeText = "";
          updated.sizeConfirmed = "";
        }
        return updated;
      })
    );
  };

  const addSection = () => setSections(prev => [...prev, createEmptySection()]);
  const removeSection = (id) => setSections(prev => prev.filter(s => s.id !== id));

  // ── Supplier rate handlers ──────────────────────────────────────────────────
  const handleSupplierRateField = (sectionId, rateId, field, value) => {
    setSections(prev =>
      prev.map(s => {
        if (s.id !== sectionId) return s;
        return {
          ...s,
          supplierRates: s.supplierRates.map(r =>
            r.id === rateId ? { ...r, [field]: value } : r
          ),
        };
      })
    );
  };

  const addSupplierRate = (sectionId) => {
    setSections(prev =>
      prev.map(s => {
        if (s.id !== sectionId) return s;
        return { ...s, supplierRates: [...s.supplierRates, createEmptySupplierRate()] };
      })
    );
  };

  const removeSupplierRate = (sectionId, rateId) => {
    setSections(prev =>
      prev.map(s => {
        if (s.id !== sectionId) return s;
        return { ...s, supplierRates: s.supplierRates.filter(r => r.id !== rateId) };
      })
    );
  };

  // ── Submit ──────────────────────────────────────────────────────────────────
  const handleSubmit = async () => {
    if (!financialYear) return alert("Please select Financial Year");
    for (const sec of sections) {
      if (!sec.sectionConfirmed && !sec.sectionText.trim())
        return alert("Please select or add a Section for all rows");
      if (!sec.mt) return alert("Please enter MT for all section rows");
      for (const sr of sec.supplierRates) {
        if (!sr.supplierConfirmed && !sr.supplierText.trim())
          return alert("Please select or add a Supplier for all supplier rows");
      }
    }
    setLoading(true);
    try {
      await addDoc(collection(db, "enquiryEntries"), {
        No: entryNo,
        FinancialYear: financialYear,
        EnquiryDate: enquiryDate,
        sections: sections.map(s => ({
          section: s.sectionConfirmed || s.sectionText.trim(),
          size: s.sizeConfirmed || s.sizeText.trim(),
          mt: parseFloat(s.mt) || 0,
          supplierRates: s.supplierRates.map(r => ({
            supplier: r.supplierConfirmed || r.supplierText.trim(),
            rate: parseFloat(r.rate) || 0,
          })),
        })),
        createdAt: new Date(),
      });
      alert("Enquiry Saved Successfully!");
      window.location.reload();
    } catch (e) {
      console.error(e);
      alert("Save Error. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="enq-container">
      {/* Header */}
      <div className="enq-header-band">
        <div className="enq-header-left">
          <h1 className="enq-title">Steel Enquiry Entry</h1>
        </div>
        <div className="enq-header-right">
          <span className="enq-fy-badge">{financialYear}</span>
        </div>
      </div>

      <div className="enq-form-body">
        {/* Meta Row */}
        <div className="enq-meta-grid">
          <div className="enq-field">
            <label className="enq-label">Financial Year</label>
            <select
              className="enq-select"
              value={financialYear}
              onChange={e => setFinancialYear(e.target.value)}
            >
              <option value="2024-25">2024-25</option>
              <option value="2025-26">2025-26</option>
              <option value="2026-27">2026-27</option>
              <option value="2027-28">2027-28</option>
            </select>
          </div>

          <div className="enq-field">
            <label className="enq-label">Enquiry Date</label>
            <input
              className="enq-input"
              type="date"
              value={enquiryDate}
              onChange={e => setEnquiryDate(e.target.value)}
            />
          </div>
        </div>

        {/* Section Cards */}
        <div className="enq-sections-header">
          <h2 className="enq-sections-title">Section / Item Details</h2>
        </div>

        <div className="enq-sections-list">
          {sections.map((sec, idx) => (
            <div key={sec.id} className="enq-section-card">
              <div className="enq-card-topbar">
                <span className="enq-card-index">Section #{idx + 1}</span>
                {sections.length > 1 && (
                  <button
                    className="enq-remove-section-btn"
                    onClick={() => removeSection(sec.id)}
                    type="button"
                  >
                    <HiTrash /> Remove Section
                  </button>
                )}
              </div>

              {/* Section / Size / MT */}
              <div className="enq-section-fields">

                {/* Section Combobox */}
                <div className="enq-field">
                  <label className="enq-label">Section</label>
                  <Combobox
                    label="section"
                    placeholder="Type or select section..."
                    value={sec.sectionText}
                    options={allSectionValues}
                    deletableIds={allSectionDeletableIds}
                    onChange={val => handleSectionField(sec.id, "sectionText", val)}
                    onConfirm={val => handleSectionField(sec.id, "sectionConfirmed", val)}
                    onAddNew={handleAddNewSection}
                    onDelete={handleDeleteSection}
                  />
                  {sec.sectionConfirmed && (
                    <span className="enq-confirmed-chip">
                      ✓ {sec.sectionConfirmed}
                    </span>
                  )}
                </div>

                {/* Size Combobox */}
                <div className="enq-field">
                  <label className="enq-label">Size</label>
                  <Combobox
                    label="size"
                    placeholder="Type or select size..."
                    value={sec.sizeText}
                    options={getAvailableSizeValues(sec.sectionConfirmed)}
                    deletableIds={allSizeDeletableIds}
                    onChange={val => handleSectionField(sec.id, "sizeText", val)}
                    onConfirm={val => handleSectionField(sec.id, "sizeConfirmed", val)}
                    onAddNew={handleAddNewSize}
                    onDelete={handleDeleteSize}
                  />
                  {sec.sizeConfirmed && (
                    <span className="enq-confirmed-chip">
                      ✓ {sec.sizeConfirmed}
                    </span>
                  )}
                </div>

                {/* Quantity */}
                <div className="enq-field">
                  <label className="enq-label">Quantity (MT)</label>
                  <input
                    className="enq-input"
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={sec.mt}
                    onChange={e => handleSectionField(sec.id, "mt", e.target.value)}
                  />
                </div>
              </div>

              {/* Supplier Rates */}
              <div className="enq-supplier-block">
                <div className="enq-supplier-block-header">
                  <span className="enq-supplier-block-title">Supplier Rates</span>
                </div>
                <div className="enq-supplier-rates-list">
                  <div className="enq-supplier-rate-header-row">
                    <span>#</span>
                    <span>Supplier Name</span>
                    <span>Rate Quoted</span>
                    <span></span>
                  </div>
                  {sec.supplierRates.map((sr, srIdx) => (
                    <div key={sr.id} className="enq-supplier-rate-row">
                      <span className="enq-sr-index">{srIdx + 1}</span>
                      <div className="enq-supplier-combobox-cell">
                        <Combobox
                          label="supplier"
                          placeholder="Type or select supplier..."
                          value={sr.supplierText}
                          options={allSupplierValues}
                          deletableIds={allSupplierDeletableIds}
                          onChange={val =>
                            handleSupplierRateField(sec.id, sr.id, "supplierText", val)
                          }
                          onConfirm={val =>
                            handleSupplierRateField(sec.id, sr.id, "supplierConfirmed", val)
                          }
                          onAddNew={handleAddNewSupplier}
                          onDelete={handleDeleteSupplier}
                        />
                        {sr.supplierConfirmed && (
                          <span className="enq-confirmed-chip enq-confirmed-chip--sm">
                            ✓ {sr.supplierConfirmed}
                          </span>
                        )}
                      </div>
                      <div className="enq-rate-input-wrapper">
                        <span className="enq-rate-prefix">Rs</span>
                        <input
                          className="enq-input enq-rate-input"
                          type="number"
                          step="0.01"
                          placeholder="0.00"
                          value={sr.rate}
                          onChange={e =>
                            handleSupplierRateField(sec.id, sr.id, "rate", e.target.value)
                          }
                        />
                      </div>
                      {sec.supplierRates.length > 1 ? (
                        <button
                          className="enq-remove-rate-btn"
                          onClick={() => removeSupplierRate(sec.id, sr.id)}
                          type="button"
                          title="Remove this supplier row"
                        >
                          <HiTrash />
                        </button>
                      ) : (
                        <span />
                      )}
                    </div>
                  ))}
                </div>
                <button
                  className="enq-add-supplier-btn"
                  onClick={() => addSupplierRate(sec.id)}
                  type="button"
                >
                  <HiPlus /> Add Another Supplier
                </button>
              </div>
            </div>
          ))}
        </div>

        <button className="enq-add-section-btn" onClick={addSection} type="button">
          <HiPlus /> Add Another Section
        </button>

        <div className="enq-submit-row">
          <button
            className="enq-submit-btn"
            onClick={handleSubmit}
            disabled={loading}
          >
            {loading ? "Saving..." : "Save Enquiry"}
          </button>
        </div>
      </div>
    </div>
  );
}
