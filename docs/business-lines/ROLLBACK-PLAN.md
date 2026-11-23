# TVK V2.0 — Rollback Plan (kế hoạch quay lại khi phát hành lỗi)

> Không có migration "down" tự động cho 0025–0030. Rollback duy nhất
> là **khôi phục toàn bộ database từ bản sao lưu trước phát hành +
> đưa code về bản cũ**. Vì vậy bản sao lưu ở Giai đoạn 1 của release
> checklist là bắt buộc — không có sao lưu thì không rollback được.

## 1. Khi nào rollback

Rollback khi **bất kỳ** điều nào sau đây xảy ra trong lúc phát hành:

- Một migration báo lỗi và không rõ nguyên nhân sau khi điều tra nhanh.
- Số liệu live sau migration lệch với baseline (đếm hoặc tiền, dù 1
  đồng) và không giải thích được ngay.
- BL-020 lệch (tổng theo ngành ≠ tổng hợp).
- Tài khoản chưa gán ngành vẫn thấy số liệu, hoặc role đảo bút toán
  sai.
- App production lỗi nghiêm trọng sau khi deploy (trang chính không
  tải được, không đăng nhập được) và không sửa nhanh được.

**Không rollback khi:** chỉ lỗi hiển thị nhỏ (chữ, màu, vị trí) mà
số liệu đúng — trường hợp đó sửa bằng commit hotfix lên nhánh rồi
deploy lại, không đụng database.

**Quyết định rollback do chủ cửa hàng đưa ra** (Muse đề xuất + chuẩn
bị, chủ gật đầu). Trừ trường hợp hệ thống sập hoàn toàn không vào
được — lúc đó rollback ngay rồi báo chủ sau.

## 2. Rollback database: khôi phục từ sao lưu

1. Dừng mọi nhập liệu (báo nhân viên dừng ngay).
2. Khôi phục database live từ bản sao lưu đã kiểm chứng ở Giai đoạn 1
   (restore toàn bộ: schema + data + auth users). Cách khôi phục tuỳ
   cách đã sao lưu — Supabase Dashboard → Database → Backups (gói
   Free chỉ restore được bản sao lưu ngày của Supabase) hoặc `psql`
   từ file `pg_dump` (cần mật khẩu database — chỉ chủ giữ).
3. Kiểm tra sau khôi phục (chạy trên live, SELECT chỉ-đọc):
   - Đếm: sản phẩm 46, lô 46, bút toán 114, chứng từ bán 1,
     phải thu 1, phải trả 0, thanh toán 0, quỹ 1.
   - Tiền: phải thu 342.755.000, phải trả 0.
   - `business_lines` / `payment_allocations` / `user_business_lines`
     **không còn tồn tại** (đã về trạng thái trước 0025).
   - Đăng nhập OWNER được, dashboard hiện số cũ.

**Lưu ý quan trọng:** mọi giao dịch nhập trong lúc phát hành (từ lúc
chạy migration tới lúc rollback) sẽ **mất** vì không có trong bản sao
lưu. Vì vậy cửa sổ bảo trì phải cấm nhập liệu tuyệt đối — nếu có giao
dịch lọt vào, ghi lại tay để nhập lại sau rollback.

## 3. Rollback code: đưa app về bản cũ

Database và code phải về cặp với nhau — chỉ rollback một bên sẽ làm
app lỗi (code mới cần schema mới; code cũ không hiểu schema mới).

1. Trên Vercel, redeploy deployment trước đó của `main` (deployment
   gần nhất trước lúc merge nhánh V2.0) — hoặc `git revert` merge
   commit rồi push `main` để Vercel deploy lại.
2. Chờ deploy xong, kiểm tra https://tvk-demo.vercel.app: đăng nhập
   OWNER, mở Tổng quan — số đúng như trước phát hành, không còn mục
   tách ngành.
3. Kiểm tra 1 tài khoản nhân viên đăng nhập được bình thường.

## 4. Sau rollback

- [ ] Báo nhân viên: hệ thống đã về bản cũ, nhập liệu bình thường.
- [ ] Ghi lại sự cố: migration nào lỗi, thông báo lỗi đầy đủ, số nào
      lệch, vào `IMPLEMENTATION-REPORT.md` (§P6).
- [ ] Điều tra nguyên nhân trên **staging** (không thử lại trên live):
      chạy lại đúng bước lỗi, sửa migration/code trên nhánh, chạy lại
      toàn bộ rehearsal từ đầu, rồi mới lên lịch phát hành lại.
- [ ] Không chạy lại migration lỗi trên live khi chưa có rehearsal
      PASS mới.

## 5. Trường hợp không rollback được

- **Mất/không dùng được bản sao lưu:** dừng mọi thao tác, giữ nguyên
  hiện trạng, báo chủ ngay. Phương án cuối là sửa tiến (forward-fix)
  trên live — chỉ làm khi chủ đồng ý và có người rà soát từng lệnh.
- **Đã có giao dịch mới sau phát hành rồi mới phát hiện lỗi số liệu:**
  không restore (sẽ mất giao dịch mới). Chuyển sang sửa tiến: đối
  chiếu từng chứng từ, sửa bằng phiếu đảo ngược theo quy trình kế
  toán (P3), không sửa tay số liệu trong database.
- **Lỗi chỉ ở một migration sau (ví dụ 0030):** có thể cân nhắc chỉ
  gỡ phần đó — 0030 chỉ tạo view nên gỡ bằng `DROP VIEW` an toàn;
  0025–0029 thay đổi bảng/triggers nên **không gỡ lẻ**, phải rollback
  toàn bộ theo §2.
