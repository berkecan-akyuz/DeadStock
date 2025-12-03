import pandas as pd
import requests
import streamlit as st

DEFAULT_BASE_URL = "http://localhost:5000"


def fetch_json(base_url: str, path: str):
    """Fetch JSON from the Flask backend and cache the response."""

    @st.cache_data(show_spinner=False)
    def _get(url: str):
        resp = requests.get(url, timeout=10)
        resp.raise_for_status()
        return resp.json()

    url = f"{base_url.rstrip('/')}{path}"
    return _get(url)


def render_header(base_url: str) -> str:
    st.title("DeadStock AI Dashboard (Streamlit)")
    st.caption("Connected to Flask backend for KPIs and product risk scoring.")

    col1, col2 = st.columns([3, 1])
    with col1:
        active_base_url = st.text_input("Backend base URL", value=base_url, key="base_url")
    with col2:
        if st.button("Refresh data"):
            st.cache_data.clear()
            st.experimental_rerun()

    st.divider()
    return active_base_url


def render_summary(base_url: str):
    st.header("Summary KPIs")

    try:
        summary = fetch_json(base_url, "/api/summary")
    except requests.RequestException as exc:
        st.error(f"Could not load summary KPIs: {exc}")
        return

    metric_cols = st.columns(4)
    metric_cols[0].metric("Total Products", summary.get("total_products", 0))
    metric_cols[1].metric("High Risk", summary.get("high_risk", 0))
    metric_cols[2].metric("Medium Risk", summary.get("medium_risk", 0))
    metric_cols[3].metric("Low Risk", summary.get("low_risk", 0))

    st.metric("Average Risk Score", summary.get("average_risk", 0.0))
    st.divider()


def render_reports(base_url: str):
    st.header("Reports & Trends")
    col1, col2 = st.columns(2)

    with col1:
        st.subheader("Risk by Category")
        try:
            risk_by_cat = fetch_json(base_url, "/api/reports/risk_by_category")
            cat_df = pd.DataFrame(risk_by_cat)
            st.bar_chart(cat_df.set_index("labels") if not cat_df.empty else cat_df)
        except requests.RequestException as exc:
            st.error(f"Could not load risk by category: {exc}")

    with col2:
        st.subheader("Dead Stock Over Time")
        try:
            trend = fetch_json(base_url, "/api/reports/deadstock_over_time")
            trend_df = pd.DataFrame(trend)
            st.line_chart(trend_df.set_index("labels") if not trend_df.empty else trend_df)
        except requests.RequestException as exc:
            st.error(f"Could not load dead-stock trend: {exc}")

    st.divider()


def render_products(base_url: str):
    st.header("Products & Risk Scores")

    try:
        products = fetch_json(base_url, "/api/products")
    except requests.RequestException as exc:
        st.error(f"Could not load products: {exc}")
        return

    df = pd.DataFrame(products)

    if df.empty:
        st.info("No products returned from backend.")
        return

    min_score, max_score = float(df["risk_score"].min()), float(df["risk_score"].max())
    score_range = st.slider(
        "Filter by risk score", min_value=min_score, max_value=max_score, value=(min_score, max_score)
    )

    category_options = sorted(df.get("category", pd.Series(dtype=str)).fillna("Unknown").unique())
    category_filter = st.multiselect("Filter by category", options=category_options, default=category_options)

    filtered = df[
        df["risk_score"].between(score_range[0], score_range[1])
        & df["category"].isin(category_filter)
    ]

    st.dataframe(
        filtered.sort_values(by="risk_score", ascending=False),
        use_container_width=True,
        hide_index=True,
    )


if __name__ == "__main__":
    st.set_page_config(page_title="DeadStock AI", layout="wide")

    base_url = st.session_state.get("base_url", DEFAULT_BASE_URL)
    active_base_url = render_header(base_url)
    render_summary(active_base_url)
    render_reports(active_base_url)
    render_products(active_base_url)
