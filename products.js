// products.js - Fixed with Debug Info
const API_BASE = "http://localhost:5000"; // Update with your Flask server URL

document.addEventListener("DOMContentLoaded", () => {
  const isProductsPage =
    document.title.includes("Product Inventory") ||
    window.location.pathname.includes("products");

  if (!isProductsPage) return;

  console.log("Products page initialized");

  // --- DOM elements ---
  const chips = Array.from(document.querySelectorAll(".chip-row .chip"));
  const sortSelect = document.querySelector(".quick-filter-row select.filter-input");
  const quickFilterInputs = document.querySelectorAll(".quick-filter-row input.filter-input");
  const minRiskInput = quickFilterInputs[0];
  const maxAgeInput = quickFilterInputs[1];
  const updateListBtn = document.querySelector("#update-btn");
  const sidebarApplyBtn = document.querySelector(".sidebar .btn-primary.full-width");
  const sidebarSelects = document.querySelectorAll(".sidebar .filter-input");
  const searchInput = document.querySelector(".top-bar .search-input");
  const tableBody = document.querySelector(".product-table tbody");

  console.log("DOM elements found:", {
    chips: chips.length,
    sortSelect: !!sortSelect,
    minRiskInput: !!minRiskInput,
    maxAgeInput: !!maxAgeInput,
    updateListBtn: !!updateListBtn,
    tableBody: !!tableBody
  });

  // --- State ---
  let allProducts = [];
  const filters = {
    search: "",
    riskBucket: "all",
    minRisk: 0,
    maxAge: 999999, // Set very high default
    sortBy: "risk_desc",
    sidebarRiskLevel: "All",
    sidebarCategory: "All Categories",
    sidebarWarehouse: "All Locations",
  };

  // --- Load Products ---
  async function loadProducts() {
    try {
      console.log("Fetching products from:", `${API_BASE}/api/products`);
      const res = await fetch(`${API_BASE}/api/products`);
      
      if (!res.ok) {
        throw new Error(`HTTP error! status: ${res.status}`);
      }
      
      const data = await res.json();
      allProducts = Array.isArray(data) ? data : data.products ?? [];
      
      console.log(`✓ Loaded ${allProducts.length} products`);
      console.log("Sample product:", allProducts[0]);
      
      renderTable();
    } catch (err) {
      console.error("❌ Failed to load products:", err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: #f97316;">
            <strong>Connection Error</strong><br><br>
            Failed to load products from ${API_BASE}/api/products<br>
            <span style="font-size: 0.85em; color: #9ca3af;">
              Make sure Flask server is running: <code>python app.py</code><br>
              Error: ${err.message}
            </span>
          </td>
        </tr>
      `;
    }
  }

  // --- Apply Filters ---
  function applyFilters(list) {
    let result = [...list];
    
    console.log("Applying filters to", result.length, "products");
    console.log("Current filters:", filters);

    // Normalize risk scores (0-100 range)
    result = result.map((p) => {
      let score = Number(p.risk_score || p.dead_stock_risk_score || 0);
      if (score <= 1) score = score * 100;
      return { ...p, risk_score: score };
    });

    const beforeSearch = result.length;
    
    // Search filter
    if (filters.search.trim() !== "") {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          String(p.sku || "").toLowerCase().includes(q) ||
          String(p.name || "").toLowerCase().includes(q)
      );
      console.log(`After search filter: ${result.length} (removed ${beforeSearch - result.length})`);
    }

    const beforeSidebar = result.length;

    // Sidebar filters
    if (filters.sidebarCategory !== "All Categories") {
      const before = result.length;
      result = result.filter((p) => (p.category || "").trim() === filters.sidebarCategory);
      console.log(`After category filter: ${result.length} (removed ${before - result.length})`);
    }
    
    if (filters.sidebarWarehouse !== "All Locations") {
      const before = result.length;
      result = result.filter((p) => (p.warehouse || "").trim() === filters.sidebarWarehouse);
      console.log(`After warehouse filter: ${result.length} (removed ${before - result.length})`);
    }
    
    if (filters.sidebarRiskLevel !== "All") {
      const before = result.length;
      result = result.filter((p) => {
        const s = p.risk_score;
        if (filters.sidebarRiskLevel.includes("High")) return s >= 70;
        if (filters.sidebarRiskLevel.includes("Medium")) return s >= 40 && s < 70;
        if (filters.sidebarRiskLevel.includes("Low")) return s < 40;
        return true;
      });
      console.log(`After sidebar risk filter: ${result.length} (removed ${before - result.length})`);
    }

    // Chip buckets
    if (filters.riskBucket !== "all") {
      const before = result.length;
      if (filters.riskBucket === "high") {
        result = result.filter((p) => p.risk_score >= 70);
      } else if (filters.riskBucket === "medium") {
        result = result.filter((p) => p.risk_score >= 40 && p.risk_score < 70);
      } else if (filters.riskBucket === "low") {
        result = result.filter((p) => p.risk_score < 40);
      } else if (filters.riskBucket === "age>180") {
        result = result.filter((p) => Number(p.stock_age_days ?? 0) > 180);
      }
      console.log(`After chip filter (${filters.riskBucket}): ${result.length} (removed ${before - result.length})`);
    }

    // Numeric filters
    const beforeMinRisk = result.length;
    result = result.filter((p) => p.risk_score >= (filters.minRisk || 0));
    console.log(`After min risk filter (>=${filters.minRisk}): ${result.length} (removed ${beforeMinRisk - result.length})`);

    const beforeMaxAge = result.length;
    result = result.filter((p) => Number(p.stock_age_days ?? 0) <= (filters.maxAge || 999999));
    console.log(`After max age filter (<=${filters.maxAge}): ${result.length} (removed ${beforeMaxAge - result.length})`);

    // Sorting
    result.sort((a, b) => {
      if (filters.sortBy === "risk_desc") {
        return b.risk_score - a.risk_score;
      }
      if (filters.sortBy === "age_desc") {
        return (b.stock_age_days ?? 0) - (a.stock_age_days ?? 0);
      }
      if (filters.sortBy === "stock_desc") {
        return (b.stock_level ?? 0) - (a.stock_level ?? 0);
      }
      if (filters.sortBy === "velocity_asc") {
        const av = a.sales_velocity ?? Number.POSITIVE_INFINITY;
        const bv = b.sales_velocity ?? Number.POSITIVE_INFINITY;
        return av - bv;
      }
      return 0;
    });

    console.log(`✓ Final result: ${result.length} products`);
    return result;
  }

  // --- Render Table ---
  function renderTable() {
    const rows = applyFilters(allProducts);
    tableBody.innerHTML = "";

    if (allProducts.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: #9ca3af;">
            Loading products...
          </td>
        </tr>
      `;
      return;
    }

    if (rows.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: #f97316;">
            <strong>No products match your filters</strong><br><br>
            <span style="font-size: 0.85em; color: #9ca3af;">
              Current filters:<br>
              • Min Risk: ${filters.minRisk}<br>
              • Max Age: ${filters.maxAge} days<br>
              • Risk Bucket: ${filters.riskBucket}<br>
              • Category: ${filters.sidebarCategory}<br>
              • Warehouse: ${filters.sidebarWarehouse}<br>
              <br>
              Try adjusting the criteria or click "All" chip to reset.
            </span>
          </td>
        </tr>
      `;
      return;
    }

    rows.forEach((p) => {
      const tr = document.createElement("tr");
      const s = p.risk_score;

      if (s >= 70) tr.classList.add("risk-high");
      else if (s >= 40) tr.classList.add("risk-medium");
      else tr.classList.add("risk-low");

      tr.innerHTML = `
        <td>${p.sku ?? "-"}</td>
        <td>${p.name ?? "-"}</td>
        <td>${p.category ?? "-"}</td>
        <td>${p.warehouse ?? "-"}</td>
        <td>${p.stock_level ?? "-"}</td>
        <td>${typeof p.sales_velocity === 'number' ? p.sales_velocity.toFixed(1) : "-"} / day</td>
        <td>${p.stock_age_days ?? "-"} days</td>
        <td>
          <span class="risk-badge ${riskBadgeClass(s)}">
            ${Math.round(s)}
          </span>
        </td>
      `;

      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => updateDetailPanel(p));

      tableBody.appendChild(tr);
    });

    console.log(`✓ Rendered ${rows.length} products in table`);
  }

  // --- Risk Badge Class ---
  function riskBadgeClass(score) {
    if (score >= 70) return "risk-badge-high";
    if (score >= 40) return "risk-badge-medium";
    return "risk-badge-low";
  }

  // --- Update Detail Panel ---
  function updateDetailPanel(product) {
    const detailPanel = document.querySelector(".detail-panel");
    if (!detailPanel) return;

    const s = product.risk_score;
    let riskLevel = "Low";
    let badgeClass = "risk-badge-low";
    
    if (s >= 70) {
      riskLevel = "High";
      badgeClass = "risk-badge-high";
    } else if (s >= 40) {
      riskLevel = "Medium";
      badgeClass = "risk-badge-medium";
    }

    const drivers = [];
    if (product.stock_age_days > 180) drivers.push("Stock age > 180 days");
    if (product.sales_velocity < 1) drivers.push("Sales velocity below category median");
    if (product.stock_level > 300) drivers.push("High inventory levels");
    if (drivers.length === 0) drivers.push("Multiple moderate risk factors");

    detailPanel.innerHTML = `
      <div class="panel-header">
        <h3>Selected SKU Details</h3>
        <span class="panel-subtitle">AI-generated risk analysis and recommendations</span>
      </div>

      <div class="detail-block">
        <p class="detail-label">SKU</p>
        <p class="detail-value">${product.sku}</p>

        <p class="detail-label">Product name</p>
        <p class="detail-value">${product.name}</p>

        <p class="detail-label">Risk Score</p>
        <p class="detail-value">
          <span class="risk-badge ${badgeClass}">${Math.round(s)} – ${riskLevel}</span>
        </p>
      </div>

      <div class="detail-block">
        <p class="detail-label">Key Drivers (AI Explanation)</p>
        <ul class="detail-list">
          ${drivers.map(d => `<li>${d}</li>`).join('')}
        </ul>
      </div>

      <div class="detail-block">
        <p class="detail-label">AI Recommended Actions</p>
        <ul class="detail-list">
          ${getRecommendations(product).map(r => `<li>${r}</li>`).join('')}
        </ul>
      </div>
    `;
  }

  // --- Generate Recommendations ---
  function getRecommendations(product) {
    const recommendations = [];
    const s = product.risk_score;

    if (s >= 70) {
      recommendations.push(`Apply 20-25% markdown and create bundle promotion`);
      recommendations.push(`Feature in "Last Chance" category for 14 days`);
      recommendations.push(`Consider transfer to outlet warehouse`);
    } else if (s >= 40) {
      recommendations.push(`Apply 10-15% promotional discount`);
      recommendations.push(`Increase digital ad spend for 2 weeks`);
      recommendations.push(`Add to homepage banner rotation`);
    } else {
      recommendations.push(`No immediate action required`);
      recommendations.push(`Continue monitoring stock levels`);
      recommendations.push(`Maintain current marketing strategy`);
    }

    return recommendations;
  }

  // --- Event Listeners ---

  // Chips - with better state management
  chips.forEach((chip, index) => {
    chip.addEventListener("click", () => {
      console.log("Chip clicked:", chip.textContent.trim());
      
      chips.forEach((c) => c.classList.remove("chip-active"));
      chip.classList.add("chip-active");

      const label = chip.textContent.trim();
      if (label === "High Risk") {
        filters.riskBucket = "high";
      } else if (label === "Medium Risk") {
        filters.riskBucket = "medium";
      } else if (label === "Low Risk") {
        filters.riskBucket = "low";
      } else if (label.includes("180")) {
        filters.riskBucket = "age>180";
      } else {
        filters.riskBucket = "all";
      }

      console.log("Risk bucket set to:", filters.riskBucket);
      renderTable();
    });
  });

  // Update List button
  if (updateListBtn) {
    updateListBtn.addEventListener("click", () => {
      const minVal = minRiskInput.value.trim();
      const maxVal = maxAgeInput.value.trim();
      
      filters.minRisk = minVal === "" ? 0 : Number(minVal);
      filters.maxAge = maxVal === "" ? 999999 : Number(maxVal);
      
      console.log("✓ Update List clicked");
      console.log("  Min Risk:", filters.minRisk);
      console.log("  Max Age:", filters.maxAge);
      
      renderTable();
    });
  }

  // Sidebar Apply Filters
  if (sidebarApplyBtn) {
    sidebarApplyBtn.addEventListener("click", () => {
      filters.sidebarRiskLevel = sidebarSelects[0].value;
      filters.sidebarCategory = sidebarSelects[1].value;
      filters.sidebarWarehouse = sidebarSelects[2].value;
      
      console.log("✓ Sidebar filters applied");
      console.log("  Risk Level:", filters.sidebarRiskLevel);
      console.log("  Category:", filters.sidebarCategory);
      console.log("  Warehouse:", filters.sidebarWarehouse);
      
      renderTable();
    });
  }

  // Sort dropdown
  if (sortSelect) {
    sortSelect.addEventListener("change", () => {
      const val = sortSelect.value;
      if (val.includes("Risk Score")) filters.sortBy = "risk_desc";
      else if (val.includes("Stock Age")) filters.sortBy = "age_desc";
      else if (val.includes("Stock Quantity")) filters.sortBy = "stock_desc";
      else filters.sortBy = "velocity_asc";
      
      console.log("✓ Sort changed to:", filters.sortBy);
      renderTable();
    });
  }

  // Search box - with debouncing
  if (searchInput) {
    let searchTimeout;
    searchInput.addEventListener("input", () => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        filters.search = searchInput.value;
        console.log("✓ Search:", filters.search);
        renderTable();
      }, 300);
    });
  }

  // Reset button functionality (optional)
  function resetFilters() {
    filters.minRisk = 0;
    filters.maxAge = 999999;
    filters.riskBucket = "all";
    filters.search = "";
    
    if (minRiskInput) minRiskInput.value = "0";
    if (maxAgeInput) maxAgeInput.value = "";
    if (searchInput) searchInput.value = "";
    
    chips.forEach((c, i) => {
      if (i === 0) c.classList.add("chip-active");
      else c.classList.remove("chip-active");
    });
    
    console.log("✓ Filters reset");
    renderTable();
  }

  // Make reset available globally for debugging
  window.resetProductFilters = resetFilters;

  // Initial load
  console.log("Starting initial load...");
  loadProducts();
});