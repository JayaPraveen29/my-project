import { useState, useEffect } from "react";
import { HiMagnifyingGlass, HiXMark } from "react-icons/hi2";
import { db } from "../../firebase";
import { collection, getDocs } from "firebase/firestore";
import "./BillNumberSearch.css";

export default function BillNumberSearch() {
  const [theme, setTheme] = useState("light");
  const [searchTerm, setSearchTerm] = useState("");
  const [selectedEntry, setSelectedEntry] = useState(null);
  const [loading, setLoading] = useState(false);
  const [allBills, setAllBills] = useState([]);
  const [filteredBills, setFilteredBills] = useState([]);

  useEffect(() => {
    const savedTheme = localStorage.getItem("appTheme") || "light";
    setTheme(savedTheme);
    document.body.setAttribute("data-theme", savedTheme);
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.body.setAttribute("data-theme", newTheme);
    localStorage.setItem("appTheme", newTheme);
  };

  // Fetch all bills on component mount
  useEffect(() => {
    const fetchAllBills = async () => {
      setLoading(true);
      try {
        const snapshot = await getDocs(collection(db, "entries"));
        const bills = snapshot.docs
          .map(doc => ({
            id: doc.id,
            billNumber: doc.data()["Bill Number"],
            supplier: doc.data()["Name of the Supplier"],
            date: doc.data()["Bill Date"],
            unit: doc.data().Unit,
            fullData: doc.data()
          }))
          .filter(bill => bill.billNumber && bill.billNumber.trim())
          .sort((a, b) => {
            if (a.billNumber < b.billNumber) return -1;
            if (a.billNumber > b.billNumber) return 1;
            return 0;
          });
        
        setAllBills(bills);
        setFilteredBills(bills);
      } catch (error) {
        console.error("Error fetching bills:", error);
        alert("Error loading bills from database. Please try again.");
      } finally {
        setLoading(false);
      }
    };
    fetchAllBills();
  }, []);

  // Filter bills based on search term
  useEffect(() => {
    if (!searchTerm.trim()) {
      setFilteredBills(allBills);
    } else {
      const filtered = allBills.filter(bill => 
        (bill.billNumber && bill.billNumber.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (bill.supplier && bill.supplier.toLowerCase().includes(searchTerm.toLowerCase())) ||
        (bill.unit && bill.unit.toLowerCase().includes(searchTerm.toLowerCase()))
      );
      setFilteredBills(filtered);
    }
  }, [searchTerm, allBills]);

  const formatNum = (n) => {
    const num = typeof n === 'number' ? n : parseFloat(n) || 0;
    return num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  const handleBillClick = (bill) => {
    setSelectedEntry({
      id: bill.id,
      ...bill.fullData
    });
  };

  const handleClear = () => {
    setSearchTerm("");
    setSelectedEntry(null);
  };

  return (
    <div className="entry-layout">

      <div className="bill-search-container">
        <h1 className="bill-search-heading">Search Entry by Bill Number</h1>

        {!selectedEntry && (
          <div className="search-section">
            <div className="search-input-wrapper">
              <input
                type="text"
                className="search-input"
                placeholder="Search by Bill Number, Supplier, or Unit..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
              {searchTerm && (
                <button className="clear-search-btn" onClick={handleClear}>
                  <HiXMark /> Clear
                </button>
              )}
            </div>

            {loading ? (
              <div className="loading-state">Loading bills from database...</div>
            ) : filteredBills.length > 0 ? (
              <>
                <h3 className="bills-count">
                  Available Bills ({filteredBills.length})
                </h3>
                <div className="bills-grid">
                  {filteredBills.map((bill) => (
                    <div
                      key={bill.id}
                      className="bill-card"
                      onClick={() => handleBillClick(bill)}
                    >
                      <div className="bill-number">{bill.billNumber}</div>
                      <div className="bill-info">
                        <strong>Supplier:</strong> {bill.supplier || "N/A"}
                      </div>
                      <div className="bill-info">
                        <strong>Date:</strong> {bill.date || "N/A"}
                      </div>
                      <div className="bill-info">
                        <strong>Unit:</strong> {bill.unit || "N/A"}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="no-results">
                <HiMagnifyingGlass size={60} style={{ opacity: 0.3 }} />
                <p>No bills found {searchTerm ? `matching: ${searchTerm}` : 'in database'}</p>
              </div>
            )}
          </div>
        )}

        {selectedEntry && (
          <div className="entry-details">
            <div className="entry-details-header">
              <h2 className="entry-details-title">
                Bill Number: {selectedEntry["Bill Number"]}
              </h2>
              <button className="back-btn" onClick={handleClear}>
                <HiXMark /> Back to List
              </button>
            </div>

            <div className="detail-section">
              <h3>Basic Information</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-label">Unit</div>
                  <div className="detail-value">{selectedEntry.Unit || "N/A"}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">Work Type</div>
                  <div className="detail-value">{selectedEntry["Work Type"] || "N/A"}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">PO Number</div>
                  <div className="detail-value">{selectedEntry.PO || "N/A"}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">Bill Number</div>
                  <div className="detail-value">{selectedEntry["Bill Number"] || "N/A"}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">Bill Date</div>
                  <div className="detail-value">{selectedEntry["Bill Date"] || "N/A"}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">Received On</div>
                  <div className="detail-value">{selectedEntry["Received On"] || "N/A"}</div>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <h3>Supplier Information</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-label">Supplier Name</div>
                  <div className="detail-value">{selectedEntry["Name of the Supplier"] || "N/A"}</div>
                </div>
                <div className="detail-item">
                  <div className="detail-label">Supplier Place</div>
                  <div className="detail-value">{selectedEntry["Supplier Place"] || "N/A"}</div>
                </div>
              </div>
            </div>

            <div className="detail-section">
              <h3>Items Supplied</h3>
              {selectedEntry.items && selectedEntry.items.length > 0 ? (
                <div className="items-table-wrapper">
                  <table className="items-table">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Section</th>
                        <th>Size</th>
                        <th>Width</th>
                        <th>Quantity (MT)</th>
                        <th>Rate</th>
                        <th>Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedEntry.items.map((item, idx) => (
                        <tr key={idx}>
                          <td>{idx + 1}</td>
                          <td>{item.Section || "N/A"}</td>
                          <td>{item.Size || "N/A"}</td>
                          <td>{item.Width || "N/A"}</td>
                          <td>{item["Quantity in Metric Tons"] || "0"}</td>
                          <td>₹ {formatNum(item["Item Per Rate"] || 0)}</td>
                          <td>₹ {formatNum(item["Bill Basic Amount"] || 0)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="detail-grid">
                  <div className="detail-item">
                    <div className="detail-label">Section</div>
                    <div className="detail-value">{selectedEntry.Section || "N/A"}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Size</div>
                    <div className="detail-value">{selectedEntry.Size || "N/A"}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Width</div>
                    <div className="detail-value">{selectedEntry.Width || "N/A"}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Quantity (MT)</div>
                    <div className="detail-value">{selectedEntry["Quantity in Metric Tons"] || "N/A"}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Rate</div>
                    <div className="detail-value">₹ {formatNum(selectedEntry["Item Per Rate"] || 0)}</div>
                  </div>
                  <div className="detail-item">
                    <div className="detail-label">Basic Amount</div>
                    <div className="detail-value">₹ {formatNum(selectedEntry["Bill Basic Amount"] || 0)}</div>
                  </div>
                </div>
              )}
            </div>

            <div className="detail-section">
              <h3>Additional Charges</h3>
              <div className="detail-grid">
                {selectedEntry.charges && Object.entries(selectedEntry.charges).map(([key, value]) => (
                  <div className="detail-item" key={key}>
                    <div className="detail-label">{key}</div>
                    <div className="detail-value">₹ {formatNum(value || 0)}</div>
                  </div>
                ))}
              </div>
            </div>

            <div className="detail-section">
              <h3>GST Details</h3>
              <div className="detail-grid">
                <div className="detail-item">
                  <div className="detail-label">GST Type</div>
                  <div className="detail-value">{selectedEntry.gst?.type || "N/A"}</div>
                </div>
                {selectedEntry.gst?.type === "AP" ? (
                  <>
                    <div className="detail-item">
                      <div className="detail-label">CGST</div>
                      <div className="detail-value">{selectedEntry.gst.cgstP}%</div>
                    </div>
                    <div className="detail-item">
                      <div className="detail-label">SGST</div>
                      <div className="detail-value">{selectedEntry.gst.sgstP}%</div>
                    </div>
                  </>
                ) : (
                  <div className="detail-item">
                    <div className="detail-label">IGST</div>
                    <div className="detail-value">{selectedEntry.gst?.igstP}%</div>
                  </div>
                )}
                <div className="detail-item">
                  <div className="detail-label">Total GST</div>
                  <div className="detail-value">₹ {formatNum(selectedEntry.gst?.totalGst || 0)}</div>
                </div>
              </div>
            </div>

            {selectedEntry.finalTotals && (
              <div className="summary-card">
                <h3>Bill Summary</h3>
                <div className="summary-row">
                  <span>Basic Total:</span>
                  <span>₹ {formatNum(selectedEntry.finalTotals.basicTotal)}</span>
                </div>
                <div className="summary-row">
                  <span>Total GST:</span>
                  <span>₹ {formatNum(selectedEntry.finalTotals.gst)}</span>
                </div>
                <div className="summary-row">
                  <span>Net Amount:</span>
                  <span>₹ {formatNum(selectedEntry.finalTotals.net)}</span>
                </div>
                <div className="summary-row">
                  <span>Grand Total:</span>
                  <span>₹ {formatNum(selectedEntry.finalTotals.gTotal)}</span>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}