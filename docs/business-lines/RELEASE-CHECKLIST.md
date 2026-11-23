# TVK V2.0 — Release Checklist (lên Production)

> Chỉ bắt đầu checklist này khi **staging rehearsal đã PASS** (xem
> `STAGING-REHEARSAL.md`). Mọi bước có dấu **✋ CHỦ GẬT ĐẦU** đều phải
> được chủ cửa hàng xác nhận rõ ràng trước khi làm — không tự ý vượt.
>
> Nguyên tắc: **database và code đi cặp với nhau** — code trên nhánh
> `feature/tvk-v2-business-lines` bắt buộc phải có schema 0025–0030
> mới chạy được, và ngược lại schema mới không tương thích code cũ
> trên `main`. Vì vậy không rollback một bên mà bỏ bên kia (xem
> `ROLLBACK-PLAN.md`).

## Giai đoạn 0 — Trước ngày phát hành

- [ ] **✋ CHỦ GẬT ĐẦU:** staging rehearsal PASS (đủ 6 migration,
      số liệu khớp live, UAT tay không lỗi) — chủ xác nhận bằng lời.
- [ ] **✋ CHỦ GẬT ĐẦU:** phương pháp tạo staging đã chọn và staging
      đã dựng xong (A/B/C trong runbook staging).
- [ ] **✋ CHỦ GẬT ĐẦU:** tài khoản mới tạo sau này tự gán Phụ tùng
      hay chủ gán tay (câu hỏi mở từ P2 — nếu chưa quyết thì mặc định
      hiện tại là **chưa gán = không thấy gì**, chủ gán tay trong Cài
      đặt).
- [ ] File import bổ sung T10+T11: xác nhận **chưa import** trước
      phát hành (đang chờ chủ quyết riêng). Nếu chủ muốn import trước
      thì import trên live **trước** bước sao lưu (Giai đoạn 1), rồi
      đối chiếu lại baseline — không import sau khi đã chạy migration.
- [ ] Nhánh `feature/tvk-v2-business-lines` đã push đủ lên origin,
      không còn commit chưa push, working tree sạch.

## Giai đoạn 1 — Sao lưu production (bắt buộc, không bỏ qua)

- [ ] Sao lưu đầy đủ database live (schema + data + auth users).
      Gói Free không có PITR nên bản sao lưu này là **đường rollback
      duy nhất** — mất sao lưu = không rollback được.
- [ ] **Kiểm chứng sao lưu dùng được:** restore thử bản sao lưu vào
      staging (hoặc database thử) và đếm lại theo bảng baseline trong
      runbook staging §0. Restore không được = dừng, chưa phát hành.
- [ ] Ghi lại: thời gian sao lưu, nơi lưu, ai giữ, mã hash/kích thước
      file (nếu có).
- [ ] **✋ CHỦ GẬT ĐẦU:** chủ xác nhận đã có sao lưu và đồng ý bắt
      đầu cửa sổ bảo trì.

## Giai đoạn 2 — Cửa sổ bảo trì (giờ thấp điểm, do chủ chọn)

- [ ] Báo cho nhân viên (bán hàng/kho/kế toán) biết hệ thống tạm dừng
      trong cửa sổ bảo trì; không ai nhập liệu trong lúc chạy.
- [ ] Ghi lại số liệu baseline live ngay trước khi chạy (chạy các
      truy vấn §3 runbook staging trên live, SELECT chỉ-đọc): đếm +
      tiền + BL-020. Lưu kết quả để đối chiếu sau.

## Giai đoạn 3 — Chạy migration lên live (đúng thứ tự)

Chạy bằng SQL Editor của project Supabase live, từng file một (paste
toàn bộ nội dung file, như cách đã chạy 0021/0022/0024). Trước mỗi
file, kiểm tra lại đã đăng nhập đúng tài khoản hlthanh1992@gmail.com
và đúng project `htgxqdwgvcfqdoevnjgd` trong URL.

- [ ] `0025_business_lines.sql` — kiểm tra: đủ 2 ngành, 46 sản phẩm
      về AUTO_PARTS, 0 chưa phân loại.
- [ ] `0026_default_assignments_fail_closed.sql` — kiểm tra: đủ 5
      dòng gán AUTO_PARTS. Nếu báo `P2 SEED THIẾU`: **dừng ngay**,
      không chạy tiếp (xem rollback plan).
- [ ] `0027_payment_allocations_reversal.sql` — kiểm tra: bảng
      `payment_allocations` tồn tại, đang rỗng.
- [ ] `0028_allocation_cutover.sql` — kiểm tra: phải thu/phải trả
      không đổi.
- [ ] `0029_finance_vat.sql` — kiểm tra: `vat_invoices` có cột
      `business_line_id`; phải thu/phải trả không đổi.
- [ ] `0030_reporting_aggregation.sql` — kiểm tra: đủ 10 view; tổng
      theo ngành = tổng hợp (BL-020).

**Quy tắc khi lỗi:** dừng ngay tại file lỗi, không chạy file sau,
không chạy lại khi chưa rõ nguyên nhân. Quyết định tiếp theo là
rollback (xem `ROLLBACK-PLAN.md`) hoặc sửa rồi chạy lại rehearsal —
do chủ quyết, không tự ý.

## Giai đoạn 4 — Đối chiếu số liệu live sau migration

- [ ] Chạy lại toàn bộ truy vấn §3 runbook staging trên live: đếm
      (46/46/114/1/1/0/0/1), tiền phải thu 342.755.000 / phải trả 0,
      BL-020 khớp.
- [ ] Đăng nhập live bằng tài khoản OWNER: dashboard Tổng quan hiện
      đúng số cũ (doanh thu 342.755.000, lãi 88.895.335, tồn kho
      5.373.234.100); bảng "So sánh theo ngành" + "Công nợ theo
      ngành" hiện đúng.
- [ ] Đăng nhập bằng 1 tài khoản nhân viên (bán hàng hoặc kho): chỉ
      thấy Phụ tùng, không thấy số tiền nhạy cảm ngoài quyền.
- [ ] Thử tạo 1 chứng từ nháp rồi xoá (không xác nhận) — form chạy
      bình thường.

## Giai đoạn 5 — Đưa code mới lên production

- [ ] **✋ CHỦ GẬT ĐẦU:** số liệu live sau migration đã khớp, chủ
      đồng ý merge.
- [ ] Merge nhánh `feature/tvk-v2-business-lines` vào `main`
      (merge commit, không squash mất lịch sử từng phase).
- [ ] Vercel tự deploy từ `main` — chờ deploy xong (khoảng 2–3 phút),
      kiểm tra lại trên https://tvk-demo.vercel.app sau khi build đã
      ổn định (không kiểm tra ngay 1–2 phút đầu vì có thể còn thấy
      bản cũ).
- [ ] Kiểm tra smoke trên production: đăng nhập OWNER, mở Tổng quan,
      Bán hàng, Phải thu, Hoá đơn GTGT — trang tải được, số đúng.

## Giai đoạn 6 — Sau phát hành

- [ ] Theo dõi 24h đầu: nhân viên nhập liệu bình thường; kiểm tra
      mỗi chứng từ mới đều có ngành, không có chứng từ NULL ngành
      (truy vấn: `SELECT count(*) FROM sales_documents WHERE
      business_line_id IS NULL AND status = 'CONFIRMED'` → 0).
- [ ] Đối chiếu lại sau 24h: tổng theo ngành = tổng hợp (BL-020),
      phải thu/phải trả khớp với sổ kế toán.
- [ ] Ghi lại vào `IMPLEMENTATION-REPORT.md` (§P6): ngày phát hành,
      người chạy, số liệu đối chiếu, sự cố (nếu có).
- [ ] Thông báo cho nhân viên: hệ thống đã tách ngành; tài khoản mới
      (nếu có) cần chủ gán ngành trước khi dùng.

## Không thuộc checklist này (việc riêng, làm sau)

- Import bổ sung T10+T11 (chờ chủ quyết riêng).
- Chạy Tier 4 E2E (cần file mẫu từ máy Windows của chủ).
- Workflow phê duyệt tách tỷ lệ BL-014 (hiện chỉ có view hàng đợi).
- Biểu đồ doanh thu theo cấp nhớt/thương hiệu E10 (cần quy tắc chuẩn
  hoá `sae_viscosity`/`brand` — chưa có).
- Quyết quỹ chung hay riêng két (chưa quyết — cả hai mô hình đều
  chạy được với schema hiện tại).
