import { useState, useEffect, useRef } from "react";
import { HiTrash, HiPencil, HiXMark, HiCheck, HiPlus, HiMagnifyingGlass, HiChevronDown, HiChevronUp } from "react-icons/hi2";
import { db } from "../../firebase";
import {
  collection, getDocs, deleteDoc, updateDoc, addDoc,
  doc, query, orderBy
} from "firebase/firestore";
import "./EnquiryManager.css";
import "../../pages/steel-enquiry-entry/SteelEnquiryEntry.css";

// ── Combobox (same as SteelEnquiryEntry) ─────────────────────────────────────
function Combobox({
  value, onChange, onConfirm,
  onAddNew, onDelete,
  options, deletableIds,
  placeholder, label,
  disabled = false,
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
          className={`enq-input enq-combobox-input${disabled ? " enq-combobox-disabled" : ""}`}
          type="text"
          placeholder={disabled ? `Select ${label} first` : placeholder}
          value={value}
          autoComplete="off"
          disabled={disabled}
          onChange={e => { onChange(e.target.value); setOpen(true); }}
          onFocus={() => { if (!disabled) setOpen(true); }}
        />
        {value && !disabled && (
          <button
            className="enq-combobox-clear"
            type="button"
            onClick={() => { onChange(""); onConfirm(""); setOpen(false); }}
          >
            ×
          </button>
        )}
      </div>
      {open && !disabled && (
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
                          if (!window.confirm('Delete "' + opt + '" from the list? This cannot be undone.'))
                            return;
                          await onDelete(opt, deletableIds.get(opt));
                          if (value === opt) { onChange(""); onConfirm(""); }
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

// ── New Section Form (with same comboboxes as SteelEnquiryEntry) ──────────────
function NewSectionForm({ masterData, onAdd, onCancel }) {
  const {
    sectionDocs, allSizeDocs, allWidthDocs, allLengthDocs, supplierDocs,
    sectionSizeRelations, sizeWidthRelations, widthLengthRelations,
    fetchMasterData,
  } = masterData;

  const allSectionValues = sectionDocs.map(d => d.value);
  const allSizeValues    = allSizeDocs.map(d => d.value);
  const allWidthValues   = allWidthDocs.map(d => d.value);
  const allLengthValues  = allLengthDocs.map(d => d.value);
  const allSupplierValues = supplierDocs.map(d => d.value);

  const allSectionDeletableIds = new Map(sectionDocs.map(d => [d.value, d.id]));
  const allSizeDeletableIds    = new Map(allSizeDocs.map(d => [d.value, d.id]));
  const allWidthDeletableIds   = new Map(allWidthDocs.map(d => [d.value, d.id]));
  const allLengthDeletableIds  = new Map(allLengthDocs.map(d => [d.value, d.id]));
  const allSupplierDeletableIds = new Map(supplierDocs.map(d => [d.value, d.id]));

  const [sec, setSec] = useState({
    sectionText: "", sectionConfirmed: "",
    sizeText: "", sizeConfirmed: "",
    widthText: "", widthConfirmed: "",
    lengthText: "", lengthConfirmed: "",
    mt: "",
    supplierRates: [{ supplierText: "", supplierConfirmed: "", mt: "", rate: "" }],
  });

  const setField = (field, value) => {
    setSec(prev => {
      const updated = { ...prev, [field]: value };
      if (field === "sectionConfirmed") {
        updated.sizeText = ""; updated.sizeConfirmed = "";
        updated.widthText = ""; updated.widthConfirmed = "";
        updated.lengthText = ""; updated.lengthConfirmed = "";
      }
      if (field === "sizeConfirmed") {
        updated.widthText = ""; updated.widthConfirmed = "";
        updated.lengthText = ""; updated.lengthConfirmed = "";
      }
      if (field === "widthConfirmed") {
        updated.lengthText = ""; updated.lengthConfirmed = "";
      }
      return updated;
    });
  };

  const setSupplierField = (idx, field, value) => {
    setSec(prev => ({
      ...prev,
      supplierRates: prev.supplierRates.map((r, i) => i === idx ? { ...r, [field]: value } : r),
    }));
  };
  const addSupplierRow = () =>
    setSec(prev => ({
      ...prev,
      supplierRates: [...prev.supplierRates, { supplierText: "", supplierConfirmed: "", mt: "", rate: "" }],
    }));
  const removeSupplierRow = (idx) =>
    setSec(prev => ({ ...prev, supplierRates: prev.supplierRates.filter((_, i) => i !== idx) }));

  // ── Filtered options (same logic as SteelEnquiryEntry) ───────────────────
  const getAvailableSizeValues = (selectedSection) => {
    if (!selectedSection) return allSizeValues;
    const sectionObj = sectionDocs.find(s => s.value === selectedSection);
    if (!sectionObj) return allSizeValues;
    const ids = sectionSizeRelations.filter(r => r.sectionId === sectionObj.id).map(r => r.sizeId);
    const f = allSizeDocs.filter(d => ids.includes(d.id)).map(d => d.value);
    return f.length > 0 ? f : allSizeValues;
  };

  const getAvailableWidthValues = (selectedSection, selectedSize) => {
    if (!selectedSection || !selectedSize) return allWidthValues;
    const sectionObj = sectionDocs.find(s => s.value === selectedSection);
    const sizeObj = allSizeDocs.find(s => s.value === selectedSize);
    if (!sectionObj || !sizeObj) return allWidthValues;
    const ids = sizeWidthRelations
      .filter(r => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id)
      .map(r => r.widthId);
    const f = allWidthDocs.filter(d => ids.includes(d.id)).map(d => d.value);
    return f.length > 0 ? f : allWidthValues;
  };

  const getAvailableLengthValues = (selectedSection, selectedSize, selectedWidth) => {
    if (!selectedSection || !selectedSize) return allLengthValues;
    const sectionObj = sectionDocs.find(s => s.value === selectedSection);
    const sizeObj = allSizeDocs.find(s => s.value === selectedSize);
    const widthObj = selectedWidth ? allWidthDocs.find(w => w.value === selectedWidth) : null;
    if (!sectionObj || !sizeObj) return allLengthValues;
    const ids = widthLengthRelations
      .filter(r =>
        r.sectionId === sectionObj.id &&
        r.sizeId === sizeObj.id &&
        (widthObj ? r.widthId === widthObj.id : r.widthId === null)
      )
      .map(r => r.lengthId);
    const f = allLengthDocs.filter(d => ids.includes(d.id)).map(d => d.value);
    return f.length > 0 ? f : allLengthValues;
  };

  // ── Master data add/delete handlers ──────────────────────────────────────
  const handleAddNewSection = async (newVal) => {
    if (allSectionValues.some(s => s.toLowerCase() === newVal.toLowerCase())) return;
    await addDoc(collection(db, "sections"), { value: newVal });
    await fetchMasterData();
  };
  const handleDeleteSection = async (val, docId) => {
    await deleteDoc(doc(db, "sections", docId));
    await fetchMasterData();
  };

  const handleAddNewSize = async (newVal, sectionConfirmed) => {
    const exists = allSizeValues.some(s => s.toLowerCase() === newVal.toLowerCase());
    let sizeId;
    if (!exists) {
      const ref = await addDoc(collection(db, "sizes"), { value: newVal });
      sizeId = ref.id;
    } else {
      sizeId = allSizeDocs.find(s => s.value.toLowerCase() === newVal.toLowerCase())?.id;
    }
    if (sectionConfirmed && sizeId) {
      const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
      if (sectionObj) {
        const linked = sectionSizeRelations.some(r => r.sectionId === sectionObj.id && r.sizeId === sizeId);
        if (!linked) await addDoc(collection(db, "sectionSizeRelations"), { sectionId: sectionObj.id, sizeId });
      }
    }
    await fetchMasterData();
  };
  const handleDeleteSize = async (val, docId) => {
    await deleteDoc(doc(db, "sizes", docId));
    await fetchMasterData();
  };

  const handleAddNewWidth = async (newVal, sectionConfirmed, sizeConfirmed) => {
    const exists = allWidthValues.some(w => w.toLowerCase() === newVal.toLowerCase());
    let widthId;
    if (!exists) {
      const ref = await addDoc(collection(db, "widths"), { value: newVal });
      widthId = ref.id;
    } else {
      widthId = allWidthDocs.find(w => w.value.toLowerCase() === newVal.toLowerCase())?.id;
    }
    if (sectionConfirmed && sizeConfirmed && widthId) {
      const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
      const sizeObj = allSizeDocs.find(s => s.value === sizeConfirmed);
      if (sectionObj && sizeObj) {
        const linked = sizeWidthRelations.some(r => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id && r.widthId === widthId);
        if (!linked) await addDoc(collection(db, "sizeWidthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, widthId });
      }
    }
    await fetchMasterData();
  };
  const handleDeleteWidth = async (val, docId) => {
    await deleteDoc(doc(db, "widths", docId));
    await fetchMasterData();
  };

  const handleAddNewLength = async (newVal, sectionConfirmed, sizeConfirmed, widthConfirmed) => {
    const exists = allLengthValues.some(l => l.toLowerCase() === newVal.toLowerCase());
    let lengthId;
    if (!exists) {
      const ref = await addDoc(collection(db, "itemLengths"), { value: newVal });
      lengthId = ref.id;
    } else {
      lengthId = allLengthDocs.find(l => l.value.toLowerCase() === newVal.toLowerCase())?.id;
    }
    if (sectionConfirmed && sizeConfirmed && lengthId) {
      const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
      const sizeObj = allSizeDocs.find(s => s.value === sizeConfirmed);
      const widthObj = widthConfirmed ? allWidthDocs.find(w => w.value === widthConfirmed) : null;
      if (sectionObj && sizeObj) {
        const linked = widthLengthRelations.some(r =>
          r.sectionId === sectionObj.id && r.sizeId === sizeObj.id &&
          (widthObj ? r.widthId === widthObj.id : r.widthId === null) && r.lengthId === lengthId
        );
        if (!linked) await addDoc(collection(db, "widthLengthRelations"), {
          sectionId: sectionObj.id, sizeId: sizeObj.id,
          widthId: widthObj ? widthObj.id : null, lengthId,
        });
      }
    }
    await fetchMasterData();
  };
  const handleDeleteLength = async (val, docId) => {
    await deleteDoc(doc(db, "itemLengths", docId));
    await fetchMasterData();
  };

  const handleAddNewSupplier = async (newVal) => {
    if (allSupplierValues.some(s => s.toLowerCase() === newVal.toLowerCase())) return;
    await addDoc(collection(db, "suppliers"), { value: newVal });
    await fetchMasterData();
  };
  const handleDeleteSupplier = async (val, docId) => {
    await deleteDoc(doc(db, "suppliers", docId));
    await fetchMasterData();
  };

  // ── Submit new section ────────────────────────────────────────────────────
  const handleAdd = () => {
    const section = sec.sectionConfirmed || sec.sectionText.trim();
    if (!section) return alert("Please select or enter a Section.");
    if (!sec.mt) return alert("Please enter Quantity (MT).");
    for (const sr of sec.supplierRates) {
      const supplier = sr.supplierConfirmed || sr.supplierText.trim();
      if (!supplier) return alert("Please select or enter a Supplier for all rows.");
      if (!sr.mt) return alert("Please enter MT for all supplier rows.");
    }
    onAdd({
      section,
      size: sec.sizeConfirmed || sec.sizeText.trim(),
      width: sec.widthConfirmed || sec.widthText.trim(),
      length: sec.lengthConfirmed || sec.lengthText.trim(),
      mt: parseFloat(sec.mt) || 0,
      supplierRates: sec.supplierRates.map(r => ({
        supplier: r.supplierConfirmed || r.supplierText.trim(),
        mt: parseFloat(r.mt) || 0,
        rate: parseFloat(r.rate) || 0,
      })),
    });
  };

  return (
    <div className="em-new-section-form">
      <div className="em-new-section-form-title">New Section</div>

      {/* Section / Size / Width / Length / MT row */}
      <div className="em-new-section-fields">
        <div className="enq-field">
          <label className="enq-label">Section</label>
          <Combobox
            label="section" placeholder="Type or select section..."
            value={sec.sectionText} options={allSectionValues} deletableIds={allSectionDeletableIds}
            onChange={val => setField("sectionText", val)}
            onConfirm={val => setField("sectionConfirmed", val)}
            onAddNew={handleAddNewSection} onDelete={handleDeleteSection}
          />
          {sec.sectionConfirmed && <span className="enq-confirmed-chip">✓ {sec.sectionConfirmed}</span>}
        </div>

        <div className="enq-field">
          <label className="enq-label">Size</label>
          <Combobox
            label="size" placeholder="Type or select size..."
            value={sec.sizeText} options={getAvailableSizeValues(sec.sectionConfirmed)} deletableIds={allSizeDeletableIds}
            onChange={val => setField("sizeText", val)}
            onConfirm={val => setField("sizeConfirmed", val)}
            onAddNew={val => handleAddNewSize(val, sec.sectionConfirmed)} onDelete={handleDeleteSize}
          />
          {sec.sizeConfirmed && <span className="enq-confirmed-chip">✓ {sec.sizeConfirmed}</span>}
        </div>

        <div className="enq-field">
          <label className="enq-label">Width</label>
          <Combobox
            label="width" placeholder="Type or select width..."
            value={sec.widthText} options={getAvailableWidthValues(sec.sectionConfirmed, sec.sizeConfirmed)}
            deletableIds={allWidthDeletableIds} disabled={!sec.sizeConfirmed}
            onChange={val => setField("widthText", val)}
            onConfirm={val => setField("widthConfirmed", val)}
            onAddNew={val => handleAddNewWidth(val, sec.sectionConfirmed, sec.sizeConfirmed)} onDelete={handleDeleteWidth}
          />
          {sec.widthConfirmed && <span className="enq-confirmed-chip">✓ {sec.widthConfirmed}</span>}
        </div>

        <div className="enq-field">
          <label className="enq-label">Length</label>
          <Combobox
            label="length" placeholder="Type or select length..."
            value={sec.lengthText}
            options={getAvailableLengthValues(sec.sectionConfirmed, sec.sizeConfirmed, sec.widthConfirmed)}
            deletableIds={allLengthDeletableIds} disabled={!sec.sizeConfirmed}
            onChange={val => setField("lengthText", val)}
            onConfirm={val => setField("lengthConfirmed", val)}
            onAddNew={val => handleAddNewLength(val, sec.sectionConfirmed, sec.sizeConfirmed, sec.widthConfirmed)}
            onDelete={handleDeleteLength}
          />
          {sec.lengthConfirmed && <span className="enq-confirmed-chip">✓ {sec.lengthConfirmed}</span>}
        </div>

        <div className="enq-field">
          <label className="enq-label">Qty (MT)</label>
          <input
            className="enq-input" type="text" inputMode="decimal" placeholder="0.00"
            value={sec.mt} onChange={e => setField("mt", e.target.value)}
          />
        </div>
      </div>

      {/* Supplier Rates */}
      <div className="em-new-section-supplier-block">
        <div className="em-new-section-supplier-label">Supplier Rates</div>
        <div className="enq-supplier-rate-header-row enq-supplier-rate-header-row--5col">
          <span>#</span><span>Supplier Name</span><span>MT</span><span>Rate Quoted</span><span></span>
        </div>
        {sec.supplierRates.map((sr, idx) => (
          <div key={idx} className="enq-supplier-rate-row enq-supplier-rate-row--5col">
            <span className="enq-sr-index">{idx + 1}</span>
            <div className="enq-supplier-combobox-cell">
              <Combobox
                label="supplier" placeholder="Type or select supplier..."
                value={sr.supplierText} options={allSupplierValues} deletableIds={allSupplierDeletableIds}
                onChange={val => setSupplierField(idx, "supplierText", val)}
                onConfirm={val => setSupplierField(idx, "supplierConfirmed", val)}
                onAddNew={handleAddNewSupplier} onDelete={handleDeleteSupplier}
              />
              {sr.supplierConfirmed && (
                <span className="enq-confirmed-chip enq-confirmed-chip--sm">✓ {sr.supplierConfirmed}</span>
              )}
            </div>
            <div className="enq-supplier-mt-wrapper">
              <input
                className="enq-input enq-supplier-mt-input" type="text" inputMode="decimal" placeholder="0.00"
                value={sr.mt} onChange={e => setSupplierField(idx, "mt", e.target.value)}
              />
            </div>
            <div className="enq-rate-input-wrapper">
              <span className="enq-rate-prefix">Rs</span>
              <input
                className="enq-input enq-rate-input" type="text" inputMode="decimal" placeholder="0.00"
                value={sr.rate} onChange={e => setSupplierField(idx, "rate", e.target.value)}
              />
            </div>
            {sec.supplierRates.length > 1 ? (
              <button className="enq-remove-rate-btn" type="button" onClick={() => removeSupplierRow(idx)}>
                <HiTrash />
              </button>
            ) : <span />}
          </div>
        ))}
        <button className="enq-add-supplier-btn" type="button" onClick={addSupplierRow}>
          <HiPlus /> Add Another Supplier
        </button>
      </div>

      {/* Form Actions */}
      <div className="em-new-section-actions">
        <button className="em-new-section-add-btn" type="button" onClick={handleAdd}>
          <HiCheck /> Add Section
        </button>
        <button className="em-new-section-cancel-btn" type="button" onClick={onCancel}>
          <HiXMark /> Cancel
        </button>
      </div>
    </div>
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

  // Which entry is showing the "Add Section" form
  const [addingSectionForEntryId, setAddingSectionForEntryId] = useState(null);

  // ── Master data (for NewSectionForm) ─────────────────────────────────────
  const [sectionDocs, setSectionDocs] = useState([]);
  const [supplierDocs, setSupplierDocs] = useState([]);
  const [allSizeDocs, setAllSizeDocs] = useState([]);
  const [allWidthDocs, setAllWidthDocs] = useState([]);
  const [allLengthDocs, setAllLengthDocs] = useState([]);
  const [sectionSizeRelations, setSectionSizeRelations] = useState([]);
  const [sizeWidthRelations, setSizeWidthRelations] = useState([]);
  const [widthLengthRelations, setWidthLengthRelations] = useState([]);

  const fetchMasterData = async () => {
    try {
      const [
        sectSnap, sizeSnap, widthSnap, lengthSnap, suppSnap,
        ssRelSnap, swRelSnap, wlRelSnap,
      ] = await Promise.all([
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "sizes")),
        getDocs(collection(db, "widths")),
        getDocs(collection(db, "itemLengths")),
        getDocs(collection(db, "suppliers")),
        getDocs(collection(db, "sectionSizeRelations")),
        getDocs(collection(db, "sizeWidthRelations")),
        getDocs(collection(db, "widthLengthRelations")),
      ]);
      const mapDocs = (snap) =>
        snap.docs
          .map(d => ({ id: d.id, value: d.data().value?.trim() || "" }))
          .filter(i => i.value)
          .sort((a, b) => a.value.localeCompare(b.value));
      setSectionDocs(mapDocs(sectSnap));
      setAllSizeDocs(mapDocs(sizeSnap));
      setAllWidthDocs(mapDocs(widthSnap));
      setAllLengthDocs(mapDocs(lengthSnap));
      setSupplierDocs(mapDocs(suppSnap));
      setSectionSizeRelations(ssRelSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setSizeWidthRelations(swRelSnap.docs.map(d => ({ id: d.id, ...d.data() })));
      setWidthLengthRelations(wlRelSnap.docs.map(d => ({ id: d.id, ...d.data() })));
    } catch (e) {
      console.error("Error fetching master data:", e);
    }
  };

  // ── Fetch entries ─────────────────────────────────────────────────────────
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

  useEffect(() => {
    fetchEntries();
    fetchMasterData();
  }, []);

  // ── Delete entry ──────────────────────────────────────────────────────────
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

  // ── Update top-level field ────────────────────────────────────────────────
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

  // ── Update section field ──────────────────────────────────────────────────
  const updateSectionField = async (entryId, sectionIdx, field, value) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = entry.sections.map((sec, i) =>
      i === sectionIdx ? { ...sec, [field]: value } : sec
    );
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
    } catch (e) {
      console.error(e);
      alert("Error saving section change.");
    } finally {
      setSaving(false);
    }
  };

  // ── Update supplier rate ──────────────────────────────────────────────────
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
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
    } catch (e) {
      console.error(e);
      alert("Error saving rate change.");
    } finally {
      setSaving(false);
    }
  };

  // ── Add supplier row ──────────────────────────────────────────────────────
  const addSupplierRate = async (entryId, sectionIdx) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = entry.sections.map((sec, si) =>
      si === sectionIdx
        ? { ...sec, supplierRates: [...sec.supplierRates, { supplier: "", mt: 0, rate: 0 }] }
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

  // ── Add section (with combobox form) ─────────────────────────────────────
  const handleAddSection = async (entryId, newSection) => {
    const entry = entries.find(e => e.id === entryId);
    if (!entry) return;
    const newSections = [...entry.sections, newSection];
    setSaving(true);
    try {
      await updateDoc(doc(db, "enquiryEntries", entryId), { sections: newSections });
      setEntries(prev => prev.map(e => e.id === entryId ? { ...e, sections: newSections } : e));
      setAddingSectionForEntryId(null);
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

  // ── Filter ────────────────────────────────────────────────────────────────
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

  const masterData = {
    sectionDocs, allSizeDocs, allWidthDocs, allLengthDocs, supplierDocs,
    sectionSizeRelations, sizeWidthRelations, widthLengthRelations,
    fetchMasterData,
  };

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
              const isAddingSection = addingSectionForEntryId === entry.id;

              return (
                <div key={entry.id} className={`em-card${isExpanded ? " em-card--open" : ""}`}>
                  {/* Card Header */}
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
                              <label className="em-sec-label">Width</label>
                              <EditableCell
                                value={sec.width || ""}
                                onSave={v => updateSectionField(entry.id, si, "width", v)}
                              />
                            </div>
                            <div className="em-sec-field">
                              <label className="em-sec-label">Length</label>
                              <EditableCell
                                value={sec.length || ""}
                                onSave={v => updateSectionField(entry.id, si, "length", v)}
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
                              <span>MT</span>
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
                                    value={String(sr.mt || "")}
                                    type="number"
                                    onSave={v => updateSupplierRateField(entry.id, si, ri, "mt", parseFloat(v) || 0)}
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

                      {/* Add Section — combobox form or button */}
                      {isAddingSection ? (
                        <NewSectionForm
                          masterData={masterData}
                          onAdd={(newSec) => handleAddSection(entry.id, newSec)}
                          onCancel={() => setAddingSectionForEntryId(null)}
                        />
                      ) : (
                        <button
                          className="em-add-section-btn"
                          onClick={() => setAddingSectionForEntryId(entry.id)}
                        >
                          <HiPlus /> Add Section
                        </button>
                      )}
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
