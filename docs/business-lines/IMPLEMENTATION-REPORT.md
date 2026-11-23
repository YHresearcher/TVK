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
