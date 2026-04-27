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
  mt: "",
  rate: "",
});

const createEmptySection = () => ({
  id: generateId(),
  sectionText: "",
  sectionConfirmed: "",
  sizeText: "",
  sizeConfirmed: "",
  widthText: "",
  widthConfirmed: "",
  lengthText: "",
  lengthConfirmed: "",
  mt: "",
  supplierRates: [createEmptySupplierRate()],
});

// ── Reusable Combobox ─────────────────────────────────────────────────────────
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

  // Master data — shared with EntryPage
  const [sectionDocs, setSectionDocs] = useState([]);
  const [supplierDocs, setSupplierDocs] = useState([]);
  const [allSizeDocs, setAllSizeDocs] = useState([]);
  const [allWidthDocs, setAllWidthDocs] = useState([]);
  const [allLengthDocs, setAllLengthDocs] = useState([]);

  // Relation tables — shared with EntryPage
  const [sectionSizeRelations, setSectionSizeRelations] = useState([]);
  const [sizeWidthRelations, setSizeWidthRelations] = useState([]);
  const [widthLengthRelations, setWidthLengthRelations] = useState([]);

  // Derived string arrays
  const allSectionValues = sectionDocs.map(d => d.value);
  const allSupplierValues = supplierDocs.map(d => d.value);
  const allSizeValues = allSizeDocs.map(d => d.value);
  const allWidthValues = allWidthDocs.map(d => d.value);
  const allLengthValues = allLengthDocs.map(d => d.value);

  // Deletable maps
  const allSectionDeletableIds = new Map(sectionDocs.map(d => [d.value, d.id]));
  const allSupplierDeletableIds = new Map(supplierDocs.map(d => [d.value, d.id]));
  const allSizeDeletableIds = new Map(allSizeDocs.map(d => [d.value, d.id]));
  const allWidthDeletableIds = new Map(allWidthDocs.map(d => [d.value, d.id]));
  const allLengthDeletableIds = new Map(allLengthDocs.map(d => [d.value, d.id]));

  // ── Fetch master data ───────────────────────────────────────────────────────
  const fetchData = async () => {
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

  // ── Filtered options based on parent selections ─────────────────────────────

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

  const getAvailableWidthValues = (selectedSection, selectedSize) => {
    if (!selectedSection || !selectedSize) return allWidthValues;
    const sectionObj = sectionDocs.find(s => s.value === selectedSection);
    const sizeObj = allSizeDocs.find(s => s.value === selectedSize);
    if (!sectionObj || !sizeObj) return allWidthValues;
    const relatedWidthIds = sizeWidthRelations
      .filter(rel => rel.sectionId === sectionObj.id && rel.sizeId === sizeObj.id)
      .map(rel => rel.widthId);
    const filtered = allWidthDocs
      .filter(w => relatedWidthIds.includes(w.id))
      .map(d => d.value);
    return filtered.length > 0 ? filtered : allWidthValues;
  };

  const getAvailableLengthValues = (selectedSection, selectedSize, selectedWidth) => {
    if (!selectedSection || !selectedSize) return allLengthValues;
    const sectionObj = sectionDocs.find(s => s.value === selectedSection);
    const sizeObj = allSizeDocs.find(s => s.value === selectedSize);
    const widthObj = selectedWidth ? allWidthDocs.find(w => w.value === selectedWidth) : null;
    if (!sectionObj || !sizeObj) return allLengthValues;
    const relatedLengthIds = widthLengthRelations
      .filter(rel =>
        rel.sectionId === sectionObj.id &&
        rel.sizeId === sizeObj.id &&
        (widthObj ? rel.widthId === widthObj.id : rel.widthId === null)
      )
      .map(rel => rel.lengthId);
    const filtered = allLengthDocs
      .filter(l => relatedLengthIds.includes(l.id))
      .map(d => d.value);
    return filtered.length > 0 ? filtered : allLengthValues;
  };

  // ── Add / Delete Section ────────────────────────────────────────────────────
  const handleAddNewSection = async (newVal) => {
    const exists = allSectionValues.some(s => s.toLowerCase() === newVal.toLowerCase());
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
            ? { ...s, sectionText: "", sectionConfirmed: "", sizeText: "", sizeConfirmed: "", widthText: "", widthConfirmed: "", lengthText: "", lengthConfirmed: "" }
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
  const handleAddNewSize = async (newVal, sectionConfirmed) => {
    const exists = allSizeValues.some(s => s.toLowerCase() === newVal.toLowerCase());
    if (!exists) {
      try {
        const docRef = await addDoc(collection(db, "sizes"), { value: newVal });
        if (sectionConfirmed) {
          const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
          if (sectionObj) {
            await addDoc(collection(db, "sectionSizeRelations"), {
              sectionId: sectionObj.id, sizeId: docRef.id,
            });
          }
        }
        await fetchData();
      } catch (e) {
        console.error("Error adding size:", e);
        alert("Error adding new size.");
      }
    } else {
      if (sectionConfirmed) {
        const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
        const sizeObj = allSizeDocs.find(s => s.value.toLowerCase() === newVal.toLowerCase());
        if (sectionObj && sizeObj) {
          const alreadyLinked = sectionSizeRelations.some(
            r => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id
          );
          if (!alreadyLinked) {
            await addDoc(collection(db, "sectionSizeRelations"), {
              sectionId: sectionObj.id, sizeId: sizeObj.id,
            });
            await fetchData();
          }
        }
      }
    }
  };

  const handleDeleteSize = async (val, docId) => {
    try {
      await deleteDoc(doc(db, "sizes", docId));
      setSections(prev =>
        prev.map(s =>
          s.sizeConfirmed === val
            ? { ...s, sizeText: "", sizeConfirmed: "", widthText: "", widthConfirmed: "", lengthText: "", lengthConfirmed: "" }
            : s
        )
      );
      await fetchData();
    } catch (e) {
      console.error("Error deleting size:", e);
      alert("Error deleting size.");
    }
  };

  // ── Add / Delete Width ──────────────────────────────────────────────────────
  const handleAddNewWidth = async (newVal, sectionConfirmed, sizeConfirmed) => {
    const exists = allWidthValues.some(w => w.toLowerCase() === newVal.toLowerCase());
    try {
      let widthId;
      if (!exists) {
        const docRef = await addDoc(collection(db, "widths"), { value: newVal });
        widthId = docRef.id;
      } else {
        widthId = allWidthDocs.find(w => w.value.toLowerCase() === newVal.toLowerCase())?.id;
      }
      if (sectionConfirmed && sizeConfirmed && widthId) {
        const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
        const sizeObj = allSizeDocs.find(s => s.value === sizeConfirmed);
        if (sectionObj && sizeObj) {
          const alreadyLinked = sizeWidthRelations.some(
            r => r.sectionId === sectionObj.id && r.sizeId === sizeObj.id && r.widthId === widthId
          );
          if (!alreadyLinked) {
            await addDoc(collection(db, "sizeWidthRelations"), {
              sectionId: sectionObj.id, sizeId: sizeObj.id, widthId,
            });
          }
        }
      }
      await fetchData();
    } catch (e) {
      console.error("Error adding width:", e);
      alert("Error adding new width.");
    }
  };

  const handleDeleteWidth = async (val, docId) => {
    try {
      await deleteDoc(doc(db, "widths", docId));
      setSections(prev =>
        prev.map(s =>
          s.widthConfirmed === val
            ? { ...s, widthText: "", widthConfirmed: "", lengthText: "", lengthConfirmed: "" }
            : s
        )
      );
      await fetchData();
    } catch (e) {
      console.error("Error deleting width:", e);
      alert("Error deleting width.");
    }
  };

  // ── Add / Delete Length ─────────────────────────────────────────────────────
  const handleAddNewLength = async (newVal, sectionConfirmed, sizeConfirmed, widthConfirmed) => {
    const exists = allLengthValues.some(l => l.toLowerCase() === newVal.toLowerCase());
    try {
      let lengthId;
      if (!exists) {
        const docRef = await addDoc(collection(db, "itemLengths"), { value: newVal });
        lengthId = docRef.id;
      } else {
        lengthId = allLengthDocs.find(l => l.value.toLowerCase() === newVal.toLowerCase())?.id;
      }
      if (sectionConfirmed && sizeConfirmed && lengthId) {
        const sectionObj = sectionDocs.find(s => s.value === sectionConfirmed);
        const sizeObj = allSizeDocs.find(s => s.value === sizeConfirmed);
        const widthObj = widthConfirmed ? allWidthDocs.find(w => w.value === widthConfirmed) : null;
        if (sectionObj && sizeObj) {
          const alreadyLinked = widthLengthRelations.some(
            r =>
              r.sectionId === sectionObj.id &&
              r.sizeId === sizeObj.id &&
              (widthObj ? r.widthId === widthObj.id : r.widthId === null) &&
              r.lengthId === lengthId
          );
          if (!alreadyLinked) {
            await addDoc(collection(db, "widthLengthRelations"), {
              sectionId: sectionObj.id,
              sizeId: sizeObj.id,
              widthId: widthObj ? widthObj.id : null,
              lengthId,
            });
          }
        }
      }
      await fetchData();
    } catch (e) {
      console.error("Error adding length:", e);
      alert("Error adding new length.");
    }
  };

  const handleDeleteLength = async (val, docId) => {
    try {
      await deleteDoc(doc(db, "itemLengths", docId));
      setSections(prev =>
        prev.map(s =>
          s.lengthConfirmed === val
            ? { ...s, lengthText: "", lengthConfirmed: "" }
            : s
        )
      );
      await fetchData();
    } catch (e) {
      console.error("Error deleting length:", e);
      alert("Error deleting length.");
    }
  };

  // ── Add / Delete Supplier ───────────────────────────────────────────────────
  const handleAddNewSupplier = async (newVal) => {
    const exists = allSupplierValues.some(s => s.toLowerCase() === newVal.toLowerCase());
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

  // ── Section row handlers ────────────────────────────────────────────────────
  const handleSectionField = (sectionId, field, value) => {
    setSections(prev =>
      prev.map(s => {
        if (s.id !== sectionId) return s;
        const updated = { ...s, [field]: value };
        if (field === "sectionConfirmed") {
          updated.sizeText = "";
          updated.sizeConfirmed = "";
          updated.widthText = "";
          updated.widthConfirmed = "";
          updated.lengthText = "";
          updated.lengthConfirmed = "";
        }
        if (field === "sizeConfirmed") {
          updated.widthText = "";
          updated.widthConfirmed = "";
          updated.lengthText = "";
          updated.lengthConfirmed = "";
        }
        if (field === "widthConfirmed") {
          updated.lengthText = "";
          updated.lengthConfirmed = "";
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
        if (!sr.mt) return alert("Please enter MT for all supplier rows");
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
          width: s.widthConfirmed || s.widthText.trim(),
          length: s.lengthConfirmed || s.lengthText.trim(),
          mt: parseFloat(s.mt) || 0,
          supplierRates: s.supplierRates.map(r => ({
            supplier: r.supplierConfirmed || r.supplierText.trim(),
            mt: parseFloat(r.mt) || 0,
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
          <span className="enq-enquiry-no-badge">Enquiry #{entryNo}</span>
          <span className="enq-fy-badge">{financialYear}</span>
        </div>
      </div>

      <div className="enq-form-body">
        {/* Meta Row */}
        <div className="enq-meta-grid">
          <div className="enq-field">
            <label className="enq-label">Enquiry No</label>
            <div className="enq-readonly-no">#{entryNo}</div>
          </div>

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

              {/* Section / Size / Width / Length / MT */}
              <div className="enq-section-fields enq-section-fields--wide">

                {/* Section */}
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
                    <span className="enq-confirmed-chip">✓ {sec.sectionConfirmed}</span>
                  )}
                </div>

                {/* Size */}
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
                    onAddNew={(val) => handleAddNewSize(val, sec.sectionConfirmed)}
                    onDelete={handleDeleteSize}
                  />
                  {sec.sizeConfirmed && (
                    <span className="enq-confirmed-chip">✓ {sec.sizeConfirmed}</span>
                  )}
                </div>

                {/* Width */}
                <div className="enq-field">
                  <label className="enq-label">Width</label>
                  <Combobox
                    label="width"
                    placeholder="Type or select width..."
                    value={sec.widthText}
                    options={getAvailableWidthValues(sec.sectionConfirmed, sec.sizeConfirmed)}
                    deletableIds={allWidthDeletableIds}
                    disabled={!sec.sizeConfirmed}
                    onChange={val => handleSectionField(sec.id, "widthText", val)}
                    onConfirm={val => handleSectionField(sec.id, "widthConfirmed", val)}
                    onAddNew={(val) => handleAddNewWidth(val, sec.sectionConfirmed, sec.sizeConfirmed)}
                    onDelete={handleDeleteWidth}
                  />
                  {sec.widthConfirmed && (
                    <span className="enq-confirmed-chip">✓ {sec.widthConfirmed}</span>
                  )}
                </div>

                {/* Length */}
                <div className="enq-field">
                  <label className="enq-label">Length</label>
                  <Combobox
                    label="length"
                    placeholder="Type or select length..."
                    value={sec.lengthText}
                    options={getAvailableLengthValues(sec.sectionConfirmed, sec.sizeConfirmed, sec.widthConfirmed)}
                    deletableIds={allLengthDeletableIds}
                    disabled={!sec.sizeConfirmed}
                    onChange={val => handleSectionField(sec.id, "lengthText", val)}
                    onConfirm={val => handleSectionField(sec.id, "lengthConfirmed", val)}
                    onAddNew={(val) => handleAddNewLength(val, sec.sectionConfirmed, sec.sizeConfirmed, sec.widthConfirmed)}
                    onDelete={handleDeleteLength}
                  />
                  {sec.lengthConfirmed && (
                    <span className="enq-confirmed-chip">✓ {sec.lengthConfirmed}</span>
                  )}
                </div>

                {/* Quantity (MT) — section level */}
                <div className="enq-field">
                  <label className="enq-label">Quantity (MT)</label>
                  <input
                    className="enq-input"
                    type="text"
                    inputMode="decimal"
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
                  <div className="enq-supplier-rate-header-row enq-supplier-rate-header-row--5col">
                    <span>#</span>
                    <span>Supplier Name</span>
                    <span>MT</span>
                    <span>Rate Quoted</span>
                    <span></span>
                  </div>
                  {sec.supplierRates.map((sr, srIdx) => (
                    <div key={sr.id} className="enq-supplier-rate-row enq-supplier-rate-row--5col">
                      <span className="enq-sr-index">{srIdx + 1}</span>

                      {/* Supplier Name */}
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

                      {/* MT per supplier */}
                      <div className="enq-supplier-mt-wrapper">
                        <input
                          className="enq-input enq-supplier-mt-input"
                          type="text"
                          inputMode="decimal"
                          placeholder="0.00"
                          value={sr.mt}
                          onChange={e =>
                            handleSupplierRateField(sec.id, sr.id, "mt", e.target.value)
                          }
                        />
                      </div>

                      {/* Rate Quoted */}
                      <div className="enq-rate-input-wrapper">
                        <span className="enq-rate-prefix">Rs</span>
                        <input
                          className="enq-input enq-rate-input"
                          type="text"
                          inputMode="decimal"
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