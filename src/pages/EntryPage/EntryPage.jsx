import { useState, useEffect } from "react";
import { HiPlus, HiTrash } from "react-icons/hi2";
import { db } from "../../firebase";
import { collection, addDoc, getDocs, query, orderBy, limit, deleteDoc, doc } from "firebase/firestore";
import "./EntryPage.css";

export default function EntryPage() {
  const [loading, setLoading] = useState(false);
  const [entryNo, setEntryNo] = useState(1);

  const [unit, setUnit] = useState("");
  const [workType, setWorkType] = useState("");
  const [headerData, setHeaderData] = useState({
    PO: "",
    "Received On": "",
    "Bill Number": "",
    "Bill Date": "",
    "Name of the Supplier": "",
    "Supplier Place": "",
  });

  const [items, setItems] = useState([
    {
      id: Date.now(),
      Section: "",
      Size: "",
      Width: "",
      "Item Length": "",
      "Number of items Supplied": "",
      "Quantity in Metric Tons": "",
      "Item Per Rate": "",
      "Bill Basic Amount": 0,
      "Section Loading Charges": 0,
      "Section Freight<": 0,
      "Section Subtotal": 0,
    }
  ]);

  const [charges, setCharges] = useState({
    "Loading Charges": "",
    "Freight<": "",
    Others: "",
    "Freight>": "",
  });

  const [gstType, setGstType] = useState("AP");
  const [cgstPercentage, setCgstPercentage] = useState("9");
  const [sgstPercentage, setSgstPercentage] = useState("9");
  const [igstPercentage, setIgstPercentage] = useState("18");

  // Master data
  const [allSections, setAllSections] = useState([]);
  const [allSizes, setAllSizes] = useState([]);
  const [allWidths, setAllWidths] = useState([]);
  const [allItemLengths, setAllItemLengths] = useState([]);
  const [allSuppliers, setAllSuppliers] = useState([]);
  const [allPlaces, setAllPlaces] = useState([]);

  // Relationship data
  const [sectionSizeRelations, setSectionSizeRelations] = useState([]);
  const [sizeWidthRelations, setSizeWidthRelations] = useState([]);
  const [widthLengthRelations, setWidthLengthRelations] = useState([]);
  const [supplierPlaceRelations, setSupplierPlaceRelations] = useState([]);

  const [customInputs, setCustomInputs] = useState({});
  const [manualEdits, setManualEdits] = useState({});

  // Clean up orphaned relationships
  const cleanupOrphanedRelations = async (sections, sizes, widths, lengths, suppliers, places, sectionSizeRels, sizeWidthRels, widthLengthRels, supplierPlaceRels) => {
    try {
      console.log("🧹 Checking for orphaned relationships...");
      
      const sectionIds = new Set(sections.map(s => s.id));
      const sizeIds = new Set(sizes.map(s => s.id));
      const widthIds = new Set(widths.map(w => w.id));
      const lengthIds = new Set(lengths.map(l => l.id));
      const supplierIds = new Set(suppliers.map(s => s.id));
      const placeIds = new Set(places.map(p => p.id));

      let orphanedCount = 0;

      // Clean sectionSizeRelations
      for (const rel of sectionSizeRels) {
        if (!sectionIds.has(rel.sectionId) || !sizeIds.has(rel.sizeId)) {
          console.warn(`🗑️ Deleting orphaned sectionSizeRelation: sectionId=${rel.sectionId}, sizeId=${rel.sizeId}`);
          await deleteDoc(doc(db, "sectionSizeRelations", rel.id));
          orphanedCount++;
        }
      }

      // Clean sizeWidthRelations
      for (const rel of sizeWidthRels) {
        if (!sectionIds.has(rel.sectionId) || !sizeIds.has(rel.sizeId) || !widthIds.has(rel.widthId)) {
          console.warn(`🗑️ Deleting orphaned sizeWidthRelation: sectionId=${rel.sectionId}, sizeId=${rel.sizeId}, widthId=${rel.widthId}`);
          await deleteDoc(doc(db, "sizeWidthRelations", rel.id));
          orphanedCount++;
        }
      }

      // Clean widthLengthRelations
      for (const rel of widthLengthRels) {
        if (!sectionIds.has(rel.sectionId) || !sizeIds.has(rel.sizeId) || !widthIds.has(rel.widthId) || !lengthIds.has(rel.lengthId)) {
          console.warn(`🗑️ Deleting orphaned widthLengthRelation: sectionId=${rel.sectionId}, sizeId=${rel.sizeId}, widthId=${rel.widthId}, lengthId=${rel.lengthId}`);
          await deleteDoc(doc(db, "widthLengthRelations", rel.id));
          orphanedCount++;
        }
      }

      // Clean supplierPlaceRelations
      for (const rel of supplierPlaceRels) {
        if (!supplierIds.has(rel.supplierId) || !placeIds.has(rel.placeId)) {
          console.warn(`🗑️ Deleting orphaned supplierPlaceRelation: supplierId=${rel.supplierId}, placeId=${rel.placeId}`);
          await deleteDoc(doc(db, "supplierPlaceRelations", rel.id));
          orphanedCount++;
        }
      }

      if (orphanedCount > 0) {
        console.log(`✅ Cleaned up ${orphanedCount} orphaned relationship(s)`);
      } else {
        console.log("✅ No orphaned relationships found");
      }

    } catch (error) {
      console.error("❌ Error cleaning up orphaned relationships:", error);
    }
  };

  const fetchMasterData = async () => {
    try {
      console.log("🔄 Starting to fetch dropdown options from Firebase...");
      
      // Fetch master collections
      const sectionsSnap = await getDocs(collection(db, "sections"));
      const sizesSnap = await getDocs(collection(db, "sizes"));
      const widthsSnap = await getDocs(collection(db, "widths"));
      const itemLengthsSnap = await getDocs(collection(db, "itemLengths"));
      const suppliersSnap = await getDocs(collection(db, "suppliers"));
      const placesSnap = await getDocs(collection(db, "places"));
      
      const sections = sectionsSnap.docs.map(doc => ({
        id: doc.id,
        value: doc.data().value?.trim() || "",
        isManual: true
      })).filter(item => item.value).sort((a, b) => a.value.localeCompare(b.value));

      const sizes = sizesSnap.docs.map(doc => ({
        id: doc.id,
        value: doc.data().value?.trim() || "",
        isManual: true
      })).filter(item => item.value).sort((a, b) => a.value.localeCompare(b.value));

      const widths = widthsSnap.docs.map(doc => ({
        id: doc.id,
        value: doc.data().value?.trim() || "",
        isManual: true
      })).filter(item => item.value).sort((a, b) => a.value.localeCompare(b.value));

      const itemLengths = itemLengthsSnap.docs.map(doc => ({
        id: doc.id,
        value: doc.data().value?.trim() || "",
        isManual: true
      })).filter(item => item.value).sort((a, b) => a.value.localeCompare(b.value));

      const suppliers = suppliersSnap.docs.map(doc => ({
        id: doc.id,
        value: doc.data().value?.trim() || "",
        isManual: true
      })).filter(item => item.value).sort((a, b) => a.value.localeCompare(b.value));

      const places = placesSnap.docs.map(doc => ({
        id: doc.id,
        value: doc.data().value?.trim() || "",
        isManual: true
      })).filter(item => item.value).sort((a, b) => a.value.localeCompare(b.value));

      // Fetch relationship collections
      const sectionSizeSnap = await getDocs(collection(db, "sectionSizeRelations"));
      const sizeWidthSnap = await getDocs(collection(db, "sizeWidthRelations"));
      const widthLengthSnap = await getDocs(collection(db, "widthLengthRelations"));
      const supplierPlaceSnap = await getDocs(collection(db, "supplierPlaceRelations"));

      const sectionSizeRels = sectionSizeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const sizeWidthRels = sizeWidthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const widthLengthRels = widthLengthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      const supplierPlaceRels = supplierPlaceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

      // Clean up orphaned relationships
      await cleanupOrphanedRelations(
        sections, sizes, widths, itemLengths, suppliers, places,
        sectionSizeRels, sizeWidthRels, widthLengthRels, supplierPlaceRels
      );

      // Refetch relationships after cleanup
      const cleanedSectionSizeSnap = await getDocs(collection(db, "sectionSizeRelations"));
      const cleanedSizeWidthSnap = await getDocs(collection(db, "sizeWidthRelations"));
      const cleanedWidthLengthSnap = await getDocs(collection(db, "widthLengthRelations"));
      const cleanedSupplierPlaceSnap = await getDocs(collection(db, "supplierPlaceRelations"));

      setAllSections(sections);
      setAllSizes(sizes);
      setAllWidths(widths);
      setAllItemLengths(itemLengths);
      setAllSuppliers(suppliers);
      setAllPlaces(places);

      setSectionSizeRelations(cleanedSectionSizeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setSizeWidthRelations(cleanedSizeWidthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setWidthLengthRelations(cleanedWidthLengthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setSupplierPlaceRelations(cleanedSupplierPlaceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      
      console.log("✅ Dropdown options and relationships fetched successfully!");
      console.log("🔍 SECTIONS:", sections);
      console.log("🔍 SIZES:", sizes);
      console.log("🔍 SECTION-SIZE RELATIONS:", cleanedSectionSizeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      
    } catch (error) {
      console.error("❌ Error fetching dropdown options:", error);
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
      } catch (e) {
        console.error("Error fetching entry number:", e);
      }
    };
    fetchLastNo();
  }, []);

  // Get available options based on cascading relationships
  const getAvailableSizes = (selectedSection) => {
    if (!selectedSection) return [];
    
    console.log("🔍 Getting sizes for section:", selectedSection);
    console.log("🔍 All sections:", allSections);
    console.log("🔍 All sizes:", allSizes);
    console.log("🔍 Section-Size relations:", sectionSizeRelations);
    
    const sectionObj = allSections.find(s => s.value === selectedSection);
    console.log("🔍 Found section object:", sectionObj);
    
    if (!sectionObj) {
      console.warn("⚠️ Section not found!");
      return [];
    }
    
    const relatedSizeIds = sectionSizeRelations
      .filter(rel => rel.sectionId === sectionObj.id)
      .map(rel => rel.sizeId);
    
    console.log("🔍 Related size IDs:", relatedSizeIds);
    
    const availableSizes = allSizes.filter(size => relatedSizeIds.includes(size.id));
    console.log("🔍 Available sizes:", availableSizes);
    
    return availableSizes;
  };
  
  const getAvailableWidths = (selectedSection, selectedSize) => {
    if (!selectedSection || !selectedSize) return [];
    
    console.log("🔍 Getting widths for section:", selectedSection, "size:", selectedSize);
    
    const sectionObj = allSections.find(s => s.value === selectedSection);
    const sizeObj = allSizes.find(s => s.value === selectedSize);
    
    console.log("🔍 Found section:", sectionObj, "size:", sizeObj);
    
    if (!sectionObj || !sizeObj) {
      console.warn("⚠️ Section or Size not found!");
      return [];
    }
    
    const relatedWidthIds = sizeWidthRelations
      .filter(rel => rel.sectionId === sectionObj.id && rel.sizeId === sizeObj.id)
      .map(rel => rel.widthId);
    
    console.log("🔍 Related width IDs:", relatedWidthIds);
    console.log("🔍 Size-Width relations:", sizeWidthRelations);
    
    const availableWidths = allWidths.filter(width => relatedWidthIds.includes(width.id));
    console.log("🔍 Available widths:", availableWidths);
    
    return availableWidths;
  };
  
  const getAvailableLengths = (selectedSection, selectedSize, selectedWidth) => {
    if (!selectedSection || !selectedSize || !selectedWidth) return [];
    
    console.log("🔍 Getting lengths for section:", selectedSection, "size:", selectedSize, "width:", selectedWidth);
    
    const sectionObj = allSections.find(s => s.value === selectedSection);
    const sizeObj = allSizes.find(s => s.value === selectedSize);
    const widthObj = allWidths.find(w => w.value === selectedWidth);
    
    console.log("🔍 Found section:", sectionObj, "size:", sizeObj, "width:", widthObj);
    
    if (!sectionObj || !sizeObj || !widthObj) {
      console.warn("⚠️ Section, Size, or Width not found!");
      return [];
    }
    
    const relatedLengthIds = widthLengthRelations
      .filter(rel => 
        rel.sectionId === sectionObj.id && 
        rel.sizeId === sizeObj.id && 
        rel.widthId === widthObj.id
      )
      .map(rel => rel.lengthId);
    
    console.log("🔍 Related length IDs:", relatedLengthIds);
    console.log("🔍 Width-Length relations:", widthLengthRelations);
    
    const availableLengths = allItemLengths.filter(length => relatedLengthIds.includes(length.id));
    console.log("🔍 Available lengths:", availableLengths);
    
    return availableLengths;
  };
  
  const getAvailablePlaces = (selectedSupplier) => {
    if (!selectedSupplier) return [];
    
    console.log("🔍 Getting places for supplier:", selectedSupplier);
    
    const supplierObj = allSuppliers.find(s => s.value === selectedSupplier);
    console.log("🔍 Found supplier object:", supplierObj);
    
    if (!supplierObj) {
      console.warn("⚠️ Supplier not found!");
      return [];
    }
    
    const relatedPlaceIds = supplierPlaceRelations
      .filter(rel => rel.supplierId === supplierObj.id)
      .map(rel => rel.placeId);
    
    console.log("🔍 Related place IDs:", relatedPlaceIds);
    console.log("🔍 Supplier-Place relations:", supplierPlaceRelations);
    
    const availablePlaces = allPlaces.filter(place => relatedPlaceIds.includes(place.id));
    console.log("🔍 Available places:", availablePlaces);
    
    return availablePlaces;
  };

  const handleAddCustomValue = async (itemId, type, value) => {
    if (!value.trim()) {
      alert("Please enter a value!");
      return;
    }
  
    const trimmedValue = value.trim();
    
    // Clear the input immediately to prevent duplicate submissions
    setCustomInputs(prev => ({ ...prev, [`${itemId}-${type}`]: { show: prev[`${itemId}-${type}`]?.show || false, value: "" } }));
    
    let collectionName = "";
    let currentOptions = [];
    let setOptions = null;

    if (type === "section") {
      collectionName = "sections";
      currentOptions = allSections;
      setOptions = setAllSections;
    } else if (type === "size") {
      collectionName = "sizes";
      currentOptions = allSizes;
      setOptions = setAllSizes;
    } else if (type === "width") {
      collectionName = "widths";
      currentOptions = allWidths;
      setOptions = setAllWidths;
    } else if (type === "itemLength") {
      collectionName = "itemLengths";
      currentOptions = allItemLengths;
      setOptions = setAllItemLengths;
    } else if (type === "supplier") {
      collectionName = "suppliers";
      currentOptions = allSuppliers;
      setOptions = setAllSuppliers;
    } else if (type === "place") {
      collectionName = "places";
      currentOptions = allPlaces;
      setOptions = setAllPlaces;
    }
  
    // For places, check if the same place exists for the CURRENT supplier
    if (type === "place" && itemId === "header") {
      const currentSupplier = headerData["Name of the Supplier"];
      if (currentSupplier) {
        const supplierObj = allSuppliers.find(s => s.value === currentSupplier);
        if (supplierObj) {
          // Check if this supplier already has this place
          const existingRelation = supplierPlaceRelations.find(rel => 
            rel.supplierId === supplierObj.id && 
            allPlaces.find(p => p.id === rel.placeId && p.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          
          if (existingRelation) {
            const existingPlace = allPlaces.find(p => p.id === existingRelation.placeId);
            alert(`"${trimmedValue}" already exists for this supplier. Using the existing entry.`);
            setHeaderData(prev => ({ ...prev, "Supplier Place": existingPlace.value }));
            return;
          }
          
          // Check if place name exists globally - if so, reuse it
          const existingPlace = allPlaces.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingPlace) {
            // Place exists but not for this supplier - create the relationship
            await addDoc(collection(db, "supplierPlaceRelations"), {
              supplierId: supplierObj.id,
              placeId: existingPlace.id
            });
            const supplierPlaceSnap = await getDocs(collection(db, "supplierPlaceRelations"));
            setSupplierPlaceRelations(supplierPlaceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setHeaderData(prev => ({ ...prev, "Supplier Place": existingPlace.value }));
            alert(`Place "${trimmedValue}" linked to this supplier successfully!`);
            return;
          }
        }
      }
    } 
    // For size, check if the same size exists for the CURRENT section
    else if (type === "size" && itemId !== "header") {
      const item = items.find(i => i.id === itemId);
      if (item && item.Section) {
        const sectionObj = allSections.find(s => s.value === item.Section);
        if (sectionObj) {
          // Check if this section already has this size
          const existingRelation = sectionSizeRelations.find(rel => 
            rel.sectionId === sectionObj.id && 
            allSizes.find(s => s.id === rel.sizeId && s.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          
          if (existingRelation) {
            const existingSize = allSizes.find(s => s.id === existingRelation.sizeId);
            alert(`"${trimmedValue}" already exists for this section. Using the existing entry.`);
            setItems(items.map(i => i.id === itemId ? { ...i, Size: existingSize.value } : i));
            return;
          }
          
          // Check if size name exists globally - if so, reuse it
          const existingSize = allSizes.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingSize) {
            // Size exists but not for this section - create the relationship
            await addDoc(collection(db, "sectionSizeRelations"), {
              sectionId: sectionObj.id,
              sizeId: existingSize.id
            });
            const sectionSizeSnap = await getDocs(collection(db, "sectionSizeRelations"));
            setSectionSizeRelations(sectionSizeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setItems(items.map(i => i.id === itemId ? { ...i, Size: existingSize.value } : i));
            alert(`Size "${trimmedValue}" linked to this section successfully!`);
            return;
          }
        }
      }
    }
    // For width, check if the same width exists for the CURRENT section+size
    else if (type === "width" && itemId !== "header") {
      const item = items.find(i => i.id === itemId);
      if (item && item.Section && item.Size) {
        const sectionObj = allSections.find(s => s.value === item.Section);
        const sizeObj = allSizes.find(s => s.value === item.Size);
        if (sectionObj && sizeObj) {
          // Check if this section+size already has this width
          const existingRelation = sizeWidthRelations.find(rel => 
            rel.sectionId === sectionObj.id && 
            rel.sizeId === sizeObj.id &&
            allWidths.find(w => w.id === rel.widthId && w.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          
          if (existingRelation) {
            const existingWidth = allWidths.find(w => w.id === existingRelation.widthId);
            alert(`"${trimmedValue}" already exists for this section and size. Using the existing entry.`);
            setItems(items.map(i => i.id === itemId ? { ...i, Width: existingWidth.value } : i));
            return;
          }
          
          // Check if width name exists globally - if so, reuse it
          const existingWidth = allWidths.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingWidth) {
            // Width exists but not for this section+size - create the relationship
            await addDoc(collection(db, "sizeWidthRelations"), {
              sectionId: sectionObj.id,
              sizeId: sizeObj.id,
              widthId: existingWidth.id
            });
            const sizeWidthSnap = await getDocs(collection(db, "sizeWidthRelations"));
            setSizeWidthRelations(sizeWidthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setItems(items.map(i => i.id === itemId ? { ...i, Width: existingWidth.value } : i));
            alert(`Width "${trimmedValue}" linked to this section and size successfully!`);
            return;
          }
        }
      }
    }
    // For itemLength, check if the same length exists for the CURRENT section+size+width
    else if (type === "itemLength" && itemId !== "header") {
      const item = items.find(i => i.id === itemId);
      if (item && item.Section && item.Size && item.Width) {
        const sectionObj = allSections.find(s => s.value === item.Section);
        const sizeObj = allSizes.find(s => s.value === item.Size);
        const widthObj = allWidths.find(w => w.value === item.Width);
        if (sectionObj && sizeObj && widthObj) {
          // Check if this section+size+width already has this length
          const existingRelation = widthLengthRelations.find(rel => 
            rel.sectionId === sectionObj.id && 
            rel.sizeId === sizeObj.id &&
            rel.widthId === widthObj.id &&
            allItemLengths.find(l => l.id === rel.lengthId && l.value.toLowerCase() === trimmedValue.toLowerCase())
          );
          
          if (existingRelation) {
            const existingLength = allItemLengths.find(l => l.id === existingRelation.lengthId);
            alert(`"${trimmedValue}" already exists for this section, size, and width. Using the existing entry.`);
            setItems(items.map(i => i.id === itemId ? { ...i, "Item Length": existingLength.value } : i));
            return;
          }
          
          // Check if length name exists globally - if so, reuse it
          const existingLength = allItemLengths.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
          if (existingLength) {
            // Length exists but not for this section+size+width - create the relationship
            await addDoc(collection(db, "widthLengthRelations"), {
              sectionId: sectionObj.id,
              sizeId: sizeObj.id,
              widthId: widthObj.id,
              lengthId: existingLength.id
            });
            const widthLengthSnap = await getDocs(collection(db, "widthLengthRelations"));
            setWidthLengthRelations(widthLengthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
            setItems(items.map(i => i.id === itemId ? { ...i, "Item Length": existingLength.value } : i));
            alert(`Length "${trimmedValue}" linked to this section, size, and width successfully!`);
            return;
          }
        }
      }
    }
    // For suppliers and sections (no cascading), check if item already exists by value
    else if (type === "supplier" || type === "section") {
      const existingItem = currentOptions.find(opt => opt.value.toLowerCase() === trimmedValue.toLowerCase());
      
      if (existingItem) {
        alert(`"${trimmedValue}" already exists. Using the existing entry.`);
        
        // Auto-select the existing item
        if (type === "supplier") {
          setHeaderData(prev => ({ ...prev, "Name of the Supplier": existingItem.value }));
        } else if (type === "section") {
          setItems(items.map(item => item.id === itemId ? { ...item, Section: existingItem.value } : item));
        }
        
        return;
      }
    }
  
    try {
      const docRef = await addDoc(collection(db, collectionName), { value: trimmedValue });
      const newOption = { id: docRef.id, value: trimmedValue, isManual: true };
      const updatedOptions = [...currentOptions, newOption].sort((a, b) => a.value.localeCompare(b.value));
      setOptions(updatedOptions);
  
      // Create relationships based on type
      if (type === "place" && itemId === "header") {
        const currentSupplier = headerData["Name of the Supplier"];
        if (currentSupplier) {
          const supplierObj = allSuppliers.find(s => s.value === currentSupplier);
          if (supplierObj) {
            await addDoc(collection(db, "supplierPlaceRelations"), {
              supplierId: supplierObj.id,
              placeId: docRef.id
            });
            const supplierPlaceSnap = await getDocs(collection(db, "supplierPlaceRelations"));
            setSupplierPlaceRelations(supplierPlaceSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          } else {
            console.warn(`⚠️ Supplier "${currentSupplier}" not found. Relationship not created.`);
          }
        }
      } else if (type === "size" && itemId !== "header") {
        const item = items.find(i => i.id === itemId);
        if (item && item.Section) {
          const sectionObj = allSections.find(s => s.value === item.Section);
          if (sectionObj) {
            await addDoc(collection(db, "sectionSizeRelations"), {
              sectionId: sectionObj.id,
              sizeId: docRef.id
            });
            const sectionSizeSnap = await getDocs(collection(db, "sectionSizeRelations"));
            setSectionSizeRelations(sectionSizeSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          } else {
            console.warn(`⚠️ Section "${item.Section}" not found. Relationship not created.`);
          }
        }
      } else if (type === "width" && itemId !== "header") {
        const item = items.find(i => i.id === itemId);
        if (item && item.Section && item.Size) {
          const sectionObj = allSections.find(s => s.value === item.Section);
          const sizeObj = allSizes.find(s => s.value === item.Size);
          if (sectionObj && sizeObj) {
            await addDoc(collection(db, "sizeWidthRelations"), {
              sectionId: sectionObj.id,
              sizeId: sizeObj.id,
              widthId: docRef.id
            });
            const sizeWidthSnap = await getDocs(collection(db, "sizeWidthRelations"));
            setSizeWidthRelations(sizeWidthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          } else {
            console.warn(`⚠️ Section or Size not found. Relationship not created.`);
          }
        }
      } else if (type === "itemLength" && itemId !== "header") {
        const item = items.find(i => i.id === itemId);
        if (item && item.Section && item.Size && item.Width) {
          const sectionObj = allSections.find(s => s.value === item.Section);
          const sizeObj = allSizes.find(s => s.value === item.Size);
          const widthObj = allWidths.find(w => w.value === item.Width);
          if (sectionObj && sizeObj && widthObj) {
            await addDoc(collection(db, "widthLengthRelations"), {
              sectionId: sectionObj.id,
              sizeId: sizeObj.id,
              widthId: widthObj.id,
              lengthId: docRef.id
            });
            const widthLengthSnap = await getDocs(collection(db, "widthLengthRelations"));
            setWidthLengthRelations(widthLengthSnap.docs.map(doc => ({ id: doc.id, ...doc.data() })));
          } else {
            console.warn(`⚠️ Section, Size, or Width not found. Relationship not created.`);
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
    if (!optionToDelete.isManual) {
      alert("Only manually created values can be deleted!");
      return;
    }
  
    const confirmDelete = window.confirm(`Are you sure you want to delete "${optionToDelete.value}"?`);
    if (!confirmDelete) return;
  
    let collectionName = "";
    let fieldName = "";
  
    if (type === "section") {
      collectionName = "sections";
      fieldName = "Section";
    } else if (type === "size") {
      collectionName = "sizes";
      fieldName = "Size";
    } else if (type === "width") {
      collectionName = "widths";
      fieldName = "Width";
    } else if (type === "itemLength") {
      collectionName = "itemLengths";
      fieldName = "Item Length";
    } else if (type === "supplier") {
      collectionName = "suppliers";
      fieldName = "Name of the Supplier";
    } else if (type === "place") {
      collectionName = "places";
      fieldName = "Supplier Place";
    }
  
    try {
      console.log(`🗑️ Deleting ${type}: ${optionToDelete.value} (ID: ${optionToDelete.id})`);
      
      // Delete from Firestore
      await deleteDoc(doc(db, collectionName, optionToDelete.id));
      
      console.log(`✅ Successfully deleted from Firestore`);
  
      // Clear from form fields
      if (type === "supplier" || type === "place") {
        if (headerData[fieldName] === optionToDelete.value) {
          setHeaderData(prev => ({ ...prev, [fieldName]: "" }));
        }
      } else {
        setItems(prevItems => prevItems.map(item => {
          if (item[fieldName] === optionToDelete.value) {
            return { ...item, [fieldName]: "" };
          }
          return item;
        }));
      }
  
      console.log(`🔄 Re-fetching all master data...`);
      
      // Re-fetch all data to get updated lists and cleaned relationships
      await fetchMasterData();
  
      console.log(`✅ Data re-fetched successfully`);
  
      alert(`${type.charAt(0).toUpperCase() + type.slice(1)} "${optionToDelete.value}" deleted successfully!`);
      
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

  const getTotalMT = () => {
    return items.reduce((sum, item) => sum + parseNum(item["Quantity in Metric Tons"]), 0);
  };

  const calculateSectionCharges = (itemId) => {
    const totalMT = getTotalMT();
    if (totalMT === 0) return { loading: 0, freight: 0 };

    const item = items.find(i => i.id === itemId);
    if (!item) return { loading: 0, freight: 0 };

    const itemMT = parseNum(item["Quantity in Metric Tons"]);
    const totalLoading = parseNum(charges["Loading Charges"]);
    const totalFreight = parseNum(charges["Freight<"]);

    const sectionLoading = (totalLoading / totalMT) * itemMT;
    const sectionFreight = (totalFreight / totalMT) * itemMT;

    return { loading: sectionLoading, freight: sectionFreight };
  };

  const calcBill = () => {
    const basicTotal = items.reduce((sum, item) => sum + parseNum(item["Bill Basic Amount"]), 0);
    const baseAmount = basicTotal + parseNum(charges["Loading Charges"]) + parseNum(charges["Freight<"]) + parseNum(charges.Others);
    
    let gst = 0;
    if (gstType === "AP") {
      gst = baseAmount * (parseNum(cgstPercentage) + parseNum(sgstPercentage)) / 100;
    } else {
      gst = baseAmount * (parseNum(igstPercentage) / 100);
    }

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
        
        // Reset cascading dropdowns
        if (key === "Section") { 
          updated.Size = ""; 
          updated.Width = ""; 
          updated["Item Length"] = "";
        }
        if (key === "Size") { 
          updated.Width = ""; 
          updated["Item Length"] = "";
        }
        if (key === "Width") {
          updated["Item Length"] = "";
        }
        
        // Auto-calculate Bill Basic Amount if not manually edited
        if (key === "Quantity in Metric Tons" || key === "Item Per Rate") {
          if (!manualEdits[`${id}-billAmount`]) {
            const qty = parseNum(updated["Quantity in Metric Tons"]);
            const rate = parseNum(updated["Item Per Rate"]);
            updated["Bill Basic Amount"] = qty * rate;
          }
        }

        // Auto-calculate section charges if not manually edited
        if (key === "Quantity in Metric Tons") {
          const { loading, freight } = calculateSectionCharges(id);
          if (!manualEdits[`${id}-sectionLoading`]) {
            updated["Section Loading Charges"] = loading;
          }
          if (!manualEdits[`${id}-sectionFreight`]) {
            updated["Section Freight<"] = freight;
          }
        }

        // Calculate section subtotal
        const basicAmt = parseNum(updated["Bill Basic Amount"]);
        const loadingAmt = parseNum(updated["Section Loading Charges"]);
        const freightAmt = parseNum(updated["Section Freight<"]);
        updated["Section Subtotal"] = basicAmt + loadingAmt + freightAmt;

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
        
        // Recalculate section subtotal
        const basicAmt = parseNum(updated["Bill Basic Amount"]);
        const loadingAmt = parseNum(updated["Section Loading Charges"]);
        const freightAmt = parseNum(updated["Section Freight<"]);
        updated["Section Subtotal"] = basicAmt + loadingAmt + freightAmt;
        
        return updated;
      }
      return item;
    }));
  };
  
  const handleHeaderChange = (key, value) => {
    if (["Received On", "Bill Date"].includes(key)) {
      const formattedDate = formatDateForDisplay(value);
      setHeaderData((prev) => ({ ...prev, [key]: formattedDate }));
    } else {
      setHeaderData((prev) => ({ ...prev, [key]: value }));
    }

    // Reset place when supplier changes
    if (key === "Name of the Supplier") {
      setHeaderData(prev => ({ ...prev, "Supplier Place": "" }));
    }
  };

  const handleSubmit = async () => {
    if (!unit || !workType) return alert("Please select Unit and Work Type");
    setLoading(true);
    try {
      const docData = {
        ...headerData,
        No: entryNo,
        Unit: unit,
        "Work Type": workType,
        items: items.map(i => ({
          ...i,
          "Bill Basic Amount": parseNum(i["Bill Basic Amount"]),
          "Section Loading Charges": parseNum(i["Section Loading Charges"]),
          "Section Freight<": parseNum(i["Section Freight<"]),
          "Section Subtotal": parseNum(i["Section Subtotal"])
        })),
        charges,
        gst: { 
          type: gstType, 
          cgstP: cgstPercentage, 
          sgstP: sgstPercentage, 
          igstP: igstPercentage, 
          totalGst: billTotals.gst 
        },
        finalTotals: billTotals,
        createdAt: new Date()
      };
      await addDoc(collection(db, "entries"), docData);
      alert("Bill Saved Successfully!");
      window.location.reload();
    } catch (e) { 
      console.error(e); 
      alert("Save Error"); 
    } finally { 
      setLoading(false); 
    }
  };

  const toggleCustomInput = (itemId, type) => {
    const key = `${itemId}-${type}`;
    setCustomInputs(prev => ({
      ...prev,
      [key]: {
        show: !prev[key]?.show,
        value: prev[key]?.value || ""
      }
    }));
  };

  const setCustomInputValue = (itemId, type, value) => {
    const key = `${itemId}-${type}`;
    setCustomInputs(prev => ({
      ...prev,
      [key]: { ...prev[key], value }
    }));
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
            <select 
              className="dropdown-select"
              value={value} 
              onChange={onChange}
            >
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
                  onKeyPress={(e) => {
                    if (e.key === 'Enter') {
                      handleAddCustomValue(itemId, type, customState.value);
                    }
                  }}
                />
                <button className="btn-add-custom" onClick={() => handleAddCustomValue(itemId, type, customState.value)} type="button">
                  Add
                </button>
              </div>
              <div className="manual-values-list">
                <div className="custom-values-header">
                  Manually Created Values
                </div>
                {options.filter(opt => opt.isManual).length === 0 ? (
                  <div className="no-manual-values">
                    No manually created values yet
                  </div>
                ) : (
                  options.filter(opt => opt.isManual).map(opt => (
                    <div key={opt.id} className="manual-value-item">
                      <span className="manual-value-text">{opt.value}</span>
                      <button className="btn-delete-value" onClick={() => handleDeleteValue(type, opt)} type="button">
                        Delete
                      </button>
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

  // Recalculate section charges when total charges change
  useEffect(() => {
    const totalMT = getTotalMT();
    if (totalMT === 0) return;

    setItems(prevItems => prevItems.map(item => {
      const { loading, freight } = calculateSectionCharges(item.id);
      const updated = { ...item };
      
      if (!manualEdits[`${item.id}-sectionLoading`]) {
        updated["Section Loading Charges"] = loading;
      }
      if (!manualEdits[`${item.id}-sectionFreight`]) {
        updated["Section Freight<"] = freight;
      }
      
      // Recalculate subtotal
      const basicAmt = parseNum(updated["Bill Basic Amount"]);
      const loadingAmt = parseNum(updated["Section Loading Charges"]);
      const freightAmt = parseNum(updated["Section Freight<"]);
      updated["Section Subtotal"] = basicAmt + loadingAmt + freightAmt;
      
      return updated;
    }));
  }, [charges["Loading Charges"], charges["Freight<"]]);

  // Recalculate all section charges when any item's MT changes
  useEffect(() => {
    const totalMT = getTotalMT();
    if (totalMT === 0) return;
    
    const totalLoading = parseNum(charges["Loading Charges"]);
    const totalFreight = parseNum(charges["Freight<"]);
    
    if (totalLoading === 0 && totalFreight === 0) return;

    setItems(prevItems => prevItems.map(item => {
      const itemMT = parseNum(item["Quantity in Metric Tons"]);
      const updated = { ...item };
      
      if (!manualEdits[`${item.id}-sectionLoading`]) {
        updated["Section Loading Charges"] = (totalLoading / totalMT) * itemMT;
      }
      if (!manualEdits[`${item.id}-sectionFreight`]) {
        updated["Section Freight<"] = (totalFreight / totalMT) * itemMT;
      }
      
      // Recalculate subtotal
      const basicAmt = parseNum(updated["Bill Basic Amount"]);
      const loadingAmt = parseNum(updated["Section Loading Charges"]);
      const freightAmt = parseNum(updated["Section Freight<"]);
      updated["Section Subtotal"] = basicAmt + loadingAmt + freightAmt;
      
      return updated;
    }));
  }, [items.map(i => parseNum(i["Quantity in Metric Tons"])).join(','), charges["Loading Charges"], charges["Freight<"]]);

  return (
    <div className="entry-container">
      <h1 className="entry-heading">Entry Page</h1>

      <div className="entry-top-inputs">
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
            <input 
              type="text"
              value={headerData.PO}
              onChange={e => handleHeaderChange("PO", e.target.value)}
            />
          </div>

          <div className="entry-input">
            <label>Received On</label>
            <input 
              type="date"
              value={formatDateForInput(headerData["Received On"])}
              onChange={e => handleHeaderChange("Received On", e.target.value)}
            />
          </div>

          <div className="entry-input">
            <label>Bill Number</label>
            <input 
              type="text"
              value={headerData["Bill Number"]}
              onChange={e => handleHeaderChange("Bill Number", e.target.value)}
            />
          </div>

          <div className="entry-input">
            <label>Bill Date</label>
            <input 
              type="date"
              value={formatDateForInput(headerData["Bill Date"])}
              onChange={e => handleHeaderChange("Bill Date", e.target.value)}
            />
          </div>

          {renderDropdownWithCustom(
            "Name of the Supplier",
            headerData["Name of the Supplier"],
            (e) => handleHeaderChange("Name of the Supplier", e.target.value),
            allSuppliers,
            "header",
            "supplier"
          )}

          {renderDropdownWithCustom(
            "Supplier Place",
            headerData["Supplier Place"],
            (e) => handleHeaderChange("Supplier Place", e.target.value),
            getAvailablePlaces(headerData["Name of the Supplier"]),
            "header",
            "place"
          )}
        </div>

        <hr />
        <h3>Sections / Items</h3>
        
        {items.map((item, index) => {
          const availSizes = getAvailableSizes(item.Section);
          const availWidths = getAvailableWidths(item.Section, item.Size);
          const availLengths = getAvailableLengths(item.Section, item.Size, item.Width);

          return (
            <div key={item.id} className="section-card">
              {items.length > 1 && (
                <button className="remove-row-btn" onClick={() => setItems(items.filter(i => i.id !== item.id))} type="button">
                  <HiTrash /> Remove
                </button>
              )}
              <h4>Section Row #{index + 1}</h4>
              <div className="section-grid">
                {renderDropdownWithCustom(
                  "Section",
                  item.Section,
                  (e) => handleItemChange(item.id, "Section", e.target.value),
                  allSections,
                  item.id,
                  "section"
                )}

                {renderDropdownWithCustom(
                  "Size",
                  item.Size,
                  (e) => handleItemChange(item.id, "Size", e.target.value),
                  availSizes,
                  item.id,
                  "size"
                )}

                {renderDropdownWithCustom(
                  "Width",
                  item.Width,
                  (e) => handleItemChange(item.id, "Width", e.target.value),
                  availWidths,
                  item.id,
                  "width"
                )}

                {renderDropdownWithCustom(
                  "Item Length",
                  item["Item Length"],
                  (e) => handleItemChange(item.id, "Item Length", e.target.value),
                  availLengths,
                  item.id,
                  "itemLength"
                )}

                <div className="entry-input">
                  <label>Number of Items Supplied</label>
                  <input 
                    type="number" 
                    value={item["Number of items Supplied"]} 
                    onChange={e => handleItemChange(item.id, "Number of items Supplied", e.target.value)} 
                  />
                </div>

                <div className="entry-input">
                  <label>Qty (MT)</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={item["Quantity in Metric Tons"]} 
                    onChange={e => handleItemChange(item.id, "Quantity in Metric Tons", e.target.value)} 
                  />
                </div>

                <div className="entry-input">
                  <label>Rate</label>
                  <input 
                    type="number" 
                    step="0.01"
                    value={item["Item Per Rate"]} 
                    onChange={e => handleItemChange(item.id, "Item Per Rate", e.target.value)} 
                  />
                </div>

                <div className="entry-input">
                  <label>Basic Amt</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={item["Bill Basic Amount"]} 
                    onChange={e => handleManualEdit(item.id, "Bill Basic Amount", e.target.value)}
                  />
                </div>

                <div className="entry-input">
                  <label>Section Loading</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={item["Section Loading Charges"]} 
                    onChange={e => handleManualEdit(item.id, "Section Loading Charges", e.target.value)}
                  />
                </div>

                <div className="entry-input">
                  <label>Section Freight&lt;</label>
                  <input 
                    type="number"
                    step="0.01"
                    value={item["Section Freight<"]} 
                    onChange={e => handleManualEdit(item.id, "Section Freight<", e.target.value)}
                  />
                </div>

                <div className="entry-input">
                  <label>Section Subtotal</label>
                  <input 
                    type="text" 
                    readOnly 
                    value={formatNum(parseNum(item["Section Subtotal"]))} 
                    className="readonly-field"
                  />
                </div>
              </div>
            </div>
          );
        })}

        <button className="add-section-btn" onClick={() => setItems([...items, { 
          id: Date.now(), 
          Section: "", 
          Size: "", 
          Width: "", 
          "Item Length": "",
          "Number of items Supplied": "",
          "Quantity in Metric Tons": "", 
          "Item Per Rate": "", 
          "Bill Basic Amount": 0,
          "Section Loading Charges": 0,
          "Section Freight<": 0,
          "Section Subtotal": 0
        }])} type="button">
          <HiPlus /> Add Another Section
        </button>

        <h3>Charges</h3>
        <div className="entry-grid">
          {Object.keys(charges).map(key => (
            <div className="entry-input" key={key}>
              <label>{key}</label>
              <input 
                type="number"
                step="0.01" 
                value={charges[key]} 
                onChange={e => setCharges({...charges, [key]: e.target.value})} 
              />
            </div>
          ))}
        </div>

        <div className="summary-box">
          <div className="summary-content">
            <div className="gst-section">
              <h4>GST Details</h4>
              <div className="gst-radio-group">
                <label>
                  <input 
                    type="radio" 
                    checked={gstType === "AP"} 
                    onChange={()=>setGstType("AP")} 
                  /> AP 
                </label>
                <label>
                  <input 
                    type="radio" 
                    checked={gstType === "OTHER"} 
                    onChange={()=>setGstType("OTHER")} 
                  /> Other 
                </label>
              </div>
              <div className="gst-inputs">
                {gstType === "AP" ? (
                  <>
                    <input 
                      type="number"
                      step="0.01"
                      className="gst-input" 
                      value={cgstPercentage} 
                      onChange={e=>setCgstPercentage(e.target.value)} 
                    /> % CGST 
                    <input 
                      type="number"
                      step="0.01"
                      className="gst-input" 
                      value={sgstPercentage} 
                      onChange={e=>setSgstPercentage(e.target.value)} 
                    /> % SGST
                  </>
                ) : (
                  <>
                    <input 
                      type="number"
                      step="0.01"
                      className="gst-input" 
                      value={igstPercentage} 
                      onChange={e=>setIgstPercentage(e.target.value)} 
                    /> % IGST
                  </>
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

        <button 
          className="entry-submit" 
          onClick={handleSubmit} 
          disabled={loading}
        >
          {loading ? "Processing..." : `Submit Entry #${entryNo}`}
        </button>
      </div>
    </div>
  );
}