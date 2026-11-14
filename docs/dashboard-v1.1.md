# TVK ERP — Admin & CEO Dashboard Implementation Specification

**Document:** `ADMIN_CEO_DASHBOARD_SPEC.md`  
**Version:** 1.1  
**Status:** Approved & Implemented  
**Project:** TVK Management System  
**Scope:** Admin Operations Dashboard & CEO Executive Dashboard  
**Language:** English (Specification) / Vietnamese (User Interface)

---

## Changelog v1.1 (Approved Decisions)

1. **CEO Executive Dashboard Route (`/executive`)**:
   - Strictly read-only for `OWNER`, `CEO`, `ACCOUNTING`. Other roles are redirected to `/dashboard`.
   - Strategic KPI Row: Doanh thu thuần, Lợi nhuận gộp, Biên lợi nhuận gộp (%), Vốn tồn kho TVK (giá vốn), Tỷ lệ công nợ quá hạn (%), Vòng quay tồn kho (Inventory Turnover). Mẫu số bằng 0 trả về "—" hoặc null, không hiển thị % ảo.
   - Cash Flow Runway Widget: Dự báo Dòng tiền 14-30 ngày tới so sánh Dòng tiền vào (thu gara) vs Dòng tiền ra (trả NCC ký gửi) -> Dòng tiền ròng và chỉ số an toàn thanh khoản.
   - Business Trends Chart: Doanh thu, Lợi nhuận, Giá vốn theo tháng/quý/năm.
   - Inventory Capital Donut: Dùng Donut đơn vòng tinh gọn (Kho TVK, Kho đối tác) kèm Center Label tổng vốn sở hữu và phân rã bảng chi tiết, không dùng multi-ring phức tạp trên CEO dashboard.
   - Receivables Aging: 4 nhóm tuổi nợ (Chưa đến hạn, 1-30 ngày, 31-60 ngày, >60 ngày).
   - Distributor Performance: Tỷ lệ tiêu thụ (%) và vốn hàng đang giữ (VNĐ).
   - Top Categories by Gross Profit: Xếp hạng nhóm hàng đóng góp lợi nhuận gộp cao nhất.

2. **Semantic Color Palette Token Separation**:
   - `cogs`: `#F59E0B` (Giá vốn hàng bán).
   - `supplierConsignment`: `#0284C7` (Hàng nhận ký gửi từ NCC, tách biệt hoàn toàn khỏi `#F59E0B` để tránh xung đột mã màu).

3. **Card Specifications & Impeccable Design Standard**:
   - Bỏ viền dày 4px một phía (`border-l-4`).
   - Sử dụng card elevation thanh lịch (`rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm hover:shadow transition-shadow`).
   - Không có nút tạo/sửa chứng từ (thuần đọc).

4. **Sidebar Navigation**:
   - Thêm liên kết `/executive` ("Bàn điều hành CEO") cho vai trò `OWNER` / `CEO`.
   - Giữ nguyên không mở route `/audit-center` riêng biệt trên sidebar (công cụ bắt lệch và xuất Excel đã được tích hợp ngay trên `/dashboard`).

---

## 1. Project Objective

Implement two role-specific dashboards for TVK ERP, a warehouse, sales, and consignment management system specializing in truck spare parts and lubricants.

Both dashboards must share the same business data, backend services, inventory ledger, and financial calculations.

However, each dashboard must have a different information hierarchy, visualization strategy, and interaction model.

### 1.1. Dashboard Types

| Dashboard | Primary Purpose | Interaction |
|---|---|---|
| Admin Dashboard | Daily operational control and exception management | Read and authorized operational actions |
| CEO Dashboard | Executive analysis, financial performance, and business risk monitoring | Strictly read-only |

### 1.2. Core Requirements

- Reuse the existing application architecture.
- Preserve existing business logic.
- Preserve the immutable inventory ledger.
- Do not create duplicate financial calculation logic.
- Do not create separate databases for different dashboards.
- Implement role-based access control (RBAC).
- Support desktop, tablet, and mobile devices.
- Keep all user-facing labels in Vietnamese.
- Use English for source code identifiers and technical documentation.
- Do not generate mock business data in production.
- Do not rewrite unrelated modules.

---

## 2. Existing Business Context

TVK ERP manages:

- Truck spare parts and lubricants.
- Inventory tracked by SKU and batch/lot.
- TVK-owned inventory stored in TVK warehouses.
- TVK-owned inventory consigned to distributors (NPP).
- Supplier-owned inventory received on consignment.
- Direct sales.
- Distributor consumption reports.
- VAT invoices.
- Accounts receivable and payable.
- Inventory adjustments and returns.
- Immutable inventory ledger transactions.

### 2.1. Consignment Business Rules

When TVK sends inventory to an NPP:

1. Inventory is physically transferred to the distributor.
2. Ownership remains with TVK.
3. The transfer does not automatically generate sales revenue.
4. The distributor sells the products to end customers.
5. The distributor reports actual consumption.
6. TVK reconciles and validates the reported consumption.
7. Revenue and receivables are recognized according to the established business accounting rules.
8. VAT invoices are issued according to applicable invoicing requirements and the relevant transaction.
9. Distributor payments may occur at the end of a month or quarter.

**Critical:** Consumption reporting, reconciliation, revenue recognition, invoicing, and payment are separate business events.

The dashboard must not assume they always occur simultaneously.

### 2.2. VAT Invoice Modes

The system supports:

- `COMBINED`: Eligible direct-sale and consignment-consumption items may be included in a consolidated invoice.
- `SEPARATED`: Direct-sale and consignment-consumption items are invoiced separately.

Invoice presentation mode must not independently modify:

- Inventory ownership.
- Inventory quantities.
- Inventory valuation.
- Previously recognized revenue.
- Previously recorded COGS.
- Immutable ledger history.

Invoices must be created only when legally and operationally eligible.

---

# 3. Dashboard Architecture

## 3.1. Proposed Routes

| Route | Dashboard | Access |
|---|---|---|
| `/dashboard` | Admin Operations Dashboard | Authorized operational roles |
| `/executive` | CEO Executive Dashboard | OWNER, CEO, ACCOUNTING (Strictly read-only) |

Preserve existing routes wherever possible.
Do not break existing navigation or bookmarks.

### 3.2. Shared Architecture

Both dashboards must reuse:

- Authentication.
- Authorization.
- Data access services.
- Financial calculation services.
- Inventory aggregation services.
- Consignment reporting services.
- Chart components.
- KPI card components.
- Date filtering.
- Number and currency formatting.
- Loading, error, and empty states.

---

# 4. Global Design System

## 4.1. Visual Style

Use a modern, professional, light-theme enterprise dashboard.

Design characteristics:

- Clean layout.
- Minimal visual noise.
- High information density without overcrowding.
- Clear section hierarchy.
- Consistent semantic colors.
- Accessible typography.
- Subtle borders and shadows.
- Compact but readable data tables.

## 4.2. Semantic Color Palette

| Token | HEX | Usage |
|---|---|---|
| `revenue` | `#2563EB` | Revenue and sales (Blue) |
| `profit` | `#10B981` | Gross profit and profitability (Emerald) |
| `cogs` | `#F59E0B` | Cost of goods sold (Amber) |
| `receivable` | `#8B5CF6` | Accounts receivable (Violet) |
| `partnerInventory` | `#0EA5E9` | TVK inventory at distributors (Cyan / Sky-500) |
| `supplierConsignment` | `#0284C7` | Supplier-owned consignment (Sky-600, separated from COGS `#F59E0B`) |
| `danger` | `#EF4444` | Critical warnings and overdue items (Red) |
| `warning` | `#F97316` | Operational warnings (Orange) |
| `neutral` | `#64748B` | Secondary information (Slate) |
| `background` | `#F8FAFC` | Dashboard background |
| `surface` | `#FFFFFF` | Cards and panels |
| `border` | `#E2E8F0` | Borders and separators |

Use semantic tokens instead of scattering hardcoded colors across components.

## 4.3. Card Specifications

| Property | Value |
|---|---|
| Background | White (`bg-white`) |
| Border | 1px solid neutral border (`border border-slate-200/80`) |
| Border radius | 12px (`rounded-xl`) |
| Padding | 16–20px (`p-4` to `p-5`) |
| KPI value | 20–28px (`text-xl font-bold sm:text-2xl`) |
| KPI label | 11–12px uppercase (`text-xs font-medium uppercase tracking-wider`) |
| Section title | 16–18px font-bold |
| Card accent | Elegant card elevation with subtle shadow (`shadow-sm hover:shadow transition-shadow`); **NO thick 4px single-side border (`border-l-4`)** |
| Shadow | Subtle (`shadow-sm`) |

Do not use strong colored backgrounds for ordinary KPI cards.

---

# 5. Admin Operations Dashboard

**Route:** `/dashboard`

**Primary Goal:** Help authorized operational users identify problems, prioritize work, and execute permitted actions quickly.

## 5.1. Information Priority

The Admin Dashboard should prioritize:

1. Current operational status.
2. Pending actions.
3. Financial exposure.
4. Inventory exceptions.
5. Consignment reconciliation.
6. Recent business activity.

## 5.2. Admin KPI Cards

| ID | Vietnamese Label | Metric | Color |
|---|---|---|---|
| `netRevenue` | Doanh thu thuần | Net revenue for selected period | Blue |
| `grossProfit` | Lợi nhuận gộp | Gross profit for selected period | Emerald |
| `receivables` | Công nợ phải thu | Outstanding receivables at cutoff | Violet |
| `ownedInventory` | Giá trị hàng sở hữu | TVK-owned inventory at cost | Emerald |
| `pendingDocuments` | Chứng từ chờ xử lý | Pending document count | Neutral |

---

# 6. CEO Executive Dashboard

**Route:** `/executive`

**Access:** Strictly read-only for `OWNER`, `CEO`, `ACCOUNTING`

**Primary Goal:** Provide strategic insight into profitability, working capital, cash flow runway, distributor performance, and business risks.

## 6.1. Information Priority

The CEO Dashboard answers:

1. Is revenue and profitability growing?
2. What is our 14–30 day Cash Flow Runway (Liquidity Safety)?
3. How much capital is tied up in TVK-owned inventory?
4. Which distributors perform efficiently?
5. Are receivables becoming riskier?
6. Which product categories contribute the most profit?

## 6.2. Strategic KPI Cards

| ID | Vietnamese Label | Metric | Calculation Rule |
|---|---|---|---|
| `netRevenue` | Doanh thu thuần | Revenue for selected period | Sum of net sales |
| `grossProfit` | Lợi nhuận gộp | Gross profit | Revenue - COGS |
| `grossMargin` | Biên lợi nhuận gộp | Gross profit / net revenue | Gross Profit / Net Revenue × 100 (if revenue <= 0, return "—") |
| `inventoryCapital` | Vốn tồn kho TVK | TVK-owned inventory at cost | TVK Warehouse + Partner Consignment at lot cost |
| `overdueRatio` | Tỷ lệ công nợ quá hạn | Overdue / outstanding | Overdue / Total Receivables × 100 (if total <= 0, return "—") |
| `inventoryTurnover` | Vòng quay tồn kho | Period COGS / inventory capital | Period COGS / Inventory Capital (if capital <= 0, return "—") |

### Edge Cases

- If a denominator is zero or negative, return `null` or "—". Never display `0%` or fabricated percentages.

## 6.3. Cash Flow Runway Widget (Dự báo Dòng tiền 14–30 ngày)

- **Input:** Inflow (gara receivables maturing in 14/30 days) vs Outflow (supplier payables for sold consignment maturing in 14/30 days).
- **Output:** Net Cash Flow (VNĐ), Coverage Ratio (%), Liquidity Safety Badge (`SAFE` / `WARNING` / `DANGER`), and operational recommendation.

## 6.4. Financial Trends Chart

- **Component:** ComposedChart (SVG)
- **Data:** Net Revenue (Bar, Blue), COGS (Bar, Amber), Gross Margin % (Polyline/Path, Emerald).
- **Timeframes:** Month, Quarter, Year, 30 days, All time.

## 6.5. Inventory Capital Analysis

- **Component:** Single-Ring Concise Donut Chart (Donut đơn vòng tinh gọn)
- **Segments:** Kho TVK (Emerald) vs Kho đối tác (Sky/Cyan).
- **Center Label:** Total TVK-owned inventory value at cost.
- **Breakdown Table:** Location, Qty, Lot count, Capital value, Percentage share.
- **Rule:** Do NOT use multi-ring donuts on the executive dashboard.

## 6.6. Receivables Aging Risk

- **Component:** Horizontal Bar Chart
- **Buckets:**
  - Chưa đến hạn (`not_due`): Emerald
  - 1–30 ngày (`1_30`): Amber
  - 31–60 ngày (`31_60`): Orange
  - >60 ngày (`over_60`): Red

## 6.7. Distributor Performance

- Consignment Consumption Rate (%) and TVK capital held (VNĐ) per distributor.

## 6.8. Top Product Categories by Gross Profit

- Ranking product categories by gross profit contribution, showing revenue, COGS, quantity, and gross margin %.

## 6.9. CEO Dashboard Layout

```text
CEO EXECUTIVE DASHBOARD (/executive)
│
├── Header
│   ├── Page Title & Strictly Read-Only Badge
│   └── Period Selector (Tháng này, Quý này, Năm nay, 30 ngày, Tất cả)
│
├── Strategic KPI Row (6 cards, elegant elevation, no 4px border)
│   ├── Net Revenue
│   ├── Gross Profit
│   ├── Gross Margin (%)
│   ├── Inventory Capital (TVK-owned at cost)
│   ├── Overdue Ratio (%)
│   └── Inventory Turnover (vòng)
│
├── Cash Flow Runway Widget
│   ├── Liquidity Status Badge (SAFE / WARNING / DANGER)
│   ├── Operational Recommendation Banner
│   ├── 14-Day Urgent Cash Flow Projection (Inflow vs Outflow -> Net)
│   └── 30-Day Monthly Cash Flow Projection
│
├── Financial Trends Chart (ComposedChart)
│   └── Revenue / COGS / Margin % Trends
│
├── Capital & Risk Analysis
│   ├── Single-Ring Inventory Capital Donut & Detailed Breakdown Table
│   └── Receivables Aging Risk (4 buckets)
│
└── Partner & Product Analytics
    ├── Distributor Performance (Consumption % & Capital Held)
    └── Top Product Categories Ranked by Gross Profit
```

---

# 7. Navigation Requirements

- Sidebar includes link to `/executive` (labeled "Bàn điều hành CEO") for `OWNER` and `CEO` roles.
- Route `/audit-center` is NOT exposed as a separate sidebar link as reconciliation and export tools are integrated directly on `/dashboard`.
- Mobile navigation drawer includes the `/executive` link for authorized roles and closes upon navigation.

---

# 8. Role-Based Access Control

- `/executive` route is strictly read-only and restricted to `OWNER`, `CEO`, `ACCOUNTING`.
- Unauthorized roles (such as `SALES` or `WAREHOUSE`) are automatically redirected to `/dashboard`.
- There are NO create, update, or delete buttons anywhere on the CEO dashboard.

---

# 9. Verification & Acceptance Criteria

- [x] Route `/executive` compiles and renders cleanly without TypeScript errors.
- [x] Strategic KPI row contains 6 core metrics with zero-denominator handling returning "—".
- [x] Cash Flow Runway 14–30 day widget displays net cash flow and safety status.
- [x] Financial trends chart renders with correct SVG paths.
- [x] Inventory capital analysis uses single-ring concise donut and detailed breakdown table.
- [x] Receivables aging is split into 4 distinct overdue buckets.
- [x] Distributor performance tracks consumption rate and capital held.
- [x] Top product categories are ranked by gross profit.
- [x] Semantic color token `supplierConsignment` (`#0284C7`) is separated from `cogs` (`#F59E0B`).
- [x] Sidebar navigation shows `/executive` for `OWNER`/`CEO` and does not include `/audit-center`.
- [x] All 27 Next.js static and dynamic routes build successfully.
