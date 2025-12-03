import os
import math
import random

import numpy as np
import pandas as pd
import pyodbc
from flask import Flask, jsonify, request
from flask_cors import CORS
from sklearn.preprocessing import MinMaxScaler
from xgboost import XGBRegressor

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# ------------------------------------------------------
# 1. SQL SERVER CONFIG
# ------------------------------------------------------

SQL_SERVER_CONN_STR = os.getenv(
    "SQL_SERVER_CONN_STR",
    "DRIVER={ODBC Driver 17 for SQL Server};"
    "SERVER=localhost;"
    "DATABASE=DeadStockDB;"
    "Trusted_Connection=yes;"
)

# Globals to hold model & data
MODEL: XGBRegressor | None = None
SCALER: MinMaxScaler | None = None
FEATURE_DF: pd.DataFrame | None = None
FEATURE_COLS: list[str] = []


def get_connection():
    """Open a SQL Server connection."""
    return pyodbc.connect(SQL_SERVER_CONN_STR)


# ------------------------------------------------------
# 2. LOAD DATA FROM YOUR SCHEMA
# ------------------------------------------------------

def load_feature_table() -> pd.DataFrame:
    """
    Load a product-level dataset by aggregating sales, customer behavior,
    marketing events, and external trends using your SQL schema.
    """
    with get_connection() as conn:
        query = """
        WITH sales_agg AS (
            SELECT
                s.product_id,
                SUM(s.quantity_sold) AS monthly_sales,
                SUM(s.returned_units) AS returned_units,
                AVG(s.discount_rate) AS avg_discount_rate
            FROM sales s
            WHERE s.date >= DATEADD(day, -30, GETDATE())
            GROUP BY s.product_id
        ),
        behavior_agg AS (
            SELECT
                c.product_id,
                SUM(c.page_views) AS page_views,
                AVG(c.click_through_rate) AS click_through_rate,
                AVG(c.add_to_cart_rate) AS add_to_cart_rate,
                AVG(c.conversion_rate) AS conversion_rate,
                SUM(c.review_count) AS review_count
            FROM customer_behavior c
            WHERE c.date >= DATEADD(day, -30, GETDATE())
            GROUP BY c.product_id
        ),
        marketing_agg AS (
            SELECT
                m.product_id,
                AVG(m.discount_percent) AS discount_percent,
                SUM(m.ad_impressions) AS ad_impressions
            FROM marketing_events m
            WHERE m.start_date >= DATEADD(day, -60, GETDATE())
            GROUP BY m.product_id
        ),
        trends_agg AS (
            SELECT
                t.product_id,
                AVG(t.trend_score) AS trend_score,
                MAX(CASE WHEN t.holiday_flag = 1 THEN 1 ELSE 0 END) AS holiday_flag
            FROM external_trends t
            WHERE t.date >= DATEADD(day, -90, GETDATE())
            GROUP BY t.product_id
        )
        SELECT
            p.id AS product_id,
            p.sku,
            p.name,
            COALESCE(c.name, 'Unknown') AS category,
            COALESCE(w.name, 'Unknown') AS warehouse,
            inv.stock_level,
            inv.stock_age_days,
            inv.restock_frequency,
            inv.safety_stock,
            CAST(COALESCE(sa.monthly_sales, 0) AS float) AS monthly_sales,
            CAST(COALESCE(sa.returned_units, 0) AS float) AS returned_units,
            COALESCE(sa.avg_discount_rate, 0) AS avg_discount_rate,
            COALESCE(ba.page_views, 0) AS page_views,
            COALESCE(ba.click_through_rate, 0) AS click_through_rate,
            COALESCE(ba.add_to_cart_rate, 0) AS add_to_cart_rate,
            COALESCE(ba.conversion_rate, 0) AS conversion_rate,
            COALESCE(ba.review_count, 0) AS review_count,
            COALESCE(ma.discount_percent, 0) AS discount_percent,
            COALESCE(ma.ad_impressions, 0) AS ad_impressions,
            COALESCE(tr.trend_score, 0) AS trend_score,
            COALESCE(tr.holiday_flag, 0) AS holiday_flag,
            p.seasonality_flag
        FROM products p
        LEFT JOIN categories c ON p.category_id = c.id
        LEFT JOIN inventory inv ON inv.product_id = p.id
        LEFT JOIN warehouses w ON inv.warehouse_id = w.id
        LEFT JOIN sales_agg sa ON sa.product_id = p.id
        LEFT JOIN behavior_agg ba ON ba.product_id = p.id
        LEFT JOIN marketing_agg ma ON ma.product_id = p.id
        LEFT JOIN trends_agg tr ON tr.product_id = p.id
        WHERE inv.id IS NOT NULL;
        """
        df = pd.read_sql(query, conn)

    # Ensure numeric columns are numeric and fill NaNs
    numeric_cols_defaults = {
        "monthly_sales": 0.0,
        "returned_units": 0.0,
        "avg_discount_rate": 0.0,
        "stock_level": 0.0,
        "stock_age_days": 0.0,
        "restock_frequency": 30.0,
        "safety_stock": 0.0,
        "page_views": 0.0,
        "click_through_rate": 0.0,
        "add_to_cart_rate": 0.0,
        "conversion_rate": 0.0,
        "review_count": 0.0,
        "discount_percent": 0.0,
        "ad_impressions": 0.0,
        "trend_score": 0.0,
        "holiday_flag": 0.0,
        "seasonality_flag": 0.0,
    }

    for col, default in numeric_cols_defaults.items():
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(default)
        else:
            df[col] = default

    if "category" not in df.columns:
        df["category"] = "Unknown"
    else:
        df["category"] = df["category"].fillna("Unknown")

    if "warehouse" not in df.columns:
        df["warehouse"] = "Unknown"
    else:
        df["warehouse"] = df["warehouse"].fillna("Unknown")

    return df


# ------------------------------------------------------
# 3. FEATURE ENGINEERING + HEURISTIC LABEL
# ------------------------------------------------------

def build_features(df: pd.DataFrame) -> pd.DataFrame:
    """
    Build model features from DB fields and create a heuristic
    continuous risk label (0–100) for training the regressor.
    """
    df = df.copy()

    # Return ratio (safety check for division by zero)
    df["return_ratio"] = np.where(
        df["monthly_sales"] > 0,
        df["returned_units"] / df["monthly_sales"],
        0.0,
    )

    # Engagement score (views * CTR * conversion)
    df["engagement_score"] = (
        df["page_views"]
        * df["click_through_rate"]
        * df["conversion_rate"]
    )

    # Inventory pressure: stock vs demand
    df["stock_pressure"] = df["stock_level"] / (df["monthly_sales"] + 1.0)

    # Promotion intensity: discount x impressions
    df["promotion_intensity"] = df["discount_percent"] * (df["ad_impressions"] + 1.0)

    # Heuristic continuous risk label (0–100)
    age_scaled = np.clip(df["stock_age_days"] / 365.0, 0, 1)
    pressure_scaled = np.clip(df["stock_pressure"] / 100.0, 0, 1)
    trend_inverse = 1.0 - np.clip(df["trend_score"], 0, 1)

    risk_raw = 0.5 * pressure_scaled + 0.3 * age_scaled + 0.2 * trend_inverse
    risk_raw = np.clip(risk_raw, 0, 1)
    df["risk_label"] = (risk_raw * 100.0).astype(float)

    return df


# ------------------------------------------------------
# 4. MODEL TRAINING (XGBRegressor)
# ------------------------------------------------------

def train_model():
    """
    Train an XGBRegressor to approximate our heuristic risk_label and
    compute a predicted risk_score for all products.
    """
    global MODEL, SCALER, FEATURE_DF, FEATURE_COLS

    try:
        base_df = load_feature_table()
    except Exception as e:
        print(f"WARNING: Could not load data from DB: {e}")
        print("Using synthetic fallback data...")
        base_df = pd.DataFrame()

    # If DB is empty, simulate a tiny dataset
    if base_df.empty:
        print("WARNING: No data returned from DB; using synthetic fallback.")
        base_df = pd.DataFrame({
            "product_id": range(1, 11),
            "sku": [f"SKU-{i:04d}" for i in range(1, 11)],
            "name": [f"Demo Product {i}" for i in range(1, 11)],
            "category": ["Unknown"] * 10,
            "warehouse": ["Unknown"] * 10,
            "stock_level": np.random.randint(50, 800, 10),
            "stock_age_days": np.random.randint(5, 260, 10),
            "restock_frequency": np.random.randint(7, 90, 10),
            "safety_stock": np.random.randint(10, 200, 10),
            "monthly_sales": np.random.randint(0, 400, 10).astype(float),
            "returned_units": np.random.randint(0, 50, 10).astype(float),
            "avg_discount_rate": np.random.uniform(0, 0.5, 10),
            "page_views": np.random.randint(0, 5000, 10),
            "click_through_rate": np.random.uniform(0.0, 0.1, 10),
            "add_to_cart_rate": np.random.uniform(0.0, 0.08, 10),
            "conversion_rate": np.random.uniform(0.0, 0.05, 10),
            "review_count": np.random.randint(0, 2000, 10),
            "discount_percent": np.random.uniform(0, 0.5, 10),
            "ad_impressions": np.random.randint(0, 100000, 10),
            "trend_score": np.random.uniform(0, 1, 10),
            "holiday_flag": np.random.randint(0, 2, 10),
            "seasonality_flag": np.random.randint(0, 2, 10),
        })

    feat_df = build_features(base_df)

    feature_cols = [
        "monthly_sales",
        "return_ratio",
        "avg_discount_rate",
        "stock_level",
        "stock_age_days",
        "restock_frequency",
        "safety_stock",
        "engagement_score",
        "stock_pressure",
        "promotion_intensity",
        "trend_score",
        "holiday_flag",
        "seasonality_flag",
    ]

    X = feat_df[feature_cols].values.astype(float)
    y = feat_df["risk_label"].values.astype(float)

    scaler = MinMaxScaler()
    X_scaled = scaler.fit_transform(X)

    model = XGBRegressor(
        n_estimators=200,
        learning_rate=0.05,
        max_depth=6,
        subsample=0.8,
        colsample_bytree=0.9,
        random_state=42,
        objective="reg:squarederror",
    )

    model.fit(X_scaled, y)

    # Predict risk score (0–100)
    y_pred = model.predict(X_scaled)
    y_pred = np.clip(y_pred, 0, 100)
    feat_df["risk_score"] = y_pred.astype(float)

    MODEL = model
    SCALER = scaler
    FEATURE_DF = feat_df
    FEATURE_COLS = feature_cols

    print(f"✓ Model trained on {len(feat_df)} products")
    print(f"  Risk score range: {feat_df['risk_score'].min():.1f} - {feat_df['risk_score'].max():.1f}")


def ensure_model_ready():
    global MODEL, SCALER, FEATURE_DF
    if MODEL is None or SCALER is None or FEATURE_DF is None:
        train_model()


# ------------------------------------------------------
# 5. API ENDPOINTS
# ------------------------------------------------------

@app.get("/api/products")
def api_products():
    """
    Return product list with risk scores for the Products page.
    """
    ensure_model_ready()
    df = FEATURE_DF

    records = []
    for _, row in df.iterrows():
        monthly_sales = float(row["monthly_sales"])
        sales_velocity = monthly_sales / 30.0 if monthly_sales > 0 else 0.0
        score = float(row["risk_score"])

        records.append({
            "product_id": int(row["product_id"]),
            "sku": str(row["sku"]),
            "name": str(row["name"]),
            "category": str(row.get("category", "Unknown")),
            "warehouse": str(row.get("warehouse", "Unknown")),
            "stock_level": int(row["stock_level"]),
            "sales_velocity": round(sales_velocity, 2),
            "stock_age_days": int(row["stock_age_days"]),
            "risk_score": round(score, 1),
            "dead_stock_risk_score": round(score, 1),
        })

    print(f"API /api/products: Returning {len(records)} products")
    return jsonify(records)


@app.get("/api/summary")
def api_summary():
    """
    Summary KPIs for the main dashboard.
    """
    ensure_model_ready()
    df = FEATURE_DF

    total = len(df)
    if total == 0:
        return jsonify({
            "total_products": 0,
            "high_risk": 0,
            "medium_risk": 0,
            "low_risk": 0,
            "average_risk": 0.0,
        })

    high = int((df["risk_score"] >= 70).sum())
    medium = int(((df["risk_score"] >= 40) & (df["risk_score"] < 70)).sum())
    low = total - high - medium
    avg = round(float(df["risk_score"].mean()), 1)

    return jsonify({
        "total_products": total,
        "high_risk": high,
        "medium_risk": medium,
        "low_risk": low,
        "average_risk": avg,
    })


@app.get("/api/reports/risk_by_category")
def api_risk_by_category():
    """
    Average risk score per category for the Reports/Analytics page.
    """
    ensure_model_ready()
    df = FEATURE_DF.copy()
    df["category"] = df.get("category", "Unknown").fillna("Unknown")

    grouped = df.groupby("category")["risk_score"].mean().reset_index()

    return jsonify({
        "labels": grouped["category"].tolist(),
        "values": grouped["risk_score"].round(1).astype(float).tolist(),
    })


@app.get("/api/reports/deadstock_over_time")
def api_deadstock_over_time():
    """
    Simulated dead-stock % over the last 6 periods based on current risk.
    """
    ensure_model_ready()
    df = FEATURE_DF

    total = len(df)
    if total == 0:
        return jsonify({
            "labels": ["-5m", "-4m", "-3m", "-2m", "-1m", "Now"],
            "values": [0, 0, 0, 0, 0, 0],
        })

    high = (df["risk_score"] >= 70).sum()
    current_pct = round(100.0 * high / total, 1)

    months = ["-5m", "-4m", "-3m", "-2m", "-1m", "Now"]
    vals = []
    base = current_pct + 8.0

    for i in range(len(months) - 1):
        vals.append(max(0.0, base))
        base -= random.uniform(1.5, 3.0)
    vals.append(current_pct)

    return jsonify({
        "labels": months,
        "values": [round(v, 1) for v in vals],
    })


@app.get("/")
def root():
    return jsonify({
        "status": "ok",
        "message": "DeadStockAI backend running",
        "endpoints": ["/api/products", "/api/summary", "/api/reports/risk_by_category", "/api/reports/deadstock_over_time"]
    })


# ------------------------------------------------------
# 6. ENTRY POINT
# ------------------------------------------------------

if __name__ == "__main__":
    print("=" * 60)
    print("DeadStock AI Backend Starting...")
    print("=" * 60)
    train_model()
    print("=" * 60)
    print("Server ready! Access at http://localhost:5000")
    print("=" * 60)
    app.run(debug=True, host='0.0.0.0', port=5000)
