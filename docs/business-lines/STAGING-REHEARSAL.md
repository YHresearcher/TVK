# TVK V2.0 — Staging Rehearsal Runbook (P6)

> Mục đích: chạy thử toàn bộ migration 0025–0030 trên một bản sao của
> database live, đối chiếu số liệu với live, rồi mới quyết định lên
> production. **Chưa tạo staging trong P6** — việc tạo staging cần chủ
> cửa hàng chọn phương pháp (§1) vì cần mật khẩu database live (chỉ chủ
> giữ) và quyết định dùng project Supabase mới hay cách khác.
>
> Quy tắc xuyên suốt: **không chạy migration nào lên live trong buổi
> rehearsal**; mọi lệnh SQL dưới đây chạy trên staging (hoặc SELECT
> chỉ-đọc trên live để lấy baseline). Nếu một bước fail, dừng lại,
> ghi log, không chạy tiếp.

## 0. Baseline live đã biết (đối chiếu — lấy ngày 23/11/2026)

Dữ liệu live đang **đóng băng ở tháng 9/2026** (chưa import bổ sung
T10+T11 — đang chờ chủ quyết, xem §5). Các số này phải giữ nguyên sau
khi chạy migration trên staging (trừ các cột/trường mới do migration
thêm — xem từng bước):

| Chỉ số | Kỳ vọng |
|---|---|
| Sản phẩm | 46 (nhóm `Linh kiện ô tô tải`), dầu 0 |
| Lô hàng (`stock_batches`) | 46 |
| Bút toán kho (`stock_movements`) | 114 |
| Chứng từ bán (`sales_documents`) | 1 — BH-2610-0001, CONFIRMED, 342.755.000đ |
| Phải thu (`partner_receivables`) | 1 — Âu Châu, 342.755.000đ, chưa thu |
| Phải trả (`supplier_payables`) | 0 |
| Thanh toán (`payments`) | 0 |
| Quỹ (`cash_funds`) | 1 — Két tiền mặt, số dư 0 |
| Doanh thu / lãi gộp (dashboard) | 342.755.000 / 88.895.335 |
| Giá trị tồn kho thuộc sở hữu | 5.373.234.100 (giá vốn 3.722.967.470) |
| Tồn kho | 5.011 cái (4.850 kho TVK + 161 tại đối tác) |

## 1. Tạo staging — CẦN CHỦ QUYẾT phương pháp

Project Supabase live **TVK** (`htgxqdwgvcfqdoevnjgd`) đang dùng gói
**Free**: không có Point-in-Time Recovery, không có Database
Branching. Vì vậy staging phải dựng từ một bản sao lưu, có 3 cách:

| Cách | Làm sao | Lưu ý |
|---|---|---|
| **A. Project Supabase mới (khuyên dùng)** | Tạo project mới trên cùng tài khoản Supabase → restore bản sao lưu live vào đó → chạy migration | Tách biệt hoàn toàn với live; cần bản sao lưu đầy đủ (schema + data + auth users). Tài khoản Supabase là hlthanh1992@gmail.com |
| **B. Supabase CLI local + pg_dump** | `pg_dump` live → restore vào Postgres local / Docker | Rẻ nhất, nhưng Auth + Storage không đi kèm đầy đủ; chỉ kiểm chứng được migration + số liệu, không kiểm được đăng nhập thật |
| **C. Nâng cấp gói rồi dùng Branching** | Lên gói Pro → tạo branch từ live | Tốn phí tháng; chỉ chọn nếu chủ muốn staging lâu dài |

**Chủ cần quyết:** chọn A, B hay C. **Chủ cần chuẩn bị:** mật khẩu
database live (chỉ chủ giữ — Muse không có, không hỏi qua chat
thường mà dùng kênh an toàn khi tới bước đó) và một bản sao lưu live
mới nhất. Cách lấy sao lưu: Supabase Dashboard → Database →
Backups (gói Free chỉ có sao lưu ngày, không tải trực tiếp) hoặc
`pg_dump` bằng connection string (cần mật khẩu).

**Kiểm tra staging đã giống live chưa** (chạy trên staging, so với
bảng §0): đếm sản phẩm/lô/bút toán/phải thu/phải trả/thanh toán/quỹ;
số nào lệch thì staging chưa phải bản sao đúng — dừng, làm lại từ
bản sao lưu khác, không chạy migration.

## 2. Thứ tự chạy migration trên staging

Chạy **đúng thứ tự** sau, từng file một, bằng SQL Editor của project
staging (paste toàn bộ nội dung file, như cách đã chạy 0021/0022/0024
lên live). Sau mỗi file, kiểm tra mục "Kiểm tra sau bước" rồi mới
chạy file tiếp theo. Nếu một file báo lỗi: dừng, giữ nguyên hiện
trạng, báo lại — không chạy file sau, không chạy lại file lỗi khi
chưa rõ nguyên nhân.

| # | File | Nội dung chính | Kiểm tra sau bước |
|---|---|---|---|
| 1 | `0025_business_lines.sql` | Bảng ngành, gán ngành cho sản phẩm, cột ngành ở 7 bảng chứng từ | `SELECT code FROM business_lines;` → OIL + AUTO_PARTS. `SELECT count(*) FROM products WHERE business_line_id IS NULL;` → 0 (46 sản phẩm đều về AUTO_PARTS). `SELECT count(*) FROM v_unclassified_products;` → 0 |
| 2 | `0026_default_assignments_fail_closed.sql` | Gán mặc định 5 tài khoản → Phụ tùng, siết fail-closed | Chạy xong phải thấy đủ 5 dòng `user_business_lines` (thanhphan, banhang, kho, ketoan, ceo → AUTO_PARTS). Nếu migration báo lỗi `P2 SEED THIẾU` thì dừng — có tài khoản thiếu, không được siết |
| 3 | `0027_payment_allocations_reversal.sql` | Bảng phân bổ thanh toán, đảo bút toán, siết sổ quỹ | `payments` có cột `reversal_of_id`. `payment_allocations` tồn tại, đang rỗng (live payments = 0 nên backfill là no-op) |
| 4 | `0028_allocation_cutover.sql` | Chuyển phân bổ công nợ sang bảng mới | Số dư phải thu/phải trả không đổi so với §0 |
| 5 | `0029_finance_vat.sql` | Công nợ + VAT tách theo ngành, BL-015 | `vat_invoices` có cột `business_line_id`. Phải thu/phải trả không đổi |
| 6 | `0030_reporting_aggregation.sql` | 10 view tổng hợp báo cáo | Đủ 10 view (xem §3). Số liệu view khớp số trực tiếp |

**Lưu ý:** 0028+0029 là hai migration của P4 (không phải một file);
không gộp, không đổi thứ tự. Toàn bộ 6 file đều nằm trên nhánh
`feature/tvk-v2-business-lines`, chưa từng chạy trên live.

## 3. Đối chiếu số liệu sau khi chạy xong 6 migration

Chạy các truy vấn sau trên **staging** rồi so với baseline §0 và với
live (SELECT chỉ-đọc). **Mọi số tiền/số lượng phải bằng nhau**; lệch
dù 1 đồng cũng là fail — dừng, ghi lại, không lên live.

```sql
-- Đếm (phải bằng §0)
SELECT (SELECT count(*) FROM products) AS products,
       (SELECT count(*) FROM stock_batches) AS batches,
       (SELECT count(*) FROM stock_movements) AS movements,
       (SELECT count(*) FROM sales_documents) AS sales_docs,
       (SELECT count(*) FROM partner_receivables) AS receivables,
       (SELECT count(*) FROM supplier_payables) AS payables,
       (SELECT count(*) FROM payments) AS payments,
       (SELECT count(*) FROM cash_funds) AS funds;
-- Kỳ vọng: 46 / 46 / 114 / 1 / 1 / 0 / 0 / 1

-- Tiền (phải bằng §0)
SELECT coalesce(sum(amount - amount_paid), 0) AS rec_open
  FROM partner_receivables;                       -- 342755000
SELECT coalesce(sum(amount - amount_paid), 0) AS pay_open
  FROM supplier_payables;                        -- 0

-- Tổng theo ngành = tổng hợp (BL-020, trên staging đã có 0030)
SELECT coalesce(sum(revenue), 0) AS rev_by_line,
       coalesce(sum(cogs), 0) AS cogs_by_line,
       coalesce(sum(orders), 0) AS orders_by_line
  FROM v_sales_by_line;                          -- 342755000 / 253859665 / 1
SELECT coalesce(sum(revenue_net), 0) AS rev_docs,
       coalesce(sum(cogs), 0) AS cogs_docs,
       count(*) AS orders_docs
  FROM v_sales_doc_totals;                       -- phải bằng dòng trên

-- Phân loại: 46 sản phẩm về Phụ tùng, 0 chưa phân loại, dầu 0
SELECT bl.code, count(*) FROM products p
  LEFT JOIN business_lines bl ON bl.id = p.business_line_id
 GROUP BY bl.code;                               -- AUTO_PARTS 46
```

**Kiểm tra truy cập (fail-closed):** đăng nhập staging bằng từng
tài khoản (thanhphan, banhang, kho, ketoan, ceo — mật khẩu như live):
- Tất cả đều thấy Phụ tùng; không ai thấy Dầu nhớt có số liệu (dầu
  đang trống).
- Tạo tài khoản thử chưa gán ngành (hoặc dùng tài khoản test nếu có)
  → không thấy số liệu gì (fail-closed).
- OWNER đảo được phiếu thanh toán; Kế toán đảo được; Sales/Kho/CEO
  không đảo được (nút đảo không hiện hoặc bị chặn).

**Kiểm tra giao diện (UAT — chủ bấm tay trên staging):**
- Tổng quan: 2 bảng "So sánh theo ngành" + "Công nợ theo ngành"
  hiện đúng số; chuyển ngành Dầu nhớt ↔ Phụ tùng ↔ Toàn doanh nghiệp.
- Bán hàng: cột Giá vốn/Lãi gộp đúng (BH-2610-0001: giá vốn
  253.859.665, lãi 88.895.335).
- Phải thu/Phải trả: lịch sử thanh toán + phân bổ theo ngành; nhật
  ký đảo bút toán xem được (OWNER + Kế toán).
- Hoá đơn GTGT: tạo hoá đơn từ dòng BH-2610-0001 được; thử trộn
  2 ngành phải bị chặn.
- Tạo chứng từ nháp mới (không xác nhận) rồi xoá — kiểm tra form
  chạy, không cần giữ lại.

## 4. Điểm dừng / tiêu chí PASS cho rehearsal

**PASS khi tất cả đúng:**
1. Cả 6 migration chạy không lỗi, đúng thứ tự.
2. Mọi số §3 bằng baseline §0 (đếm + tiền + BL-020).
3. Fail-closed + đảo bút toán đúng role như §3.
4. UAT tay của chủ không phát hiện lỗi hiển thị/số liệu.

**FAIL khi bất kỳ điều nào sau đây xảy ra — dừng, không lên live:**
- Migration báo lỗi, hoặc chạy xong mà số lệch với §0.
- BL-020 lệch (tổng theo ngành ≠ tổng hợp).
- Tài khoản chưa gán ngành vẫn thấy số liệu.
- Đảo bút toán sai role, hoặc đảo khi đã có hoá đơn mà không bị chặn.

Khi FAIL: giữ nguyên staging để điều tra, chụp lại thông báo lỗi +
số lệch, báo lại cho lead. **Không sửa tay số liệu trên staging để
cho khớp** — số liệu staging phải là kết quả thật của migration.

## 5. Những việc KHÔNG làm trong rehearsal

- Không import bổ sung T10+T11 trong buổi rehearsal (đang chờ chủ
  quyết riêng; import xong mới đối chiếu lại từ đầu vì baseline đổi).
- Không chạy Tier 4 E2E trên staging (cần file
  `user-accounting-sample.csv` từ máy Windows của chủ — chưa có).
- Không kiểm chứng số liệu dashboard trên DB thật có 0030 bằng cách
  khác ngoài rehearsal này — rehearsal chính là cách kiểm đó.
- Không tạo dữ liệu bán hàng/thanh toán thật trên staging (chỉ tạo
  nháp rồi xoá).

## 6. Sau khi rehearsal PASS

Ghi lại vào `docs/business-lines/IMPLEMENTATION-REPORT.md` (§P6):
ngày chạy, ai chạy, số liệu đối chiếu, UAT của chủ, rồi mới chuyển
sang `RELEASE-CHECKLIST.md` để lên production. Rehearsal PASS không
có nghĩa là tự động lên live — lên live vẫn cần chủ gật đầu riêng
ở từng bước (xem release checklist).
