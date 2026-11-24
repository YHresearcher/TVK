# TVK V2.0 P5 — Reporting (Báo cáo theo ngành)

Tài liệu thiết kế + kiểm chứng cho báo cáo/dashboard tách theo ngành
(Dầu nhớt / Phụ tùng). Thuộc P5 của prompt `Prompt-TVK-V2.0-FINAL.md`
(§17 Reporting and Dashboards, §18.1 nhãn ngành, E8, BL-020).
Báo cáo triển khai đầy đủ: `docs/business-lines/IMPLEMENTATION-REPORT.md`
(mục P5).

## 1. Một định nghĩa duy nhất cho mọi KPI (§17.6)

Mọi số tiền trong dashboard/báo cáo dùng chung một định nghĩa, tính ở
database (view), không cộng tay ở app theo hai cách khác nhau:

| KPI | Định nghĩa (chuẩn) | Nguồn |
|---|---|---|
| Doanh thu thuần | `GREATEST(SUM(line_total) − discount_amount, 0)` theo chứng từ đã xác nhận | `v_sales_doc_totals` |
| Giá vốn | `SUM(qty × unit_cost)` theo **lô thực tế đã xuất** (`COALESCE(batch_id, allocation_lines.batch_id)` → `stock_batches.unit_cost`) | `v_sales_doc_totals` |
| Lãi gộp | Doanh thu thuần − giá vốn | `v_sales_by_line` |
| Doanh thu theo nhóm hàng | `SUM(line_total)` **GỘP trước chiết khấu** (giữ nguyên ý nghĩa cũ của `getGroupPerformance`) | `v_group_performance_by_line` |
| Dư nợ phải thu / phải trả | `amount − amount_paid`, trạng thái UNPAID/PARTIAL (suy từ `payment_allocations`, P4a) | `v_debt_by_line` |
| Giá trị tồn kho | `SUM(qty × unit_cost)` theo lô, chỉ hàng TVK sở hữu | `v_inventory_value_by_line` |

Hai điểm dễ nhầm đã ghi rõ trong code:

- **Doanh thu thuần ≠ doanh thu gộp.** Tổng thuần toàn doanh nghiệp là
  1.750.000đ trong dữ liệu kiểm chứng, tổng gộp là 1.800.000đ — chênh
  đúng 50.000đ là chiết khấu của BH-VAT-0001. `getPerformanceSeries`
  (biểu đồ Doanh thu – Giá vốn – Lãi) dùng doanh thu **thuần**.
  `getGroupPerformance` (doanh thu theo nhóm hàng) dùng doanh thu
  **gộp** như từ trước tới nay.
- **`getPerformanceSeries` đổi nguồn, không đổi định nghĩa.** Trước P5
  hàm này đọc header `total_amount`; `confirm_sales_document` (0019)
  đã ghi `total_amount = subtotal − discount_amount` nên giá trị kỳ
  vọng khớp với định nghĩa view. Khác biệt duy nhất: (a) chứng từ có
  `total_amount` lưu sẵn lệch tổng dòng thì nay lấy theo tổng dòng,
  (b) kỳ dài trên 2000 chứng từ trước đây bị cắt ngắn âm thầm (E8),
  nay đủ số.

## 2. View tổng hợp (migration 0030)

10 view, tất cả `security_invoker = true` (chạy theo quyền người gọi,
RLS bảng gốc áp dụng), `GRANT SELECT TO authenticated`. Chỉ tạo view —
không đổi dữ liệu, không thêm cột/bảng.

| View | Nội dung | Ghi chú |
|---|---|---|
| `v_sales_doc_totals` | Từng chứng từ đã xác nhận: doanh thu thuần, giá vốn, lãi | Định nghĩa chuẩn §1 |
| `v_sales_by_line` | Doanh thu/giá vốn/lãi/số đơn/số lượng theo ngành + bản 30 ngày (doc_date ≥ CURRENT_DATE − 29) | 3 hàng: OIL / AUTO_PARTS / NULL (chưa phân loại) |
| `v_daily_revenue_by_line` | Doanh thu thuần + giá vốn theo ngày × ngành | Nguồn cho biểu đồ hiệu quả kinh doanh |
| `v_product_sales_30d` | Sản phẩm × 30 ngày / lũy kế | Chỉ tính dòng của chứng từ đã xác nhận (dòng DRAFT không lọt vào lũy kế — đã có hồi quy trong file kiểm chứng) |
| `v_group_performance_by_line` | Nhóm hàng × ngành, doanh thu gộp | |
| `v_debt_by_line` | Phải thu/phải trả × ngành: còn nợ / chưa trả / trả một phần / quá hạn / số khoản | |
| `v_inventory_value_by_line` | Giá trị tồn kho theo giá vốn: kho TVK / tại đối tác / ký gửi giữ hộ | |
| `v_partner_consignment_by_line` | Đối tác × ngành: đã gửi / đã tiêu thụ / đã trả lại / còn giữ / phải thu | Cộng theo ngành = đối soát hợp nhất `v_partner_consignment` |
| `v_consignment_flow_by_line` | Đã gửi theo phiếu GK đã xác nhận | Phiếu nháp không tính |
| `v_stock_movements_with_line` | Sổ cái + ngành của lô (qua `v_batches_for_sales`) | Lô không quy chiếu được (đã xuất hết / ngoài quyền) → ngành NULL, giống hành vi app từ P2 |

Post-check trong 0030: thiếu view nào thì `RAISE EXCEPTION` + báo số
hàng `v_sales_by_line` / `v_debt_by_line` / `v_inventory_value_by_line`.

## 3. Hành vi theo vai trò (đã kiểm chứng trên DB scratch)

- **OWNER / CEO**: thấy đủ 3 hàng ngành trong `v_sales_by_line`,
  `v_debt_by_line`; sổ cái quy chiếu đúng ngành từng bút toán.
- **SALES**: đọc `v_sales_by_line` vẫn thấy doanh thu (SALES vốn đã
  đọc được `sales_documents`/`sales_document_lines` trực tiếp) nhưng
  **giá vốn = 0 khắp nơi** (không rò giá vốn qua view), **không thấy
  phải trả** qua `v_debt_by_line`, **không thấy giá trị tồn kho** qua
  `v_inventory_value_by_line`. App không gọi các view tiền cho SALES
  (gate `canSeeMoney`/`canSeeCost` giữ nguyên ở mọi trang).
- **Tài khoản chỉ gán 1 ngành** (vd chỉ OIL): sổ cái chỉ quy chiếu
  được bút toán ngành đó, bút toán ngành còn lại hiện ngành NULL.
- **Tài khoản không có hồ sơ (ghost)**: thấy dòng sổ cái nhưng không
  quy chiếu được ngành nào.
- Hàng **chưa phân loại** (business_line_id NULL) luôn nằm trong số
  toàn doanh nghiệp (ALL) nhưng không nằm trong số của ngành nào —
  `checkLineTotals` (BL-020) trả chênh lệch đúng bằng phần chưa phân
  loại, UI ghi rõ thay vì giấu.

## 4. App code (P5)

- `src/lib/reporting.ts` (mới, hàm thuần): `sumSalesByLine`,
  `sumDebtByLine`, `buildLineComparison` (OIL / AUTO_PARTS / ALL +
  hàng "Chưa phân loại" riêng khi có dữ liệu NULL),
  `mergeGroupPerformance`, `businessLineLabel` (§18.1),
  `checkLineTotals` (BL-020: trả `diff`/`matches`).
- `src/lib/queries.ts`: `fetchAllPages` (phân trang range, thứ tự ổn
  định, throw khi lỗi — "validated pagination" theo E8),
  `chunkIds` (danh sách IN tối đa 200 id); hàm đọc view
  `getSalesByLine`, `getDebtByLine`, `getInventoryValueByLine`,
  `getConsignmentFlowByLine`, `getLineComparison`;
  `getDashboard(lineId?)` viết lại theo E8 — số tiền tổng lấy từ view
  (không giới hạn dòng), phần tử theo dòng lấy bằng `fetchAllPages`,
  **giữ nguyên hình dạng object trả về**; tồn kho trong `getDashboard`
  nay lọc theo ngành đang chọn bằng `.eq("business_line_id")` ở DB
  (trước đây không lọc — OWNER xem một ngành vẫn thấy tồn kho toàn
  doanh nghiệp); `getPerformanceSeries(from, to, lineId?)` đọc
  `v_daily_revenue_by_line`; `getGroupPerformance(lineId?)` đọc
  `v_group_performance_by_line`; `listLedgerMovements(limit, lineId?)`
  đọc `v_stock_movements_with_line` + đếm tổng bằng DB, trả thêm
  `total`; `lineId?` thêm cho `getPartnerDetail`,
  `getPartnerConsignmentGoods`, `getSlowMoving`,
  `getInventoryValueByGroup`, `getReceivableAgingBars`,
  `getPartnerConsignmentBars` (đọc `v_partner_consignment_by_line`),
  `getPartnerRemainingEstimates`.
- Lỗi DB: `getDashboard`/`getPerformanceSeries` để lỗi view lan ra
  (throw) để số tiền sai không hiện như số đúng; widget phụ
  (slow-moving, aging, consignment bars…) giữ hành vi cũ là trả rỗng;
  `listLedgerMovements` trả rỗng + `total: 0` khi lỗi (trang sổ cái
  không sập khi DB chưa chạy 0030).

## 5. Giao diện

- **Tổng quan (dashboard)**: `lineFilter` truyền vào mọi truy vấn
  L3/L4. Ở chế độ ALL, tầng L1 (chỉ Chủ/Kế toán/CEO) thêm bảng
  **"So sánh theo ngành"** (doanh thu/lãi/tồn kho/dư nợ từng ngành +
  tổng) và **"Công nợ theo ngành"** (phải thu/phải trả từng ngành +
  tổng), kèm ghi chú BL-020 (tổng các ngành = toàn doanh nghiệp, hoặc
  chênh lệch đúng bằng phần chưa phân loại). Khi đã chọn 1 ngành thì
  các số trên trang đã là của ngành đó nên 2 bảng này ẩn đi.
- **Báo cáo** (`/reports`): mục đầu **"Doanh thu, lãi và tồn kho theo
  ngành"** (chỉ Chủ/Kế toán/CEO, chỉ chế độ ALL) + ghi chú BL-020.
- **Executive** (`/executive`): mục **"So sánh theo ngành"** (CEO chỉ
  đọc) + link sang `/reports`.
- **Chi tiết đối tác**: filter pills `?line=` (Tất cả / Dầu nhớt /
  Phụ tùng); đối soát/phải thu/hàng ký gửi lọc theo ngành đã chọn.
- **Lịch sử kho** (`/ledger`): hiện "đang hiện X / tổng Y bút toán".

## 6. Kiểm chứng

- **DB scratch PostgreSQL 16** (`docs/tests/p5_reporting_local.sql`,
  chạy bằng `/tmp/tvk-p5-verify/run-all.sh` — chuỗi 0001–0029 + seed
  + 0030 + file kiểm chứng): **16/16 PASS** (R5-01→R5-14): đủ 10
  view + `security_invoker` + grants; giá trị từng view đã đối chiếu
  tay (AUTO 1.100.000đ / OIL 550.000đ / chưa phân loại 100.000đ;
  phải thu 1.900.000đ / phải trả 2.650.000đ; tồn AUTO 10.500.000đ /
  OIL 2.400.000đ); **BL-020**: tổng theo ngành = tổng hợp, đối chiếu
  độc lập bằng truy vấn trực tiếp; sổ cái theo OWNER / user chỉ-OIL /
  ghost; rào chắn SALES (§3); bất biến tài chính sau 0030.
- **E2E**: 87/87 pass (Tier 1–3: 55 + Tier 5: 32/32, gồm 8 test P5
  mới `BL-020-…`/`P5: …`); Tier 4 vẫn SKIP (không có
  `user-accounting-sample.csv`).
- **Gate**: `tsc --noEmit` 0, `next lint` 0, `next build` 0 (chạy độc
  lập 2 lần: subagent P5 + lead kiểm tra lại).

## 7. Hạn chế đã biết (P5 — đã xử lý ở P6)

- ~~Chưa chạy thử với DB thật có 0030 (chỉ biên dịch + build + DB
  scratch): số liệu dashboard/báo cáo trên DB thật cần kiểm tra ở
  P6 rehearsal (chạy 0030 trên staging rồi đối chiếu số).~~ → **P6:
  đã chuẩn bị runbook rehearsal đầy đủ**
  (`docs/business-lines/STAGING-REHEARSAL.md` + `RELEASE-CHECKLIST.md`
  + `ROLLBACK-PLAN.md`); **chưa chạy** — việc tạo staging + chạy
  rehearsal cần chủ quyết phương pháp và gật đầu.
- ~~`getSalesDocumentCosts` (cột Giá vốn/Lãi gộp trang Bán hàng) vẫn
  dùng `.limit(20000)` trên `sales_document_lines` theo từng đợt
  chứng từ của trang — không nằm trong danh sách E8 nêu tên
  (getDashboard / listLedgerMovements / getGroupPerformance) nên giữ
  nguyên; ứng viên cho P6 hardening.~~ → **P6 ĐÃ XONG:** kéo toàn bộ
  dòng bằng `fetchAllPages` theo từng chunk 200 chứng từ (thứ tự
  document_id, id); `.in()` phân bổ/lô cũng chunk 200 id. Lỗi DB ném
  ra theo quy ước P5/E8.
- ~~`getPartnerRemainingEstimates` vẫn giữ `.limit(500/5000)` cũ
  (phiếu GK, dòng GK) — ngoài phạm vi P5.~~ → **P6 ĐÃ XONG:** tồn kho
  tại đối tác + phiếu GK + dòng GK + sản phẩm đều kéo bằng
  `fetchAllPages` (thứ tự ổn định); dòng GK theo từng chunk 200 phiếu.
  (Kèm theo: truy vấn sản phẩm trong hàm này trước đây không đặt
  giới hạn — PostgREST mặc định chỉ trả 1000 dòng — nay cũng kéo đủ.)
- ~~`getMonthlyCashflowSummary` (báo cáo dòng tiền theo tháng, code
  gốc) vẫn đọc `sales_documents.total_amount` với `.limit(3000)` —
  ngoài phạm vi P5; ứng viên cho P6.~~ → **P6 ĐÃ XONG:** dòng tiền +
  chứng từ kéo bằng `fetchAllPages`; dòng chứng từ theo từng chunk
  200 chứng từ; phân bổ/lô chunk 200 id.
- Hạn chế **còn lại sau P6** (không thuộc 3 hàm trên): `listPartnerStats`
  (cửa sổ thống kê nhanh từng đối tác ở dashboard) vẫn dùng
  `.limit(500/2000)` — chỉ là số thống kê nhanh, không phải số tiền
  báo cáo chính thức; ứng viên cho đợt cứng hoá sau, không chặn
  phát hành.
- Biểu đồ "Doanh thu theo cấp nhớt / theo thương hiệu" (§17.3/17.4,
  E10) chưa làm: `sae_viscosity`/`brand` là text tự do, cần quy tắc
  chuẩn hoá trước khi vẽ — chưa có quy tắc này.
- BL-014 (workflow phê duyệt tách tỷ lệ cho khoản chưa phân loại)
  vẫn chỉ có view hàng đợi (từ P4) — không đổi trong P5.
