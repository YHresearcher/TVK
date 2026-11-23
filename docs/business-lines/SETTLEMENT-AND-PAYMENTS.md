# TVK V2.0 P3 — Đối soát & Thanh toán (Settlement and Payments)

Tài liệu thiết kế + vận hành cho kiến trúc thanh toán sau P3
(migration 0027). Đọc cùng `PAYMENT-REVERSAL.md` (đảo bút toán) và
`IMPLEMENTATION-REPORT.md` mục P3.

## 1. Vấn đề của kiến trúc cũ (trước 0027)

Trigger `apply_payment_to_balance` bản 0019 ghi tiền trực tiếp vào
`amount_paid` của khoản phải thu / phải trả, không để lại dòng nào cho
biết **tiền đó thuộc ngành nào, chứng từ nào**. Hậu quả:

- Không phân bổ được thanh toán theo ngành (Dầu nhớt / Phụ tùng) — chặn
  P4 (tách tài chính theo ngành).
- Thanh toán đợt chốt sổ (DS) phân bổ theo từng dòng nhưng không có bảng
  ghi lại — không đối chiếu được sau này.
- Phiếu đảo (nếu có) sẽ **tăng** `amount_paid` thay vì giảm — trigger
  cũ không phân biệt phiếu thường và phiếu đảo (không có cột
  `reversal_of_id`).
- Trả thừa bị chặn (0019) nhưng không có nơi nào ghi "đã chặn" — chỉ là
  lỗi lúc ghi.

## 2. Bảng `payment_allocations` — sổ phân bổ thanh toán

Mỗi lần ghi tiền, trigger tạo **một dòng phân bổ cho mỗi khoản công nợ
được thanh toán**:

| Cột | Ý nghĩa |
|---|---|
| `payment_id` | Phiếu thu/chi (PT/PC) |
| `receivable_id` / `payable_id` | Khoản công nợ được thanh toán — đúng một trong hai (CHECK) |
| `settlement_id` / `settlement_line_id` | Đợt chốt sổ + dòng DS (chỉ khi thanh toán DS) |
| `business_line_id` | Ngành hàng của khoản công nợ (OIL / AUTO_PARTS) — NOT NULL |
| `amount` | Số tiền phân bổ. Phiếu thường > 0; phiếu đảo < 0 (dòng gương, xem `PAYMENT-REVERSAL.md`) |
| `reversal_of_id` | Dòng phân bổ gốc mà dòng gương này đảo (null với dòng thường) |

**Bất biến lõi:** với mọi khoản công nợ,
`SUM(payment_allocations.amount) = amount_paid` — kiểm chứng ở mục N
của `docs/tests/p3_payment_allocations_local.sql` sau mỗi lần chạy.

**Quy tắc ghi:** chỉ trigger `apply_payment_to_balance` (SECURITY
DEFINER) mới ghi bảng này. RLS: OWNER/ACCOUNTING/CEO được xem; không có
policy INSERT/UPDATE/DELETE cho bất kỳ role nào — không ai ghi trực
tiếp được, kể cả OWNER.

**Chống ghi trùng:** unique index
`(payment_id, receivable_id, payable_id, settlement_line_id)` với
`NULLS NOT DISTINCT` — một phiếu không thể phân bổ 2 lần cho cùng một
khoản (cùng một dòng DS).

## 3. Ngành của một khoản công nợ — quy chiếu qua chứng từ gốc (§11.3)

`payment_allocations` **không thêm cột ngành lên bảng công nợ** (đó là
việc của P4). Ngành được xác định lúc ghi phiếu, qua hàm
`tvk_resolve_obligation_line(payable_id, receivable_id)`:

1. Phải thu → chứng từ bán gốc (`sales_documents.business_line_id`).
2. Phải trả mua hàng (PURCHASE) → phiếu nhập gốc
   (`purchase_receipts.business_line_id`).
3. Phải trả ký gửi đã bán (CONSIGNMENT_SALE) → chứng từ bán gốc.
4. Nếu chứng từ gốc chưa có ngành (chứng từ hỗn hợp lịch sử, NULL) →
   suy ra từ **một ngành duy nhất** trong các dòng sản phẩm của chứng
   từ đó.
5. Nếu vẫn không xác định được (chứng từ hỗn hợp 2 ngành) → **RAISE,
   chặn phiếu** — phân loại chứng từ gốc trước rồi ghi tiền lại
   (fail-closed). Không bao giờ đoán ngành.

## 4. Luồng ghi tiền (không đổi ở UI, đổi ở trigger)

1. **Trực tiếp (PT/PC):** phiếu ghi 1 khoản công nợ → 1 dòng phân bổ
   bằng đúng số tiền phiếu.
2. **Đợt chốt sổ (DS):** phiếu chỉ ghi `settlement_id` → trigger duyệt
   `settlement_lines ORDER BY id`, phân bổ `least(tiền còn lại, dư
   nợ của dòng)` cho từng dòng, ghi `settlement_line_id` + ngành từng
   dòng. Nếu sau khi duyệt hết mà còn dư tiền → RAISE (trả thừa, BL-023).
3. **Trả thừa (BL-023, giữ hành vi 0019):** trực tiếp vượt dư nợ, hoặc
   DS vượt tổng dư của đợt → trigger RAISE, phiếu không được ghi, số dư
   không đổi. Tiền thừa chỉ nhận qua chứng từ tạm ứng/đặt cọc riêng —
   **ngoài phạm vi V2.0** (fix E6).

**Chuyển đổi nguyên tử:** trong cùng migration 0027, hàm
`apply_payment_to_balance` được viết lại — nhánh đảo xử lý trước, nhánh
thường giữ nguyên logic 0019 (guard + thứ tự dòng + thông báo lỗi) và
**thêm một INSERT phân bổ sau mỗi lần cập nhật số dư**. Không có thời
điểm nào hai cơ chế cùng chạy → không double-count.

## 5. Backfill — phiếu lịch sử

Hàm `tvk_backfill_payment_allocations()` (chạy 1 lần trong 0027, rồi
DROP) tái hiện lại thuật toán 0019 theo thứ tự `(created_at, doc_code,
id)` — `doc_code` là thứ tự thật (mã PT/PC tăng dần), UUID ngẫu nhiên
không phải thứ tự. Phiếu trực tiếp → 1 dòng; phiếu DS → phân bổ từng
dòng theo dư nợ **tại thời điểm đó** (bảng tạm chạy `paid_so_far`).
Cuối backfill: kiểm tra `SUM(alloc) = amount_paid` cho mọi khoản, lệch
là RAISE — không xây trên sổ lệch.

Trên live hiện tại `payments = 0` nên backfill là no-op; kiểm chứng thật
diễn ra trên scratch (phiếu PT-SEED-0001 → 1 dòng 100.000 AUTO_PARTS,
mục A của file kiểm chứng P3).

## 6. Giao diện (P3)

- **Trang Phải thu / Phải trả** (chỉ OWNER/ACCOUNTING thấy, theo RLS
  bảng `payments`):
  - Thẻ **"Ghi nhận thu/chi tiền đợt chốt sổ (DS)"** — chọn đợt còn dư,
    nhập tiền, chọn quỹ; hệ thống tự phân bổ theo dòng + ngành.
  - Thẻ **"Đảo bút toán thanh toán"** — chỉ Kế toán (xem
    `PAYMENT-REVERSAL.md`).
  - Bảng **"Lịch sử thu/chi tiền + phân bổ theo ngành"** — mỗi phiếu:
    mã, ngày, đối tượng (đối tác/NCC + chứng từ gốc), phân bổ từng
    ngành ("Dầu nhớt: … • Phụ tùng: …"), số tiền (phiếu đảo hiện số
    âm), trạng thái ("Bút toán đảo" / "Đã đảo (mã phiếu đảo)").
- **Sổ dòng tiền (`/cashflow`):** dòng tiền gắn phiếu thu/chi **không
  còn nút "Huỷ phiếu"** — hiện ghi chú "Đảo ở phiếu thanh toán" (RPC hủy
  dòng tiền cũng từ chối, phòng vệ 2 lớp).

## 7. Những gì P3 KHÔNG làm (để P4/P5)

- ~~Không thêm cột ngành lên `partner_receivables` / `supplier_payables`.~~
  → Đã làm ở P4 (0029 §1): cột `business_line_id` + backfill + trigger
  tự điền + guard chặn đổi ngành; `v_unattributed_balances` gom khoản
  chưa phân loại (BL-014).
- Không tách tổng phải thu/phải trả trên dashboard theo ngành (P5 —
  dời theo chỉ đạo parent; trang công nợ đã có cột Ngành + dư nợ theo
  ngành ở P4).
- ~~Không tách hoá đơn GTGT theo ngành (P4, BL-015).~~ → Đã làm ở P4
  (0029 §2–§3): `create_vat_invoice` chặn trộn ngành + tách VAT 8%
  sau giảm giá; `reverse_payment` chặn đảo khi đã có hoá đơn (BL-015).
- Không xuất báo cáo phân bổ theo ngành (P5).
- Không có chứng từ tạm ứng/đặt cọc cho tiền thừa (ngoài V2.0).

## 8. Cutover P4a — số dư suy từ phân bổ (migration 0028)

Trigger 0027 gộp cả cộng/trừ `amount_paid` VÀ chèn phân bổ trong một
trigger nên không có "đường legacy" riêng để tắt — cutover P4a không
tắt trigger cũ mà đổi cơ chế suy số dư:

- `tvk_recompute_obligation_balance(p_payable_id, p_receivable_id)`:
  `amount_paid = SUM(payment_allocations)`, trạng thái suy ra
  PAID/PARTIAL/UNPAID.
- `apply_payment_to_balance()` viết lại: 6 khối UPDATE cộng/trừ trực
  tiếp (nhánh đảo, thu/trả trực tiếp, vòng DS) đổi thành gọi helper.
- Guard `tvk_guard_obligation_balance()` + trigger BEFORE UPDATE trên
  cả hai bảng công nợ: chặn sửa trực tiếp `amount_paid`/trạng thái trừ
  khi đúng `SUM(phân bổ)` — đồng thời đóng lỗ hổng M4 "sửa trực tiếp
  số dư suy ra từ trigger".
- Post-check trong 0028: định nghĩa hàm không còn
  `amount_paid = amount_paid ±`; mọi khoản thỏa
  `amount_paid = SUM(phân bổ)` (kiểm chứng mục U trong
  `docs/tests/p4_finance_vat_local.sql`).
- Chỉ trigger + hàm backfill 0027 được ghi `amount_paid`; app không
  bao giờ ghi trực tiếp cột này.

## 9. Kiểm chứng

- `docs/tests/p3_seed_local.sql` + `docs/tests/p3_payment_allocations_local.sql`
  (A–O) trên PostgreSQL 16 scratch, chạy bằng
  `bash /tmp/tvk-p3-verify/run-all.sh`.
- BL-021 (đảo DS), BL-022 (chặn OWNER ghi trực tiếp cash_movements),
  BL-023 (chặn trả thừa) ở cấp DB; hàm thuần UI
  (`buildAllocationSummary`, `isReversiblePayment`,
  `paymentReversalLabel`) ở Tier 5 E2E.
- Đồng thời 2 phiên (concurrency): phiên đảo thứ hai bị khóa hàng đợi
  rồi fail "đã được đảo" sau khi phiên đầu commit — không đảo trùng.
