# TVK V2.0 P1 — Implementation Report (Báo cáo triển khai P1)

Ngày: 23/11/2026. Prompt: `Prompt-TVK-V2.0-FINAL.md` (§20 P1, §5, §6, §15).
Nhánh: `feature/tvk-v2-business-lines` (từ `origin/main` @ `d7f6f34`).
Baseline Preflight: 24 migrations; live 46 phụ tùng / 0 dầu; 0019 ✅, 0020 một
phần, 0023 ✅, 0024 ✅ (chạy live 23/11 16:51); E2E 55/55 pass + Tier 4 skipped.

## 1. Thay đổi đã làm

### Migration mới

| File | Nội dung |
|---|---|
| `supabase/migrations/0025_business_lines.sql` | Toàn bộ P1 ở tầng database (xem §2) |

### Code app mới / sửa

| File | Thay đổi |
|---|---|
| `src/lib/types.ts` | Thêm `BusinessLineCode`, `BusinessLine`, `BUSINESS_LINE_LABELS`, `userHasBusinessLineAccess()` (quy tắc tương thích P1) |
| `src/lib/business-lines.ts` (mới) | `listBusinessLines()`, `getUserBusinessLineIds()`, `getMyBusinessLineIds()`, `canChangeProductBusinessLine()`, `listUnclassifiedProducts()` |
| `src/lib/actions.ts` | Thêm 3 server action OWNER-only: `assignUserBusinessLineAction`, `revokeUserBusinessLineAction`, `updateProductBusinessLineAction` |

### Kiểm chứng database local

| File | Vai trò |
|---|---|
| `docs/tests/p1_seed_local.sql` (mới) | Seed giả lập trạng thái live trước 0025 (7 sản phẩm, 2 lô, 9 chứng từ, 1 receivable + 1 payment) |
| `docs/tests/p1_business_lines_local.sql` (mới) | Assertions A–J sau 0025 (mẫu theo `p0_sales_view_rls_local.sql`) |

### Tài liệu (§23 — phần P1)

| File | Nội dung |
|---|---|
| `docs/business-lines/DATABASE-DESIGN.md` | Schema P1 |
| `docs/business-lines/ACCESS-CONTROL.md` | Phân quyền ngành P1 + câu hỏi mở |
| `docs/business-lines/HISTORICAL-MIGRATION.md` | Backfill, kiểm toán, bất biến tài chính, rollback |
| `docs/business-lines/MIGRATION-DEPENDENCIES.md` | Phụ thuộc 0001–0024, thứ tự áp dụng |
| `docs/business-lines/IMPLEMENTATION-REPORT.md` | File này |

Các tài liệu §23 còn lại (PRD, ARCHITECTURE, SCHEMA-AUDIT, INVENTORY-RULES,
SALES-AND-CONSIGNMENT, SETTLEMENT-AND-PAYMENTS, PAYMENT-REVERSAL, VAT-DESIGN,
CASH-FUND-DESIGN, RECONCILIATION, REPORTING, TEST-PLAN,
FINANCIAL-VALIDATION, ROLLBACK-PLAN, RELEASE-CHECKLIST) thuộc P2–P6, chưa viết.

### Hướng dẫn vận hành

`HUONG-DAN-VAN-HANH.md`: thêm mục ngành hàng ở PHẦN E (phân quyền ngành,
đổi ngành sản phẩm, hàng đợi chưa phân loại).

## 2. Nội dung migration 0025

1. `business_lines` (seed OIL/AUTO_PARTS) + RLS (đọc: mọi authenticated;
   ghi: OWNER) + grants.
2. `user_business_lines` + RLS (xem: chính mình hoặc OWNER/CEO; gán/xoá:
   OWNER; không policy UPDATE) + grants.
3. Hàm `user_can_access_business_line(uuid, uuid)` (SECURITY DEFINER) —
   quy tắc tương thích P1 (xem ACCESS-CONTROL.md §2).
4. `business_line_group_mappings` (mapping tường minh nhóm → ngành, seed 3
   dòng đã phê duyệt) + RLS (ghi: OWNER).
5. `products.business_line_id` (nullable) + backfill theo giá trị
   `product_group` (khớp chính xác, không heuristic tên hàng) + bảng kiểm toán
   `product_business_line_audit` (append-only) + view hàng đợi
   `v_unclassified_products` + báo cáo phân loại (NOTICE/WARNING).
6. `business_line_id` (nullable) trên 7 bảng chứng từ (không có trên
   `sales_orders`) + backfill từ dòng (chỉ khi mọi dòng cùng một ngành;
   hỗn hợp → NULL) + báo cáo từng bảng.
7. Guard `tvk_guard_product_business_line()` (BL-016): cấm đổi ngành khi đã
   có giao dịch/tồn kho; ghi kiểm toán cho thay đổi được phép.
8. Guard `tvk_guard_line_business_line()` (7 trigger trên bảng dòng) và
   `tvk_guard_header_business_line()` (7 trigger trên bảng chứng từ):
   cấm trộn ngành — chỉ khi cả hai phía đã gán (NULL-tolerant ở P1).
9. `v_batches_for_sales` định nghĩa lại theo §6.5: giữ guard 0024, thêm lọc
   phân quyền ngành, append 2 cột ở cuối (`business_line_id`,
   `business_line_code`).
10. Kiểm chứng cuối migration: in số lượng bảng tài chính + sổ cái để đối
    chiếu trước/sau (không fail deploy vì dữ liệu lạ).

## 3. Kết quả kiểm chứng

### Database local (PostgreSQL 16, database scratch — KHÔNG phải live)

Quy trình: database trống → áp 0001–0024 (exit 0 cả 24 file) → seed
`p1_seed_local.sql` (exit 0; baseline payables 0 / receivables 1 /
payments 1 / movements 0 / products 7) → áp 0025 → chạy
`p1_business_lines_local.sql`.

- Lần chạy 0025 đầu tiên **fail** ở backfill chứng từ:
  `function min(uuid) does not exist` (Postgres không có `min()` cho UUID).
  Đã sửa: dùng `(array_agg(p.business_line_id))[1]` (HAVING đã đảm bảo chỉ
  có đúng 1 giá trị phân biệt). Chạy lại **exit 0**.
- Migration 0025 in đúng báo cáo: phân loại 7 = OIL 2 / AUTO_PARTS 3 /
  chưa phân loại 2 (nhóm lạ: `(NULL)`, `Nhóm lạ XYZ`); backfill chứng từ
  7 gán / 2 hỗn hợp ở lại NULL; bất biến tài chính 0/1/1/0 không đổi.
- File kiểm chứng **`p1_business_lines_local.sql`: exit 0, PASS A–J toàn bộ**:
  - A: phân loại đúng, bẫy tên `Lọc dầu`/`Lọc nhớt` → AUTO_PARTS, audit = 5.
  - B: backfill chứng từ đúng (7 gán, 2 hỗn hợp NULL).
  - C: bất biến tài chính (0/1/1/0) + số tiền receivable không đổi.
  - D: guard bất biến phân loại BL-016 (chặn khi có giao dịch; cho + kiểm toán khi chưa có).
  - E: guard dòng-chứng từ (lệch ngành chặn; header NULL cho qua).
  - F: guard đổi ngành chứng từ.
  - G: hàm `user_can_access_business_line` (OWNER/CEO tất cả; OIL-only bị chặn AUTO_PARTS; chưa gán thấy tất cả; ghost bị chặn; NULL cho qua).
  - H0–H5: view theo role (không JWT 0 dòng; OIL-only 1 dòng OIL; chưa gán 2 dòng; CEO 2; OWNER 2; không profile 0; không cột giá vốn).
  - I1–I3: RLS (SALES không tự gán, không tạo ngành; vẫn đọc được danh mục).
  - J: cấu trúc (`sales_orders` không có cột; đúng 8 bảng có cột).

### Gate build (repo local, nhánh feature)

| Gate | Kết quả |
|---|---|
| `npx tsc --noEmit` | exit 0 |
| `npx next lint` | exit 0 — No ESLint warnings or errors |
| `npx next build` | exit 0 |
| `npm run test:e2e` | exit 0 — Tier 1: 42/42, Tier 2: 8/8, Tier 3: 5/5, **tổng 55/55 pass**; Tier 4 SKIPPED (không có file mẫu, như baseline Preflight) |

## 4. P1 Exit Gate — ĐẠT (với 2 lưu ý)

| Điều kiện (§20) | Trạng thái |
|---|---|
| Correct product classifications | ✅ Backfill theo mapping tường minh; kiểm chứng A + báo cáo migration |
| Correct authorization | ✅ RLS + hàm + view kiểm chứng G/H/I; server actions OWNER-only |
| No financial changes | ✅ Số lượng + số tiền tài chính không đổi (mục C); migration không đụng bảng tài chính |
| No unintended data exposure | ✅ View không lộ giá vốn; OIL-only không thấy AUTO_PARTS; ghost/không-JWT 0 dòng |
| Existing application remains functional | ✅ tsc/lint/build exit 0; E2E 55/55; guards NULL-tolerant nên luồng cũ (chưa ghi ngành) vẫn chạy |

**Lưu ý 1 — Migration 0025 CHƯA chạy trên database thật nào ngoài local
scratch.** Database local là PostgreSQL 16 cài mới, áp 0001–0025 + seed giả
lập. Theo prompt §21.5/§21.6, trước khi chạy 0025 lên live phải chạy lại trên
**staging** (bản sao dữ liệu live) và đối chiếu bất biến tài chính. Không tự
chạy lên live trong P1.

**Lưu ý 2 — Tier 4 E2E vẫn SKIPPED** (cần file `user-accounting-sample.csv`
từ máy Windows của chủ cửa hàng). 5 scenario replay chưa được kiểm chứng bằng
dữ liệu thật — chặn duy nhất còn lại từ Preflight, không thuộc phạm vi P1.

## 5. Hạn chế đã biết (P1)

- `products.business_line_id` và header `business_line_id` còn NULLABLE;
  `NOT NULL` chỉ siết ở P2 khi form đã ghi được ngành.
- User chưa gán ngành nào vẫn thấy toàn bộ (tương thích P1) — siết bắt buộc
  gán thuộc P2, cần quyết định của chủ (xem ACCESS-CONTROL.md §7).
- Chưa có UI quản lý phân quyền ngành (P2); mới có server actions nền tảng.
- Chưa có test BL-001–BL-023 đầy đủ trong suite TS in-memory — các test
  BL-001/BL-002/BL-016 mức database đã có trong file SQL P1; BL còn lại
  thuộc P2–P4 theo roadmap.
- `v_unclassified_products` là view đọc (hàng đợi) — chưa có quy trình
  phê duyệt phân loại thủ công trong app (P2).

## 6. Quyết định cần chủ cửa hàng (CẦN XÁC NHẬN)

1. Khi nào siết "không gán = không thấy gì"? (P2; khuyến nghị sau khi OWNER
   gán xong 5 tài khoản hiện có.)
2. Gán mặc định cho 5 tài khoản hiện có hay OWNER gán tay từng người?
3. (Từ Preflight) File `user-accounting-sample.csv` để chạy Tier 4 đầy đủ.

## 7. Production readiness (P1)

**Chưa sẵn sàng deploy production.** P1 mới xong tầng database + helpers
trên nhánh feature. Cần trước khi merge/deploy: chạy 0025 trên staging (bản
sao live) + đối chiếu tài chính + smoke test app trên staging. Không merge
vào main trong P1 (theo §0.2: không merge trực tiếp vào main khi chưa review
và kiểm chứng).

---

# TVK V2.0 P2 — Implementation Report (Báo cáo triển khai P2)

Ngày: 23/11/2026. Prompt: `Prompt-TVK-V2.0-FINAL.md` (§20 P2, §5, §6, §7,
§9, §10, §18). Nhánh: `feature/tvk-v2-business-lines` (tiếp sau commit
P1 `4964689`). Quyết định của chủ (đã chốt 23/11 20:18): **gán mặc định 5
tài khoản hiện có đều thấy Phụ tùng (AUTO_PARTS), rồi siết lại fail-closed
(chưa gán = không thấy gì; OWNER/CEO thấy tất cả)**.

## P2.1. Thay đổi đã làm

### Migration mới

| File | Nội dung |
|---|---|
| `supabase/migrations/0026_default_assignments_fail_closed.sql` | Toàn bộ P2 ở tầng database (xem P2.2) |

### Code app mới / sửa

| File | Thay đổi |
|---|---|
| `src/lib/business-lines.ts` | Thêm `BUSINESS_LINE_COOKIE`, `BusinessLineContext`/`getBusinessLineContext()`, `resolveWriteLine()`, `getLineByCode()`, `getLineLabelById()`, `getGroupLineId()`, `assertGroupMatchesLine()`, `getProductLineMap()`, `assertProductsInLine()`, `assertBatchesInLine()`, `listGroupLineMappings()`, `listUserBusinessLines()`; `userHasBusinessLineAccess()` đổi sang fail-closed |
| `src/lib/types.ts` | `userHasBusinessLineAccess()` fail-closed (chưa gán = false; NULL cho qua hàng đợi chưa phân loại; OWNER/CEO luôn true) |
| `src/lib/product-match.ts` | Thêm `isOilLineCode()`, `isExpiredBatch()`, `splitByBusinessLine()`; giữ `isOilGroup` để tương thích ngược |
| `src/lib/actions.ts` | `setBusinessLineContextAction()` (đổi ngành phiên làm việc); `requireHeaderBusinessLine()`; mọi action tạo/xác nhận chứng từ đều giải quyết ngành ghi + chặn lệch ngành; `createSaleFromForm` tách theo (tính chất, ngành) tối đa 4 chứng từ + chia giảm giá theo tỷ lệ; import bán/BT/PB tách theo ngành; import nhập/GK từ chối file trộn ngành; FEFO theo `business_line_code` + chặn bán lô dầu hết hạn (BL-006) |
| `src/lib/queries.ts` | `list()` thêm tham số `lineId` (null → trả rỗng, không truy vấn); 8 hàm `list*` nhận `lineId?`; `listPayables`/`listReceivables` lọc theo ngành của chứng từ nguồn; `getDashboard(lineId?)` lọc theo ngành; `listLedgerMovements(limit, lineId?)`; `DocumentDetail.business_line_id` |
| `src/lib/detail-actions.ts` | `getDocumentDetailAction` chặn DOC/SLIP lệch ngành (BL-001); hoá đơn (INV) chưa có cột ngành nên được miễn — P4 BL-015 |
| `src/components/BusinessLineSwitcher.tsx` (mới) | Bộ chuyển ngành ở sidebar: NONE → cảnh báo; 1 ngành → huy hiệu tĩnh; OWNER/CEO → ô chọn (Toàn doanh nghiệp + từng ngành) |
| `src/components/NoBusinessLineNotice.tsx` (mới) | Thông báo "tài khoản chưa được gán ngành" cho các trang khi NONE |
| `src/components/Sidebar.tsx`, `src/components/MobileTopBar.tsx`, `src/app/(dashboard)/layout.tsx` | Layout tải context một lần, truyền xuống Sidebar + MobileTopBar (nhãn ngành trên mobile) |
| Trang: products, products/[id], inventory, stock-in, sales, consignment-out, partner-consumption, partner-consumption/allocations/[id], returns, ledger, dashboard, receivables, payables, settings | Tải context, lọc danh sách theo ngành, cột "Ngành" ở bảng chính, trường ngành trên form tạo/import (ẩn khi LINE, ô chọn khi ALL), cảnh báo hết hạn dầu ở Tồn kho (§7.3), thẻ quản lý phân quyền + hàng đợi chưa phân loại ở Cài đặt |
| `src/components/ImportExcel.tsx`, `src/components/ImportConsignmentOut.tsx` | Thêm `lineContext` + trường ngành vào payload |
| `src/app/api/export/route.ts` | Tham số `?line=` (OIL/AUTO_PARTS/ALL; mặc định ALL); NONE → 403; xin ngành khác khi đang LINE → 403; 2 view có cột ngành được lọc; 3 view tổng hợp ký gửi luôn xuất hợp nhất (chưa có phân bổ theo ngành — P5) |
| `scripts/e2e/tier5-business-lines.test.ts` (mới) | 8 test BL-003/004/005/006/007/008 cho hàm thuần; `scripts/verify-e2e.ts` chạy Tier 5 sau Tier 4 |

### Kiểm chứng database local

| File | Vai trò |
|---|---|
| `docs/tests/p2_setup_local.sql` (mới) | Stub `auth` schema + `auth.uid()` cho PostgreSQL 16 thuần (khớp mẫu `p0_sales_view_rls_local.sql`) |
| `docs/tests/p2_seed_local.sql` (mới) | Seed 5 tài khoản thật (UUID live) + 3 tài khoản kiểm chứng (chưa gán / chỉ-dầu / đã tắt) + ghost UUID |
| `docs/tests/p2_operational_local.sql` (mới) | Assertions A–H sau 0026 (mẫu theo file kiểm chứng P1) |

### Hướng dẫn vận hành

`HUONG-DAN-VAN-HANH.md`: mục ngành hàng ở PHẦN E cập nhật theo P2
(siết fail-closed, bộ chuyển ngành, tách chứng từ khi bán chung, chặn lô
dầu hết hạn, xuất Excel theo ngành).

## P2.2. Nội dung migration 0026

1. **Seed gán mặc định** 5 tài khoản → AUTO_PARTS, tìm user theo
   `username` (`thanhphan`, `banhang`, `kho`, `ketoan`, `ceo`), chỉ tài
   khoản `is_active = true`, `ON CONFLICT DO NOTHING` (idempotent).
2. **Guard DO block**: đếm đủ 5/5 mới cho chạy tiếp; thiếu username nào
   thì `RAISE EXCEPTION` liệt kê tên thiếu và **rollback toàn bộ** —
   không bao giờ siết khi còn tài khoản chưa gán (kiểm chứng âm: đổi
   `kho` → `kho2` thì migration fail, 0 dòng gán).
3. **`user_can_access_business_line()` siết fail-closed**: NULL cho qua
   (hàng đợi chưa phân loại); OWNER/CEO luôn true; tài khoản không hoạt
   động false; chưa gán false.
4. **`tvk_guard_line_business_line()` siết**: sản phẩm chưa phân loại
   vào chứng từ có ngành nay bị chặn (P1 còn NULL-tolerant).
5. **Trigger mới `tvk_require_header_business_line()`** trên 7 bảng
   chứng từ: INSERT thiếu ngành bị chặn; UPDATE bỏ ngành bị chặn khi
   chứng từ đã có dòng (chưa có dòng thì được, để dọn dữ liệu cũ).
6. **`v_batch_stock` lọc theo ngành (§6, BL-001)**: định nghĩa lại đúng
   0016 + 2 cột append ở cuối (`business_line_id`, `business_line_code`)
   + `WHERE user_can_access_business_line(auth.uid(), p.business_line_id)`,
   giữ `security_invoker = true` (0018). Trang Tồn kho + L2 dashboard
   không còn lộ lô ngành khác.
7. **`v_product_stock` thêm `business_line_id` (§6b, §18.6)**: append ở
   cuối select + GROUP BY, để route xuất Excel lọc `?line=` được.
8. Kiểm chứng cuối migration: NOTICE bất biến tài chính.

Thứ tự trong file là bắt buộc: **seed trước, siết sau** — ghi rõ trong
comment đầu migration.

## P2.3. Quyết định thiết kế (theo prompt §18.6 — được phép từ chối HOẶC tách)

| Luồng | Quyết định | Lý do |
|---|---|---|
| Import bán đại lý | **Tách** theo ngành (checkout chung §9.3) | Một đơn bán có thể chứa cả 2 ngành |
| Import BT (tiêu thụ) | **Tách** theo ngành thành nhiều báo cáo (§10.4) | Một báo cáo đối tác có thể chứa cả 2 ngành |
| Import PB (phân bổ) | **Tách** theo ngành thành nhiều phiếu | Cùng lý do BT |
| Import nhập kho | **Từ chối** file trộn ngành | Một phiếu nhập = một ngành (§8.1) |
| Import gửi ký gửi | **Từ chối** file trộn ngành | Một phiếu GK = một ngành (§10.2) |
| Form tay | Chỉ hiện sản phẩm/lô của ngành hiện tại; server từ chối dòng lệch | Chặn ở cả UI lẫn server action |
| Tài liệu phân bổ | **Tách** theo (tính chất, ngành) → tối đa 4 chứng từ (§9.3/E11) | BH/KG × OIL/AUTO_PARTS |
| Giảm giá checkout chung | Chia theo tỷ lệ trên các phiếu BH (làm tròn xuống, phần dư vào phiếu BH lớn nhất); phiếu KG = 0 như trước | Tổng giảm giá không đổi |

Các quyết định khác đã ghi trong báo cáo P2 của lead engineer:

- **Dashboard**: `getDashboard(lineId?)` lọc theo ngành ở các truy vấn
  phiếu bán, phiếu gửi ký gửi và tồn kho thấp; số liệu tồn kho tự lọc qua
  view; **tổng phải thu/phải trả, lệch đối chiếu và thống kê đối tác vẫn
  hợp nhất** (phân bổ theo ngành là P4) — ghi rõ để không ai tưởng đã
  tách xong tài chính.
- **Xác nhận chứng từ**: trước khi gọi RPC xác nhận, kiểm tra header đã
  có `business_line_id`; chứng từ cũ hỗn hợp/NULL không xác nhận được
  sau P2 cho tới khi phân loại lại.
- **Context NONE**: trang hiển thị thông báo nhờ chủ cửa hàng gán ngành;
  helper list trả rỗng khi `lineId` là null (không truy vấn DB).
- **Phải thu/phải trả**: lọc theo ngành của chứng từ nguồn; dòng có nguồn
  NULL/mất vẫn hiện (không giấu tiền).
- **Trang chi tiết**: sau khi tải `business_line_id` của chứng từ, nếu
  context LINE khác ngành thì từ chối xem (BL-001 cả đường dẫn trực tiếp).
- **SALES không đọc được `v_batch_stock`** (siết M2 từ 0018 — chỉ
  OWNER/WAREHOUSE/ACCOUNTING/CEO có SELECT trên `stock_batches`; SALES
  dùng `v_batches_for_sales`) — đây là hành vi đúng theo thiết kế, không
  phải lỗi; test C7e khẳng định điều này.
- **Trang điều hành / dòng tiền / đối soát / báo cáo / hoá đơn** (code
  gốc 8e37a3b) **không thuộc P2** — vẫn hợp nhất, chờ P4/P5.

## P2.4. Kết quả kiểm chứng

### Database scratch (PostgreSQL 16 local — KHÔNG phải live/staging)

Quy trình: database trống → stub auth → áp 0001–0024 → seed P1 → áp
0025 → seed P2 → áp 0026 → chạy `p2_operational_local.sql`. Lệnh chạy:
`bash /tmp/tvk-p2-verify/run-all.sh` (script ngoài repo, chỉ dùng local).

**PASS A–H toàn bộ** (chạy lại lần cuối sau khi thêm §6b):

- A: 5 tài khoản thật → AUTO_PARTS, tổng 7 dòng gán (5 thật + 2 thử OIL).
- B: fail-closed đúng (OWNER/CEO tất cả; chưa gán = 0; chỉ-dầu đúng 1;
  đã tắt/ghost = 0; NULL cho qua).
- C1–C6: `v_batches_for_sales` theo role (chưa gán 0 dòng; banhang 1
  AUTO_PARTS/0 OIL; chỉ-dầu 1 OIL/0 AUTO_PARTS; OWNER 2; ghost 0;
  không cột giá vốn).
- C7a–e: `v_batch_stock` theo role (kho 1 AUTO_PARTS; test-kho-dau 1
  OIL; chưa gán 0; OWNER 2; banhang 0 theo đúng siết M2).
- D1–D3: INSERT phiếu NULL ngành bị chặn; UPDATE bỏ ngành của phiếu có
  dòng bị chặn; phiếu chưa có dòng được phép bỏ ngành.
- E1–E4: dòng chưa phân loại bị chặn; dòng lệch ngành bị chặn; lô dầu
  vào phiếu GK AUTO_PARTS bị chặn; phiếu thử chỉ giữ đúng 1 dòng cùng ngành.
- F: bất biến tài chính 0/1/1/0 không đổi.
- G: đúng 5 dòng gán AUTO_PARTS (chạy lại 0026 không tạo trùng).
- H: `v_product_stock` có `business_line_id` (AUTO_PARTS=3, OIL=2,
  NULL=2 — đúng seed P1).

**Idempotency**: chạy lại 0026 trên cùng DB scratch → exit 0, vẫn 5
dòng AUTO_PARTS / 7 dòng tổng.

**Kiểm chứng âm** (DB `tvk_p2_neg`, seed đổi `kho` → `kho2`): 0026 fail
với `P2 SEED THIẾU: chưa gán được Phụ tùng cho username: kho`, rollback
toàn bộ, 0 dòng gán.

### Gate build (repo local, nhánh feature)

| Gate | Kết quả |
|---|---|
| `npx tsc --noEmit` | exit 0 (sau 3 vòng sửa: fragment JSX ở ledger, kiểu `BusinessLineContext` ở layout, `client()` thay `db()` + null-guard ở business-lines.ts, cast `BusinessLineCode`/`ROLE_LABELS` ở inventory/settings) |
| `npx next lint` | exit 0 — No ESLint warnings or errors (1 lỗi import thừa đã sửa) |
| `npx next build` | exit 0 |
| `npm run test:e2e` | exit 0 — Tier 1: 42/42, Tier 2: 8/8, Tier 3: 5/5, **Tier 5 mới: 8/8** (BL-003/004/005/006/007/008), **tổng 63/63 pass**; Tier 4 SKIPPED (không có file mẫu, như baseline Preflight) |

## P2.5. P2 Exit Gate — ĐẠT (với 3 lưu ý)

| Điều kiện (§20) | Trạng thái |
|---|---|
| No mixed-line operational document | ✅ Trigger + server action + UI chặn ở mọi đường tạo chứng từ; test E1–E4 + BL-003/004 |
| No expired oil sale | ✅ `isExpiredBatch` + chặn ở `createSaleFromForm`/`createAllocationDocumentsAction` + loại khỏi FIFO; test BL-006 (chưa có lô dầu thật để kiểm chứng end-to-end — dầu đang là ngành rỗng) |
| Correct stock movements | ✅ Lọc view theo ngành; FEFO/FIFO theo `business_line_code`; test BL-005/007/008 + C/C7 |
| Correct inventory ownership | ✅ View + RLS + test C/C7; SALES vẫn dùng view an toàn không giá vốn |
| No duplicate sales or payable posting | ✅ Không đổi logic ghi sổ; bất biến tài chính F không đổi; discount chia không làm đổi tổng |

**Lưu ý 1 — Migration 0025 + 0026 CHƯA chạy trên database thật nào ngoài
local scratch.** Theo prompt §21.5/§21.6, trước khi chạy lên live phải
chạy trên **staging** (bản sao dữ liệu live) và đối chiếu bất biến tài
chính. Không tự chạy lên live trong P2. Staging cũng là nơi kiểm chứng
UI theo role thật (SALES/WAREHOUSE/ACCOUNTING/CEO) vì tài khoản test
trên máy chủ không có mật khẩu thật.

**Lưu ý 2 — Tier 4 E2E vẫn SKIPPED** (cần file
`user-accounting-sample.csv` từ máy Windows của chủ cửa hàng).

**Lưu ý 3 — Dầu đang là ngành rỗng** (0 sản phẩm, 0 lô, 0 chứng từ trên
live). FEFO + chặn hết hạn đã kiểm chứng ở tầng hàm thuần (Tier 5) và
tầng DB (trigger), nhưng chưa có lô dầu thật để kiểm chứng end-to-end
trong app — chờ phiếu nhập dầu thật đầu tiên.

## P2.6. Hạn chế đã biết (P2)

- Trang điều hành (`/executive`), dòng tiền (`/cashflow`), đối soát
  (`/reconciliation`), báo cáo (`/reports`), hoá đơn GTGT (`/invoices`)
  vẫn hợp nhất — thuộc P4/P5.
- Tổng phải thu/phải trả trên dashboard + trang công nợ vẫn hợp nhất
  (phân bổ theo ngành là P4); chỉ danh sách chứng từ nguồn đã lọc theo ngành.
- Export CSV: 3 view tổng hợp ký gửi luôn xuất hợp nhất (không có cột
  ngành trên từng dòng — phân bổ theo ngành là P5).
- `getDocumentDetailAction` miễn kiểm tra ngành cho hoá đơn GTGT (INV)
  vì chưa có cột ngành — P4 BL-015.
- Trang chi tiết đối tác (`/partners/[id]`) chưa lọc theo ngành (hiển thị
  tổng hợp đối tác) — P5.
- Tài khoản mới tạo sau này chưa được gán ngành mặc định — OWNER gán tay
  ở Cài đặt (thẻ "Ngành hàng của tài khoản"); chưa có gán tự động cho
  tài khoản mới (cần quyết định: có nên gán mặc định AUTO_PARTS cho mọi
  tài khoản mới không).

## P2.7. Quyết định cần chủ cửa hàng (CẦN XÁC NHẬN)

1. Có gán mặc định AUTO_PARTS cho tài khoản mới tạo sau này không, hay
   OWNER gán tay từng người (mặc định hiện tại: chưa gán = không thấy gì)?
2. (Từ P1) File `user-accounting-sample.csv` để chạy Tier 4 đầy đủ.
3. Thời điểm chạy 0025 + 0026 trên staging (bản sao live) để đối chiếu
   trước khi lên live — cần chủ cửa hàng gật đầu và cung cấp cách tạo
   staging (hoặc để Muse tạo từ backup live).

## P2.8. Production readiness (P2)

**Chưa sẵn sàng deploy production.** P2 xong trên nhánh feature: migration
0026 đã kiểm chứng trên scratch + app code đã qua gate + E2E 63/63.
Cần trước khi merge/deploy: chạy 0025 + 0026 trên staging (bản sao live)
+ đối chiếu tài chính + smoke test app trên staging theo role thật.
Không merge vào main trong P2 (theo §0.2).

# TVK V2.0 P3 — Implementation Report (Báo cáo triển khai P3)

## P3.1. Thay đổi đã làm

### Migration mới

- `supabase/migrations/0027_payment_allocations_reversal.sql` — xem P3.2.

### Code app mới / sửa

- Mới `src/lib/payment-allocations.ts`: kiểu `PaymentAllocationRow` /
  `PaymentWithAllocations`, `listPaymentsWithAllocations(kind, lineId?)`
  (lấy phiếu thu/chi + các phiếu đảo của chúng + phân bổ theo ngành +
  nhãn đối tượng + trạng thái đảo; lọc theo ngành qua phân bổ, phiếu
  không có phân bổ vẫn hiện), hàm thuần `buildAllocationSummary`,
  `isReversiblePayment`, `paymentReversalLabel`, `allocationLineLabel`.
- Mới `src/components/PaymentHistory.tsx`: thẻ "Ghi nhận thu/chi tiền
  đợt chốt sổ (DS)", thẻ "Đảo bút toán thanh toán" (chỉ ACCOUNTING;
  OWNER thấy ghi chú giải thích), bảng "Lịch sử thu/chi tiền + phân bổ
  theo ngành" (chỉ OWNER/ACCOUNTING thấy, theo RLS bảng `payments`).
- `src/lib/actions.ts`: mới `recordSettlementPaymentAction` (chỉ ghi
  `settlement_id`, trigger tự phân bổ) + `reversePaymentAction`
  (ACCOUNTING-only, gọi RPC `reverse_payment`); sửa
  `createOperatingCashMovementAction` — bỏ INSERT trực tiếp vào
  `cash_movements`, đi qua RPC `record_operating_cash_movement` (BL-022).
- Trang Phải thu / Phải trả: gắn `<PaymentHistory>` (IN/PARTNER,
  OUT/SUPPLIER).
- Sổ dòng tiền (`CashflowLedger.tsx`): ẩn nút "Huỷ phiếu" với dòng tiền
  gắn phiếu thu/chi, hiện "Đảo ở phiếu thanh toán".
- Tier 5 E2E: +4 test hàm thuần P3 (tổng Tier 5: 12).
- Không đụng VAT (P4) hay báo cáo (P5).

### Kiểm chứng database local

- Mới `docs/tests/p3_seed_local.sql` (chứng từ dầu + phụ tùng, 2 đợt
  chốt sổ 2 dòng, khoản mua hỗn hợp để kiểm chứng âm) +
  `docs/tests/p3_payment_allocations_local.sql` (A–O, 15 mục).
- Chạy bằng `bash /tmp/tvk-p3-verify/run-all.sh` (chuỗi đầy đủ
  0001–0027 + seed P1/P2/P3; script ở ngoài repo, như P2).

### Tài liệu (§23 — phần P3)

- Mới `docs/business-lines/SETTLEMENT-AND-PAYMENTS.md` +
  `docs/business-lines/PAYMENT-REVERSAL.md`.
- Mục P3 này trong `IMPLEMENTATION-REPORT.md`.
- `HUONG-DAN-VAN-HANH.md`: mục D5 Công nợ (phân bổ, thanh toán DS,
  đảo bút toán, huỷ dòng tiền gắn phiếu).

## P3.2. Nội dung migration 0027

1. `payments.reversal_of_id` + unique partial index
   `uq_payments_one_reversal` (một phiếu gốc chỉ có một phiếu đảo) +
   index thường trên cột.
2. Bảng `payment_allocations` (id, payment_id, receivable/payable,
   settlement/settlement_line, business_line_id NOT NULL, amount
   numeric(15,4), reversal_of_id) + CHECK đúng một khoản công nợ +
   CHECK dấu tiền (thường > 0, gương < 0) + unique index
   `(payment_id, receivable_id, payable_id, settlement_line_id)` NULLS
   NOT DISTINCT (chống ghi trùng). RLS: SELECT OWNER/ACCOUNTING/CEO;
   không policy ghi — chỉ trigger SECURITY DEFINER ghi.
3. Hàm `tvk_resolve_obligation_line()` — quy chiếu ngành qua chứng từ
   gốc (phải thu → chứng từ bán; phải trả mua → phiếu nhập; phải trả ký
   gửi → chứng từ bán); chứng từ gốc NULL ngành thì suy từ một ngành
   duy nhất của các dòng; hỗn hợp 2 ngành → RAISE (fail-closed).
4. Viết lại `apply_payment_to_balance()` trong cùng migration (chuyển
   đổi nguyên tử, không có cửa sổ double-count): nhánh đảo xử lý
   trước (tạo dòng gương âm + trừ `amount_paid` + tính lại trạng thái);
   nhánh thường giữ nguyên logic 0019 (guard trả thừa + thứ tự dòng DS
   + thông báo lỗi) và thêm INSERT phân bổ sau mỗi lần cập nhật số dư.
5. RPC `reverse_payment(p_payment_id, p_reason)` — ACCOUNTING-only, lý
   do bắt buộc, khóa `FOR UPDATE`, kiểm tra đã đảo / phiếu đảo, tạo
   phiếu đảo (chiều ngược, cùng quỹ/phương thức/tham chiếu), đánh dấu
   hủy dòng tiền gốc.
6. Viết lại `cancel_cash_movement_reversal` (E7): dòng tiền gắn phiếu
   thanh toán → TỪ CHỐI (chỉ đảo ở phiếu); dòng đảo không copy
   `payment_id` (luôn NULL, liên kết qua `reversal_of_id`); bỏ bước 4
   cũ (trừ trực tiếp công nợ) — nay thuộc về `reverse_payment`.
7. Viết lại `apply_payment_to_cash_fund`: dòng tiền của phiếu đảo loại
   `REVERSAL`, số âm, `reversal_of_id` trỏ dòng tiền gốc.
8. RPC `record_operating_cash_movement()` — OWNER-only, kiểm tra quỹ +
   khoản mục, ký dấu tiền theo loại, ghi diễn giải mặc định. Đây là
   đường ghi OPERATING duy nhất sau khi bỏ policy ghi trực tiếp.
9. Cứng hoá quỹ tiền (§12.6, BL-022): DROP policy INSERT/UPDATE trực
   tiếp trên `cash_movements` (mọi role) + trigger
   `trg_cash_movements_no_direct_mutation` (DELETE luôn chặn; UPDATE
   chỉ cho đổi các cột hủy/liên kết).
10. Trigger bất biến `trg_payments_no_mutation` trên `payments`
    (UPDATE/DELETE luôn chặn — sửa sai chỉ bằng phiếu đảo).
11. Backfill `tvk_backfill_payment_allocations()` — tái hiện thuật toán
    0019 theo `(created_at, doc_code, id)`, có bảng tạm `paid_so_far`;
    post-check `SUM(alloc) = amount_paid` mọi khoản, lệch là RAISE.
    Trên live `payments = 0` nên backfill là no-op.

## P3.3. Quyết định thiết kế (theo prompt §18.6 — được phép từ chối HOẶC tách)

- **Chặn đảo khi đã xuất hoá đơn / đã thu tiền (§12.5): TÁCH.** Hiện
  mới chặn "đã đảo" và "phiếu đảo". Chặn đảo khi phiếu gốc đã gắn dòng
  hoá đơn GTGT đang hoạt động chưa kiểm tra được vì P4 chưa có cột
  ngành trên hoá đơn và chưa có liên kết phiếu ↔ hoá đơn — cần bổ sung
  ở P4 (BL-015). Ghi rõ trong `PAYMENT-REVERSAL.md` §6 thay vì giả vờ
  đã làm.
- **Khoản công nợ hỗn hợp (chứng từ gốc 2 ngành): fail-closed.** Không
  tách phân bổ theo tỷ lệ giá trị (đó là quy tắc quy chiếu mới, không
  có trong prompt) — resolver RAISE, người vận hành phân loại chứng từ
  gốc trước. Kiểm chứng âm ở mục O.
- **Đảo từng dòng DS riêng lẻ: KHÔNG làm.** Đảo toàn bộ phiếu; muốn đảo
  một phần thì đảo cả phiếu rồi ghi lại phần đúng. Đơn giản hơn và giữ
  được bất biến "một phiếu đảo = một phiếu gốc".
- **Tiền thừa: giữ hành vi 0019 (chặn).** Không tạo chứng từ tạm ứng /
  đặt cọc trong P3 (ngoài phạm vi V2.0, fix E6).

## P3.4. Kết quả kiểm chứng

### Database scratch (PostgreSQL 16 local — KHÔNG phải live/staging)

Chuỗi: DB trống → auth stub → 0001–0024 → p1 seed → 0025 → p2 seed →
0026 → p3 seed → 0027 → file kiểm chứng P3. Kết quả `ALL DONE`,
**PASS A–O (15/15)**:

| Mục | Nội dung | Kết quả |
|---|---|---|
| A | Backfill PT-SEED-0001 → 1 phân bổ 100.000 AUTO_PARTS | ✅ |
| B | Thu trực tiếp 50.000 → 1 phân bổ + R-PART2 PARTIAL + quỹ +50.000 | ✅ |
| C | Thu DS 250.000 → 2 phân bổ theo thứ tự dòng (200.000 + 50.000) | ✅ |
| D (BL-023) | Trả thừa trực tiếp + DS đều bị chặn, số dư không đổi | ✅ |
| E (BL-021) | Đảo thu DS 250.000 — khôi phục đúng 2 khoản, gương âm, quỹ về lại | ✅ |
| F | Đảo thu trực tiếp — R-PART2 về 0 UNPAID | ✅ |
| G | Đảo trùng + đảo phiếu đảo bị chặn | ✅ |
| H (E7) | Dòng tiền đảo có payment_id riêng, không copy gốc | ✅ |
| I (BL-022) | OWNER ghi/sửa/xóa trực tiếp cash_movements đều bị chặn (42501) | ✅ |
| J | payments bất biến (UPDATE/DELETE bị chặn, mọi role) | ✅ |
| K | Cancel redesign: gắn phiếu thì từ chối; OPERATING + chuyển quỹ hủy đúng, không copy payment_id | ✅ |
| L | Đảo DS xuyên ngành — mỗi khoản khôi phục đúng ngành của mình | ✅ |
| M | Đảo phiếu đầu sau khi có phiếu sau — chỉ trừ đúng phiếu bị đảo | ✅ |
| N | SUM(alloc) = amount_paid mọi khoản; số dư quỹ khớp; mọi phiếu có phân bổ | ✅ |
| O | Khoản hỗn hợp → fail-closed (resolver + phiếu chi đều RAISE) | ✅ |

Tổng kết cuối chuỗi: 11 phiếu (4 phiếu đảo), 15 dòng phân bổ, 7 dòng
tiền đảo, 16 dòng tiền. **Concurrency (2 phiên, ngoài file A–O):**
phiên B đảo cùng phiếu bị khóa đợi, sau khi phiên A commit thì B fail
"đã được đảo trước đó" — không đảo trùng.

### Gate build (repo local, nhánh feature)

- `npx tsc --noEmit`: exit 0.
- `npx next lint`: exit 0 (sau 1 vòng sửa biến thừa `verbNoun`).
- `npx next build`: exit 0.
- `npm run test:e2e`: **67/67** (Tier 1: 42 + Tier 2: 8 + Tier 3: 5 +
  Tier 5: 12 — gồm 4 test P3 mới; Tier 4 SKIPPED như trước vì thiếu
  file `user-accounting-sample.csv`).

## P3.5. P3 Exit Gate — ĐẠT (với 3 lưu ý)

| Điều kiện (§20) | Trạng thái |
|---|---|
| No double-posting | ✅ Chuyển đổi nguyên tử trong 0027 + unique index chống ghi trùng; bất biến N (SUM = amount_paid) |
| No overpayment | ✅ BL-023 (mục D): trực tiếp + DS đều chặn, số dư không đổi |
| Correct DS allocation | ✅ Mục C + L: phân bổ theo thứ tự dòng, đúng ngành từng dòng, kể cả xuyên ngành |
| Correct reversal | ✅ BL-021 (mục E/F/L/M): gương âm, khôi phục đúng từng khoản, quỹ về lại |
| Concurrency tests pass | ✅ 2 phiên: phiên sau bị khóa đợi rồi fail "đã được đảo" |
| Financial baselines reconcile | ✅ Mục N + post-check backfill trong 0027; số dư quỹ khớp |

**Lưu ý 1 — Migration 0025 + 0026 + 0027 CHƯA chạy trên database thật
nào ngoài local scratch.** Theo prompt §21.5/§21.6, trước khi chạy lên
live phải chạy trên **staging** (bản sao dữ liệu live) và đối chiếu bất
biến tài chính. Không tự chạy lên live trong P3.

**Lưu ý 2 — Tier 4 E2E vẫn SKIPPED** (cần file
`user-accounting-sample.csv` từ máy Windows của chủ cửa hàng).

**Lưu ý 3 — Chặn đảo khi đã xuất hoá đơn chưa kiểm tra được** (xem
P3.3/P3.6) — cần bổ sung ở P4 (BL-015) trước khi chạy live.

## P3.6. Hạn chế đã biết (P3)

- Chặn đảo khi phiếu gốc đã gắn dòng hoá đơn GTGT đang hoạt động chưa
  có (chờ P4, BL-015).
- Đảo DS chỉ đảo toàn bộ phiếu, không đảo từng dòng riêng lẻ.
- Phiếu không có tham chiếu công nợ/DS (phiếu lịch sử cũ) không đảo
  được (không có phân bổ để gương).
- Tổng phải thu/phải trả trên dashboard + trang công nợ vẫn hợp nhất
  (phân bổ theo ngành là P4); chỉ lịch sử thanh toán đã hiện phân bổ
  theo ngành.
- Trang điều hành (`/executive`), dòng tiền (`/cashflow`), đối soát
  (`/reconciliation`), báo cáo (`/reports`), hoá đơn GTGT (`/invoices`)
  vẫn hợp nhất — thuộc P4/P5.

## P3.7. Quyết định cần chủ cửa hàng (CẦN XÁC NHẬN)

1. **Đảo bút toán chỉ Kế toán mới được làm — Chủ cửa hàng có đồng ý
   giữ quy định này không?** (Quy định kế toán 28/10/2026; nếu chủ
   cửa hàng muốn tự đảo được thì phải quyết lại trước P4, vì RPC đang
   chặn OWNER.)
2. (Từ P1/P2) Có gán mặc định AUTO_PARTS cho tài khoản mới tạo sau này
   không, hay OWNER gán tay từng người?
3. (Từ P1) File `user-accounting-sample.csv` để chạy Tier 4 đầy đủ.
4. Thời điểm chạy 0025 + 0026 + 0027 trên staging (bản sao live) để
   đối chiếu trước khi lên live — cần chủ cửa hàng gật đầu và cung cấp
   cách tạo staging (hoặc để Muse tạo từ backup live).

## P3.8. Production readiness (P3)

**Chưa sẵn sàng deploy production.** P3 xong trên nhánh feature:
migration 0027 đã kiểm chứng trên scratch (A–O + concurrency) + app
code đã qua gate + E2E 67/67. Cần trước khi merge/deploy: chạy 0025 +
0026 + 0027 trên staging (bản sao live) + đối chiếu tài chính + smoke
test app trên staging theo role thật (đặc biệt: Kế toán đảo thử một
phiếu, Chủ cửa hàng xác nhận không đảo được). Không merge vào main
trong P3 (theo §0.2).
