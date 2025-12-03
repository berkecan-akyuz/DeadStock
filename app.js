// products.js - Fixed Interactive Version
const API_BASE = "http://localhost:5000"; // Update with your Flask server URL

document.addEventListener("DOMContentLoaded", () => {
  const isProductsPage =
    document.title.includes("Product Inventory") ||
    window.location.pathname.includes("products");

  if (!isProductsPage) return;

  // --- DOM elements ---
  const chips = Array.from(document.querySelectorAll(".chip-row .chip"));
  const sortSelect = document.querySelector(".quick-filter-row select.filter-input");
  const minRiskInput = document.querySelectorAll(".quick-filter-row input.filter-input")[0];
  const maxAgeInput = document.querySelectorAll(".quick-filter-row input.filter-input")[1];
  const updateListBtn = document.querySelector("#update-btn");
  const sidebarApplyBtn = document.querySelector(".sidebar .btn-primary.full-width");
  const sidebarSelects = document.querySelectorAll(".sidebar .filter-input");
  const searchInput = document.querySelector(".top-bar .search-input");
  const tableBody = document.querySelector(".product-table tbody");

  // --- State ---
  let allProducts = [];
  const filters = {
    search: "",
    riskBucket: "all",
    minRisk: 0,
    maxAge: 365,
    sortBy: "risk_desc",
    sidebarRiskLevel: "All",
    sidebarCategory: "All Categories",
    sidebarWarehouse: "All Locations",
  };

  // --- Load Products ---
  async function loadProducts() {
    try {
      const res = await fetch(`${API_BASE}/api/products`);
      const data = await res.json();
      allProducts = Array.isArray(data) ? data : data.products ?? [];
      
      console.log(`Loaded ${allProducts.length} products`);
      renderTable();
    } catch (err) {
      console.error("Failed to load products", err);
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: #9ca3af;">
            Failed to load products. Make sure the Flask server is running on ${API_BASE}
          </td>
        </tr>
      `;
    }
  }

  // --- Apply Filters ---
  function applyFilters(list) {
    let result = [...list];

    // Normalize risk scores (0-100 range)
    result = result.map((p) => {
      let score = Number(p.risk_score || p.dead_stock_risk_score || 0);
      if (score <= 1) score = score * 100;
      return { ...p, risk_score: score };
    });

    // Search filter
    if (filters.search.trim() !== "") {
      const q = filters.search.trim().toLowerCase();
      result = result.filter(
        (p) =>
          String(p.sku || "").toLowerCase().includes(q) ||
          String(p.name || "").toLowerCase().includes(q)
      );
    }

    // Sidebar filters
    if (filters.sidebarCategory !== "All Categories") {
      result = result.filter((p) => (p.category || "").trim() === filters.sidebarCategory);
    }
    
    if (filters.sidebarWarehouse !== "All Locations") {
      result = result.filter((p) => (p.warehouse || "").trim() === filters.sidebarWarehouse);
    }
    
    if (filters.sidebarRiskLevel !== "All") {
      result = result.filter((p) => {
        const s = p.risk_score;
        if (filters.sidebarRiskLevel.includes("High")) return s >= 70;
        if (filters.sidebarRiskLevel.includes("Medium")) return s >= 40 && s < 70;
        if (filters.sidebarRiskLevel.includes("Low")) return s < 40;
        return true;
      });
    }

    // Chip buckets
    if (filters.riskBucket === "high") {
      result = result.filter((p) => p.risk_score >= 70);
    } else if (filters.riskBucket === "medium") {
      result = result.filter((p) => p.risk_score >= 40 && p.risk_score < 70);
    } else if (filters.riskBucket === "low") {
      result = result.filter((p) => p.risk_score < 40);
    } else if (filters.riskBucket === "age>180") {
      result = result.filter((p) => Number(p.stock_age_days ?? 0) > 180);
    }

    // Numeric filters
    result = result.filter((p) => p.risk_score >= (filters.minRisk || 0));
    result = result.filter((p) => Number(p.stock_age_days ?? 0) <= (filters.maxAge || 99999));

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

    return result;
  }

  // --- Render Table ---
  function renderTable() {
    const rows = applyFilters(allProducts);
    tableBody.innerHTML = "";

    if (rows.length === 0) {
      tableBody.innerHTML = `
        <tr>
          <td colspan="8" style="text-align: center; padding: 2rem; color: #9ca3af;">
            No products match your filters. Try adjusting the criteria.
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

      // Make row clickable for detail view
      tr.style.cursor = "pointer";
      tr.addEventListener("click", () => updateDetailPanel(p));

      tableBody.appendChild(tr);
    });

    console.log(`Rendered ${rows.length} products`);
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

    // Generate AI explanation based on product data
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

  // Chips
  chips.forEach((chip) => {
    chip.addEventListener("click", () => {
      chips.forEach((c) => c.classList.remove("chip-active"));
      chip.classList.add("chip-active");

      const label = chip.textContent.trim();
      if (label === "High Risk") filters.riskBucket = "high";
      else if (label === "Medium Risk") filters.riskBucket = "medium";
      else if (label === "Low Risk") filters.riskBucket = "low";
      else if (label.includes("180")) filters.riskBucket = "age>180";
      else filters.riskBucket = "all";

      renderTable();
    });
  });

  // Update List button
  if (updateListBtn) {
    updateListBtn.addEventListener("click", () => {
      filters.minRisk = Number(minRiskInput.value) || 0;
      filters.maxAge = Number(maxAgeInput.value) || 365;
      console.log("Filters updated:", filters);
      renderTable();
    });
  }

  // Sidebar Apply Filters
  if (sidebarApplyBtn) {
    sidebarApplyBtn.addEventListener("click", () => {
      filters.sidebarRiskLevel = sidebarSelects[0].value;
      filters.sidebarCategory = sidebarSelects[1].value;
      filters.sidebarWarehouse = sidebarSelects[2].value;
      console.log("Sidebar filters updated:", filters);
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
      renderTable();
    });
  }

  // Search box
  if (searchInput) {
    searchInput.addEventListener("input", () => {
      filters.search = searchInput.value;
      renderTable();
    });
  }

  // Initial load
  loadProducts();
});
