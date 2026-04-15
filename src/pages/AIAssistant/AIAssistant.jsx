import { useState, useEffect, useRef } from "react";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import "./AIAssistant.css";

// ============================================================
//  PASTE YOUR GEMINI API KEY BELOW
// ============================================================
const GEMINI_API_KEY = "AIzaSyDUSq_EL_llTFynP3KaO8AaC5v8rI_Csek";
// ============================================================

// ✅ FIXED: Updated from gemini-1.5-flash to gemini-2.0-flash
const GEMINI_URL = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${GEMINI_API_KEY}`;

export default function AIAssistant() {
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      text: "Hello! I'm your SIEC GROUP data assistant \n\nI have access to all your procurement data — entries, suppliers, sections, prices and more.\n\nAsk me anything like:\n• Which supplier gave the best rate for TMT 8mm?\n• What is the total purchased this financial year?\n• Show me all bills from a specific supplier.\n• Compare prices across suppliers for a section.",
    },
  ]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [dataLoading, setDataLoading] = useState(true);
  const [firestoreData, setFirestoreData] = useState(null);
  const [error, setError] = useState(null);
  const bottomRef = useRef(null);
  const inputRef = useRef(null);

  // Scroll to bottom on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Fetch all Firestore data once on mount
  useEffect(() => {
    fetchAllData();
  }, []);

  const fetchAllData = async () => {
    try {
      setDataLoading(true);

      const [
        entriesSnap,
        sectionsSnap,
        sizesSnap,
        widthsSnap,
        itemLengthsSnap,
        suppliersSnap,
        placesSnap,
      ] = await Promise.all([
        getDocs(collection(db, "entries")),
        getDocs(collection(db, "sections")),
        getDocs(collection(db, "sizes")),
        getDocs(collection(db, "widths")),
        getDocs(collection(db, "itemLengths")),
        getDocs(collection(db, "suppliers")),
        getDocs(collection(db, "places")),
      ]);

      const entries = entriesSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
      const sections = sectionsSnap.docs.map((d) => d.data().value);
      const sizes = sizesSnap.docs.map((d) => d.data().value);
      const widths = widthsSnap.docs.map((d) => d.data().value);
      const itemLengths = itemLengthsSnap.docs.map((d) => d.data().value);
      const suppliers = suppliersSnap.docs.map((d) => d.data().value);
      const places = placesSnap.docs.map((d) => d.data().value);

      // Flatten entries into rows for easier AI consumption
      const rows = [];
      entries.forEach((entry) => {
        const base = {
          entryNo: entry.entryNo,
          financialYear: entry.FinancialYear || entry.financialYear || "",
          unit: entry.unit || "",
          workType: entry.workType || "",
          po: entry.headerData?.PO || "",
          receivedOn: entry.headerData?.["Received On"] || "",
          billNumber: entry.headerData?.["Bill Number"] || "",
          billDate: entry.headerData?.["Bill Date"] || "",
          supplier: entry.headerData?.["Name of the Supplier"] || "",
          supplierPlace: entry.headerData?.["Supplier Place"] || "",
          loadingCharges: entry.charges?.["Loading Charges"] || 0,
          freightIn: entry.charges?.["Freight<"] || 0,
          freightOut: entry.charges?.["Freight>"] || 0,
          others: entry.charges?.Others || 0,
          gstType: entry.gstType || "",
          cgstPct: entry.cgstPercentage || 0,
          sgstPct: entry.sgstPercentage || 0,
          igstPct: entry.igstPercentage || 0,
        };
        if (entry.items && Array.isArray(entry.items)) {
          entry.items.forEach((item) => {
            rows.push({
              ...base,
              section: item.Section || "",
              size: item.Size || "",
              width: item.Width || "",
              length: item["Item Length"] || "",
              itemsSupplied: item["Number of items Supplied"] || 0,
              quantityMT: item["Quantity in Metric Tons"] || 0,
              ratePerItem: item["Item Per Rate"] || 0,
              basicAmount: item["Bill Basic Amount"] || 0,
            });
          });
        }
      });

      setFirestoreData({
        totalEntries: entries.length,
        totalRows: rows.length,
        rows,
        masterData: { sections, sizes, widths, itemLengths, suppliers, places },
      });
    } catch (e) {
      console.error(e);
      setError("Failed to load data from Firestore. Please refresh.");
    } finally {
      setDataLoading(false);
    }
  };

  const buildSystemContext = () => {
    const { rows, masterData, totalEntries, totalRows } = firestoreData;

    // Summarize data compactly
    const supplierSummary = {};
    const sectionSummary = {};
    const fySet = new Set();

    rows.forEach((r) => {
      if (r.supplier) {
        if (!supplierSummary[r.supplier]) {
          supplierSummary[r.supplier] = { totalBasic: 0, totalMT: 0, bills: new Set(), entries: 0 };
        }
        supplierSummary[r.supplier].totalBasic += Number(r.basicAmount) || 0;
        supplierSummary[r.supplier].totalMT += Number(r.quantityMT) || 0;
        supplierSummary[r.supplier].bills.add(r.billNumber);
        supplierSummary[r.supplier].entries++;
      }
      if (r.section) {
        const key = `${r.section}${r.size ? "/" + r.size : ""}`;
        if (!sectionSummary[key]) {
          sectionSummary[key] = { totalMT: 0, rates: [], totalBasic: 0 };
        }
        sectionSummary[key].totalMT += Number(r.quantityMT) || 0;
        sectionSummary[key].totalBasic += Number(r.basicAmount) || 0;
        if (r.ratePerItem) sectionSummary[key].rates.push(Number(r.ratePerItem));
      }
      if (r.financialYear) fySet.add(r.financialYear);
    });

    const supplierLines = Object.entries(supplierSummary)
      .map(([name, d]) => `  ${name}: basicAmt=₹${Math.round(d.totalBasic).toLocaleString()}, MT=${d.totalMT.toFixed(2)}, bills=${d.bills.size}, rows=${d.entries}`)
      .join("\n");

    const sectionLines = Object.entries(sectionSummary)
      .map(([key, d]) => {
        const avgRate = d.rates.length ? (d.rates.reduce((a, b) => a + b, 0) / d.rates.length).toFixed(2) : "N/A";
        const minRate = d.rates.length ? Math.min(...d.rates).toFixed(2) : "N/A";
        const maxRate = d.rates.length ? Math.max(...d.rates).toFixed(2) : "N/A";
        return `  ${key}: MT=${d.totalMT.toFixed(2)}, basicAmt=₹${Math.round(d.totalBasic).toLocaleString()}, avgRate=₹${avgRate}, minRate=₹${minRate}, maxRate=₹${maxRate}`;
      })
      .join("\n");

    // Recent 100 rows for detailed queries
    const recentRows = rows.slice(-100).map((r) =>
      `  FY=${r.financialYear}|Unit=${r.unit}|Bill=${r.billNumber}|Date=${r.billDate}|Supplier=${r.supplier}|Place=${r.supplierPlace}|Section=${r.section}|Size=${r.size}|Width=${r.width}|Length=${r.length}|Items=${r.itemsSupplied}|MT=${r.quantityMT}|Rate=₹${r.ratePerItem}|Basic=₹${r.basicAmount}|Loading=${r.loadingCharges}|FreightIn=${r.freightIn}|FreightOut=${r.freightOut}|Others=${r.others}|GST=${r.gstType}`
    ).join("\n");

    return `You are an AI data assistant for SIEC GROUP, a procurement/purchasing company. 
You have READ-ONLY access to their Firestore database. You must NEVER suggest or imply any data changes.
Answer questions accurately based only on the data provided below. Be concise and helpful.
Format numbers in Indian style (₹ with commas). If data is insufficient to answer, say so clearly.

DATABASE SUMMARY:
- Total purchase entries: ${totalEntries}
- Total line items: ${totalRows}
- Financial Years in data: ${[...fySet].sort().join(", ") || "N/A"}
- Master sections: ${masterData.sections.join(", ")}
- Master suppliers: ${masterData.suppliers.join(", ")}
- Master places: ${masterData.places.join(", ")}

SUPPLIER-WISE SUMMARY:
${supplierLines || "No supplier data"}

SECTION/SIZE-WISE SUMMARY (with rates):
${sectionLines || "No section data"}

LAST 100 DETAILED ROWS (most recent):
${recentRows || "No row data"}

FULL DATA has ${totalRows} rows total. The above 100 rows are the most recent. For aggregate questions use the summaries above.`;
  };

  const sendMessage = async () => {
    const question = input.trim();
    if (!question || loading || dataLoading) return;

    setInput("");
    setMessages((prev) => [...prev, { role: "user", text: question }]);
    setLoading(true);

    try {
      const systemContext = buildSystemContext();

      // Build conversation history for Gemini
      const conversationHistory = messages
        .filter((m) => m.role !== "assistant" || messages.indexOf(m) !== 0) // skip intro
        .slice(-10) // last 10 messages for context
        .map((m) => ({
          role: m.role === "user" ? "user" : "model",
          parts: [{ text: m.text }],
        }));

      const payload = {
        system_instruction: { parts: [{ text: systemContext }] },
        contents: [
          ...conversationHistory,
          { role: "user", parts: [{ text: question }] },
        ],
        generationConfig: {
          temperature: 0.2,
          maxOutputTokens: 1024,
        },
      };

      const res = await fetch(GEMINI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (data.error) {
        throw new Error(data.error.message || "Gemini API error");
      }

      const reply =
        data.candidates?.[0]?.content?.parts?.[0]?.text ||
        "Sorry, I couldn't generate a response. Please try again.";

      setMessages((prev) => [...prev, { role: "assistant", text: reply }]);
    } catch (e) {
      console.error(e);
      setMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          text: `⚠️ Error: ${e.message}. Please check your API key or try again.`,
          isError: true,
        },
      ]);
    } finally {
      setLoading(false);
      inputRef.current?.focus();
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const clearChat = () => {
    setMessages([
      {
        role: "assistant",
        text: "Chat cleared! Ask me anything about your procurement data 😊",
      },
    ]);
  };

  // Render message text with basic formatting
  const renderText = (text) => {
    return text.split("\n").map((line, i) => (
      <span key={i}>
        {line}
        {i < text.split("\n").length - 1 && <br />}
      </span>
    ));
  };

  return (
    <div className="ai-page">
      {/* Header */}
      <div className="ai-header">
        <div className="ai-header-left">
          <div className="ai-avatar-header">✦</div>
          <div>
            <h1 className="ai-title">AI Data Assistant</h1>
            <p className="ai-subtitle">• SIEC GROUP Procurement Data</p>
          </div>
        </div>
        <div className="ai-header-right">
          {dataLoading ? (
            <span className="ai-status loading">⏳ Loading data...</span>
          ) : error ? (
            <span className="ai-status error">⚠️ Data error</span>
          ) : (
            <span className="ai-status ready">
              ✅ {firestoreData?.totalRows?.toLocaleString()} records loaded
            </span>
          )}
          <button className="ai-clear-btn" onClick={clearChat} title="Clear chat">
            🗑 Clear
          </button>
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="ai-error-banner">
          {error}
          <button onClick={fetchAllData}>Retry</button>
        </div>
      )}

      {/* Messages */}
      <div className="ai-messages">
        {messages.map((msg, i) => (
          <div key={i} className={`ai-message-row ${msg.role}`}>
            {msg.role === "assistant" && (
              <div className="ai-avatar">✦</div>
            )}
            <div className={`ai-bubble ${msg.role} ${msg.isError ? "error" : ""}`}>
              {renderText(msg.text)}
            </div>
            {msg.role === "user" && (
              <div className="ai-avatar user-avatar">👤</div>
            )}
          </div>
        ))}

        {loading && (
          <div className="ai-message-row assistant">
            <div className="ai-avatar">✦</div>
            <div className="ai-bubble assistant">
              <span className="ai-typing">
                <span></span><span></span><span></span>
              </span>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestion chips */}
      {messages.length <= 1 && !dataLoading && (
        <div className="ai-suggestions">
          {[
            "Which supplier gave the best rate?",
            "Total purchased in 2026-27?",
            "List all sections available",
            "Top 3 suppliers by amount",
          ].map((s, i) => (
            <button
              key={i}
              className="ai-chip"
              onClick={() => { setInput(s); inputRef.current?.focus(); }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input area */}
      <div className="ai-input-area">
        <textarea
          ref={inputRef}
          className="ai-input"
          placeholder={dataLoading ? "Loading data, please wait..." : "Ask anything about your procurement data..."}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={loading || dataLoading}
          rows={1}
        />
        <button
          className="ai-send-btn"
          onClick={sendMessage}
          disabled={loading || dataLoading || !input.trim()}
        >
          {loading ? "..." : "➤"}
        </button>
      </div>
      <p className="ai-hint">Press Enter to send • Shift+Enter for new line</p>
    </div>
  );
}
