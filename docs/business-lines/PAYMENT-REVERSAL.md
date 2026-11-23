# TVK V2.0 P3 — Đảo bút toán thanh toán (Payment Reversal)

Tài liệu thiết kế + vận hành cho cơ chế đảo phiếu thu/chi sau P3
(migration 0027). Đọc cùng `SETTLEMENT-AND-PAYMENTS.md`.

## 1. Nguyên tắc (theo quyết định kế toán 28/10/2026)

- **Chỉ Kế toán mới được đảo bút toán thanh toán.** Chủ cửa hàng cũng
  không tự đảo được — nếu cần đảo, nhờ Kế toán thực hiện. (Quyết định
  này đã khóa; muốn đổi thì chủ cửa hàng phải quyết lại trước P4.)
- **Không sửa, không xoá phiếu gốc.** Sửa sai chỉ bằng **phiếu đảo mới**
  ngược chiều. Phiếu gốc, dòng phân bổ gốc, đợt chốt sổ và các dòng DS
  giữ nguyên.
- **Lý do bắt buộc** — mỗi lần đảo phải ghi rõ lý do (lưu vào ghi chú
  phiếu đảo: "Đảo bút toán <mã phiếu gốc> (Lý do: …)").
- Phiếu đã đảo **không đảo lại được**; phiếu đảo **không đảo được nữa**
  (không có đảo của đảo).

## 2. Cơ chế — RPC `reverse_payment(p_payment_id, p_reason)`

Hàm SECURITY DEFINER, kiểm tra role = ACCOUNTING ngay đầu (fail-closed:
role khác, kể cả OWNER, đều bị từ chối).

1. Khóa phiếu gốc `FOR UPDATE` (chống đảo đồng thời — xem §5).
2. Kiểm tra: phiếu tồn tại; không phải phiếu đảo; chưa bị đảo (cả kiểm
   tra trong hàm lẫn unique index `uq_payments_one_reversal`).
3. Chặn đảo khi: phiếu gốc đã gắn dòng hoá đơn GTGT đang hoạt động, hoặc
   phiếu gốc đã được dùng để ghi nhận tạm ứng/đặt cọc (khi 2 cơ chế này
   có ở P4 — hiện chưa có nên kiểm tra này đang ở dạng giữ chỗ, luôn
   cho qua; xem §6).
4. Tạo **phiếu đảo**: cùng phương thức, cùng quỹ, cùng tham chiếu công
   nợ/DS, cùng số tiền, chiều ngược lại (IN ↔ OUT), ngày = hôm nay,
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

## 6. Hạn chế đã biết (P3)

- **Chặn đảo khi đã xuất hoá đơn / đã thu tiền** (§12.5): hiện mới chặn
  ở mức "đã được đảo" và "phiếu đảo". Chặn đảo khi phiếu gốc đã gắn
  dòng hoá đơn GTGT đang hoạt động **chưa kiểm tra được** vì P4 chưa
  có cột ngành trên hoá đơn và chưa có liên kết phiếu ↔ hoá đơn ở tầng
  này — cần bổ sung ở P4 (BL-015) trước khi chạy live, hoặc chấp nhận
  rủi ro và ghi rõ trong biên bản chạy staging.
- Đảo chỉ làm việc với phiếu có tham chiếu công nợ/DS. Phiếu không có
  tham chiếu (phiếu lịch sử cũ, nếu có) không có phân bổ để gương —
  `reverse_payment` từ chối (thông báo "không có dòng phân bổ").
- Đảo một phiếu DS chỉ đảo **toàn bộ phiếu**, không đảo từng dòng DS
  riêng lẻ (muốn đảo một phần thì đảo cả phiếu rồi ghi lại phần đúng).
- `payments` bất biến: UPDATE/DELETE trực tiếp bị trigger chặn với mọi
  role, kể cả superuser (sửa sai chỉ bằng phiếu đảo).

## 7. Vận hành (cho Kế toán)

1. Mở trang **Phải thu đối tác** (thu tiền) hoặc **Phải trả nhà cung
   cấp** (chi tiền).
2. Thẻ **"Đảo bút toán thanh toán"** (chỉ Kế toán thấy): chọn phiếu cần
   đảo trong danh sách (chỉ hiện phiếu chưa bị đảo), nhập lý do, bấm
   "Đảo bút toán".
3. Kiểm tra bảng **"Lịch sử thu/chi tiền + phân bổ theo ngành"**: phiếu
   gốc hiện "Đã đảo (mã phiếu đảo)", phiếu đảo mới hiện "Bút toán đảo"
   với số tiền âm; công nợ và số dư quỹ đã về lại.
4. **Không** hủy dòng tiền của phiếu thanh toán ở sổ dòng tiền — hệ
   thống từ chối; đảo ở trang công nợ như trên.
