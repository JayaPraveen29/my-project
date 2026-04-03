import { useState, useEffect, useRef } from "react";
import { HiPlus, HiTrash } from "react-icons/hi2";
import { db } from "../../firebase";
import { collection, addDoc, getDocs, query, orderBy, limit, deleteDoc, doc } from "firebase/firestore";
import "./EntryPage.css";

export default function EntryPage() {
  const [loading, setLoading] = useState(false);
  const [entryNo, setEntryNo] = useState(1);
  const [financialYear, setFinancialYear] = useState("2026-27");
  const [unit, setUnit] = useState("");
  const [workType, setWorkType] = useState("");
  const [headerData, setHeaderData] = useState({
    PO: "", "Received On": "", "Bill Number": "", "Bill Date": "",
    "Name of the Supplier": "", "Supplier Place": "",
  });

  // Supplier combobox state
  const [supplierInputText, setSupplierInputText] = useState("");
  const [supplierSuggestions, setSupplierSuggestions] = useState([]);
  const [showSupplierSuggestions, setShowSupplierSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const supplierWrapperRef = useRef(null);

  const [items, setItems] = useState([{
    id: Date.now(), Section: "", Size: "", Width: "", "Item Length": "",
    "Number of items Supplied": "", "Quantity in Metric Tons": "", "Item Per Rate": "",
    "Bill Basic Amount": 0, "Section Loading Charges": 0, "Section Freight<": 0,
    "Section Freight>": 0, "Section Subtotal": 0,
  }]);

  const [charges, setCharges] = useState({
    "Loading Charges": "", "Freight<": "", Others: "", "Freight>": "",
  });

  const [gstType, setGstType] = useState("AP");
  const [cgstPercentage, setCgstPercentage] = useState("9");
  const [sgstPercentage, setSgstPercentage] = useState("9");
  const [igstPercentage, setIgstPercentage] = useState("18");

  const [allSections, setAllSections] = useState([]);
  const [allSizes, setAllSizes] = useState([]);
  const [allWidths, setAllWidths] = useState([]);
  const [allItemLengths, setAllItemLengths] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [allPlaces, setAllPlaces] = useState([]);

  const [sectionSizeRelations, setSectionSizeRelations] = useState([]);
  const [sizeWidthRelations, setSizeWidthRelations] = useState([]);
  const [widthLengthRelations, setWidthLengthRelations] = useState([]);
  const [supplierPlaceRelations, setSupplierPlaceRelations] = useState([]);

  const [customInputs, setCustomInputs] = useState({});
  const [manualEdits, setManualEdits] = useState({});

  // Close supplier suggestions on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (supplierWrapperRef.current && !supplierWrapperRef.current.contains(e.target)) {
        setShowSupplierSuggestions(false);
        setHighlightedIndex(-1);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const removeDuplicates = (arr) => {
    const seen = new Map();
    return arr.filter(item => {
      const lowerValue = item.value.toLowerCase();
      if (seen.has(lowerValue)) return false;
      seen.set(lowerValue, true);
      return true;
    });
  };

  const cleanupOrphanedRelations = async (sections, sizes, widths, lengths, suppliers, places, sectionSizeRels, sizeWidthRels, widthLengthRels, supplierPlaceRels) => {
    try {
      const sectionIds = new Set(sections.map(s => s.id));
      const sizeIds = new Set(sizes.map(s => s.id));
      const widthIds = new Set(widths.map(w => w.id));
      const lengthIds = new Set(lengths.map(l => l.id));
      const supplierIds = new Set(suppliers.map(s => s.id));
      const placeIds = new Set(places.map(p => p.id));
      let orphanedCount = 0;

      for (const rel of sectionSizeRels) {
        if (!sectionIds.has(rel.sectionId) || !sizeIds.has(rel.sizeId)) {
          await deleteDoc(doc(db, "sectionSizeRelations", rel.id)); orphanedCount++;
        }
      }
      for (const rel of sizeWidthRels) {
        if (!sectionIds.has(rel.sectionId) || !sizeIds.has(rel.sizeId) || !widthIds.has(rel.widthId)) {
          await deleteDoc(doc(db, "sizeWidthRelations", rel.id)); orphanedCount++;
        }
      }
      for (const rel of widthLengthRels) {
        if (!sectionIds.has(rel.sectionId) || !sizeIds.has(rel.sizeId) || (rel.widthId !== null && !widthIds.has(rel.widthId)) || !lengthIds.has(rel.lengthId)) {
          await deleteDoc(doc(db, "widthLengthRelations", rel.id)); orphanedCount++;
        }
      }
      for (const rel of supplierPlaceRels) {
        if (!supplierIds.has(rel.supplierId) || !placeIds.has(rel.placeId)) {
          await deleteDoc(doc(db, "supplierPlaceRelations", rel.id)); orphanedCount++;
        }
      }
      console.log(orphanedCount > 0 ? `✅ Cleaned up ${orphanedCount} orphaned relationship(s)` : "✅ No orphaned relationships found");
    } catch (error) {
      console.error("❌ Error cleaning up orphaned relationships:", error);
    }
  };

  const fetchMasterData = async () => {
    try {
      const sectionsSnap = await getDocs(collection(db, "sections"));
      const sizesSnap = await getDocs(collection(db, "sizes"));
      const widthsSnap = await getDocs(collection(db, "widths"));
      const itemLengthsSnap = await getDocs(collection(db, "itemLengths"));
      const suppliersSnap = await getDocs(collection(db, "suppliers"));
      const placesSnap = await getDocs(collection(db, "places"));

      const sections = sectionsSnap.docs.map(d => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true })).filter(i => i.value).sort((a, b) => a.value.localeCompare(b.value));
      const sizes = sizesSnap.docs.map(d => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true })).filter(i => i.value).sort((a, b) => a.value.localeCompare(b.value));
      const widths = removeDuplicates(widthsSnap.docs.map(d => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true })).filter(i => i.value).sort((a, b) => a.value.localeCompare(b.value)));
      const itemLengths = removeDuplicates(itemLengthsSnap.docs.map(d => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true })).filter(i => i.value).sort((a, b) => a.value.localeCompare(b.value)));
      const suppliers = suppliersSnap.docs.map(d => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true })).filter(i => i.value).sort((a, b) => a.value.localeCompare(b.value));
      const places = placesSnap.docs.map(d => ({ id: d.id, value: d.data().value?.trim() || "", isManual: true })).filter(i => i.value).sort((a, b) => a.value.localeCompare(b.value));

      const sectionSizeRels = (await getDocs(collection(db, "sectionSizeRelations"))).docs.map(d => ({ id: d.id, ...d.data() }));
      const sizeWidthRels = (await getDocs(collection(db, "sizeWidthRelations"))).docs.map(d => ({ id: d.id, ...d.data() }));
      const widthLengthRels = (await getDocs(collection(db, "widthLengthRelations"))).docs.map(d => ({ id: d.id, ...d.data() }));
      const supplierPlaceRels = (await getDocs(collection(db, "supplierPlaceRelations"))).docs.map(d => ({ id: d.id, ...d.data() }));

      await cleanupOrphanedRelations(sections, sizes, widths, itemLengths, suppliers, places, sectionSizeRels, sizeWidthRels, widthLengthRels, supplierPlaceRels);

      setAllSections(sections);
      setAllSizes(sizes);
      setAllWidths(widths);
      setAllItemLengths(itemLengths);
      setAllSuppliers(suppliers);
      setAllPlaces(places);
      setSectionSizeRelations((await getDocs(collection(db, "sectionSizeRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
      setSizeWidthRelations((await getDocs(collection(db, "sizeWidthRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
      setWidthLengthRelations((await getDocs(collection(db, "widthLengthRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
      setSupplierPlaceRelations((await getDocs(collection(db, "supplierPlaceRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));

      console.log("✅ Data fetched successfully!");
    } catch (error) {
      console.error("❌ Error fetching data:", error);
      alert("Error fetching data from Firebase");
    }
  };

  useEffect(() => {
    fetchMasterData();
    const fetchLastNo = async () => {
      try {
        const q = query(collection(db, "entries"), orderBy("No", "desc"), limit(1));
        const snap = await getDocs(q);
        if (!snap.empty) setEntryNo(snap.docs[0].data().No + 1);
      } catch (e) { console.error("Error fetching entry number:", e); }
    };
    fetchLastNo();
  }, []);

  // ── Supplier combobox logic ────────────────────────────────────────────────

  const applySupplierSelection = (value) => {
    if (!value) {
      setHeaderData(prev => ({ ...prev, "Name of the Supplier": "", "Supplier Place": "" }));
      return;
    }
    const supplierObj = allSuppliers.find(s => s.value === value);
    if (supplierObj) {
      const relatedPlaceIds = supplierPlaceRelations.filter(r => r.supplierId === supplierObj.id).map(r => r.placeId);
      const relatedPlaces = allPlaces.filter(p => relatedPlaceIds.includes(p.id));
      setHeaderData(prev => ({
        ...prev,
        "Name of the Supplier": value,
        "Supplier Place": relatedPlaces.length === 1 ? relatedPlaces[0].value : ""
      }));
    } else {
      // New supplier not yet saved — store name, clear place so user can pick from all places
      setHeaderData(prev => ({ ...prev, "Name of the Supplier": value, "Supplier Place": "" }));
    }
  };

  const handleSupplierInputChange = (text) => {
    setSupplierInputText(text);
    setHighlightedIndex(-1);
    if (!text.trim()) {
      setSupplierSuggestions([]);
      setShowSupplierSuggestions(false);
      applySupplierSelection("");
      return;
    }
    const filtered = allSuppliers.filter(s => s.value.toLowerCase().includes(text.toLowerCase()));
    setSupplierSuggestions(filtered);
    setShowSupplierSuggestions(true);
    const exact = allSuppliers.find(s => s.value.toLowerCase() === text.toLowerCase());
    if (exact) applySupplierSelection(exact.value);
    else setHeaderData(prev => ({ ...prev, "Name of the Supplier": "", "Supplier Place": "" }));
  };

  const handleSupplierSuggestionClick = (value) => {
    setSupplierInputText(value);
    setShowSupplierSuggestions(false);
    setSupplierSuggestions([]);
    setHighlightedIndex(-1);
    applySupplierSelection(value);
  };

  const handleSupplierDropdownChange = (value) => {
    setSupplierInputText(value);
    setShowSupplierSuggestions(false);
    setHighlightedIndex(-1);
    applySupplierSelection(value);
  };

  const clearSupplier = () => {
    setSupplierInputText("");
    setSupplierSuggestions([]);
    setShowSupplierSuggestions(false);
    setHighlightedIndex(-1);
    applySupplierSelection("");
  };

  // Sync text box if headerData changes externally
  useEffect(() => {
    setSupplierInputText(headerData["Name of the Supplier"] || "");
  }, [headerData["Name of the Supplier"]]);

  // ─────────────────────────────────────────────────────────────────────────

  const getAvailableSizes = (selectedSection) => {
    if (!selectedSection) return [];
    const sectionObj = allSections.find(s => s.value === selectedSection);
    if (!sectionObj) return [];
    const relatedSizeIds = sectionSizeRelations.filter(rel => rel.sectionId === sectionObj.id).map(rel => rel.sizeId);
    return allSizes.filter(size => relatedSizeIds.includes(size.id));
  };

  // ── UPDATED: show all places when supplier is new (not yet in allSuppliers) ──
  const getAvailablePlaces = (selectedSupplier) => {
    if (!selectedSupplier) return [];
    const supplierObj = allSuppliers.find(s => s.value === selectedSupplier);
    // Supplier not yet saved → show all places so user can link one
    if (!supplierObj) return allPlaces;
    const relatedPlaceIds = supplierPlaceRelations.filter(rel => rel.supplierId === supplierObj.id).map(rel => rel.placeId);
    // Existing supplier with no linked places yet → also show all places
    if (relatedPlaceIds.length === 0) return allPlaces;
    return allPlaces.filter(place => relatedPlaceIds.includes(place.id));
  };
  // ─────────────────────────────────────────────────────────────────────────

  const handleAddCustomValue = async (itemId, type, value) => {
    if (!value.trim()) { alert("Please enter a value!"); return; }
    const trimmedValue = value.trim();
    setCustomInputs(prev => ({ ...prev, [`${itemId}-${type}`]: { show: prev[`${itemId}-${type}`]?.show || false, value: "" } }));

    let collectionName = "", currentOptions = [], setOptions = null;
    if (type === "section") { collectionName = "sections"; currentOptions = allSections; setOptions = setAllSections; }
    else if (type === "size") { collectionName = "sizes"; currentOptions = allSizes; setOptions = setAllSizes; }
    else if (type === "width") { collectionName = "widths"; currentOptions = allWidths; setOptions = setAllWidths; }
    else if (type === "itemLength") { collectionName = "itemLengths"; currentOptions = allItemLengths; setOptions = setAllItemLengths; }
    else if (type === "supplier") { collectionName = "suppliers"; currentOptions = allSuppliers; setOptions = setAllSuppliers; }
    else if (type === "place") { collectionName = "places"; currentOptions = allPlaces; setOptions = setAllPlaces; }

    if (type === "place" && itemId === "header") {
      const currentSupplier = headerData["Name of the Supplier"];
      if (currentSupplier) {
        const supplierObj = allSuppliers.find(s => s.value === currentSupplier);
        if (supplierObj) {
          const existingRelation = supplierPlaceRelations.find(rel =>
            rel.supplierId === supplierObj.id && allPlaces.find(p => p.id === rel.placeId && p.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          if (existingRelation) {
            const existingPlace = allPlaces.find(p => p.id === existingRelation.placeId);
            alert(`"${trimmedValue}" already exists for this supplier.`);
            setHeaderData(prev => ({ ...prev, "Supplier Place": existingPlace.value }));
            return;
          }
          const existingPlace = allPlaces.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingPlace) {
            await addDoc(collection(db, "supplierPlaceRelations"), { supplierId: supplierObj.id, placeId: existingPlace.id });
            setSupplierPlaceRelations((await getDocs(collection(db, "supplierPlaceRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
            setHeaderData(prev => ({ ...prev, "Supplier Place": existingPlace.value }));
            alert(`Place "${trimmedValue}" linked to this supplier!`);
            return;
          }
        }
      }
    } else if (type === "supplier" && itemId === "header") {
      const existingSupplier = allSuppliers.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
      if (existingSupplier) {
        alert(`"${trimmedValue}" already exists.`);
        applySupplierSelection(existingSupplier.value);
        return;
      }
      try {
        const docRef = await addDoc(collection(db, "suppliers"), { value: trimmedValue });
        const newOption = { id: docRef.id, value: trimmedValue, isManual: true };
        const updatedSuppliers = [...allSuppliers, newOption].sort((a, b) => a.value.localeCompare(b.value));
        setAllSuppliers(updatedSuppliers);
        applySupplierSelection(trimmedValue);
        alert(`Supplier "${trimmedValue}" added successfully!`);
      } catch (error) {
        console.error("Error adding supplier:", error);
        alert("Error adding supplier. Please try again.");
      }
      return;
    } else if (type === "size" && itemId !== "header") {
      const item = items.find(i => i.id === itemId);
      if (item && item.Section) {
        const sectionObj = allSections.find(s => s.value === item.Section);
        if (sectionObj) {
          const existingRelation = sectionSizeRelations.find(rel =>
            rel.sectionId === sectionObj.id && allSizes.find(s => s.id === rel.sizeId && s.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          if (existingRelation) {
            const existingSize = allSizes.find(s => s.id === existingRelation.sizeId);
            alert(`"${trimmedValue}" already exists for this section.`);
            setItems(items.map(i => i.id === itemId ? { ...i, Size: existingSize.value } : i));
            return;
          }
          const existingSize = allSizes.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingSize) {
            await addDoc(collection(db, "sectionSizeRelations"), { sectionId: sectionObj.id, sizeId: existingSize.id });
            setSectionSizeRelations((await getDocs(collection(db, "sectionSizeRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
            setItems(items.map(i => i.id === itemId ? { ...i, Size: existingSize.value } : i));
            alert(`Size "${trimmedValue}" linked!`);
            return;
          }
        }
      }
    } else if (type === "width" && itemId !== "header") {
      const item = items.find(i => i.id === itemId);
      if (item && item.Section && item.Size) {
        const sectionObj = allSections.find(s => s.value === item.Section);
        const sizeObj = allSizes.find(s => s.value === item.Size);
        if (sectionObj && sizeObj) {
          const existingRelation = sizeWidthRelations.find(rel =>
            rel.sectionId === sectionObj.id && rel.sizeId === sizeObj.id && allWidths.find(w => w.id === rel.widthId && w.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          if (existingRelation) {
            const existingWidth = allWidths.find(w => w.id === existingRelation.widthId);
            alert(`"${trimmedValue}" already exists for this section and size.`);
            setItems(items.map(i => i.id === itemId ? { ...i, Width: existingWidth.value } : i));
            return;
          }
          const existingWidth = allWidths.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingWidth) {
            await addDoc(collection(db, "sizeWidthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: existingWidth.id });
            setSizeWidthRelations((await getDocs(collection(db, "sizeWidthRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
            setItems(items.map(i => i.id === itemId ? { ...i, Width: existingWidth.value } : i));
            alert(`Width "${trimmedValue}" linked!`);
            return;
          }
        }
      }
    } else if (type === "itemLength" && itemId !== "header") {
      const item = items.find(i => i.id === itemId);
      if (item && item.Section && item.Size) {
        const sectionObj = allSections.find(s => s.value === item.Section);
        const sizeObj = allSizes.find(s => s.value === item.Size);
        const widthObj = item.Width ? allWidths.find(w => w.value === item.Width) : null;
        if (sectionObj && sizeObj) {
          const existingRelation = widthLengthRelations.find(rel =>
            rel.sectionId === sectionObj.id && rel.sizeId === sizeObj.id &&
            (widthObj ? rel.widthId === widthObj.id : rel.widthId === null) &&
            allItemLengths.find(l => l.id === rel.lengthId && l.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          if (existingRelation) {
            const existingLength = allItemLengths.find(l => l.id === existingRelation.lengthId);
            alert(`"${trimmedValue}" already exists for this combination.`);
            setItems(items.map(i => i.id === itemId ? { ...i, "Item Length": existingLength.value } : i));
            return;
          }
          const existingLength = allItemLengths.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingLength) {
            await addDoc(collection(db, "widthLengthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: widthObj ? widthObj.id : null, lengthId: existingLength.id });
            setWidthLengthRelations((await getDocs(collection(db, "widthLengthRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
            setItems(items.map(i => i.id === itemId ? { ...i, "Item Length": existingLength.value } : i));
            alert(`Length "${trimmedValue}" linked!`);
            return;
          }
        }
      }
    } else if (type === "section") {
      const existingItem = currentOptions.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
      if (existingItem) {
        alert(`"${trimmedValue}" already exists.`);
        setItems(items.map(item => item.id === itemId ? { ...item, Section: existingItem.value } : item));
        return;
      }
    }

    try {
      const docRef = await addDoc(collection(db, collectionName), { value: trimmedValue });
      const newOption = { id: docRef.id, value: trimmedValue, isManual: true };
      const updatedOptions = [...currentOptions, newOption].sort((a, b) => a.value.localeCompare(b.value));
      setOptions(updatedOptions);

      if (type === "place" && itemId === "header") {
        const supplierObj = allSuppliers.find(s => s.value === headerData["Name of the Supplier"]);
        if (supplierObj) {
          await addDoc(collection(db, "supplierPlaceRelations"), { supplierId: supplierObj.id, placeId: docRef.id });
          setSupplierPlaceRelations((await getDocs(collection(db, "supplierPlaceRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
        }
      } else if (type === "size" && itemId !== "header") {
        const item = items.find(i => i.id === itemId);
        if (item?.Section) {
          const sectionObj = allSections.find(s => s.value === item.Section);
          if (sectionObj) {
            await addDoc(collection(db, "sectionSizeRelations"), { sectionId: sectionObj.id, sizeId: docRef.id });
            setSectionSizeRelations((await getDocs(collection(db, "sectionSizeRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
          }
        }
      } else if (type === "width" && itemId !== "header") {
        const item = items.find(i => i.id === itemId);
        if (item?.Section && item?.Size) {
          const sectionObj = allSections.find(s => s.value === item.Section);
          const sizeObj = allSizes.find(s => s.value === item.Size);
          if (sectionObj && sizeObj) {
            await addDoc(collection(db, "sizeWidthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: docRef.id });
            setSizeWidthRelations((await getDocs(collection(db, "sizeWidthRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
          }
        }
      } else if (type === "itemLength" && itemId !== "header") {
        const item = items.find(i => i.id === itemId);
        if (item?.Section && item?.Size) {
          const sectionObj = allSections.find(s => s.value === item.Section);
          const sizeObj = allSizes.find(s => s.value === item.Size);
          const widthObj = item.Width ? allWidths.find(w => w.value === item.Width) : null;
          if (sectionObj && sizeObj) {
            await addDoc(collection(db, "widthLengthRelations"), { sectionId: sectionObj.id, sizeId: sizeObj.id, widthId: widthObj ? widthObj.id : null, lengthId: docRef.id });
            setWidthLengthRelations((await getDocs(collection(db, "widthLengthRelations"))).docs.map(d => ({ id: d.id, ...d.data() })));
          }
        }
      }
      alert(`${type.charAt(0).toUpperCase() + type.slice(1)} "${trimmedValue}" added successfully!`);
    } catch (error) {
      console.error(`Error adding ${type}:`, error);
      alert(`Error adding ${type}. Please try again.`);
    }
  };

  const handleDeleteValue = async (type, optionToDelete) => {
    if (!optionToDelete.isManual) { alert("Only manually created values can be deleted!"); return; }
    if (!window.confirm(`Are you sure you want to delete "${optionToDelete.value}"?`)) return;

    let collectionName = "", fieldName = "";
    if (type === "section") { collectionName = "sections"; fieldName = "Section"; }
    else if (type === "size") { collectionName = "sizes"; fieldName = "Size"; }
    else if (type === "width") { collectionName = "widths"; fieldName = "Width"; }
    else if (type === "itemLength") { collectionName = "itemLengths"; fieldName = "Item Length"; }
    else if (type === "supplier") { collectionName = "suppliers"; fieldName = "Name of the Supplier"; }
    else if (type === "place") { collectionName = "places"; fieldName = "Supplier Place"; }

    try {
      await deleteDoc(doc(db, collectionName, optionToDelete.id));
      if (type === "supplier" || type === "place") {
        if (headerData[fieldName] === optionToDelete.value) {
          setHeaderData(prev => ({ ...prev, [fieldName]: "" }));
          if (type === "supplier") {
            setSupplierInputText("");
          }
        }
      } else {
        setItems(prevItems => prevItems.map(item => {
          if (item[fieldName] === optionToDelete.value) return { ...item, [fieldName]: "" };
          return item;
        }));
      }
      await fetchMasterData();
      alert(`${type.charAt(0).toUpperCase() + type.slice(1)} "${optionToDelete.value}" deleted!`);
    } catch (error) {
      console.error(`❌ Error deleting ${type}:`, error);
      alert(`Error deleting ${type}. Please try again.`);
    }
  };

  const parseNum = (v) => parseFloat(v?.toString().replace(/,/g, "")) || 0;
  const formatNum = (n) => n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const formatDateForDisplay = (d) => {
    if (!d) return "";
    const [y, m, day] = d.split("-");
    return `${day}-${m}-${y}`;
  };

  const formatDateForInput = (d) => {
    if (!d || d.match(/^\d{4}-\d{2}-\d{2}$/)) return d;
    const [day, m, y] = d.split("-");
    return `${y}-${m}-${day}`;
  };

  const getTotalMT = () => items.reduce((sum, item) => sum + parseNum(item["Quantity in Metric Tons"]), 0);

  const calculateSectionCharges = (itemId) => {
    const totalMT = getTotalMT();
    if (totalMT === 0) return { loading: 0, freightLess: 0, freightGreater: 0 };
    const item = items.find(i => i.id === itemId);
    if (!item) return { loading: 0, freightLess: 0, freightGreater: 0 };
    const itemMT = parseNum(item["Quantity in Metric Tons"]);
    return {
      loading: (parseNum(charges["Loading Charges"]) / totalMT) * itemMT,
      freightLess: (parseNum(charges["Freight<"]) / totalMT) * itemMT,
      freightGreater: (parseNum(charges["Freight>"]) / totalMT) * itemMT
    };
  };

  const calcBill = () => {
    const basicTotal = items.reduce((sum, item) => sum + parseNum(item["Bill Basic Amount"]), 0);
    const baseAmount = basicTotal + parseNum(charges["Loading Charges"]) + parseNum(charges["Freight<"]) + parseNum(charges.Others);
    const gst = gstType === "AP"
      ? baseAmount * (parseNum(cgstPercentage) + parseNum(sgstPercentage)) / 100
      : baseAmount * (parseNum(igstPercentage) / 100);
    const total = baseAmount + gst;
    const gTotal = total + parseNum(charges["Freight>"]);
    const net = gTotal - gst;
    return { basicTotal, gst, total, gTotal, net };
  };

  const billTotals = calcBill();

  const handleItemChange = (id, key, value) => {
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [key]: value };
        if (key === "Section") { updated.Size = ""; updated.Width = ""; updated["Item Length"] = ""; }
        if (key === "Size") { if (!item.Width) updated["Item Length"] = ""; }
        if (key === "Width") { updated["Item Length"] = ""; }
        if (key === "Quantity in Metric Tons" || key === "Item Per Rate") {
          if (!manualEdits[`${id}-billAmount`]) {
            updated["Bill Basic Amount"] = parseNum(updated["Quantity in Metric Tons"]) * parseNum(updated["Item Per Rate"]);
          }
        }
        if (key === "Quantity in Metric Tons") {
          const { loading, freightLess, freightGreater } = calculateSectionCharges(id);
          if (!manualEdits[`${id}-sectionLoading`]) updated["Section Loading Charges"] = loading;
          if (!manualEdits[`${id}-sectionFreightLess`]) updated["Section Freight<"] = freightLess;
          if (!manualEdits[`${id}-sectionFreightGreater`]) updated["Section Freight>"] = freightGreater;
        }
        updated["Section Subtotal"] = parseNum(updated["Bill Basic Amount"]) + parseNum(updated["Section Loading Charges"]) + parseNum(updated["Section Freight<"]) + parseNum(updated["Section Freight>"]);
        return updated;
      }
      return item;
    }));
  };

  const handleManualEdit = (id, field, value) => {
    setManualEdits(prev => ({ ...prev, [`${id}-${field}`]: true }));
    setItems(items.map(item => {
      if (item.id === id) {
        const updated = { ...item, [field]: value };
        updated["Section Subtotal"] = parseNum(updated["Bill Basic Amount"]) + parseNum(updated["Section Loading Charges"]) + parseNum(updated["Section Freight<"]) + parseNum(updated["Section Freight>"]);
        return updated;
      }
      return item;
    }));
  };

  const handleHeaderChange = (key, value) => {
    if (["Received On", "Bill Date"].includes(key)) {
      setHeaderData(prev => ({ ...prev, [key]: formatDateForDisplay(value) }));
      return;
    }
    setHeaderData(prev => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    if (!financialYear) return alert("Please select Financial Year");
    if (!unit || !workType) return alert("Please select Unit and Work Type");
    setLoading(true);
    try {
      const docData = {
        ...headerData, No: entryNo, FinancialYear: financialYear, Unit: unit, "Work Type": workType,
        items: items.map(i => ({
          ...i,
          "Bill Basic Amount": parseNum(i["Bill Basic Amount"]),
          "Section Loading Charges": parseNum(i["Section Loading Charges"]),
          "Section Freight<": parseNum(i["Section Freight<"]),
          "Section Freight>": parseNum(i["Section Freight>"]),
          "Section Subtotal": parseNum(i["Section Subtotal"])
        })),
        charges,
        gst: { type: gstType, cgstP: cgstPercentage, sgstP: sgstPercentage, igstP: igstPercentage, totalGst: billTotals.gst },
        finalTotals: billTotals,
        createdAt: new Date()
      };
      await addDoc(collection(db, "entries"), docData);
      alert("Bill Saved Successfully!");
      window.location.reload();
    } catch (e) { console.error(e); alert("Save Error"); }
    finally { setLoading(false); }
  };

  const toggleCustomInput = (itemId, type) => {
    const key = `${itemId}-${type}`;
    setCustomInputs(prev => ({ ...prev, [key]: { show: !prev[key]?.show, value: prev[key]?.value || "" } }));
  };

  const setCustomInputValue = (itemId, type, value) => {
    const key = `${itemId}-${type}`;
    setCustomInputs(prev => ({ ...prev, [key]: { ...prev[key], value } }));
  };

  const getCustomInputState = (itemId, type) => {
    const key = `${itemId}-${type}`;
    return customInputs[key] || { show: false, value: "" };
  };

  const renderDropdownWithCustom = (label, value, onChange, options, itemId, type, showCount = true) => {
    const customState = getCustomInputState(itemId, type);
    return (
      <div className="entry-input">
        <label>{label} {showCount && `(${options.length} options)`}</label>
        <div className="dropdown-container">
          <div className="dropdown-row">
            <select className="dropdown-select" value={value} onChange={onChange}>
              <option value="">Select {label}</option>
              {options.map(opt => <option key={opt.value} value={opt.value}>{opt.value}</option>)}
            </select>
            <button className="btn-toggle-custom" onClick={() => toggleCustomInput(itemId, type)} type="button">
              {customState.show ? "✕" : "+"}
            </button>
          </div>
          {customState.show && (
            <div className="custom-input-section">
              <div className="custom-input-row">
                <input
                  type="text"
                  className="custom-input-field"
                  value={customState.value}
                  onChange={e => setCustomInputValue(itemId, type, e.target.value)}
                  placeholder={`Enter new ${label.toLowerCase()}`}
                  onKeyPress={e => { if (e.key === 'Enter') handleAddCustomValue(itemId, type, customState.value); }}
                />
                <button className="btn-add-custom" onClick={() => handleAddCustomValue(itemId, type, customState.value)} type="button">Add</button>
              </div>
              <div className="manual-values-list">
                <div className="custom-values-header">Manually Created Values</div>
                {options.filter(opt => opt.isManual).length === 0 ? (
                  <div className="no-manual-values">No manually created values yet</div>
                ) : (
                  options.filter(opt => opt.isManual).map(opt => (
                    <div key={opt.id} className="manual-value-item">
                      <span className="manual-value-text">{opt.value}</span>
                      <button className="btn-delete-value" onClick={() => handleDeleteValue(type, opt)} type="button">Delete</button>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    );
  };

  useEffect(() => {
    const totalMT = getTotalMT();
    if (totalMT === 0) return;
    setItems(prevItems => prevItems.map(item => {
      const { loading, freightLess, freightGreater } = calculateSectionCharges(item.id);
      const updated = { ...item };
      if (!manualEdits[`${item.id}-sectionLoading`]) updated["Section Loading Charges"] = loading;
      if (!manualEdits[`${item.id}-sectionFreightLess`]) updated["Section Freight<"] = freightLess;
      if (!manualEdits[`${item.id}-sectionFreightGreater`]) updated["Section Freight>"] = freightGreater;
      updated["Section Subtotal"] = parseNum(updated["Bill Basic Amount"]) + parseNum(updated["Section Loading Charges"]) + parseNum(updated["Section Freight<"]) + parseNum(updated["Section Freight>"]);
      return updated;
    }));
  }, [charges["Loading Charges"], charges["Freight<"], charges["Freight>"]]);

  useEffect(() => {
    const totalMT = getTotalMT();
    if (totalMT === 0) return;
    const totalLoading = parseNum(charges["Loading Charges"]);
    const totalFreightLess = parseNum(charges["Freight<"]);
    const totalFreightGreater = parseNum(charges["Freight>"]);
    if (totalLoading === 0 && totalFreightLess === 0 && totalFreightGreater === 0) return;
    setItems(prevItems => prevItems.map(item => {
      const itemMT = parseNum(item["Quantity in Metric Tons"]);
      const updated = { ...item };
      if (!manualEdits[`${item.id}-sectionLoading`]) updated["Section Loading Charges"] = (totalLoading / totalMT) * itemMT;
      if (!manualEdits[`${item.id}-sectionFreightLess`]) updated["Section Freight<"] = (totalFreightLess / totalMT) * itemMT;
      if (!manualEdits[`${item.id}-sectionFreightGreater`]) updated["Section Freight>"] = (totalFreightGreater / totalMT) * itemMT;
      updated["Section Subtotal"] = parseNum(updated["Bill Basic Amount"]) + parseNum(updated["Section Loading Charges"]) + parseNum(updated["Section Freight<"]) + parseNum(updated["Section Freight>"]);
      return updated;
    }));
  }, [items.map(i => parseNum(i["Quantity in Metric Tons"])).join(','), charges["Loading Charges"], charges["Freight<"], charges["Freight>"]]);

  return (
    <div className="entry-container">
      <h1 className="entry-heading">Entry Page</h1>

      <div className="entry-top-inputs">
        <div className="unit-dropdown-wrapper">
          <label className="unit-dropdown-label">Financial Year</label>
          <select className="unit-dropdown" value={financialYear} onChange={e => setFinancialYear(e.target.value)}>
            <option value="2024-25">2024-25</option>
            <option value="2025-26">2025-26</option>
            <option value="2026-27">2026-27</option>
            <option value="2027-28">2027-28</option>
          </select>
        </div>
        <div className="unit-dropdown-wrapper">
          <label className="unit-dropdown-label">Unit</label>
          <select className="unit-dropdown" value={unit} onChange={e => setUnit(e.target.value)}>
            <option value="">Select Unit</option>
            <option value="SIEC">SIEC</option>
            <option value="ST">ST</option>
          </select>
        </div>
        <div className="unit-dropdown-wrapper">
          <label className="unit-dropdown-label">Work Type</label>
          <select className="unit-dropdown" value={workType} onChange={e => setWorkType(e.target.value)}>
            <option value="">Select Work Type</option>
            <option value="CT">CT</option>
            <option value="STRL">STRL</option>
          </select>
        </div>
      </div>

      <div className="form-wrapper">
        <div className="entry-grid">

          <div className="entry-input">
            <label>PO</label>
            <input type="text" value={headerData.PO} onChange={e => handleHeaderChange("PO", e.target.value)} />
          </div>

          <div className="entry-input">
            <label>Received On</label>
            <input
              type="date"
              value={formatDateForInput(headerData["Received On"])}
              min="1000-01-01"
              max="9999-12-31"
              onChange={e => handleHeaderChange("Received On", e.target.value)}
            />
          </div>

          <div className="entry-input">
            <label>Bill Number</label>
            <input type="text" value={headerData["Bill Number"]} onChange={e => handleHeaderChange("Bill Number", e.target.value)} />
          </div>

          <div className="entry-input">
            <label>Bill Date</label>
            <input
              type="date"
              value={formatDateForInput(headerData["Bill Date"])}
              min="1000-01-01"
              max="9999-12-31"
              onChange={e => handleHeaderChange("Bill Date", e.target.value)}
            />
          </div>

          {/* ── Supplier Name: renderDropdownWithCustom + combobox search ── */}
          <div className="entry-input">
            <label>Name of the Supplier ({allSuppliers.length} options)</label>
            <div className="dropdown-container" ref={supplierWrapperRef}>

              {(() => {
                const customState = getCustomInputState("header", "supplier");
                return (
                  <>
                    <div className="dropdown-row">
                      <select
                        className="dropdown-select"
                        value={headerData["Name of the Supplier"]}
                        onChange={e => handleSupplierDropdownChange(e.target.value)}
                      >
                        <option value="">Select Name of the Supplier</option>
                        {allSuppliers.map(opt => (
                          <option key={opt.value} value={opt.value}>{opt.value}</option>
                        ))}
                      </select>
                      <button
                        className="btn-toggle-custom"
                        onClick={() => toggleCustomInput("header", "supplier")}
                        type="button"
                      >
                        {customState.show ? "✕" : "+"}
                      </button>
                    </div>
                    {customState.show && (
                      <div className="custom-input-section">
                        <div className="custom-input-row">
                          <input
                            type="text"
                            className="custom-input-field"
                            value={customState.value}
                            onChange={e => setCustomInputValue("header", "supplier", e.target.value)}
                            placeholder="Enter new name of the supplier"
                            onKeyPress={e => { if (e.key === 'Enter') handleAddCustomValue("header", "supplier", customState.value); }}
                          />
                          <button
                            className="btn-add-custom"
                            onClick={() => handleAddCustomValue("header", "supplier", customState.value)}
                            type="button"
                          >
                            Add
                          </button>
                        </div>
                        <div className="manual-values-list">
                          <div className="custom-values-header">Manually Created Values</div>
                          {allSuppliers.filter(opt => opt.isManual).length === 0 ? (
                            <div className="no-manual-values">No manually created values yet</div>
                          ) : (
                            allSuppliers.filter(opt => opt.isManual).map(opt => (
                              <div key={opt.id} className="manual-value-item">
                                <span className="manual-value-text">{opt.value}</span>
                                <button
                                  className="btn-delete-value"
                                  onClick={() => handleDeleteValue("supplier", opt)}
                                  type="button"
                                >
                                  Delete
                                </button>
                              </div>
                            ))
                          )}
                        </div>
                      </div>
                    )}
                  </>
                );
              })()}

              {/* Bottom: text search combobox */}
              <div className="supplier-combobox-wrapper" style={{ marginTop: "6px" }}>
                <div className="supplier-search-row">
                  <input
                    type="text"
                    className="supplier-search-input"
                    value={supplierInputText}
                    onChange={e => handleSupplierInputChange(e.target.value)}
                    onFocus={() => {
                      if (supplierInputText.trim()) {
                        const filtered = allSuppliers.filter(s =>
                          s.value.toLowerCase().includes(supplierInputText.toLowerCase())
                        );
                        setSupplierSuggestions(filtered);
                        setShowSupplierSuggestions(true);
                      }
                    }}
                    onKeyDown={e => {
                      if (!showSupplierSuggestions || supplierSuggestions.length === 0) return;
                      if (e.key === "ArrowDown") {
                        e.preventDefault();
                        setHighlightedIndex(i => Math.min(i + 1, supplierSuggestions.length - 1));
                      } else if (e.key === "ArrowUp") {
                        e.preventDefault();
                        setHighlightedIndex(i => Math.max(i - 1, 0));
                      } else if (e.key === "Tab" || e.key === "Enter") {
                        const idx = highlightedIndex >= 0 ? highlightedIndex : 0;
                        const selected = supplierSuggestions[idx];
                        if (selected) {
                          e.preventDefault();
                          handleSupplierSuggestionClick(selected.value);
                          setHighlightedIndex(-1);
                        }
                      } else if (e.key === "Escape") {
                        setShowSupplierSuggestions(false);
                        setHighlightedIndex(-1);
                      }
                    }}
                    placeholder="Or type to search supplier..."
                    autoComplete="off"
                  />
                  {supplierInputText && (
                    <button className="supplier-clear-btn" type="button" onClick={clearSupplier} title="Clear">✕</button>
                  )}
                </div>

                {showSupplierSuggestions && (
                  <ul className="supplier-suggestions-list">
                    {supplierSuggestions.length > 0 ? (
                      supplierSuggestions.map((s, idx) => (
                        <li
                          key={s.id}
                          className={`supplier-suggestion-item${
                            headerData["Name of the Supplier"] === s.value ? " active" : ""
                          }${
                            idx === highlightedIndex ? " highlighted" : ""
                          }`}
                          onMouseDown={() => handleSupplierSuggestionClick(s.value)}
                          onMouseEnter={() => setHighlightedIndex(idx)}
                        >
                          {s.value}
                        </li>
                      ))
                    ) : (
                      <li className="supplier-suggestion-no-match">No suppliers found</li>
                    )}
                  </ul>
                )}
              </div>

            </div>
          </div>

          {/* Supplier Place — passes getAvailablePlaces which now returns all places for new suppliers */}
          {renderDropdownWithCustom(
            "Supplier Place",
            headerData["Supplier Place"],
            e => handleHeaderChange("Supplier Place", e.target.value),
            getAvailablePlaces(headerData["Name of the Supplier"]),
            "header",
            "place"
          )}

        </div>

        <hr />
        <h3>Sections / Items</h3>
        {items.map((item, index) => {
          const availSizes = getAvailableSizes(item.Section);
          return (
            <div key={item.id} className="section-card">
              {items.length > 1 && (
                <button className="remove-row-btn" onClick={() => setItems(items.filter(i => i.id !== item.id))} type="button">
                  <HiTrash /> Remove
                </button>
              )}
              <h4>Section Row #{index + 1}</h4>
              <div className="section-grid">
                {renderDropdownWithCustom("Section", item.Section, e => handleItemChange(item.id, "Section", e.target.value), allSections, item.id, "section")}
                {renderDropdownWithCustom("Size", item.Size, e => handleItemChange(item.id, "Size", e.target.value), availSizes, item.id, "size")}
                {renderDropdownWithCustom("Width", item.Width, e => handleItemChange(item.id, "Width", e.target.value), allWidths, item.id, "width")}
                {renderDropdownWithCustom("Item Length", item["Item Length"], e => handleItemChange(item.id, "Item Length", e.target.value), allItemLengths, item.id, "itemLength")}
                <div className="entry-input">
                  <label>Number of Items Supplied</label>
                  <input type="number" value={item["Number of items Supplied"]} onChange={e => handleItemChange(item.id, "Number of items Supplied", e.target.value)} />
                </div>
                <div className="entry-input">
                  <label>Qty (MT)</label>
                  <input type="number" step="0.01" value={item["Quantity in Metric Tons"]} onChange={e => handleItemChange(item.id, "Quantity in Metric Tons", e.target.value)} />
                </div>
                <div className="entry-input">
                  <label>Rate</label>
                  <input type="number" step="0.01" value={item["Item Per Rate"]} onChange={e => handleItemChange(item.id, "Item Per Rate", e.target.value)} />
                </div>
                <div className="entry-input">
                  <label>Basic Amt</label>
                  <input type="number" step="0.01" value={item["Bill Basic Amount"]} onChange={e => handleManualEdit(item.id, "Bill Basic Amount", e.target.value)} />
                </div>
                <div className="entry-input">
                  <label>Section Loading</label>
                  <input type="number" step="0.001" value={parseFloat(item["Section Loading Charges"]).toFixed(3)} onChange={e => handleManualEdit(item.id, "Section Loading Charges", parseFloat(e.target.value))} />
                </div>
                <div className="entry-input">
                  <label>Section Freight&lt;</label>
                  <input type="number" step="0.001" value={parseFloat(item["Section Freight<"]).toFixed(3)} onChange={e => handleManualEdit(item.id, "Section Freight<", parseFloat(e.target.value))} />
                </div>
                <div className="entry-input">
                  <label>Section Freight&gt;</label>
                  <input type="number" step="0.001" value={parseFloat(item["Section Freight>"]).toFixed(3)} onChange={e => handleManualEdit(item.id, "Section Freight>", parseFloat(e.target.value))} />
                </div>
                <div className="entry-input">
                  <label>Section Subtotal</label>
                  <input type="text" readOnly value={formatNum(parseNum(item["Section Subtotal"]))} className="readonly-field" />
                </div>
              </div>
            </div>
          );
        })}

        <button className="add-section-btn" onClick={() => setItems([...items, {
          id: Date.now(), Section: "", Size: "", Width: "", "Item Length": "", "Number of items Supplied": "",
          "Quantity in Metric Tons": "", "Item Per Rate": "", "Bill Basic Amount": 0,
          "Section Loading Charges": 0, "Section Freight<": 0, "Section Freight>": 0, "Section Subtotal": 0
        }])} type="button">
          <HiPlus /> Add Another Section
        </button>

        <h3>Charges</h3>
        <div className="entry-grid">
          {Object.keys(charges).map(key => (
            <div className="entry-input" key={key}>
              <label>{key}</label>
              <input type="number" step="0.01" value={charges[key]} onChange={e => setCharges({ ...charges, [key]: e.target.value })} />
            </div>
          ))}
        </div>

        <div className="summary-box">
          <div className="summary-content">
            <div className="gst-section">
              <h4>GST Details</h4>
              <div className="gst-radio-group">
                <label><input type="radio" checked={gstType === "AP"} onChange={() => setGstType("AP")} /> AP</label>
                <label><input type="radio" checked={gstType === "OTHER"} onChange={() => setGstType("OTHER")} /> Other</label>
              </div>
              <div className="gst-inputs">
                {gstType === "AP" ? (
                  <>
                    <input type="number" step="0.01" className="gst-input" value={cgstPercentage} onChange={e => setCgstPercentage(e.target.value)} /> % CGST
                    <input type="number" step="0.01" className="gst-input" value={sgstPercentage} onChange={e => setSgstPercentage(e.target.value)} /> % SGST
                  </>
                ) : (
                  <><input type="number" step="0.01" className="gst-input" value={igstPercentage} onChange={e => setIgstPercentage(e.target.value)} /> % IGST</>
                )}
              </div>
            </div>
            <div className="totals-section">
              <p>Basic Total: ₹ {formatNum(billTotals.basicTotal)}</p>
              <p>Total GST: ₹ {formatNum(billTotals.gst)}</p>
              <h2 className="grand-total">Total: ₹ {formatNum(billTotals.gTotal)}</h2>
              <p>Net Amount: ₹ {formatNum(billTotals.net)}</p>
            </div>
          </div>
        </div>

        <button className="entry-submit" onClick={handleSubmit} disabled={loading}>
          {loading ? "Processing..." : `Submit Entry #${entryNo}`}
        </button>
      </div>
    </div>
  );
}