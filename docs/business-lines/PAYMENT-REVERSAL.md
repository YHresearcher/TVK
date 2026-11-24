# TVK V2.0 P3 + P4 — Đảo bút toán thanh toán (Payment Reversal)

Tài liệu thiết kế + vận hành cho cơ chế đảo phiếu thu/chi sau P3
(migration 0027), cập nhật ở P4 (migration 0029: BL-015 + quyền OWNER
+ nhật ký đảo). Đọc cùng `SETTLEMENT-AND-PAYMENTS.md`.

## 1. Nguyên tắc

- **OWNER và Kế toán đều được đảo bút toán thanh toán.** Quyết của
  chủ 23/11 21:48 — bãi bỏ quy tắc chỉ-Kế-toán (quyết định kế toán
  28/10/2026). SALES / WAREHOUSE / CEO vẫn bị chặn (RPC + server
  action đều chặn).
- **Không sửa, không xoá phiếu gốc.** Sửa sai chỉ bằng **phiếu đảo mới**
  ngược chiều. Phiếu gốc, dòng phân bổ gốc, đợt chốt sổ và các dòng DS
  giữ nguyên.
- **Lý do bắt buộc** — mỗi lần đảo phải ghi rõ lý do (lưu vào ghi chú
  phiếu đảo: "Đảo của <mã phiếu gốc>: <lý do>" — định dạng từ 0029;
  phiếu đảo thời P3 (0027) ghi "Đảo bút toán <mã> (Lý do: …)" —
  nhật ký đảo hiểu cả hai định dạng).
- Phiếu đã đảo **không đảo lại được**; phiếu đảo **không đảo được nữa**
  (không có đảo của đảo).

## 2. Cơ chế — RPC `reverse_payment(p_payment_id, p_reason)`

Hàm SECURITY DEFINER, kiểm tra role = OWNER hoặc ACCOUNTING ngay đầu
(fail-closed: SALES / WAREHOUSE / CEO đều bị từ chối).

1. Khóa phiếu gốc `FOR UPDATE` (chống đảo đồng thời — xem §5).
2. Kiểm tra: phiếu tồn tại; không phải phiếu đảo; chưa bị đảo (cả kiểm
   tra trong hàm lẫn unique index `uq_payments_one_reversal`).
3. **BL-015 (P4, 0029): chặn đảo khi chứng từ gốc của phiếu đã có hoá
   đơn GTGT còn hiệu lực** — phải huỷ bản ghi hoá đơn GTGT trước rồi
   mới đảo. Phải trả mua hàng (không có chứng từ bán) không bao giờ bị
   chặn ở bước này.
4. Tạo **phiếu đảo**: cùng phương thức, cùng quỹ, cùng tham chiếu công
   nợ/DS, cùng số tiền, chiều ngược lại (IN ↔ OUT — mã phiếu do trigger
   `trg_payments_code` cấp theo chiều đã đảo: đảo phiếu thu PT thành
   phiếu chi PC và ngược lại), ngày = hôm nay,
   `reversal_of_id` = phiếu gốc.
5. Hai trigger tự chạy trên phiếu đảo:
   - `apply_payment_to_balance` (nhánh đảo): với mỗi dòng phân bổ gốc
     (theo thứ tự id) tạo **dòng gương âm** (`amount = −gốc`,
     `reversal_of_id` = dòng gốc) và **trừ** đúng số đó khỏi
     `amount_paid` của khoản công nợ, tính lại trạng thái
     (PAID/PARTIAL/UNPAID). Chỉ trừ đúng phiếu bị đảo — phiếu thanh
     toán khác sau đó không bị ảnh hưởng.
   - `apply_payment_to_cash_fund`: tạo dòng tiền ngược dấu, loại
     `REVERSAL`, `reversal_of_id` trỏ dòng tiền gốc (không copy
     `payment_id` — xem §4).
6. Đánh dấu dòng tiền gốc đã hủy (`is_cancelled`, lý do, thời gian,
   người hủy, `reversal_entry_id` = dòng tiền đảo). Không có quỹ (phiếu
   cũ `fund_id` NULL) thì bước này bỏ qua.

Kết quả sau đảo: công nợ về đúng số trước khi ghi phiếu gốc; số dư quỹ
về đúng số trước đó; phiếu gốc + phiếu đảo đều còn trong sổ để đối
chiếu.

## 3. Đảo đợt chốt sổ (BL-021)

Đảo một phiếu thanh toán DS khôi phục **đúng từng khoản** trong đợt:
dòng gương âm được tạo cho **mỗi dòng DS** (kèm `settlement_line_id` +
ngành riêng của từng khoản — kể cả đợt xuyên ngành dầu + phụ tùng).
Đợt chốt sổ và các dòng DS không bị sửa.

## 4. Dòng tiền khi đảo — sửa lỗi E7

Hàm cũ `cancel_cash_movement_reversal` (0023) **chắc chắn fail** khi hủy
dòng tiền gắn phiếu thanh toán: nó copy `payment_id` gốc sang dòng đảo
trong khi cột đó UNIQUE. Thiết kế lại trong 0027:

- **Dòng tiền gắn phiếu thanh toán: từ chối hủy ở đây.** Thông báo chỉ
  rõ: "Dòng tiền này gắn với phiếu thu/chi … — đảo bút toán ở trang
  Phải thu / Phải trả." Nút "Huỷ phiếu" cũng đã ẩn trên giao diện sổ
  dòng tiền với các dòng này (phòng vệ 2 lớp).
- **Dòng đảo không bao giờ copy `payment_id`** — luôn NULL, liên kết
  với dòng gốc qua `reversal_of_id`. Dòng tiền đảo của phiếu đảo có
  `payment_id` **riêng** (là id phiếu đảo).
- **Bước 4 cũ (trừ trực tiếp số dư công nợ trong hàm hủy dòng tiền) đã
  bỏ** — việc khôi phục công nợ giờ thuộc về `reverse_payment`; giữ lại
  sẽ trừ trùng 2 lần.
- Hủy dòng OPERATING và hủy chuyển quỹ nội bộ vẫn làm việc như cũ (đảo
  cả 2 chân, không copy `payment_id`).

## 5. Đồng thời (concurrency)

- Phiếu gốc bị khóa `FOR UPDATE` ngay đầu `reverse_payment`; unique
  index `uq_payments_one_reversal` là chốt cuối.
- Kiểm chứng 2 phiên trên scratch: phiên A đảo phiếu M-B và giữ
  transaction mở → phiên B gọi đảo cùng phiếu **bị khóa đợi** → sau khi
  A commit, B fail với "đã được đảo trước đó". Không có đảo trùng.

## 6. Hạn chế đã biết (P3 → P4)

- **BL-015 đã làm xong ở P4 (0029):** đảo bị chặn khi chứng từ gốc đã
  có hoá đơn GTGT còn hiệu lực; kiểm chứng REV-03 (OWNER cũng bị chặn
  khi đã có hoá đơn). Chặn đảo khi phiếu gốc đã được dùng để ghi nhận
  tạm ứng/đặt cọc thì chưa có cơ chế tạm ứng/đặt cọc nên không kiểm tra.
- **Lệch bản sao 0029 (đã sửa trong P4):** bản `reverse_payment` đầu
  tiên của 0029 giữ nguyên `payment_kind` của phiếu gốc và không đánh
  dấu dòng tiền gốc `is_cancelled` — lệch 0027. Giữ nguyên kind làm
  phiếu đảo hiện 2 lần trong lịch sử app (vừa là dòng cùng kind gốc,
  vừa được lấy thêm qua `reversal_of_id`) và cộng trùng vào tiền đã
  trả của đợt chốt sổ; đồng thời view `v_cash_flow_by_line` lúc đầu
  cũng phân loại theo kind phiếu đảo nên sai ngăn thu/chi. Đã khôi phục
  đúng 0027 trong 0029 (phiếu đảo đảo chiều IN↔OUT, mã theo chiều đã
  đảo, đánh dấu dòng tiền gốc `is_cancelled`) và sửa view phân loại
  theo kind của phiếu gốc (`coalesce(orig.payment_kind, ...)`) — kiểm
  chứng lại toàn bộ P4 trên scratch: ALL PASS.
- Đảo chỉ làm việc với phiếu có tham chiếu công nợ/DS. Phiếu không có
  tham chiếu (phiếu lịch sử cũ, nếu có) không có phân bổ để gương —
  `reverse_payment` từ chối (thông báo "không có dòng phân bổ").
- Đảo một phiếu DS chỉ đảo **toàn bộ phiếu**, không đảo từng dòng DS
  riêng lẻ (muốn đảo một phần thì đảo cả phiếu rồi ghi lại phần đúng).
- `payments` bất biến: UPDATE/DELETE trực tiếp bị trigger chặn với mọi
  role, kể cả superuser (sửa sai chỉ bằng phiếu đảo).

## 7. Vận hành (cho Chủ cửa hàng + Kế toán)

1. Mở trang **Phải thu đối tác** (thu tiền) hoặc **Phải trả nhà cung
   cấp** (chi tiền).
2. Thẻ **"Đảo bút toán thanh toán"** (Chủ cửa hàng và Kế toán đều thấy
   và làm được): chọn phiếu cần đảo trong danh sách (chỉ hiện phiếu
   chưa bị đảo), nhập lý do, bấm "Đảo bút toán".
3. Kiểm tra bảng **"Lịch sử thu/chi tiền + phân bổ theo ngành"**: phiếu
   gốc hiện "Đã đảo (mã phiếu đảo)", phiếu đảo mới hiện "Bút toán đảo"
   với số tiền âm; công nợ và số dư quỹ đã về lại.
4. **Không** hủy dòng tiền của phiếu thanh toán ở sổ dòng tiền — hệ
   thống từ chối; đảo ở trang công nợ như trên.

## 8. Nhật ký đảo bút toán (P4 — chủ yêu cầu 23/11 21:48)

- **Xem ở đâu:** cùng trang **Phải thu đối tác** / **Phải trả nhà cung
  cấp**, mục **"Nhật ký đảo bút toán"** ngay dưới bảng lịch sử thanh
  toán (component `PaymentHistory`, hàm thuần `getReversalLog` trong
  `src/lib/payment-allocations.ts`).
- **Ai xem được:** Chủ cửa hàng (OWNER) và Kế toán (ACCOUNTING) — cùng
  quyền xem như toàn bộ thẻ lịch sử thanh toán (RLS bảng `payments`
  chỉ cho 2 role này xem; SALES / WAREHOUSE / CEO không thấy mục này).
- **Mỗi dòng log ghi rõ:** phiếu đảo, phiếu gốc, số tiền, lý do đảo
  (bắt buộc, tách từ ghi chú phiếu đảo bằng `reversalReasonFromNote`
  — hiểu cả hai định dạng ghi chú 0027/0029), người đảo (tên hiển thị
  tra từ `profiles` qua `created_by`), thời gian đảo (`created_at`).
  Mới nhất xếp trước. Phiếu đảo không bao giờ bị sửa hay xoá (bảng
  `payments` bất biến) nên log là đầy đủ và không mất dòng.
- **Kiểm chứng:** test DB REV-01/04 (`docs/tests/p4_finance_vat_local.sql`)
  — phiếu đảo của OWNER ghi đúng phiếu gốc, ghi chú chứa lý do,
  `created_by` = OWNER, `created_at` có giá trị, tên tra ra "Thanh Phan";
  test Tier 5 cho `reversalReasonFromNote` + `getReversalLog`.
