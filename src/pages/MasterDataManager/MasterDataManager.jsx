import { useState, useEffect } from "react";
import { db } from "../../firebase";
import {
  collection, getDocs, addDoc, deleteDoc, updateDoc, doc, writeBatch, query, where
} from "firebase/firestore";
import "./MasterDataManager.css";

const CATEGORIES = [
  { key: "sections",    label: "Sections",     icon: "⬡", color: "#2196F3" },
  { key: "sizes",       label: "Sizes",        icon: "⊞", color: "#9C27B0" },
  { key: "widths",      label: "Widths",       icon: "↔", color: "#FF9800" },
  { key: "itemLengths", label: "Item Lengths", icon: "↕", color: "#E91E63" },
  { key: "suppliers",   label: "Suppliers",    icon: "🏭", color: "#009688" },
  { key: "places",      label: "Places",       icon: "📍", color: "#F44336" },
];

export default function MasterDataManager() {
  const [activeTab, setActiveTab] = useState("sections");
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [renaming, setRenaming] = useState(null); // { id, value, originalValue }
  const [adding, setAdding] = useState("");
  const [addInput, setAddInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState(null); // { message, type }

  const showToast = (message, type = "success") => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3000);
  };

  const fetchAll = async () => {
    setLoading(true);
    try {
      const results = {};
      for (const cat of CATEGORIES) {
        const snap = await getDocs(collection(db, cat.key));
        results[cat.key] = snap.docs
          .map(d => ({ id: d.id, value: d.data().value?.trim() || "" }))
          .filter(i => i.value)
          .sort((a, b) => a.value.localeCompare(b.value));
      }
      setItems(results);
    } catch (e) {
      console.error(e);
      showToast("Error fetching data", "error");
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  // ── ADD ───────────────────────────────────────────────────────────────────
  const handleAdd = async () => {
    const val = addInput.trim();
    if (!val) { showToast("Please enter a value", "error"); return; }

    const exists = (items[activeTab] || []).find(
      i => i.value.toLowerCase() === val.toLowerCase()
    );
    if (exists) { showToast(`"${val}" already exists`, "error"); return; }

    setSaving(true);
    try {
      const docRef = await addDoc(collection(db, activeTab), { value: val });
      const updated = [...(items[activeTab] || []), { id: docRef.id, value: val }]
        .sort((a, b) => a.value.localeCompare(b.value));
      setItems(prev => ({ ...prev, [activeTab]: updated }));
      setAddInput("");
      setAdding("");
      showToast(`"${val}" added successfully`);
    } catch (e) {
      showToast("Error adding value", "error");
    }
    setSaving(false);
  };

  // ── RENAME ────────────────────────────────────────────────────────────────
  const startRename = (item) => {
    setRenaming({ id: item.id, value: item.value, originalValue: item.value });
  };

  const cancelRename = () => setRenaming(null);

  const handleRename = async () => {
    if (!renaming) return;
    const newVal = renaming.value.trim();
    if (!newVal) { showToast("Value cannot be empty", "error"); return; }
    if (newVal === renaming.originalValue) { setRenaming(null); return; }

    const exists = (items[activeTab] || []).find(
      i => i.value.toLowerCase() === newVal.toLowerCase() && i.id !== renaming.id
    );
    if (exists) { showToast(`"${newVal}" already exists`, "error"); return; }

    setSaving(true);
    try {
      // 1. Update the master collection document
      await updateDoc(doc(db, activeTab, renaming.id), { value: newVal });

      // 2. Bulk update all entries that use this old value
      const fieldMap = {
        sections:    "Section",
        sizes:       "Size",
        widths:      "Width",
        itemLengths: "Item Length",
        suppliers:   "Name of the Supplier",
        places:      "Supplier Place",
      };
      const entryField = fieldMap[activeTab];
      const entriesSnap = await getDocs(collection(db, "entries"));

      const batch = writeBatch(db);
      let updateCount = 0;

      entriesSnap.docs.forEach(entryDoc => {
        const data = entryDoc.data();

        if (activeTab === "suppliers" || activeTab === "places") {
          // These are header-level fields
          if (data[entryField] === renaming.originalValue) {
            batch.update(doc(db, "entries", entryDoc.id), {
              [entryField]: newVal
            });
            updateCount++;
          }
        } else {
          // These are item-level fields inside the items array
          if (data.items && Array.isArray(data.items)) {
            const hasMatch = data.items.some(
              item => item[entryField] === renaming.originalValue
            );
            if (hasMatch) {
              const updatedItems = data.items.map(item =>
                item[entryField] === renaming.originalValue
                  ? { ...item, [entryField]: newVal }
                  : item
              );
              batch.update(doc(db, "entries", entryDoc.id), {
                items: updatedItems
              });
              updateCount++;
            }
          }
        }
      });

      await batch.commit();

      // 3. Update local state
      const updated = (items[activeTab] || [])
        .map(i => i.id === renaming.id ? { ...i, value: newVal } : i)
        .sort((a, b) => a.value.localeCompare(b.value));
      setItems(prev => ({ ...prev, [activeTab]: updated }));
      setRenaming(null);
      showToast(
        updateCount > 0
          ? `Renamed to "${newVal}" and updated ${updateCount} entry(s)`
          : `Renamed to "${newVal}"`
      );
    } catch (e) {
      console.error(e);
      showToast("Error renaming value", "error");
    }
    setSaving(false);
  };

  // ── DELETE ────────────────────────────────────────────────────────────────
  const handleDelete = async (item) => {
    if (!window.confirm(`Delete "${item.value}"? This will NOT remove it from existing entries.`)) return;

    setSaving(true);
    try {
      await deleteDoc(doc(db, activeTab, item.id));
      const updated = (items[activeTab] || []).filter(i => i.id !== item.id);
      setItems(prev => ({ ...prev, [activeTab]: updated }));
      showToast(`"${item.value}" deleted from master list`);
    } catch (e) {
      showToast("Error deleting value", "error");
    }
    setSaving(false);
  };

  const activeCat = CATEGORIES.find(c => c.key === activeTab);
  const filteredItems = (items[activeTab] || []).filter(i =>
    i.value.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="mdm-container">
      {/* Toast */}
      {toast && (
        <div className={`mdm-toast mdm-toast--${toast.type}`}>
          <span>{toast.type === "success" ? "✓" : "✕"}</span>
          {toast.message}
        </div>
      )}

      {/* Header */}
      <div className="mdm-header">
        <div>
          <h1 className="mdm-title">Master Data Manager</h1>
       
        </div>
      </div>

      {/* Tab Bar */}
      <div className="mdm-tabs">
        {CATEGORIES.map(cat => (
          <button
            key={cat.key}
            className={`mdm-tab ${activeTab === cat.key ? "mdm-tab--active" : ""}`}
            style={activeTab === cat.key ? { borderBottomColor: cat.color, color: cat.color } : {}}
            onClick={() => {
              setActiveTab(cat.key);
              setSearchQuery("");
              setRenaming(null);
              setAdding("");
              setAddInput("");
            }}
          >
            <span className="mdm-tab-icon">{cat.icon}</span>
            {cat.label}
            <span
              className="mdm-tab-count"
              style={activeTab === cat.key ? { background: cat.color } : {}}
            >
              {(items[cat.key] || []).length}
            </span>
          </button>
        ))}
      </div>

      {/* Content Panel */}
      <div className="mdm-panel">

        {/* Panel Toolbar */}
        <div className="mdm-toolbar">
          <div className="mdm-search-wrapper">
            <span className="mdm-search-icon">🔍</span>
            <input
              type="text"
              className="mdm-search"
              placeholder={`Search ${activeCat?.label}...`}
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button className="mdm-search-clear" onClick={() => setSearchQuery("")}>✕</button>
            )}
          </div>

          <button
            className="mdm-btn mdm-btn--add"
            onClick={() => { setAdding(activeTab); setAddInput(""); setRenaming(null); }}
          >
            + Add New
          </button>
        </div>

        {/* Add New Row */}
        {adding === activeTab && (
          <div className="mdm-add-row">
            <input
              type="text"
              className="mdm-add-input"
              placeholder={`Enter new ${activeCat?.label.toLowerCase().slice(0, -1)} name...`}
              value={addInput}
              autoFocus
              onChange={e => setAddInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === "Enter") handleAdd();
                if (e.key === "Escape") { setAdding(""); setAddInput(""); }
              }}
            />
            <button className="mdm-btn mdm-btn--save" onClick={handleAdd} disabled={saving}>
              {saving ? "Saving..." : "Save"}
            </button>
            <button className="mdm-btn mdm-btn--cancel" onClick={() => { setAdding(""); setAddInput(""); }}>
              Cancel
            </button>
          </div>
        )}

        {/* Table */}
        {loading ? (
          <div className="mdm-loading">
            <div className="mdm-spinner" style={{ borderTopColor: activeCat?.color }}></div>
            <span>Loading...</span>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="mdm-empty">
            {searchQuery
              ? `No results for "${searchQuery}"`
              : `No ${activeCat?.label.toLowerCase()} yet. Click "+ Add New" to create one.`}
          </div>
        ) : (
          <div className="mdm-table-wrapper">
            <table className="mdm-table">
              <thead>
                <tr>
                  <th className="mdm-th mdm-th--no">#</th>
                  <th className="mdm-th">Name / Value</th>
                  <th className="mdm-th mdm-th--actions">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item, idx) => (
                  <tr key={item.id} className="mdm-row">
                    <td className="mdm-td mdm-td--no">{idx + 1}</td>
                    <td className="mdm-td">
                      {renaming && renaming.id === item.id ? (
                        <div className="mdm-rename-row">
                          <input
                            type="text"
                            className="mdm-rename-input"
                            value={renaming.value}
                            autoFocus
                            onChange={e => setRenaming(prev => ({ ...prev, value: e.target.value }))}
                            onKeyDown={e => {
                              if (e.key === "Enter") handleRename();
                              if (e.key === "Escape") cancelRename();
                            }}
                          />
                          <button className="mdm-btn mdm-btn--save mdm-btn--sm" onClick={handleRename} disabled={saving}>
                            {saving ? "…" : "✓ Save"}
                          </button>
                          <button className="mdm-btn mdm-btn--cancel mdm-btn--sm" onClick={cancelRename}>
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div className="mdm-value-cell">
                          <span
                            className="mdm-dot"
                            style={{ background: activeCat?.color }}
                          ></span>
                          <span className="mdm-value-text">{item.value}</span>
                        </div>
                      )}
                    </td>
                    <td className="mdm-td mdm-td--actions">
                      {!(renaming && renaming.id === item.id) && (
                        <div className="mdm-action-btns">
                          <button
                            className="mdm-action-btn mdm-action-btn--rename"
                            onClick={() => startRename(item)}
                            title="Rename (updates all entries)"
                          >
                            ✏️ Rename
                          </button>
                          <button
                            className="mdm-action-btn mdm-action-btn--delete"
                            onClick={() => handleDelete(item)}
                            title="Remove from master list"
                          >
                            🗑️ Delete
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Footer count */}
        {!loading && (
          <div className="mdm-footer">
            {searchQuery
              ? `Showing ${filteredItems.length} of ${(items[activeTab] || []).length} ${activeCat?.label.toLowerCase()}`
              : `${(items[activeTab] || []).length} ${activeCat?.label.toLowerCase()} total`}
          </div>
        )}
      </div>  
    </div>
  );
}